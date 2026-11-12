import { type ClientSession, type Filter, ObjectId } from "mongodb";
import { z } from "zod";
import type { Audit } from "../audit/service";
import type { TenantGrant } from "../authorization/tenant-grant";
import { requireCondition } from "../errors";
import type { Families } from "../families/service";
import { objectId, parse, version } from "../http-validation";
import type { Database } from "../infrastructure/database";
import { businessDay } from "../members/dates";
import type { OrganizationMembers } from "../members/organization";
import { daySchema, idSchema } from "../members/validation";
import type { Operations } from "../operations/service";
import { TenantQueries } from "../tenant-queries";
import { type Settings, type Unit, unitDto } from "./models";

const text = (n: number) => z.string().trim().min(1).max(n);
const common = { reason: text(500), effectiveOn: daySchema };
const detailInput = z.strictObject({
  ...common,
  leaderMemberId: idSchema.nullable(),
  scheduleText: text(500).nullable(),
});
const membershipInput = z
  .strictObject({
    ...common,
    changes: z
      .array(z.strictObject({ id: idSchema, version: z.number().int().min(1), add: z.boolean() }))
      .min(1)
      .max(100),
  })
  .refine((b) => new Set(b.changes.map((c) => c.id.toLowerCase())).size === b.changes.length);
const termInput = z
  .strictObject({
    ...common,
    label: text(100),
    startOn: daySchema.nullable(),
    endOn: daySchema.nullable(),
    appointments: z
      .array(
        z.strictObject({
          memberId: idSchema,
          position: z.enum(["secretary", "treasurer", "deacon"]),
        }),
      )
      .max(100),
  })
  .refine(
    (b) =>
      (!b.startOn || !b.endOn || b.startOn <= b.endOn) &&
      new Set(b.appointments.map((a) => a.memberId.toLowerCase())).size === b.appointments.length &&
      ["secretary", "treasurer"].every(
        (p) => b.appointments.filter((a) => a.position === p).length <= 1,
      ),
  );
