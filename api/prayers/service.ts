import { type ClientSession, type Filter, MongoServerError, ObjectId } from "mongodb";
import { z } from "zod";
import type { Audit } from "../audit/service";
import type { TenantGrant } from "../authorization/tenant-grant";
import { AppError, requireCondition } from "../errors";
import { objectId, parse, version } from "../http-validation";
import { digest } from "../identity/crypto";
import type { Database } from "../infrastructure/database";
import { businessDay } from "../members/dates";
import { searchName } from "../members/models";
import type { PrayerMembers } from "../members/prayers";
import { escaped } from "../members/queries";
import { canonical, type Operations } from "../operations/service";
import { resourceCode } from "../resource-code";
import { TenantQueries } from "../tenant-queries";
import {
  type Prayer,
  type PrayerGrant,
  type PrayerHistory,
  prayerDto,
  type RequesterSnapshot,
} from "./models";
import { categories, commandInput, type PrayerCommand, personalPrayerInput } from "./validation";

interface PortalPrayerGrant extends TenantGrant {
  actorKind: "church_user";
  memberId: ObjectId;
}

const personalPrayerStatus = (state: Prayer["state"]): "sent" | "closed" | "cancelled" =>
  state === "closed" ? "closed" : state === "cancelled" ? "cancelled" : "sent";

