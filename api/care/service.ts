import { type ClientSession, type Filter, MongoServerError, ObjectId } from "mongodb";
import type { Audit } from "../audit/service";
import { AppError, requireCondition } from "../errors";
import { objectId, parse, version } from "../http-validation";
import { digest } from "../identity/crypto";
import type { Database } from "../infrastructure/database";
import { businessDay } from "../members/dates";
import { searchName } from "../members/models";
import { escaped } from "../members/queries";
import { canonical, type Operations } from "../operations/service";
import { resourceCode } from "../resource-code";
import { TenantQueries } from "../tenant-queries";
import type { Visitation } from "../visitation/service";
import {
  alertDto,
  type CareAlert,
  type CareAssessment,
  type CareGrant,
  type CareHistory,
  type CareSignal,
  type CareTarget,
  signalDto,
} from "./models";
import { type CareSources, targetKey } from "./sources";
import {
  type AlertCommand,
  alertInput,
  careKinds,
  evaluateInput,
  type SignalCommand,
  signalInput,
} from "./validation";
export class Care {
  private query: TenantQueries;
  constructor(
    private db: Database,
    private sources: CareSources,
    private visits: ReturnType<Visitation["carePort"]>,
    private ops: Operations,
    private audit: Audit,
    key: string,
    private now: () => Date,
  ) {
    this.query = new TenantQueries(key, now, "care");
  }
  private get alerts() {
    return this.db.db.collection<CareAlert>("care_alerts");
  }
  private get signals() {
    return this.db.db.collection<CareSignal>("care_signals");
  }
  private get histories() {
    return this.db.db.collection<CareHistory>("care_history");
  }
  private get assessments() {
    return this.db.db.collection<CareAssessment>("care_assessments");
  }
  private authorized(g: CareGrant, write = false) {
    requireCondition(
      g.canReadCare &&
        !g.unitScope &&
        !g.receiptScope &&
        (!write || (g.canWrite && g.canManageCare)),
      403,
      "FORBIDDEN",
    );
  }
  private async signal(g: CareGrant, id: string, tx: ClientSession) {
    const s = await this.signals.findOne(
      { churchId: g.churchId, _id: objectId(id) },
      { session: tx },
    );
    requireCondition(s, 404, "NOT_FOUND");
    return s;
  }
  private async alert(g: CareGrant, id: string, tx: ClientSession) {
    const s = await this.alerts.findOne(
      { churchId: g.churchId, _id: objectId(id) },
      { session: tx },
    );
    requireCondition(s, 404, "NOT_FOUND");
    return s;
  }
  private target(s: CareSignal | CareAlert): CareTarget {
    return { kind: s.targetKind, id: s.targetId.toHexString() };
  }
  private dto(s: CareSignal | CareAlert) {
    return "evidence" in s ? alertDto(s) : signalDto(s);
  }
  private async record(
    g: CareGrant,
    kind: "signal" | "alert",
    before: CareSignal | CareAlert | null,
    after: CareSignal | CareAlert,
    event: string,
    reason: string | null,
    op: ObjectId,
    requestId: string,
    tx: ClientSession,
  ) {
    await this.histories.insertOne(
      {
        _id: new ObjectId(),
        churchId: g.churchId,
        resourceKind: kind,
        resourceId: after._id,
        event,
        before: before ? this.dto(before) : null,
        after: this.dto(after),
        reason,
        actorId: g.actorId,
        actorKind: g.actorKind,
        operationId: op,
        occurredAt: this.now(),
      },
      { session: tx },
    );
    await this.audit.organization(
      `care.${kind}.${event}`,
      requestId,
      { kind: g.actorKind, id: g.actorId, churchId: g.actorKind === "owner" ? null : g.churchId },
      g.churchId,
      `care_${kind}`,
      after._id,
      [event],
      op,
      tx,
    );
  }
  private async authorizeOperation(
    g: CareGrant,
    op: { resourceRefs: { type: string; id: string }[] },
    tx: ClientSession,
  ) {
    requireCondition(op.resourceRefs.length > 0, 404, "NOT_FOUND");
    for (const r of op.resourceRefs) {
      if (r.type === "care_alert") await this.alert(g, r.id, tx);
      else if (r.type === "care_signal") await this.signal(g, r.id, tx);
      else if (r.type === "visitation_case") await this.visits.read(g, r.id, tx);
      else requireCondition(r.type === "care_scan", 404, "NOT_FOUND");
    }
  }
  private async execute(
    g: CareGrant,
    route: string,
    b: unknown,
    key: string | null,
    expected: number | null,
    mutate: Parameters<Operations["executeTenant"]>[6],
    status = 200,
  ) {
    this.authorized(g, true);
    try {
      return await this.ops.executeTenant(
        g,
        route.includes("/new") || route.endsWith("/evaluate") ? "POST" : "PATCH",
        `care/${g.churchId}/${route}`,
        key,
        b,
        expected,
        mutate,
        status,
        (tx, op) => this.authorizeOperation(g, op, tx),
      );
    } catch (e) {
      if (e instanceof MongoServerError && e.code === 11000) {
        if (String(e.message).includes("care_signal_open_unique"))
          throw new AppError(409, "CARE_SIGNAL_EXISTS");
        if (String(e.message).includes("care_episode_unique"))
          throw new AppError(409, "CARE_EPISODE_EXISTS");
        if (String(e.message).includes("visitation_open_unique"))
          throw new AppError(409, "VISIT_CASE_EXISTS");
      }
      throw e;
    }
  }
  async operation(g: CareGrant, id: string) {
    this.authorized(g, true);
    return this.ops.getTenant(g, id, "care", (tx, op) => this.authorizeOperation(g, op, tx));
  }
  async list(g: CareGrant, q: URLSearchParams, kind: "alert" | "signal" = "alert") {
    this.authorized(g);
    this.query.allow(q, ["state", "kind", "q", "cursor", "limit"]);
    const state = q.get("state") ?? (kind === "alert" ? "pending" : "open"),
      reason = q.get("kind"),
      term = searchName(q.get("q") ?? ""),
      limit = this.query.limit(q);
    requireCondition(
      (kind === "alert"
        ? ["all", "pending", "linked", "dismissed", "expired"]
        : ["all", "open", "ended"]
      ).includes(state) &&
        (!reason || careKinds.includes(reason as CareAlert["kind"])) &&
        term.length <= 100,
      400,
      "INVALID_REQUEST",
    );
    const context = this.query.context(g, kind, [state, reason, term]),
      after = q.has("cursor") ? this.query.decode(q.get("cursor") as string, context) : null;
    const f = {
      churchId: g.churchId,
      ...(state !== "all" ? { state } : {}),
      ...(reason ? { kind: reason } : {}),
      ...(term
        ? {
            $or: [
              { targetNameKey: { $regex: `^${escaped(term)}` } },
              { code: { $regex: `^${escaped(term.toUpperCase())}` } },
            ],
          }
        : {}),
    };
    return this.db.readSnapshot(g.churchId.toHexString(), async (tx) => {
      await g.fence(tx);
      const collection = kind === "alert" ? this.alerts : this.signals;
      const summary = await collection
        .aggregate<{ _id: string; count: number }>(
          [{ $match: f }, { $group: { _id: "$state", count: { $sum: 1 } } }],
          { session: tx },
        )
        .toArray();
      const rows = await collection
          .find(
            { ...f, ...(after ? { _id: { $lt: objectId(after.id) } } : {}) } as Filter<CareAlert> &
              Filter<CareSignal>,
            { session: tx },
          )
          .sort({ _id: -1 })
          .limit(limit + 1)
          .toArray(),
        more = rows.length > limit;
      rows.splice(limit);
      const last = rows.at(-1);
      return {
        items: rows.map((s) => this.dto(s)),
        summary: { total: summary.reduce((n, c) => n + c.count, 0), states: summary },
        nextCursor: more && last ? this.query.encode(context, "", last._id.toHexString()) : null,
        canManage: g.canManageCare,
        principalKey: `${g.actorKind}:${g.actorId}:${g.policyContext}`,
        day: businessDay(this.now()),
        assessment: await this.assessment(g, tx),
      };
    });
  }
  async assessment(g: CareGrant, tx: ClientSession) {
    this.authorized(g);
    const row = await this.assessments.findOne({ _id: g.churchId }, { session: tx });
    return {
      pending: await this.alerts.countDocuments(
        { churchId: g.churchId, state: "pending" },
        { session: tx },
      ),
      lastEvaluatedAt: row?.lastEvaluatedAt.toISOString() ?? null,
      lastCompleteAt: row?.lastCompleteAt?.toISOString() ?? null,
      complete: row?.complete ?? false,
    };
  }
  private async source(g: CareGrant, target: CareTarget, tx: ClientSession) {
    const ctx = await this.sources.load(g, [target], tx),
      signals = await this.signals
        .find(
          {
            churchId: g.churchId,
            targetKind: target.kind,
            targetId: objectId(target.id),
            state: "open",
          },
          { session: tx },
        )
        .limit(4)
        .toArray();
    requireCondition(signals.length <= 3, 503, "DEPENDENCY_UNAVAILABLE");
    return this.sources.assess(target, signals, ctx, businessDay(this.now()));
  }
  async get(g: CareGrant, id: string, kind: "alert" | "signal" = "alert") {
    this.authorized(g);
    return this.db.readSnapshot(g.churchId.toHexString(), async (tx) => {
      await g.fence(tx);
      const r = kind === "alert" ? await this.alert(g, id, tx) : await this.signal(g, id, tx),
        current = await this.source(g, this.target(r), tx),
        condition = current.conditions.find((c) => c.kind === r.kind);
      return {
        record: this.dto(r),
        current: {
          target: current.snapshot,
          available: current.available,
          qualifies: condition?.qualifies ?? null,
          evidence: condition?.evidence ?? [],
        },
        existing: kind === "alert" ? await this.visits.open(g, this.target(r), r.kind, tx) : null,
      };
    });
  }
  async history(g: CareGrant, id: string, kind: "alert" | "signal", q: URLSearchParams) {
    this.authorized(g);
    this.query.allow(q, ["limit", "cursor"]);
    const limit = this.query.limit(q),
      context = this.query.context(g, `history/${kind}/${id}`, null),
      after = q.has("cursor") ? this.query.decode(q.get("cursor") as string, context) : null;
    return this.db.readSnapshot(g.churchId.toHexString(), async (tx) => {
      await g.fence(tx);
      if (kind === "alert") await this.alert(g, id, tx);
      else await this.signal(g, id, tx);
      const rows = await this.histories
          .find(
            {
              churchId: g.churchId,
              resourceKind: kind,
              resourceId: objectId(id),
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
          before: h.before,
          after: h.after,
          reason: h.reason,
          actorId: h.actorId.toHexString(),
          actorKind: h.actorKind,
          occurredAt: h.occurredAt.toISOString(),
        })),
        nextCursor: more && last ? this.query.encode(context, "", last._id.toHexString()) : null,
      };
    });
  }
  private async signalProposal(
    g: CareGrant,
    b: SignalCommand,
    old: CareSignal | null,
    tx: ClientSession,
  ) {
    requireCondition(old ? b.action !== "create" : b.action === "create", 422, "VALIDATION_FAILED");
    if (b.action !== "create") requireCondition(b.reason, 422, "REASON_REQUIRED");
    if (b.action === "end") requireCondition(old?.state === "open", 409, "CARE_SIGNAL_ENDED");
    const target = old ? this.target(old) : b.action === "create" ? b.target : null;
    requireCondition(target, 422, "VALIDATION_FAILED");
    const kind = old?.kind ?? (b.action === "create" ? b.kind : "illness"),
      fields =
        "fields" in b
          ? b.fields
          : { occurredOn: (old as CareSignal).occurredOn, summary: (old as CareSignal).summary };
    requireCondition(
      (kind === "bereavement") === (target.kind === "family") &&
        fields.occurredOn <= businessDay(this.now()),
      422,
      "CARE_SOURCE_INVALID",
    );
    const source = await this.source(g, target, tx);
    if (b.action === "create")
      requireCondition(source.available && source.snapshot, 422, "CARE_TARGET_UNAVAILABLE");
    if (b.action === "create")
      requireCondition(
        !(await this.signals.findOne(
          {
            churchId: g.churchId,
            targetKind: target.kind,
            targetId: objectId(target.id),
            kind,
            state: "open",
          },
          { session: tx },
        )),
        409,
        "CARE_SIGNAL_EXISTS",
      );
    const context = digest(
      canonical({
        actor: [g.actorKind, g.actorId, g.policyContext, g.churchId],
        body: { ...b, preview: null, confirmed: false },
        version: old?.version ?? 0,
        source,
        day: businessDay(this.now()),
      }),
    );
    return { context, target, kind, fields, source };
  }
  async previewSignal(g: CareGrant, id: string | null, raw: unknown, match: string | null) {
    this.authorized(g, true);
    const b = parse(signalInput, raw),
      expected = id ? version(match) : null;
    return this.db.readSnapshot(g.churchId.toHexString(), async (tx) => {
      await g.fence(tx);
      const old = id ? await this.signal(g, id, tx) : null;
      requireCondition(!old || old.version === expected, 412, "VERSION_CONFLICT");
      const p = await this.signalProposal(g, b, old, tx);
      return {
        context: p.context,
        action: b.action,
        before: old ? signalDto(old) : null,
        target: p.source.snapshot ?? old?.targetSnapshot,
        kind: p.kind,
        fields: p.fields,
        reason: b.reason,
      };
    });
  }
  async saveSignal(
    g: CareGrant,
    id: string | null,
    raw: unknown,
    key: string | null,
    match: string | null,
    requestId: string,
  ) {
    this.authorized(g, true);
    const b = parse(signalInput, raw),
      expected = id ? version(match) : null;
    return this.execute(
      g,
      `signals/${id ? objectId(id).toHexString() : "new"}`,
      b,
      key,
      expected,
      async (tx, op) => {
        const old = id ? await this.signal(g, id, tx) : null;
        requireCondition(!old || old.version === expected, 412, "VERSION_CONFLICT");
        const p = await this.signalProposal(g, b, old, tx);
        requireCondition(b.preview === p.context, 412, "CARE_PREVIEW_STALE");
        requireCondition(b.confirmed, 422, "CARE_CONFIRMATION_REQUIRED");
        await this.sources.fence(g, p.source, tx);
        const now = this.now(),
          snapshot = old?.targetSnapshot ?? p.source.snapshot;
        requireCondition(snapshot, 422, "CARE_TARGET_UNAVAILABLE");
        const row: CareSignal = {
          _id: old?._id ?? new ObjectId(),
          churchId: g.churchId,
          code: old?.code ?? resourceCode("NC"),
          version: (old?.version ?? 0) + 1,
          targetKind: p.target.kind,
          targetId: objectId(p.target.id),
          targetSnapshot: snapshot,
          targetNameKey: old?.targetNameKey ?? searchName(snapshot.name),
          kind: p.kind,
          ...p.fields,
          state: b.action === "end" ? "ended" : (old?.state ?? "open"),
          createdAt: old?.createdAt ?? now,
          updatedAt: now,
        };
        if (old) {
          const r = await this.signals.replaceOne(
            { _id: old._id, churchId: g.churchId, version: old.version },
            row,
            { session: tx },
          );
          requireCondition(r.matchedCount, 412, "VERSION_CONFLICT");
        } else await this.signals.insertOne(row, { session: tx });
        await this.record(g, "signal", old, row, b.action, b.reason, op, requestId, tx);
        await this.reconcile(g, [p.target], tx, op, requestId);
        return {
          safeResult: { signalId: row._id.toHexString(), version: row.version },
          resourceRefs: [{ type: "care_signal", id: row._id.toHexString() }],
        };
      },
      id ? 200 : 201,
    );
  }
  private async alertProposal(g: CareGrant, b: AlertCommand, old: CareAlert, tx: ClientSession) {
    requireCondition(old.state === "pending" && old.episodeActive, 409, "CARE_ALREADY_DECIDED");
    requireCondition(b.reason, 422, "REASON_REQUIRED");
    const source = await this.source(g, this.target(old), tx),
      condition = source.conditions.find((c) => c.kind === old.kind);
    let visit: Awaited<ReturnType<typeof this.visits.prepare>> | null = null,
      existing: Awaited<ReturnType<typeof this.visits.open>> = null;
    if (b.action === "convert") {
      requireCondition(
        condition?.qualifies === true && source.available,
        condition?.qualifies === null ? 503 : 412,
        condition?.qualifies === null ? "CARE_SOURCE_UNKNOWN" : "CARE_SOURCE_STALE",
      );
      existing = await this.visits.open(g, this.target(old), old.kind, tx);
      requireCondition(
        existing
          ? b.mode === "link" && b.caseId === existing.id && b.caseVersion === existing.version
          : b.mode === "create" && b.caseId === null && b.caseVersion === null,
        409,
        "CARE_LINK_CHANGED",
      );
      if (!existing)
        visit = await this.visits.prepare(
          g,
          this.target(old),
          { ...b.fields, reasonCode: old.kind },
          tx,
        );
    }
    const context = digest(
      canonical({
        actor: [g.actorKind, g.actorId, g.policyContext, g.churchId],
        body: { ...b, preview: null, confirmed: false },
        version: old.version,
        source,
        visit,
        existing,
        day: businessDay(this.now()),
      }),
    );
    return { context, source, condition, visit, existing };
  }
  async previewAlert(g: CareGrant, id: string, raw: unknown, match: string | null) {
    this.authorized(g, true);
    const b = parse(alertInput, raw),
      expected = version(match);
    return this.db.readSnapshot(g.churchId.toHexString(), async (tx) => {
      await g.fence(tx);
      const old = await this.alert(g, id, tx);
      requireCondition(old.version === expected, 412, "VERSION_CONFLICT");
      const p = await this.alertProposal(g, b, old, tx);
      return {
        context: p.context,
        action: b.action,
        before: alertDto(old),
        current: {
          target: p.source.snapshot,
          qualifies: p.condition?.qualifies ?? null,
          evidence: p.condition?.evidence ?? [],
        },
        visit: p.visit,
        existing: p.existing,
        reason: b.reason,
      };
    });
  }
  async decide(
    g: CareGrant,
    id: string,
    raw: unknown,
    key: string | null,
    match: string | null,
    requestId: string,
  ) {
    this.authorized(g, true);
    const b = parse(alertInput, raw),
      expected = version(match);
    return this.execute(g, `alerts/${objectId(id)}`, b, key, expected, async (tx, op) => {
      const old = await this.alert(g, id, tx);
      requireCondition(old.version === expected, 412, "VERSION_CONFLICT");
      const p = await this.alertProposal(g, b, old, tx);
      requireCondition(b.preview === p.context, 412, "CARE_PREVIEW_STALE");
      requireCondition(b.confirmed, 422, "CARE_CONFIRMATION_REQUIRED");
      await this.sources.fence(g, p.source, tx);
      const visit =
        b.action === "convert"
          ? (p.existing ??
            (await this.visits.create(
              g,
              this.target(old),
              { ...b.fields, reasonCode: old.kind },
              b.reason,
              tx,
              op,
              requestId,
            )))
          : null;
      const row: CareAlert = {
        ...old,
        version: old.version + 1,
        state: visit ? "linked" : "dismissed",
        caseId: visit ? objectId(visit.id) : null,
        decisionReason: b.reason,
        evidence: p.condition?.qualifies === null ? old.evidence : (p.condition?.evidence ?? []),
        availability:
          p.condition?.qualifies === null
            ? "unknown"
            : p.condition?.qualifies
              ? "eligible"
              : "ineligible",
        episodeActive: p.condition?.qualifies !== false,
        lastEvaluatedAt: this.now(),
        updatedAt: this.now(),
      };
      const r = await this.alerts.replaceOne(
        { _id: old._id, churchId: g.churchId, version: old.version },
        row,
        { session: tx },
      );
      requireCondition(r.matchedCount, 412, "VERSION_CONFLICT");
      await this.record(g, "alert", old, row, b.action, b.reason, op, requestId, tx);
      return {
        safeResult: {
          alertId: row._id.toHexString(),
          version: row.version,
          caseId: row.caseId?.toHexString() ?? null,
          state: row.state,
        },
        resourceRefs: [
          { type: "care_alert", id: row._id.toHexString() },
          ...(visit ? [{ type: "visitation_case", id: visit.id }] : []),
        ],
      };
    });
  }
  private async reconcile(
    g: CareGrant,
    targets: CareTarget[],
    tx: ClientSession,
    op: ObjectId,
    requestId: string,
  ) {
    const unique = [...new Map(targets.map((t) => [targetKey(t), t])).values()];
    if (!unique.length) return { created: 0, updated: 0, expired: 0 };
    requireCondition(unique.length <= 100, 400, "INVALID_REQUEST");
    const match = { $or: unique.map((t) => ({ targetKind: t.kind, targetId: objectId(t.id) })) },
      ctx = await this.sources.load(g, unique, tx);
    const signals = await this.signals
        .find({ churchId: g.churchId, state: "open", ...match }, { session: tx })
        .limit(301)
        .toArray(),
      active = await this.alerts
        .find({ churchId: g.churchId, episodeActive: true, ...match }, { session: tx })
        .limit(401)
        .toArray();
    requireCondition(signals.length <= 300 && active.length <= 400, 503, "DEPENDENCY_UNAVAILABLE");
    let created = 0,
      updated = 0,
      expired = 0;
    for (const target of unique) {
      const source = this.sources.assess(
        target,
        signals.filter(
          (s) => s.targetKind === target.kind && s.targetId.toHexString() === target.id,
        ),
        ctx,
        businessDay(this.now()),
      );
      await this.sources.fence(g, source, tx);
      for (const c of source.conditions) {
        const old = active.find(
            (a) =>
              a.targetKind === target.kind &&
              a.targetId.toHexString() === target.id &&
              a.kind === c.kind,
          ),
          now = this.now();
        if (!old) {
          if (c.qualifies !== true || !source.snapshot) continue;
          const row: CareAlert = {
            _id: new ObjectId(),
            churchId: g.churchId,
            code: resourceCode("DN"),
            version: 1,
            targetKind: target.kind,
            targetId: objectId(target.id),
            targetSnapshot: source.snapshot,
            targetNameKey: searchName(source.snapshot.name),
            kind: c.kind,
            state: "pending",
            episodeActive: true,
            availability: "eligible",
            evidence: c.evidence,
            caseId: null,
            decisionReason: null,
            lastEvaluatedAt: now,
            createdAt: now,
            updatedAt: now,
          };
          await this.alerts.insertOne(row, { session: tx });
          await this.record(g, "alert", null, row, "evaluate", null, op, requestId, tx);
          created++;
          continue;
        }
        const availability =
            c.qualifies === null ? "unknown" : c.qualifies ? "eligible" : "ineligible",
          state = c.qualifies === false && old.state === "pending" ? "expired" : old.state,
          episodeActive = c.qualifies !== false,
          evidence = c.qualifies === null ? old.evidence : c.evidence;
        if (
          canonical([old.availability, old.state, old.episodeActive, old.evidence]) ===
          canonical([availability, state, episodeActive, evidence])
        ) {
          await this.alerts.updateOne(
            { _id: old._id, churchId: g.churchId, version: old.version },
            { $set: { lastEvaluatedAt: now } },
            { session: tx },
          );
          continue;
        }
        const row: CareAlert = {
          ...old,
          availability,
          state,
          episodeActive,
          evidence,
          version: old.version + 1,
          lastEvaluatedAt: now,
          updatedAt: now,
        };
        const r = await this.alerts.replaceOne(
          { _id: old._id, churchId: g.churchId, version: old.version },
          row,
          { session: tx },
        );
        requireCondition(r.matchedCount, 412, "VERSION_CONFLICT");
        await this.record(
          g,
          "alert",
          old,
          row,
          state === "expired" ? "expire" : "evaluate",
          null,
          op,
          requestId,
          tx,
        );
        updated++;
        if (state === "expired") expired++;
      }
    }
    return { created, updated, expired };
  }
  async evaluate(g: CareGrant, raw: unknown, key: string | null, requestId: string) {
    this.authorized(g, true);
    const b = parse(evaluateInput, raw);
    return this.execute(g, "sources/evaluate", b, key, null, async (tx, op) => {
      const w = await this.sources.window(g, tx),
        day = businessDay(this.now()),
        context = this.query.context(g, "scan", [day, w.fingerprint]),
        after = b.cursor ? this.query.decode(b.cursor, context) : null,
        phase = after?.key ?? "members";
      requireCondition(["members", "signals", "alerts"].includes(phase), 400, "INVALID_CURSOR");
      const last = after?.id ?? null;
      let targets: CareTarget[], ids: string[];
      if (phase === "members") {
        const rows = await this.sources.page(g, last, b.limit + 1, tx);
        ids = rows.map((r) => r.id);
        targets = rows.slice(0, b.limit).map((r) => ({ kind: "member", id: r.id }));
      } else {
        const collection = phase === "signals" ? this.signals : this.alerts,
          rows = await collection
            .find(
              {
                churchId: g.churchId,
                ...(phase === "signals" ? { state: "open" } : { episodeActive: true }),
                ...(last ? { _id: { $gt: objectId(last) } } : {}),
              } as Filter<CareSignal> & Filter<CareAlert>,
              { session: tx },
            )
            .sort({ _id: 1 })
            .limit(b.limit + 1)
            .toArray();
        ids = rows.map((r) => r._id.toHexString());
        targets = rows.slice(0, b.limit).map((r) => this.target(r));
      }
      const counts = await this.reconcile(g, targets, tx, op, requestId),
        more = ids.length > b.limit,
        nextPhase = phase === "members" ? "signals" : phase === "signals" ? "alerts" : null,
        nextCursor = more
          ? this.query.encode(context, phase, ids[b.limit - 1] as string)
          : nextPhase
            ? this.query.encode(context, nextPhase, "000000000000000000000000")
            : null,
        now = this.now(),
        old = await this.assessments.findOne({ _id: g.churchId }, { session: tx });
      await this.assessments.replaceOne(
        { _id: g.churchId },
        {
          lastEvaluatedAt: now,
          lastCompleteAt: nextCursor ? (old?.lastCompleteAt ?? null) : now,
          complete: !nextCursor,
          context,
        },
        { upsert: true, session: tx },
      );
      return {
        safeResult: {
          processed: Math.min(ids.length, b.limit),
          ...counts,
          phase,
          nextCursor,
          evaluatedAt: now.toISOString(),
          coverage: w.days.slice(-3).filter((d) => d.state === "closed").length,
          complete: !nextCursor,
        },
        resourceRefs: [{ type: "care_scan", id: op.toHexString() }],
      };
    });
  }
}
