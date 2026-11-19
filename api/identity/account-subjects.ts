import { type ClientSession, MongoServerError, type ObjectId } from "mongodb";
import { z } from "zod";
import type { Audit } from "../audit/service";
import type { OwnerGrant } from "../authorization/owner-grant";
import type { TenantGrant } from "../authorization/tenant-grant";
import { AppError, requireCondition } from "../errors";
import { objectId, parse, version } from "../http-validation";
import type { Database } from "../infrastructure/database";
import { type PortalMembers, portalEligible } from "../members/portal";
import type { Operations } from "../operations/service";
import type { ChurchAccess } from "../tenancy/access";
import { TenantQueries } from "../tenant-queries";
import { type Account, accountDto } from "./accounts-model";

const id = z
  .string()
  .regex(/^[a-f0-9]{24}$/i)
  .transform((x) => x.toLowerCase());
const reason = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .refine((s) => [...s].every((c) => (c.codePointAt(0) ?? 0) >= 32 && c.codePointAt(0) !== 127));
const input = z.union([
  z.strictObject({
    memberId: id,
    memberVersion: z.number().int().positive(),
    reason,
    confirm: z.literal(true),
  }),
  z.strictObject({ memberId: z.null(), reason, confirm: z.literal(true) }),
]);

export async function recordSubjectChange(
  db: Database,
  account: Account,
  by: ObjectId,
  changes: {
    before: ObjectId | null;
    after: ObjectId | null;
    reason: string;
    operationId: ObjectId;
    at: Date;
  },
  tx: ClientSession,
) {
  await db.db.collection("account_subject_history").insertOne(
    {
      churchId: account.churchId,
      accountId: account._id,
      actorId: by,
      ...changes,
    },
    { session: tx },
  );
}

export function revokeAccountSessions(
  db: Database,
  account: Account,
  when: Date,
  tx: ClientSession,
) {
  return db.sessions.updateMany(
    {
      realm: "church",
      principalId: account._id,
      churchId: account.churchId,
      revokedAt: { $exists: false },
    },
    { $set: { revokedAt: when }, $inc: { writeFence: 1 } },
    { session: tx },
  );
}