export class Prayers {
  private query: TenantQueries;
  constructor(
    private db: Database,
    private members: PrayerMembers,
    private ops: Operations,
    private audit: Audit,
    key: string,
    private now: () => Date,
  ) {
    this.query = new TenantQueries(key, now, "prayers");
  }
  private get rows() {
    return this.db.db.collection<Prayer>("prayer_requests");
  }
  private get histories() {
    return this.db.db.collection<PrayerHistory>("prayer_history");
  }
  private authorized(g: PrayerGrant, write = false) {
    requireCondition(
      ["shared", "all"].includes(g.prayerAudience) &&
        !g.unitScope &&
        !g.receiptScope &&
        (!write || g.canWrite) &&
        (g.prayerAudience !== "all" || g.actorKind === "church_user"),
      403,
      "FORBIDDEN",
    );
  }
  private visible(g: PrayerGrant): Filter<Prayer> {
    return {
      churchId: g.churchId,
      ...(g.prayerAudience === "all" ? {} : { visibility: "shared" }),
    };
  }
  private context(g: PrayerGrant, route: string, filters: unknown) {
    return this.query.context(g, route, [g.prayerAudience, filters]);
  }
  private async raw(g: PrayerGrant, id: string, tx: ClientSession) {
    const p = await this.rows.findOne({ ...this.visible(g), _id: objectId(id) }, { session: tx });
    requireCondition(p, 404, "NOT_FOUND");
    return p;
  }
  private async authorizeOperation(
    g: PrayerGrant,
    op: { resourceRefs: { type: string; id: string }[] },
    tx: ClientSession,
  ) {
    requireCondition(
      op.resourceRefs.length > 0 && op.resourceRefs.every((r) => r.type === "prayer_request"),
      404,
      "NOT_FOUND",
    );
    for (const r of op.resourceRefs) await this.raw(g, r.id, tx);
  }
  async people(g: PrayerGrant, q: URLSearchParams) {
    this.authorized(g);
    this.query.allow(q, ["q", "limit", "cursor"]);
    const term = (q.get("q") ?? "").normalize("NFC").trim(),
      limit = this.query.limit(q);
    requireCondition(term.length <= 100, 400, "INVALID_REQUEST");
    const context = this.context(g, "people", term),
      after = q.has("cursor") ? this.query.decode(q.get("cursor") as string, context) : null;
    return this.db.readSnapshot(g.churchId.toHexString(), async (tx) => {
      await g.fence(tx);
      const rows = await this.members.page(g, term, after, limit + 1, tx),
        more = rows.length > limit;
      rows.splice(limit);
      const last = rows.at(-1);
      return {
        items: rows.map((p) => ({ id: p.id, code: p.code, fullName: p.fullName })),
        nextCursor: more && last ? this.query.encode(context, last.key, last.id) : null,
      };
    });
  }
  async list(g: PrayerGrant, q: URLSearchParams) {
    this.authorized(g);
    this.query.allow(q, ["q", "state", "category", "visibility", "limit", "cursor"]);
    const state = q.get("state") ?? "active",
      category = q.get("category"),
      visibility = q.get("visibility") ?? "all",
      term = searchName(q.get("q") ?? "");
    requireCondition(
      ["active", "all", "open", "shared", "closed", "cancelled"].includes(state) &&
        ["all", "shared", "pastoral"].includes(visibility) &&
        (!category || categories.includes(category as Prayer["category"])) &&
        term.length <= 100,
      400,
      "INVALID_REQUEST",
    );
    requireCondition(visibility !== "pastoral" || g.prayerAudience === "all", 403, "FORBIDDEN");
    const f: Filter<Prayer> = {
      ...this.visible(g),
      ...(visibility !== "all" ? { visibility: visibility as Prayer["visibility"] } : {}),
      ...(state === "active"
        ? { state: { $in: ["open", "shared"] } }
        : state !== "all"
          ? { state: state as Prayer["state"] }
          : {}),
      ...(category ? { category: category as Prayer["category"] } : {}),
      ...(term
        ? {
            $or: [
              { contentKey: { $regex: `^${escaped(term)}` } },
              { requesterNameKey: { $regex: `^${escaped(term)}` } },
              { code: { $regex: `^${escaped(term.toUpperCase())}` } },
            ],
          }
        : {}),
    };
    const limit = this.query.limit(q),
      context = this.context(g, "list", [state, category, visibility, term]),
      after = q.has("cursor") ? this.query.decode(q.get("cursor") as string, context) : null;
    return this.db.readSnapshot(g.churchId.toHexString(), async (tx) => {
      await g.fence(tx);
      const counts = await this.rows
        .aggregate<{ _id: Prayer["state"]; count: number }>(
          [{ $match: f }, { $group: { _id: "$state", count: { $sum: 1 } } }],
          { session: tx },
        )
        .toArray();
      const rows = await this.rows
          .find({ ...f, ...(after ? { _id: { $lt: objectId(after.id) } } : {}) }, { session: tx })
          .sort({ _id: -1 })
          .limit(limit + 1)
          .toArray(),
        more = rows.length > limit;
      rows.splice(limit);
      const last = rows.at(-1),
        count = (state: Prayer["state"]) => counts.find((c) => c._id === state)?.count ?? 0;
      return {
        items: rows.map(prayerDto),
        summary: {
          total: counts.reduce((n, c) => n + c.count, 0),
          active: count("open") + count("shared"),
          closed: count("closed"),
          cancelled: count("cancelled"),
        },
        audience: g.prayerAudience,
        principalKey: `${g.actorKind}:${g.actorId}:${g.policyContext}:${g.prayerAudience}`,
        canManage: g.canWrite,
        nextCursor: more && last ? this.query.encode(context, "", last._id.toHexString()) : null,
        day: businessDay(this.now()),
      };
    });
  }
  async activeCount(g: PrayerGrant, tx: ClientSession) {
    this.authorized(g);
    return this.rows.countDocuments(
      { ...this.visible(g), state: { $in: ["open", "shared"] } },
      { session: tx },
    );
  }
  async get(g: PrayerGrant, id: string) {
    this.authorized(g);
    return this.db.readSnapshot(g.churchId.toHexString(), async (tx) => {
      await g.fence(tx);
      const p = await this.raw(g, id, tx),
        current =
          p.requester.kind === "member" ? await this.members.person(g, p.requester.id, tx) : null;
      return {
        ...prayerDto(p),
        ...(p.portalSubmission ? { fromPortal: true } : {}),
        source:
          p.requester.kind === "member"
            ? {
                available: !!current?.available,
                changed:
                  !current ||
                  current.fullName !== p.requesterSnapshot.name ||
                  current.code !== p.requesterSnapshot.code,
                current: current
                  ? { id: current.id, code: current.code, fullName: current.fullName }
                  : null,
              }
            : null,
      };
    });
  }
  private async proposal(g: PrayerGrant, b: PrayerCommand, old: Prayer | null, tx: ClientSession) {
    requireCondition(old ? b.action !== "create" : b.action === "create", 422, "VALIDATION_FAILED");
    requireCondition(
      !old || ["open", "shared"].includes(old.state) || b.action === "correct",
      409,
      "PRAYER_CLOSED",
    );
    requireCondition(
      !old?.portalSubmission || b.action === "close" || b.action === "cancel",
      422,
      b.action === "share" ? "PRAYER_PRIVATE_SHARE" : "PRAYER_PORTAL_IMMUTABLE",
    );
    if (b.action !== "create") requireCondition(b.reason, 422, "REASON_REQUIRED");
    const visibility = old?.visibility ?? (b.action === "create" ? b.visibility : "shared");
    requireCondition(visibility !== "pastoral" || g.prayerAudience === "all", 403, "FORBIDDEN");
    const fields =
      "fields" in b
        ? b.fields
        : {
            content: (old as Prayer).content,
            category: (old as Prayer).category,
            receivedOn: (old as Prayer).receivedOn,
            requester: (old as Prayer).requester,
          };
    requireCondition(
      !fields.receivedOn || fields.receivedOn <= businessDay(this.now()),
      422,
      "PRAYER_DATE_INVALID",
    );
    let snapshot: RequesterSnapshot,
      source: Awaited<ReturnType<PrayerMembers["person"]>> = null;
    if (old && canonical(fields.requester) === canonical(old.requester))
      snapshot = old.requesterSnapshot;
    else if (fields.requester.kind === "member") {
      source = await this.members.person(g, fields.requester.id, tx);
      requireCondition(source?.available, 422, "PRAYER_SOURCE_UNAVAILABLE");
      snapshot = { kind: "member", id: source.id, code: source.code, name: source.fullName };
    } else
      snapshot = {
        kind: fields.requester.kind,
        id: null,
        code: null,
        name: fields.requester.kind === "text" ? fields.requester.name : null,
      };
    const sharedOn =
      b.action === "share"
        ? b.sharedOn
        : b.action === "correct" && b.sharedOn !== undefined
          ? b.sharedOn
          : (old?.sharedOn ?? null);
    if (b.action === "correct" && b.sharedOn !== undefined)
      requireCondition(old?.sharedOn, 422, "PRAYER_STATE_CONFLICT");
    if (b.action === "share") {
      requireCondition(visibility === "shared", 422, "PRAYER_PRIVATE_SHARE");
      requireCondition(old?.state === "open", 409, "PRAYER_STATE_CONFLICT");
    }
    requireCondition(
      !sharedOn ||
        (sharedOn <= businessDay(this.now()) &&
          (!fields.receivedOn || sharedOn >= fields.receivedOn)),
      422,
      "PRAYER_DATE_INVALID",
    );
    const state =
      b.action === "share"
        ? "shared"
        : b.action === "close"
          ? "closed"
          : b.action === "cancel"
            ? "cancelled"
            : (old?.state ?? "open");
    const context = digest(
      canonical({
        actor: [g.actorKind, g.actorId, g.churchId, g.policyContext, g.prayerAudience],
        body: { ...b, preview: null, confirmed: false },
        version: old?.version ?? 0,
        source,
        snapshot,
        day: businessDay(this.now()),
      }),
    );
    return { visibility, fields, snapshot, source, sharedOn, state, context };
  }
  async preview(g: PrayerGrant, id: string | null, raw: unknown, match: string | null) {
    this.authorized(g, true);
    const b = parse(commandInput, raw),
      expected = id ? version(match) : null;
    return this.db.readSnapshot(g.churchId.toHexString(), async (tx) => {
      await g.fence(tx);
      const old = id ? await this.raw(g, id, tx) : null;
      requireCondition(!old || old.version === expected, 412, "VERSION_CONFLICT");
      const p = await this.proposal(g, b, old, tx);
      return {
        context: p.context,
        action: b.action,
        before: old ? prayerDto(old) : null,
        fields: p.fields,
        requesterSnapshot: p.snapshot,
        visibility: p.visibility,
        state: p.state,
        sharedOn: p.sharedOn,
        reason: b.reason,
        confirmationRequired: true,
      };
    });
  }
  async save(
    g: PrayerGrant,
    id: string | null,
    raw: unknown,
    key: string | null,
    match: string | null,
    requestId: string,
  ) {
    this.authorized(g, true);
    const b = parse(commandInput, raw),
      expected = id ? version(match) : null;
    const guarded = {
      ...g,
      fence: async (tx: ClientSession) => {
        await g.fence(tx);
        this.authorized(g, true);
        if (id) await this.raw(g, id, tx);
      },
    };
    return this.ops.executeTenant(
      guarded,
      id ? "PATCH" : "POST",
      `prayers/${g.churchId}/requests${id ? `/${objectId(id)}` : ""}`,
      key,
      b,
      expected,
      async (tx, op) => {
        const before = id ? await this.raw(g, id, tx) : null;
        requireCondition(!before || before.version === expected, 412, "VERSION_CONFLICT");
        const p = await this.proposal(g, b, before, tx);
        requireCondition(b.preview === p.context, 412, "PRAYER_PREVIEW_STALE");
        requireCondition(b.confirmed, 422, "PRAYER_CONFIRMATION_REQUIRED");
        if (p.source) await this.members.fence(g, p.source, tx);
        const now = this.now(),
          prayer: Prayer = {
            _id: before?._id ?? new ObjectId(),
            churchId: g.churchId,
            code: before?.code ?? resourceCode("CT"),
            version: (before?.version ?? 0) + 1,
            ...p.fields,
            requesterSnapshot: p.snapshot,
            requesterNameKey: searchName(p.snapshot.name ?? ""),
            contentKey: searchName(p.fields.content),
            visibility: p.visibility,
            state: p.state,
            sharedOn: p.sharedOn,
            closeReason: ["close", "cancel"].includes(b.action)
              ? b.reason
              : (before?.closeReason ?? null),
            closedAt: ["close", "cancel"].includes(b.action) ? now : (before?.closedAt ?? null),
            ...(before?.portalSubmission ? { portalSubmission: before.portalSubmission } : {}),
            createdAt: before?.createdAt ?? now,
            updatedAt: now,
          };
        if (before) {
          const saved = await this.rows.replaceOne(
            { ...this.visible(g), _id: before._id, version: expected as number },
            prayer,
            { session: tx },
          );
          requireCondition(saved.matchedCount, 412, "VERSION_CONFLICT");
        } else await this.rows.insertOne(prayer, { session: tx });
        await this.recordChange(g, prayer, before, b.action, b.reason, op, requestId, tx);
        return {
          safeResult: {
            prayerId: prayer._id.toHexString(),
            version: prayer.version,
            state: prayer.state,
          },
          resourceRefs: [{ type: "prayer_request", id: prayer._id.toHexString() }],
        };
      },
      id ? 200 : 201,
      (tx, op) => this.authorizeOperation(g, op, tx),
    );
  }
  private async recordChange(
    g: TenantGrant,
    prayer: Prayer,
    before: Prayer | null,
    action: PrayerCommand["action"],
    reason: string | null,
    op: ObjectId,
    requestId: string,
    tx: ClientSession,
  ) {
    await this.histories.insertOne(
      {
        _id: new ObjectId(),
        churchId: g.churchId,
        prayerId: prayer._id,
        event: action,
        operationId: op,
        reason,
        before: before ? prayerDto(before) : null,
        after: prayerDto(prayer),
        actorId: g.actorId,
        actorKind: g.actorKind,
        occurredAt: prayer.updatedAt,
      },
      { session: tx },
    );
    await this.audit.organization(
      `prayer.${action}`,
      requestId,
      {
        kind: g.actorKind,
        id: g.actorId,
        churchId: g.actorKind === "owner" ? null : g.churchId,
      },
      g.churchId,
      "prayer_request",
      prayer._id,
      [action],
      op,
      tx,
      `prayer.${action}`,
      prayer.visibility === "pastoral" ? "pastoral" : "general",
    );
  }