interface Appointment {
  memberId: ObjectId;
  code: string;
  fullName: string;
  position: "secretary" | "treasurer" | "deacon";
}
export interface BoardTerm
  extends Omit<Settings, "unitType" | "customUnitLabel" | "defaultAssignmentMode"> {
  churchId: ObjectId;
  label: string;
  startOn: string | null;
  endOn: string | null;
  state: "draft" | "confirmed" | "ended" | "cancelled";
  closedOn?: string;
  lastEffectiveOn?: string;
  appointments: Appointment[];
}
export function termDto(t: BoardTerm) {
  return {
    id: t._id.toHexString(),
    label: t.label,
    startOn: t.startOn,
    endOn: t.endOn,
    state: t.state,
    closedOn: t.closedOn ?? null,
    version: t.version,
    appointments: t.appointments.map((a) => ({ ...a, memberId: a.memberId.toHexString() })),
  };
}
export class OrganizationRuntime {
  private queries: TenantQueries;
  constructor(
    private db: Database,
    private members: OrganizationMembers,
    private families: Pick<Families, "countInArea">,
    private ops: Operations,
    private audit: Audit,
    key: string,
    private now: () => Date,
  ) {
    this.queries = new TenantQueries(key, now, "organization-runtime");
  }
  private get units() {
    return this.db.db.collection<Unit>("organization_units");
  }
  private get terms() {
    return this.db.db.collection<BoardTerm>("organization_terms");
  }
  private get histories() {
    return this.db.db.collection("organization_history");
  }
  private today() {
    return businessDay(this.now());
  }
  private effective(day: string) {
    requireCondition(day <= this.today(), 422, "VALIDATION_FAILED");
  }
  private async unit(g: TenantGrant, id: string, tx: ClientSession) {
    const u = await this.units.findOne(
      {
        _id: objectId(id),
        churchId: g.churchId,
        ...(g.unitScope ? { status: "active" as const } : {}),
      },
      { session: tx },
    );
    requireCondition(
      u && (!g.unitScope || g.unitScope.some((id) => id.toLowerCase() === u._id.toHexString())),
      404,
      "NOT_FOUND",
    );
    return u;
  }
  private async root(g: TenantGrant, tx: ClientSession) {
    const r = await this.db.db
      .collection("church_settings")
      .updateOne({ _id: g.churchId }, { $inc: { writeFence: 1 } }, { session: tx });
    requireCondition(r.matchedCount, 409, "SETTINGS_NOT_CONFIGURED");
  }
  private async history(
    g: TenantGrant,
    id: ObjectId,
    event: string,
    body: { reason: string; effectiveOn: string },
    before: object | null,
    after: object,
    tx: ClientSession,
    op: ObjectId,
    requestId: string,
  ) {
    await this.histories.insertOne(
      {
        churchId: g.churchId,
        targetId: id,
        event,
        ...body,
        before,
        after,
        actorId: g.actorId,
        actorKind: g.actorKind,
        occurredAt: this.now(),
      },
      { session: tx },
    );
    await this.audit.organization(
      `organization.${event}`,
      requestId,
      { kind: g.actorKind, id: g.actorId, churchId: g.actorKind === "owner" ? null : g.churchId },
      g.churchId,
      "organization",
      id,
      [event],
      op,
      tx,
    );
  }
  async overviewLeadership(g: TenantGrant, tx: ClientSession, day: string) {
    const rows = await this.terms
      .find(
        {
          churchId: g.churchId,
          state: "confirmed",
          $and: [
            { $or: [{ startOn: null }, { startOn: { $lte: day } }] },
            { $or: [{ endOn: null }, { endOn: { $gte: day } }] },
          ],
        },
        { session: tx },
      )
      .limit(2)
      .toArray();
    requireCondition(rows.length <= 1, 409, "VERSION_CONFLICT");
    return {
      boardTerm: rows[0]?.label ?? null,
      secretary: rows[0]?.appointments.find((a) => a.position === "secretary")?.fullName ?? null,
    };
  }
  async overview(g: TenantGrant, q: URLSearchParams) {
    this.queries.allow(q, ["kind", "limit", "cursor"]);
    const kind = q.get("kind");
    requireCondition(
      !kind || ["board", "age_ministry", "service_ministry", "area"].includes(kind),
      400,
      "INVALID_REQUEST",
    );
    return this.db.readSnapshot(g.churchId.toHexString(), async (tx) => {
      // Identity fences church/account/session. Every Member/Family/Unit writer uses the same church fence.
      await g.fence(tx);
      const filter: Filter<Unit> = {
        churchId: g.churchId,
        status: "active",
        ...(kind ? { kind: kind as Unit["kind"] } : {}),
        ...(g.unitScope
          ? {
              _id: { $in: g.unitScope.map(objectId) },
              kind: kind === "board" ? "area" : kind ? (kind as Unit["kind"]) : { $ne: "board" },
            }
          : {}),
      };
      if (g.unitScope && kind === "board") filter._id = { $in: [] };
      const context = this.queries.context(g, "overview", [kind, g.unitScope]),
        limit = this.queries.limit(q);
      if (q.has("cursor")) {
        const c = this.queries.decode(q.get("cursor") as string, context);
        filter.$or = [
          { nameKey: { $gt: c.key } },
          { nameKey: c.key, _id: { $gt: objectId(c.id) } },
        ];
      }
      const rows = await this.units
          .find(filter, { session: tx })
          .sort({ nameKey: 1, _id: 1 })
          .limit(limit + 1)
          .toArray(),
        more = rows.length > limit;
      if (more) rows.pop();
      const leaderIds = rows.flatMap((u) => (u.leaderMemberId ? [u.leaderMemberId] : [])),
        leaders = g.unitScope ? [] : await this.members.labels(g.churchId, leaderIds, tx);
      const items = [];
      for (const u of rows)
        items.push({
          ...unitDto(u),
          ...(!g.unitScope
            ? { leader: leaders.find((m) => m.id === u.leaderMemberId?.toHexString()) ?? null }
            : { leaderMemberId: null, leader: null }),
          memberCount: {
            value:
              u.kind === "board" ? null : await this.members.count(g.churchId, u._id, u.kind, tx),
            availability: u.kind === "board" ? ("not_available" as const) : ("available" as const),
          },
          householdCount:
            !g.unitScope && u.kind === "area"
              ? await this.families.countInArea(g.churchId, u._id, tx)
              : null,
          attendance: { value: null, availability: "not_available" as const },
        });
      const settings = await this.db.db
        .collection<Settings>("church_settings")
        .findOne({ _id: g.churchId }, { session: tx });
      const last = rows.at(-1);
      return {
        items,
        configured: !!settings,
        unitLabel:
          settings?.unitType === "custom"
            ? settings.customUnitLabel
            : settings?.unitType === "cell_group"
              ? "Nhóm tế bào"
              : settings?.unitType === "branch"
                ? "Chi phái"
                : "Khu vực",
        scoped: !!g.unitScope,
        canManage: g.canWrite,
        canManageMemberships: !!g.canManageMemberships,
        nextCursor:
          more && last ? this.queries.encode(context, last.nameKey, last._id.toHexString()) : null,
      };
    });
  }
  async roster(g: TenantGrant, id: string, q: URLSearchParams) {
    return this.db.readSnapshot(g.churchId.toHexString(), async (tx) => {
      await g.fence(tx);
      const u = await this.unit(g, id, tx);
      requireCondition(u.kind !== "board", 422, "VALIDATION_FAILED");
      return {
        unit: { id: u._id.toHexString(), name: u.name, kind: u.kind, version: u.version },
        ...(await this.members.roster(g, u._id, u.kind, u.version, q, tx)),
      };
    });
  }
  async details(
    g: TenantGrant,
    id: string,
    raw: unknown,
    key: string | null,
    match: string | null,
    requestId: string,
  ) {
    requireCondition(g.canWrite && !g.unitScope, 403, "FORBIDDEN");
    const b = parse(detailInput, raw),
      expected = version(match);
    this.effective(b.effectiveOn);
    return this.ops.executeTenant(
      g,
      "PATCH",
      `organization/${g.churchId}/units/${id}/details`,
      key,
      b,
      expected,
      async (tx, op) => {
        const old = await this.unit(g, id, tx);
        requireCondition(old.kind !== "board", 422, "VALIDATION_FAILED");
        requireCondition(old.version === expected, 412, "VERSION_CONFLICT");
        if (b.leaderMemberId && b.leaderMemberId !== old.leaderMemberId?.toHexString())
          await this.members.eligible(g.churchId, b.leaderMemberId, tx);
        const u = await this.units.findOneAndUpdate(
          { _id: old._id, churchId: g.churchId, version: expected },
          {
            $set: {
              leaderMemberId: b.leaderMemberId ? objectId(b.leaderMemberId) : null,
              scheduleText: b.scheduleText,
              updatedAt: this.now(),
              updatedBy: g.actorId,
              updatedByKind: g.actorKind,
            },
            $inc: { version: 1, writeFence: 1 },
          },
          { session: tx, returnDocument: "after" },
        );
        requireCondition(u, 412, "VERSION_CONFLICT");
        await this.history(
          g,
          u._id,
          "details_updated",
          b,
          unitDto(old),
          unitDto(u),
          tx,
          op,
          requestId,
        );
        return {
          safeResult: { unit: unitDto(u) },
          resourceRefs: [{ type: "organization_unit", id }],
        };
      },
    );
  }
  async membershipPreview(g: TenantGrant, id: string, raw: unknown, match: string | null) {
    requireCondition(g.canManageMemberships && !g.unitScope, 403, "FORBIDDEN");
    const b = parse(membershipInput, raw),
      expected = version(match);
    this.effective(b.effectiveOn);
    return this.db.readSnapshot(g.churchId.toHexString(), async (tx) => {
      await g.fence(tx);
      const u = await this.unit(g, id, tx);
      requireCondition(
        u.kind === "service_ministry" && u.status === "active",
        422,
        "UNIT_NOT_AVAILABLE",
      );
      requireCondition(u.version === expected, 412, "VERSION_CONFLICT");
      return {
        unit: unitDto(u),
        changes: await this.members.previewServices(g, b.changes, tx),
        effectiveOn: b.effectiveOn,
        reason: b.reason,
      };
    });
  }
  async memberships(
    g: TenantGrant,
    id: string,
    raw: unknown,
    key: string | null,
    match: string | null,
    requestId: string,
  ) {
    requireCondition(g.canManageMemberships && !g.unitScope, 403, "FORBIDDEN");
    const b = parse(membershipInput, raw),
      expected = version(match);
    this.effective(b.effectiveOn);
    const commandGrant = { ...g, canWrite: true };
    return this.ops.executeTenant(
      commandGrant,
      "POST",
      `organization/${g.churchId}/units/${id}/memberships`,
      key,
      b,
      expected,
      async (tx, op) => {
        const u = await this.unit(g, id, tx);
        requireCondition(
          u.kind === "service_ministry" && u.status === "active",
          422,
          "UNIT_NOT_AVAILABLE",
        );
        requireCondition(u.version === expected, 412, "VERSION_CONFLICT");
        const result = await this.members.changeServices(
          g,
          u._id,
          b.changes,
          b.effectiveOn,
          b.reason,
          tx,
          op,
          requestId,
        );
        await this.history(
          g,
          u._id,
          "memberships_updated",
          b,
          null,
          { members: result },
          tx,
          op,
          requestId,
        );
        return {
          safeResult: { members: result },
          resourceRefs: [{ type: "organization_unit", id }],
        };
      },
    );
  }
  async termList(g: TenantGrant, q: URLSearchParams) {
    requireCondition(!g.unitScope, 403, "FORBIDDEN");
    this.queries.allow(q, ["limit", "cursor"]);
    return this.db.readSnapshot(g.churchId.toHexString(), async (tx) => {
      await g.fence(tx);
      const context = this.queries.context(g, "terms", []),
        limit = this.queries.limit(q),
        filter: Filter<BoardTerm> = { churchId: g.churchId };
      if (q.has("cursor")) {
        const c = this.queries.decode(q.get("cursor") as string, context);
        filter._id = { $lt: objectId(c.id) };
      }
      const rows = await this.terms
          .find(filter, { session: tx })
          .sort({ _id: -1 })
          .limit(limit + 1)
          .toArray(),
        more = rows.length > limit;
      if (more) rows.pop();
      const items = [];
      for (const t of rows)
        items.push({
          ...termDto(t),
          current:
            t.state === "confirmed" &&
            !!t.startOn &&
            !!t.endOn &&
            t.startOn <= this.today() &&
            t.endOn >= this.today(),
          people: await this.members.labels(
            g.churchId,
            t.appointments.map((a) => a.memberId),
            tx,
          ),
        });
      const last = rows.at(-1);
      return {
        items,
        nextCursor: more && last ? this.queries.encode(context, "", last._id.toHexString()) : null,
      };
    });
  }
  async termWrite(
    g: TenantGrant,
    id: string | null,
    action: string | null,
    raw: unknown,
    key: string | null,
    match: string | null,
    requestId: string,
  ) {
    requireCondition(g.canWrite && !g.unitScope, 403, "FORBIDDEN");
    const b =
        action && action !== "amend" ? parse(z.strictObject(common), raw) : parse(termInput, raw),
      expected = id ? version(match) : null;
    this.effective(b.effectiveOn);
    return this.ops.executeTenant(
      g,
      id && !action ? "PATCH" : "POST",
      `organization/${g.churchId}/board-terms${id ? `/${id}${action ? `/${action}` : ""}` : ""}`,
      key,
      b,
      expected,
      async (tx, op) => {
        await this.root(g, tx);
        const old = id
          ? await this.terms.findOne({ _id: objectId(id), churchId: g.churchId }, { session: tx })
          : null;
        if (id) {
          requireCondition(old, 404, "NOT_FOUND");
          requireCondition(old.version === expected, 412, "VERSION_CONFLICT");
        }
        const t: BoardTerm = old
          ? {
              ...old,
              version: old.version + 1,
              writeFence: old.writeFence + 1,
              updatedAt: this.now(),
              updatedBy: g.actorId,
              updatedByKind: g.actorKind,
            }
          : {
              _id: new ObjectId(),
              churchId: g.churchId,
              label: "",
              startOn: null,
              endOn: null,
              state: "draft",
              appointments: [],
              version: 1,
              writeFence: 0,
              createdAt: this.now(),
              updatedAt: this.now(),
              createdBy: g.actorId,
              updatedBy: g.actorId,
              createdByKind: g.actorKind,
              updatedByKind: g.actorKind,
            };
        if ("label" in b) {
          requireCondition(
            !old ||
              (action === "amend"
                ? old.state === "confirmed" &&
                  !!old.startOn &&
                  old.startOn <= this.today() &&
                  !!old.endOn &&
                  old.endOn >= this.today()
                : old.state === "draft"),
            409,
            "TERM_IMMUTABLE",
          );
          const fields = b as z.infer<typeof termInput>;
          if (action === "amend")
            requireCondition(
              old &&
                fields.label === old.label &&
                fields.startOn === old.startOn &&
                fields.endOn === old.endOn &&
                fields.effectiveOn === this.today(),
              422,
              "VALIDATION_FAILED",
            );
          t.label = fields.label;
          t.startOn = fields.startOn;
          t.endOn = fields.endOn;
          t.appointments = [];
          for (const a of fields.appointments) {
            const unchanged = old?.appointments.find(
              (p) => p.memberId.toHexString() === a.memberId && p.position === a.position,
            );
            t.appointments.push({
              ...(unchanged ?? (await this.members.eligible(g.churchId, a.memberId, tx))),
              position: a.position,
            });
          }
        } else if (action === "confirm") {
          requireCondition(
            old?.state === "draft" && !!t.startOn && !!t.endOn && t.endOn >= this.today(),
            409,
            "TERM_NOT_CONFIRMABLE",
          );
          // Revalidate draft appointments at confirmation; saved snapshots alone grant no eligibility.
          for (const a of t.appointments)
            await this.members.eligible(g.churchId, a.memberId.toHexString(), tx);
          const overlap = await this.terms.findOne(
            {
              churchId: g.churchId,
              _id: { $ne: t._id },
              state: { $in: ["confirmed", "ended"] },
              startOn: { $lte: t.endOn },
              $or: [
                { closedOn: { $gte: t.startOn } },
                { closedOn: { $exists: false }, endOn: { $gte: t.startOn } },
              ],
            },
            { session: tx },
          );
          requireCondition(!overlap, 409, "TERM_OVERLAP");
          t.state = "confirmed";
        } else if (action === "close") {
          requireCondition(
            !old?.lastEffectiveOn || b.effectiveOn >= old.lastEffectiveOn,
            422,
            "VALIDATION_FAILED",
          );
          requireCondition(
            old?.state === "confirmed" &&
              !!old.startOn &&
              !!old.endOn &&
              b.effectiveOn >= old.startOn,
            409,
            "TERM_IMMUTABLE",
          );
          t.state = "ended";
          t.closedOn = b.effectiveOn < old.endOn ? b.effectiveOn : old.endOn;
        } else if (action === "cancel") {
          requireCondition(
            old?.state === "draft" ||
              (old?.state === "confirmed" && !!old.startOn && old.startOn > this.today()),
            409,
            "TERM_IMMUTABLE",
          );
          t.state = "cancelled";
        } else requireCondition("label" in b, 400, "INVALID_REQUEST");
        t.lastEffectiveOn = b.effectiveOn;
        if (old)
          await this.terms.replaceOne(
            { _id: old._id, churchId: g.churchId, version: expected as number },
            t,
            { session: tx },
          );
        else await this.terms.insertOne(t, { session: tx });
        await this.history(
          g,
          t._id,
          `term_${action ?? (old ? "updated" : "created")}`,
          b,
          old ? termDto(old) : null,
          termDto(t),
          tx,
          op,
          requestId,
        );
        return {
          safeResult: { term: termDto(t) },
          resourceRefs: [{ type: "organization_term", id: t._id.toHexString() }],
        };
      },
      id ? 200 : 201,
    );
  }
  async historyPage(g: TenantGrant, id: string, q: URLSearchParams) {
    requireCondition(!g.unitScope, 403, "FORBIDDEN");
    this.queries.allow(q, ["limit", "cursor"]);
    return this.db.readSnapshot(g.churchId.toHexString(), async (tx) => {
      await g.fence(tx);
      const target = objectId(id),
        context = this.queries.context(g, "history", id),
        limit = this.queries.limit(q),
        filter: Filter<import("mongodb").Document> = { churchId: g.churchId, targetId: target };
      requireCondition(
        (await this.units.findOne({ _id: target, churchId: g.churchId }, { session: tx })) ||
          (await this.terms.findOne({ _id: target, churchId: g.churchId }, { session: tx })),
        404,
        "NOT_FOUND",
      );
      if (q.has("cursor")) {
        const c = this.queries.decode(q.get("cursor") as string, context);
        filter._id = { $lt: objectId(c.id) };
      }
      const rows = await this.histories
          .find(filter, { session: tx })
          .sort({ _id: -1 })
          .limit(limit + 1)
          .toArray(),
        more = rows.length > limit;
      if (more) rows.pop();
      const last = rows.at(-1);
      return {
        items: rows.map((h) => ({
          id: h._id.toHexString(),
          event: h.event,
          effectiveOn: h.effectiveOn,
          reason: h.reason,
          actorId: h.actorId.toHexString(),
          actorKind: h.actorKind,
          occurredAt: h.occurredAt.toISOString(),
          before: h.before,
          after: h.after,
        })),
        nextCursor: more && last ? this.queries.encode(context, "", last._id.toHexString()) : null,
      };
    });
  }
}