export class AccountSubjects {
  private queries: TenantQueries;
  constructor(
    private db: Database,
    private access: ChurchAccess,
    private members: PortalMembers,
    private ops: Operations,
    private audit: Audit,
    key: string,
    private now: () => Date,
  ) {
    this.queries = new TenantQueries(key, now, "account-subjects");
  }
  private get accounts() {
    return this.db.db.collection<Account>("accounts");
  }
  private async load(churchId: ObjectId, accountId: ObjectId, tx: ClientSession) {
    const a = await this.accounts.findOne({ _id: accountId, churchId }, { session: tx });
    requireCondition(a, 404, "NOT_FOUND");
    requireCondition(
      a.role === "member" && a.scope.kind === "self",
      422,
      "PORTAL_ACCOUNT_NOT_ELIGIBLE",
    );
    return a;
  }
  async options(grant: OwnerGrant, churchId: ObjectId, accountId: ObjectId, q: URLSearchParams) {
    this.queries.allow(q, ["q", "limit", "cursor"]);
    const term = q.get("q")?.trim() ?? "",
      limit = this.queries.limit(q);
    requireCondition(term.length <= 100, 400, "INVALID_REQUEST");
    return this.db.readSnapshot(churchId.toHexString(), async (tx) => {
      await grant.fence(tx);
      await this.access.fence(churchId, tx, true);
      const account = await this.load(churchId, accountId, tx);
      const cursorGrant: TenantGrant = {
        actorKind: "owner",
        actorId: grant.actorId,
        churchId,
        policyContext: String(account.version),
        canWrite: false,
        fence: grant.fence,
      };
      const subject = account.subjectMemberId
        ? await this.members.profile(churchId, account.subjectMemberId, tx)
        : null;
      const context = this.queries.context(cursorGrant, accountId.toHexString(), term);
      const token = q.get("cursor");
      const rows = await this.members.page(
        churchId,
        term,
        token ? this.queries.decode(token, context) : null,
        limit + 1,
        tx,
      );
      const more = rows.length > limit;
      if (more) rows.pop();
      const last = rows.at(-1);
      const eligible =
        !!subject &&
        !!account.subjectMemberVersion &&
        portalEligible(subject) &&
        subject.version >= account.subjectMemberVersion &&
        !(await this.members.accessBroken(churchId, subject.id, account.subjectMemberVersion, tx));
      return {
        items: rows.map(({ nameKey: _, ...item }) => item),
        current: subject
          ? {
              memberId: subject.id.toHexString(),
              code: subject.code,
              fullName: subject.fullName,
              eligible,
            }
          : null,
        nextCursor: more && last ? this.queries.encode(context, last.nameKey, last.id) : null,
      };
    });
  }
  async update(
    g: OwnerGrant,
    churchId: ObjectId,
    accountId: ObjectId,
    raw: unknown,
    key: string | null,
    match: string | null,
    requestId: string,
  ) {
    const body = parse(input, raw),
      expected = version(match);
    const route = `/owner/churches/${churchId}/accounts/${accountId}/subject`;
    try {
      return await this.ops.execute(
        g,
        "PATCH",
        route,
        key,
        body,
        expected,
        async (tx, operationId) => {
          await this.access.fence(churchId, tx, true);
          const a = await this.load(churchId, accountId, tx);
          requireCondition(a.version === expected, 412, "VERSION_CONFLICT");
          const nextId = body.memberId ? objectId(body.memberId) : null;
          if (nextId) requireCondition(a.status === "active", 422, "PORTAL_ACCOUNT_NOT_ELIGIBLE");
          const target = nextId ? await this.members.profile(churchId, nextId, tx) : null;
          requireCondition(!nextId || target, 404, "NOT_FOUND");
          if (target && body.memberId !== null) {
            requireCondition(portalEligible(target), 422, "PORTAL_MEMBER_NOT_ELIGIBLE");
            requireCondition(target.version === body.memberVersion, 412, "PORTAL_MEMBER_CHANGED");
            await this.members.fence(churchId, target.id, target.version, tx);
          }
          const before = a.subjectMemberId ?? null;
          requireCondition(target || before, 422, "PORTAL_LINK_REQUIRED");
          const at = this.now();
          const updated = await this.accounts.findOneAndUpdate(
            { churchId, _id: accountId, version: expected },
            {
              $set: {
                updatedAt: at,
                updatedBy: g.actorId,
                ...(target
                  ? { subjectMemberId: target.id, subjectMemberVersion: target.version }
                  : {}),
              },
              ...(target ? {} : { $unset: { subjectMemberId: "", subjectMemberVersion: "" } }),
              $inc: { version: 1, authEpoch: 1, writeFence: 1 },
            },
            { session: tx, returnDocument: "after" },
          );
          requireCondition(updated, 412, "VERSION_CONFLICT");
          await revokeAccountSessions(this.db, updated, at, tx);
          await recordSubjectChange(
            this.db,
            updated,
            g.actorId,
            { before, after: nextId, reason: body.reason, operationId, at },
            tx,
          );
          await this.audit.principal(
            "account.subject_changed",
            requestId,
            { kind: "owner", id: g.actorId, churchId: null },
            { id: accountId, churchId },
            ["subjectMemberId"],
            tx,
            operationId,
            "success",
          );
          return {
            safeResult: { account: accountDto(updated) },
            resourceRefs: [{ type: "account", id: accountId.toHexString() }],
          };
        },
        200,
        true,
      );
    } catch (error) {
      if (
        error instanceof MongoServerError &&
        error.code === 11000 &&
        error.keyPattern?.subjectMemberId
      )
        throw new AppError(409, "PORTAL_SUBJECT_TAKEN");
      throw error;
    }
  }
}