  async personalPage(
    churchId: ObjectId,
    accountId: ObjectId,
    memberId: ObjectId,
    afterId: string | null,
    limit: number,
    tx: ClientSession,
  ) {
    return (
      await this.rows
        .find(
          {
            churchId,
            visibility: "pastoral",
            "portalSubmission.accountId": accountId,
            "portalSubmission.memberId": memberId,
            ...(afterId ? { _id: { $lt: objectId(afterId) } } : {}),
          },
          {
            session: tx,
            maxTimeMS: 3000,
            projection: { code: 1, category: 1, content: 1, createdAt: 1, state: 1 },
          },
        )
        .sort({ _id: -1 })
        .limit(limit)
        .toArray()
    ).map((row) => ({
      id: row._id.toHexString(),
      code: row.code,
      category: row.category,
      content: row.content,
      submittedAt: row.createdAt.toISOString(),
      status: personalPrayerStatus(row.state),
    }));
  }

  async sendPersonal(g: PortalPrayerGrant, raw: unknown, rawKey: string | null, requestId: string) {
    const b = parse(personalPrayerInput, raw);
    requireCondition(b.confirmed, 422, "PRAYER_CONFIRMATION_REQUIRED");
    const parsedKey = z.uuid().safeParse(rawKey);
    requireCondition(parsedKey.success, 400, "INVALID_REQUEST");
    const key = parsedKey.data.toLowerCase(),
      payloadHash = digest(canonical(b));
    const intent: Filter<Prayer> = {
      churchId: g.churchId,
      visibility: "pastoral",
      "portalSubmission.accountId": g.actorId,
      "portalSubmission.key": key,
    };
    const sameIntent = (row: Prayer) => {
      requireCondition(
        row.portalSubmission?.memberId.equals(g.memberId) &&
          row.portalSubmission.payloadHash === payloadHash,
        409,
        "IDEMPOTENCY_CONFLICT",
      );
      return row;
    };
    const receipt = (row: Prayer) => ({ code: row.code, status: "sent" as const });
    try {
      const result = await this.ops.executeTenant(
        g,
        "POST",
        `prayers/${g.churchId}/portal-submission`,
        key,
        b,
        null,
        async (tx, op) => {
          const existing = await this.rows.findOne(intent, { session: tx });
          if (existing) {
            sameIntent(existing);
            return {
              safeResult: { ...receipt(existing), reconciled: true },
              resourceRefs: [{ type: "prayer_request", id: existing._id.toHexString() }],
            };
          }
          const subject = await this.members.person(g, g.memberId.toHexString(), tx);
          requireCondition(subject?.available, 403, "PORTAL_LINK_REQUIRED");
          const now = this.now();
          const prayer: Prayer = {
            _id: new ObjectId(),
            churchId: g.churchId,
            code: resourceCode("CT"),
            version: 1,
            content: b.content,
            category: b.category,
            receivedOn: businessDay(now),
            requester: { kind: "member", id: subject.id },
            requesterSnapshot: {
              kind: "member",
              id: subject.id,
              code: subject.code,
              name: subject.fullName,
            },
            requesterNameKey: searchName(subject.fullName),
            contentKey: searchName(b.content),
            visibility: "pastoral",
            state: "open",
            sharedOn: null,
            closeReason: null,
            closedAt: null,
            createdAt: now,
            updatedAt: now,
            portalSubmission: { accountId: g.actorId, memberId: g.memberId, key, payloadHash },
          };
          await this.rows.insertOne(prayer, { session: tx });
          await this.recordChange(g, prayer, null, "create", null, op, requestId, tx);
          return {
            safeResult: receipt(prayer),
            resourceRefs: [{ type: "prayer_request", id: prayer._id.toHexString() }],
          };
        },
        201,
        async (tx, op) => {
          const ref = op.resourceRefs[0];
          requireCondition(
            op.resourceRefs.length === 1 && ref?.type === "prayer_request",
            404,
            "NOT_FOUND",
          );
          const row = await this.rows.findOne(
            { ...intent, _id: objectId(ref.id) },
            { session: tx },
          );
          requireCondition(row, 404, "NOT_FOUND");
          sameIntent(row);
        },
      );
      const replayed = result.replayed || result.data.reconciled === true;
      return {
        data: { code: result.data.code as string, status: "sent" as const },
        status: replayed ? 200 : result.status,
        replayed,
      };
    } catch (e) {
      // Durable uniqueness outlives the generic operation's replay window.
      if (
        (e instanceof AppError && e.code === "IDEMPOTENCY_EXPIRED") ||
        (e instanceof MongoServerError &&
          e.code === 11000 &&
          e.keyPattern?.["portalSubmission.key"])
      ) {
        return this.db.readSnapshot(g.churchId.toHexString(), async (tx) => {
          await g.fence(tx);
          const row = await this.rows.findOne(intent, { session: tx });
          requireCondition(row, 409, "OPERATION_IN_PROGRESS");
          return { data: receipt(sameIntent(row)), status: 200, replayed: true };
        });
      }
      throw e;
    }
  }

