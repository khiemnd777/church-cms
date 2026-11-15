import { type ClientSession, type Filter, MongoServerError, ObjectId } from "mongodb";
import type { Audit } from "../audit/service";
import type { TenantGrant } from "../authorization/tenant-grant";
import { AppError, requireCondition } from "../errors";
import { objectId, parse, version } from "../http-validation";
import { digest } from "../identity/crypto";
import type { Database } from "../infrastructure/database";
import { businessDay, validDay } from "../members/dates";
import { searchName } from "../members/models";
import { escaped } from "../members/queries";
import { canonical, type Operations } from "../operations/service";
import { resourceCode } from "../resource-code";
import { TenantQueries } from "../tenant-queries";
import {
  caseDto,
  entryDto,
  type VisitCase,
  type VisitEntry,
  type VisitHistory,
  type VisitPerson,
} from "./models";
import type { VisitationSources } from "./sources";
import {
  commandInput,
  reasonCodes,
  type VisitCommand,
  type VisitFields,
  type VisitTarget,
} from "./validation";
export class Visitation {
  private query: TenantQueries;
  constructor(
    private db: Database,
    private sources: VisitationSources,
    private ops: Operations,
    private audit: Audit,
    key: string,
    private now: () => Date,
  ) {
    this.query = new TenantQueries(key, now, "visitation");
  }
  private get cases() {
    return this.db.db.collection<VisitCase>("visitation_cases");
  }
  private get entries() {
    return this.db.db.collection<VisitEntry>("visitation_entries");
  }
  private get histories() {
    return this.db.db.collection<VisitHistory>("visitation_history");
  }
  private authorized(g: TenantGrant) {
    requireCondition(g.canWrite && !g.unitScope && !g.receiptScope, 403, "FORBIDDEN");
  }
  private async raw(g: TenantGrant, id: string, tx: ClientSession) {
    const c = await this.cases.findOne(
      { _id: objectId(id), churchId: g.churchId },
      { session: tx },
    );
    requireCondition(c, 404, "NOT_FOUND");
    return c;
  }
  private async entry(g: TenantGrant, c: VisitCase, id: string, tx: ClientSession) {
    const e = await this.entries.findOne(
      { _id: objectId(id), churchId: g.churchId, caseId: c._id },
      { session: tx },
    );
    requireCondition(e, 404, "NOT_FOUND");
    return e;
  }
  async people(g: TenantGrant, q: URLSearchParams) {
    this.authorized(g);
    this.query.allow(q, ["kind", "q", "limit", "cursor"]);
    const kind = q.get("kind") ?? "member",
      term = (q.get("q") ?? "").normalize("NFC").trim(),
      limit = this.query.limit(q);
    requireCondition(
      (kind === "member" || kind === "family") && term.length <= 100,
      400,
      "INVALID_REQUEST",
    );
    const context = this.query.context(g, "people", [kind, term]),
      after = q.has("cursor") ? this.query.decode(q.get("cursor") as string, context) : null;
    return this.db.readSnapshot(g.churchId.toHexString(), async (tx) => {
      await g.fence(tx);
      const rows = await this.sources.page(g, kind, term, after, limit + 1, tx),
        more = rows.length > limit;
      rows.splice(limit);
      const last = rows.at(-1);
      return {
        items: rows.map((p) => ({ id: p.id, code: p.code, fullName: p.fullName })),
        nextCursor: more && last ? this.query.encode(context, last.key, last.id) : null,
      };
    });
  }
  async list(g: TenantGrant, q: URLSearchParams) {
    this.authorized(g);
    this.query.allow(q, [
      "state",
      "reason",
      "priority",
      "assigneeId",
      "q",
      "from",
      "to",
      "overdue",
      "limit",
      "cursor",
    ]);
    const state = q.get("state") ?? "open",
      reason = q.get("reason"),
      priority = q.get("priority"),
      assignee = q.get("assigneeId"),
      term = searchName(q.get("q") ?? ""),
      from = q.get("from"),
      to = q.get("to"),
      overdue = q.get("overdue");
    requireCondition(
      ["all", "open", "completed", "cancelled"].includes(state) &&
        (!reason || reasonCodes.includes(reason as VisitFields["reasonCode"])) &&
        (!priority || ["normal", "high"].includes(priority)) &&
        term.length <= 100 &&
        (!from || validDay(from)) &&
        (!to || validDay(to)) &&
        (!from || !to || from <= to) &&
        (!overdue || overdue === "true"),
      400,
      "INVALID_REQUEST",
    );
    if (assignee) objectId(assignee);
    const day = businessDay(this.now()),
      f: Filter<VisitCase> = {
        churchId: g.churchId,
        ...(state !== "all" ? { state: state as VisitCase["state"] } : {}),
        ...(reason ? { reasonCode: reason as VisitFields["reasonCode"] } : {}),
        ...(priority ? { priority: priority as VisitFields["priority"] } : {}),
        ...(assignee ? { assigneeId: objectId(assignee) } : {}),
        ...(term
          ? {
              $or: [
                { targetNameKey: { $regex: `^${escaped(term)}` } },
                { code: { $regex: `^${escaped(term.toUpperCase())}` } },
              ],
            }
          : {}),
      };
    const and: Filter<VisitCase>[] = [];
    if (from || to)
      and.push({ plannedOn: { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) } });
    if (overdue) and.push({ state: "open", plannedOn: { $type: "string", $lt: day } });
    if (and.length) f.$and = and;
    const limit = this.query.limit(q),
      context = this.query.context(g, "cases", [
        state,
        reason,
        priority,
        assignee,
        term,
        from,
        to,
        overdue,
        overdue ? day : null,
      ]),
      after = q.has("cursor") ? this.query.decode(q.get("cursor") as string, context) : null;
    return this.db.readSnapshot(g.churchId.toHexString(), async (tx) => {
      await g.fence(tx);
      const counts = await this.cases
        .aggregate<{ _id: VisitCase["state"]; count: number }>(
          [{ $match: f }, { $group: { _id: "$state", count: { $sum: 1 } } }],
          { session: tx },
        )
        .toArray();
      const rows = await this.cases
          .find({ ...f, ...(after ? { _id: { $lt: objectId(after.id) } } : {}) }, { session: tx })
          .sort({ _id: -1 })
          .limit(limit + 1)
          .toArray(),
        more = rows.length > limit;
      rows.splice(limit);
      const last = rows.at(-1);
      return {
        items: rows.map(caseDto),
        summary: {
          total: counts.reduce((n, c) => n + c.count, 0),
          open: counts.find((c) => c._id === "open")?.count ?? 0,
          completed: counts.find((c) => c._id === "completed")?.count ?? 0,
          cancelled: counts.find((c) => c._id === "cancelled")?.count ?? 0,
        },
        nextCursor: more && last ? this.query.encode(context, "", last._id.toHexString()) : null,
        principalKey: `${g.actorKind}:${g.actorId}:${g.policyContext}`,
        canManage: true,
        day,
      };
    });
  }
  async get(g: TenantGrant, id: string) {
    this.authorized(g);
    return this.db.readSnapshot(g.churchId.toHexString(), async (tx) => {
      await g.fence(tx);
      const c = await this.raw(g, id, tx);
      return { ...caseDto(c), current: await this.sources.current(g, c, tx) };
    });
  }
  private async proposal(g: TenantGrant, b: VisitCommand, c: VisitCase | null, tx: ClientSession) {
    requireCondition(c ? b.action !== "create" : b.action === "create", 422, "VALIDATION_FAILED");
    requireCondition(!c || c.state === "open" || b.action === "correct", 409, "VISIT_CASE_CLOSED");
    if (b.action === "cancel" || b.action === "correct")
      requireCondition(b.reason, 422, "REASON_REQUIRED");
    const target: VisitTarget =
      b.action === "create"
        ? b.target
        : { kind: (c as VisitCase).targetKind, id: (c as VisitCase).targetId.toHexString() };
    const fields: VisitFields =
      "fields" in b
        ? b.fields
        : {
            reasonCode: (c as VisitCase).reasonCode,
            description: (c as VisitCase).description,
            priority: (c as VisitCase).priority,
            plannedOn: (c as VisitCase).plannedOn,
            assigneeId: (c as VisitCase).assigneeId?.toHexString() ?? null,
          };
    const source = await this.sources.target(g, target, tx),
      assignee = fields.assigneeId ? await this.sources.person(g, fields.assigneeId, tx) : null;
    const strict = ["create", "update", "record"].includes(b.action);
    if (strict) {
      requireCondition(source.available && source.snapshot, 422, "VISIT_TARGET_UNAVAILABLE");
      requireCondition(
        !fields.assigneeId || assignee?.available,
        422,
        "VISIT_ASSIGNEE_UNAVAILABLE",
      );
    }
    let oldEntry: VisitEntry | null = null;
    const participants: VisitPerson[] = [],
      people: NonNullable<typeof assignee>[] = [];
    if (assignee) people.push(assignee);
    if (b.action === "record" || b.action === "correct") {
      requireCondition(b.entry.visitedOn <= businessDay(this.now()), 422, "VISIT_FUTURE_DATE");
      if (c && b.entry.visitedOn < businessDay(c.createdAt))
        requireCondition(b.reason, 422, "REASON_REQUIRED");
      if (b.action === "correct") {
        requireCondition(c, 404, "NOT_FOUND");
        oldEntry = await this.entry(g, c, b.entryId, tx);
        requireCondition(oldEntry.version === b.entryVersion, 412, "VERSION_CONFLICT");
        requireCondition(
          c.state !== "completed" ||
            c.visitedCount +
              (b.entry.outcome === "visited" ? 1 : 0) -
              (oldEntry.outcome === "visited" ? 1 : 0) >=
              1,
          409,
          "VISIT_COMPLETION_INVALID",
        );
      }
      for (const id of b.entry.participantIds) {
        const p = await this.sources.person(g, id, tx),
          retained = oldEntry?.participants.find((p) => p.id === id);
        requireCondition(p?.available || retained, 422, "VISIT_PARTICIPANT_UNAVAILABLE");
        participants.push(
          p?.available
            ? { id: p.id, code: p.code, fullName: p.fullName }
            : (retained as VisitPerson),
        );
        if (p) people.push(p);
      }
    }
    if (b.action === "complete") {
      requireCondition(c && c.visitedCount > 0, 422, "VISIT_NEEDS_VISITED_ENTRY");
      if (!source.available || (fields.assigneeId && !assignee?.available))
        requireCondition(b.reason, 422, "REASON_REQUIRED");
    }
    if (b.action === "create" || b.action === "update") {
      const duplicate = await this.cases.findOne(
        {
          churchId: g.churchId,
          targetKind: target.kind,
          targetId: objectId(target.id),
          reasonCode: fields.reasonCode,
          state: "open",
          ...(c ? { _id: { $ne: c._id } } : {}),
        },
        { session: tx, projection: { _id: 1 } },
      );
      requireCondition(!duplicate, 409, "VISIT_CASE_EXISTS");
    }
    const nextState =
      b.action === "complete"
        ? "completed"
        : b.action === "cancel"
          ? "cancelled"
          : (c?.state ?? "open");
    const context = digest(
      canonical({
        actor: [g.actorKind, g.actorId, g.churchId, g.policyContext],
        body: { ...b, preview: null, confirmed: false },
        version: c?.version ?? 0,
        entryVersion: oldEntry?.version ?? null,
        source,
        assignee,
        people,
        day: businessDay(this.now()),
      }),
    );
    return { context, target, fields, source, assignee, people, participants, oldEntry, nextState };
  }
  async preview(g: TenantGrant, id: string | null, raw: unknown, match: string | null) {
    this.authorized(g);
    const b = parse(commandInput, raw),
      expected = id ? version(match) : null;
    return this.db.readSnapshot(g.churchId.toHexString(), async (tx) => {
      await g.fence(tx);
      const c = id ? await this.raw(g, id, tx) : null;
      requireCondition(!c || c.version === expected, 412, "VERSION_CONFLICT");
      const p = await this.proposal(g, b, c, tx);
      return {
        context: p.context,
        action: b.action,
        before: c ? caseDto(c) : null,
        beforeEntry: p.oldEntry ? entryDto(p.oldEntry) : null,
        target: c?.targetSnapshot ?? p.source.snapshot,
        currentTarget: p.source.snapshot,
        targetAvailable: p.source.available,
        fields: p.fields,
        assignee: p.assignee
          ? { id: p.assignee.id, code: p.assignee.code, fullName: p.assignee.fullName }
          : null,
        entry: "entry" in b ? { ...b.entry, participants: p.participants } : null,
        nextState: p.nextState,
        reason: b.reason,
        confirmationRequired: ["complete", "cancel"].includes(b.action),
      };
    });
  }
  async save(
    g: TenantGrant,
    id: string | null,
    raw: unknown,
    key: string | null,
    match: string | null,
    requestId: string,
  ) {
    this.authorized(g);
    const b = parse(commandInput, raw),
      expected = id ? version(match) : null;
    const guarded = {
      ...g,
      fence: async (tx: ClientSession) => {
        await g.fence(tx);
        this.authorized(g);
        if (id) await this.raw(g, id, tx);
      },
    };
    try {
      return await this.ops.executeTenant(
        guarded,
        id ? "PATCH" : "POST",
        `visitation/${g.churchId}/cases${id ? `/${objectId(id)}` : ""}`,
        key,
        b,
        expected,
        async (tx, op) => {
          const before = id ? await this.raw(g, id, tx) : null;
          requireCondition(!before || before.version === expected, 412, "VERSION_CONFLICT");
          const p = await this.proposal(g, b, before, tx);
          requireCondition(b.preview === p.context, 412, "VISIT_PREVIEW_STALE");
          requireCondition(
            !["complete", "cancel"].includes(b.action) || b.confirmed,
            422,
            "VISIT_CONFIRMATION_REQUIRED",
          );
          await this.sources.fence(g, p.source, p.people, tx);
          const now = this.now(),
            snapshot = before?.targetSnapshot ?? p.source.snapshot;
          requireCondition(snapshot, 422, "VISIT_TARGET_UNAVAILABLE");
          const c = this.caseFromProposal(g, before, p, snapshot, now);
          if (b.action !== "create" && b.action !== "update")
            c.assigneeSnapshot = before?.assigneeSnapshot ?? null;
          let entry: VisitEntry | null = null;
          if (b.action === "record" || b.action === "correct") {
            const old = p.oldEntry;
            entry = {
              _id: old ? old._id : new ObjectId(),
              churchId: g.churchId,
              caseId: c._id,
              version: (old?.version ?? 0) + 1,
              ...b.entry,
              participantIds: b.entry.participantIds.map(objectId),
              participants: p.participants,
              targetSnapshot:
                b.action === "correct" && old
                  ? old.targetSnapshot
                  : (p.source.snapshot ?? snapshot),
              createdAt: old?.createdAt ?? now,
              updatedAt: now,
            };
            c.entryCount += old ? 0 : 1;
            c.visitedCount +=
              (b.entry.outcome === "visited" ? 1 : 0) - (old?.outcome === "visited" ? 1 : 0);
            if (old) {
              const r = await this.entries.replaceOne(
                { _id: old._id, churchId: g.churchId, caseId: c._id, version: old.version },
                entry,
                { session: tx },
              );
              requireCondition(r.matchedCount, 412, "VERSION_CONFLICT");
            } else await this.entries.insertOne(entry, { session: tx });
          }
          if (b.action === "complete" || b.action === "cancel") {
            c.closedAt = now;
            c.closeReason = b.reason;
          }
          if (before) {
            const r = await this.cases.replaceOne(
              { _id: before._id, churchId: g.churchId, version: expected as number },
              c,
              { session: tx },
            );
            requireCondition(r.matchedCount, 412, "VERSION_CONFLICT");
          } else await this.cases.insertOne(c, { session: tx });
          await this.histories.insertOne(
            {
              _id: new ObjectId(),
              churchId: g.churchId,
              caseId: c._id,
              entryId: entry ? entry._id : null,
              event: b.action,
              operationId: op,
              reason: b.reason,
              before: before
                ? { case: caseDto(before), entry: p.oldEntry ? entryDto(p.oldEntry) : null }
                : null,
              after: { case: caseDto(c), entry: entry ? entryDto(entry) : null },
              actorId: g.actorId,
              actorKind: g.actorKind,
              occurredAt: now,
            },
            { session: tx },
          );
          await this.audit.organization(
            `visitation.${b.action}`,
            requestId,
            {
              kind: g.actorKind,
              id: g.actorId,
              churchId: g.actorKind === "owner" ? null : g.churchId,
            },
            g.churchId,
            "visitation_case",
            c._id,
            [b.action],
            op,
            tx,
          );
          return {
            safeResult: {
              caseId: c._id.toHexString(),
              version: c.version,
              entryId: entry ? entry._id.toHexString() : null,
              state: c.state,
            },
            resourceRefs: [{ type: "visitation_case", id: c._id.toHexString() }],
          };
        },
        id ? 200 : 201,
      );
    } catch (e) {
      if (
        e instanceof MongoServerError &&
        e.code === 11000 &&
        String(e.message).includes("visitation_open_unique")
      )
        throw new AppError(409, "VISIT_CASE_EXISTS");
      throw e;
    }
  }
  // Public application port: caller owns the operation and transaction. No nested ledger/transaction.
  carePort() {
    return {
      open: async (
        g: TenantGrant,
        target: VisitTarget,
        reasonCode: VisitFields["reasonCode"],
        tx: ClientSession,
      ) => {
        this.authorized(g);
        const c = await this.cases.findOne(
          {
            churchId: g.churchId,
            targetKind: target.kind,
            targetId: objectId(target.id),
            reasonCode,
            state: "open",
          },
          { session: tx },
        );
        return c ? caseDto(c) : null;
      },
      read: async (g: TenantGrant, id: string, tx: ClientSession) => {
        this.authorized(g);
        return caseDto(await this.raw(g, id, tx));
      },
      prepare: async (
        g: TenantGrant,
        target: VisitTarget,
        fields: VisitFields,
        tx: ClientSession,
      ) => {
        this.authorized(g);
        const p = await this.proposal(
          g,
          { action: "create", target, fields, reason: null, preview: null, confirmed: true },
          null,
          tx,
        );
        return {
          context: p.context,
          target: p.source.snapshot,
          assignee: p.assignee
            ? { id: p.assignee.id, code: p.assignee.code, fullName: p.assignee.fullName }
            : null,
          fields: p.fields,
        };
      },
      create: async (
        g: TenantGrant,
        target: VisitTarget,
        fields: VisitFields,
        reason: string | null,
        tx: ClientSession,
        op: ObjectId,
        requestId: string,
      ) => {
        this.authorized(g);
        const p = await this.proposal(
          g,
          { action: "create", target, fields, reason, preview: null, confirmed: true },
          null,
          tx,
        );
        await this.sources.fence(g, p.source, p.people, tx);
        requireCondition(p.source.snapshot, 422, "VISIT_TARGET_UNAVAILABLE");
        const now = this.now(),
          c: VisitCase = this.caseFromProposal(g, null, p, p.source.snapshot, now);
        await this.cases.insertOne(c, { session: tx });
        await this.histories.insertOne(
          {
            _id: new ObjectId(),
            churchId: g.churchId,
            caseId: c._id,
            entryId: null,
            event: "create",
            operationId: op,
            reason,
            before: null,
            after: { case: caseDto(c), entry: null },
            actorId: g.actorId,
            actorKind: g.actorKind,
            occurredAt: now,
          },
          { session: tx },
        );
        await this.audit.organization(
          "visitation.create",
          requestId,
          {
            kind: g.actorKind,
            id: g.actorId,
            churchId: g.actorKind === "owner" ? null : g.churchId,
          },
          g.churchId,
          "visitation_case",
          c._id,
          ["create"],
          op,
          tx,
        );
        return caseDto(c);
      },
    };
  }
  private caseFromProposal(
    g: TenantGrant,
    before: VisitCase | null,
    p: Awaited<ReturnType<Visitation["proposal"]>>,
    snapshot: VisitCase["targetSnapshot"],
    now: Date,
  ): VisitCase {
    return {
      _id: before?._id ?? new ObjectId(),
      churchId: g.churchId,
      code: before?.code ?? resourceCode("TV"),
      version: (before?.version ?? 0) + 1,
      state: p.nextState,
      targetKind: p.target.kind,
      targetId: objectId(p.target.id),
      targetSnapshot: snapshot,
      targetNameKey: before?.targetNameKey ?? searchName(snapshot.name),
      ...p.fields,
      assigneeId: p.fields.assigneeId ? objectId(p.fields.assigneeId) : null,
      assigneeSnapshot: p.assignee
        ? { id: p.assignee.id, code: p.assignee.code, fullName: p.assignee.fullName }
        : null,
      entryCount: before?.entryCount ?? 0,
      visitedCount: before?.visitedCount ?? 0,
      closeReason: before?.closeReason ?? null,
      closedAt: before?.closedAt ?? null,
      createdAt: before?.createdAt ?? now,
      updatedAt: now,
    };
  }
  async entriesPage(g: TenantGrant, id: string, q: URLSearchParams) {
    this.authorized(g);
    this.query.allow(q, ["limit", "cursor"]);
    const limit = this.query.limit(q),
      context = this.query.context(g, `entries/${id}`, null),
      after = q.has("cursor") ? this.query.decode(q.get("cursor") as string, context) : null;
    return this.db.readSnapshot(g.churchId.toHexString(), async (tx) => {
      await g.fence(tx);
      const c = await this.raw(g, id, tx);
      const rows = await this.entries
          .find(
            {
              churchId: g.churchId,
              caseId: c._id,
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
        items: rows.map(entryDto),
        nextCursor: more && last ? this.query.encode(context, "", last._id.toHexString()) : null,
      };
    });
  }
  async historyPage(g: TenantGrant, id: string, q: URLSearchParams) {
    this.authorized(g);
    this.query.allow(q, ["limit", "cursor"]);
    const limit = this.query.limit(q),
      context = this.query.context(g, `history/${id}`, null),
      after = q.has("cursor") ? this.query.decode(q.get("cursor") as string, context) : null;
    return this.db.readSnapshot(g.churchId.toHexString(), async (tx) => {
      await g.fence(tx);
      const c = await this.raw(g, id, tx);
      const rows = await this.histories
          .find(
            {
              churchId: g.churchId,
              caseId: c._id,
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
        items: rows.map((r) => ({
          id: r._id.toHexString(),
          event: r.event,
          reason: r.reason,
          before: r.before,
          after: r.after,
          occurredAt: r.occurredAt.toISOString(),
        })),
        nextCursor: more && last ? this.query.encode(context, "", last._id.toHexString()) : null,
      };
    });
  }
  async operation(g: TenantGrant, id: string) {
    this.authorized(g);
    return this.ops.getTenant(g, id, "visitation", async (tx, op) => {
      requireCondition(
        op.resourceRefs.length > 0 && op.resourceRefs.every((r) => r.type === "visitation_case"),
        403,
        "FORBIDDEN",
      );
      for (const r of op.resourceRefs) await this.raw(g, r.id, tx);
    });
  }
}