  async history(g: PrayerGrant, id: string, q: URLSearchParams) {
    this.authorized(g);
    this.query.allow(q, ["limit", "cursor"]);
    const limit = this.query.limit(q),
      context = this.context(g, `history/${id}`, null),
      after = q.has("cursor") ? this.query.decode(q.get("cursor") as string, context) : null;
    return this.db.readSnapshot(g.churchId.toHexString(), async (tx) => {
      await g.fence(tx);
      const p = await this.raw(g, id, tx);
      const rows = await this.histories
          .find(
            {
              churchId: g.churchId,
              prayerId: p._id,
              ...(after ? { _id: { $lt: objectId(after.id) } } : {}),
            },
            { session: tx },
          )
          .sort({ _id: -1 })
          .limit(limit + 1)
          .toArray(),
        more = rows.length > limit;
      rows.splice(limit);
      const last = rows.at(-1);
      return {
        items: rows.map((h) => ({
          id: h._id.toHexString(),
          event: h.event,
          reason: h.reason,
          before: h.before,
          after: h.after,
          actorKind: h.actorKind,
          actorId: h.actorId.toHexString(),
          occurredAt: h.occurredAt.toISOString(),
        })),
        nextCursor: more && last ? this.query.encode(context, "", last._id.toHexString()) : null,
      };
    });
  }
  async operation(g: PrayerGrant, id: string) {
    this.authorized(g, true);
    return this.ops.getTenant(g, id, "prayers", (tx, op) => this.authorizeOperation(g, op, tx));
  }
}
