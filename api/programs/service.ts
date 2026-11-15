import { type ClientSession, type Filter, MongoServerError, ObjectId } from "mongodb";
import type { Audit } from "../audit/service";
import { AppError, requireCondition } from "../errors";
import { objectId, parse, version } from "../http-validation";
import { digest } from "../identity/crypto";
import type { Database } from "../infrastructure/database";
import { canonical, type Operations } from "../operations/service";
import { TenantQueries } from "../tenant-queries";
import { generateRows, mergeGenerated } from "./generation";
import {
  draftDto,
  editionDto,
  type ProgramDraft,
  type ProgramEdition,
  type ProgramGrant,
  type ProgramHistory,
} from "./models";
import type { ProgramSources } from "./sources";
import { commandInput, type ProgramCommand } from "./validation";
export class Programs {
  private query: TenantQueries;
  constructor(
    private db: Database,
    private sources: ProgramSources,
    private ops: Operations,
    private audit: Audit,
    key: string,
    private now: () => Date,
  ) {
    this.query = new TenantQueries(key, now, "programs");
  }
  private get drafts() {
    return this.db.db.collection<ProgramDraft>("program_drafts");
  }
  private get editions() {
    return this.db.db.collection<ProgramEdition>("program_editions");
  }
  private get histories() {
    return this.db.db.collection<ProgramHistory>("program_history");
  }
  private manage(g: ProgramGrant) {
    requireCondition(g.canManagePrograms, 403, "FORBIDDEN");
  }
  private async raw(g: ProgramGrant, id: string, tx: ClientSession) {
    const d = await this.drafts.findOne(
      { _id: objectId(id), churchId: g.churchId },
      { session: tx },
    );
    requireCondition(d, 404, "NOT_FOUND");
    await this.sources.organization.unit(g, d.unitId.toHexString(), tx);
    return d;
  }
  private async current(g: ProgramGrant, d: ProgramDraft, tx: ClientSession) {
    const s = await this.sources.capture(
      g,
      d.unitId.toHexString(),
      d.occurrenceId.toHexString(),
      tx,
      d.rows,
      d,
    );
    return {
      matches: s.cal.matches,
      editable: s.cal.editable && s.ctx.unit.status === "active",
      rosterAvailable: s.ctx.available,
      changed:
        !s.cal.matches ||
        s.snapshot.sourceVersion !== d.snapshot.sourceVersion ||
        s.snapshot.unitName !== d.snapshot.unitName ||
        s.snapshot.termLabel !== d.snapshot.termLabel ||
        s.snapshot.churchName !== d.snapshot.churchName ||
        !s.ctx.available ||
        s.invalid.length > 0 ||
        s.people.some((p) => {
          const old = d.people.find((before) => before.id === p.id);
          return old && (old.fullName !== p.fullName || old.code !== p.code);
        }),
      invalidMemberIds: s.invalid,
      snapshot: s.cal.matches ? s.snapshot : null,
    };
  }
  async units(g: ProgramGrant, q: URLSearchParams) {
    return this.sources.organization.list(g, q);
  }
  async occurrences(g: ProgramGrant, q: URLSearchParams) {
    this.query.allow(q, ["unitId", "from", "to", "limit", "cursor"]);
    const unitId = q.get("unitId");
    requireCondition(unitId, 400, "INVALID_REQUEST");
    objectId(unitId);
    const query = new URLSearchParams(q);
    query.delete("unitId");
    return this.sources.occurrences(
      {
        ...g,
        fence: async (tx) => {
          await g.fence(tx);
          await this.sources.organization.unit(g, unitId, tx, true);
        },
      },
      unitId,
      query,
    );
  }
  async people(g: ProgramGrant, q: URLSearchParams) {
    this.manage(g);
    this.query.allow(q, ["unitId", "occurrenceId", "q", "limit", "cursor"]);
    const unitId = q.get("unitId"),
      occurrenceId = q.get("occurrenceId"),
      term = (q.get("q") ?? "").normalize("NFC").trim(),
      limit = this.query.limit(q);
    requireCondition(unitId && occurrenceId && term.length <= 100, 400, "INVALID_REQUEST");
    objectId(unitId);
    objectId(occurrenceId);
    return this.db.readSnapshot(g.churchId.toHexString(), async (tx) => {
      await g.fence(tx);
      const initial = await this.sources.people(g, unitId, occurrenceId, tx, limit + 1, term, null),
        context = this.query.context(g, "people", [unitId, occurrenceId, term, initial.context]);
      const after = q.has("cursor") ? this.query.decode(q.get("cursor") as string, context) : null;
      const p = after
          ? await this.sources.people(g, unitId, occurrenceId, tx, limit + 1, term, after)
          : initial,
        rows = p.rows,
        more = rows.length > limit;
      rows.splice(limit);
      const last = rows.at(-1);
      return {
        items: rows.map((p) => ({ id: p.id, code: p.code, fullName: p.fullName })),
        available: p.available,
        nextCursor: more && last ? this.query.encode(context, last.nameKey, last.id) : null,
      };
    });
  }
  async list(g: ProgramGrant, q: URLSearchParams) {
    this.query.allow(q, ["unitId", "occurrenceId", "limit", "cursor"]);
    const unit = q.get("unitId"),
      occ = q.get("occurrenceId"),
      limit = this.query.limit(q);
    if (unit) objectId(unit);
    if (occ) objectId(occ);
    const context = this.query.context(g, "drafts", [unit, occ, g.unitScope ?? null]),
      after = q.has("cursor") ? this.query.decode(q.get("cursor") as string, context) : null;
    return this.db.readSnapshot(g.churchId.toHexString(), async (tx) => {
      await g.fence(tx);
      if (unit) await this.sources.organization.unit(g, unit, tx);
      const f: Filter<ProgramDraft> = {
        churchId: g.churchId,
        ...(unit ? { unitId: objectId(unit) } : {}),
        ...(occ ? { occurrenceId: objectId(occ) } : {}),
      };
      if (g.unitScope) {
        const active = await this.sources.organization.activeIds(g, tx);
        f.unitId = { $in: active.filter((id) => !unit || id.toHexString() === unit) };
      }
      if (after) f._id = { $lt: objectId(after.id) };
      const rows = await this.drafts
          .find(f, { session: tx })
          .sort({ _id: -1 })
          .limit(limit + 1)
          .toArray(),
        more = rows.length > limit;
      rows.splice(limit);
      const last = rows.at(-1);
      return {
        items: rows.map((d) => ({
          id: d._id.toHexString(),
          unitId: d.unitId.toHexString(),
          occurrenceId: d.occurrenceId.toHexString(),
          version: d.version,
          state: d.state,
          latestRevision: d.latestRevision,
          snapshot: d.snapshot,
        })),
        nextCursor: more && last ? this.query.encode(context, "", last._id.toHexString()) : null,
        principalKey: `${g.actorKind}:${g.actorId}:${g.policyContext}`,
        canManage: g.canManagePrograms,
      };
    });
  }
  async get(g: ProgramGrant, id: string) {
    return this.db.readSnapshot(g.churchId.toHexString(), async (tx) => {
      await g.fence(tx);
      const d = await this.raw(g, id, tx);
      return { ...draftDto(d), current: await this.current(g, d, tx) };
    });
  }
  private async proposal(
    g: ProgramGrant,
    b: ProgramCommand,
    d: ProgramDraft | null,
    tx: ClientSession,
  ) {
    requireCondition(
      d
        ? b.action !== "create" && b.unitId === null && b.occurrenceId === null
        : b.action === "create" && !!b.unitId && !!b.occurrenceId,
      422,
      "VALIDATION_FAILED",
    );
    requireCondition((b.action === "save") === !!b.rows, 422, "VALIDATION_FAILED");
    requireCondition(
      !d ||
        (b.action === "amend"
          ? d.state === "finalized" && d.latestRevision > 0
          : d.state === "draft"),
      409,
      "PROGRAM_DRAFT_LOCKED",
    );
    requireCondition(
      !(b.action === "amend" || (b.action === "finalize" && (d?.latestRevision ?? 0) > 0)) ||
        !!b.reason,
      422,
      "REASON_REQUIRED",
    );
    const unitId = d?.unitId.toHexString() ?? (b.unitId as string),
      occurrenceId = d?.occurrenceId.toHexString() ?? (b.occurrenceId as string);
    let rows = b.rows ?? d?.rows ?? [],
      baseline = d?.baseline ?? [];
    if (b.action === "save" && d)
      for (const row of rows)
        if (row.templateKey)
          requireCondition(
            d.baseline.some((r) => r.templateKey === row.templateKey && r.id === row.id),
            422,
            "VALIDATION_FAILED",
          );
    const source = await this.sources.capture(
      g,
      unitId,
      occurrenceId,
      tx,
      b.action === "create" ? [] : rows,
      d,
      true,
      b.action === "create" || b.action === "regenerate",
    );
    if (b.action === "create" || b.action === "regenerate") {
      const speaker = source.cal.source?.input.speaker;
      const generated = generateRows(
        source.candidates,
        source.snapshot.scripture,
        source.snapshot.theme,
        speaker?.source === "member" ? speaker.memberId : null,
        baseline,
      );
      // New IDs must be deterministic across preview and commit. They are program-local slot identities.
      if (!d)
        generated.forEach((r) => {
          const h = digest(canonical([g.churchId, unitId, occurrenceId, r.templateKey]));
          r.id = `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
        });
      rows = d ? mergeGenerated(rows, baseline, generated) : generated;
      baseline = generated;
    }
    const captured = await this.sources.capture(g, unitId, occurrenceId, tx, rows, d, true);
    const incomplete = rows.filter((r) => r.assignment.mode === "unassigned").length;
    const context = digest(
      canonical({
        actor: [g.actorKind, g.actorId, g.churchId, g.policyContext],
        body: { ...b, preview: null, incompleteConfirmed: false },
        version: d?.version ?? 0,
        head: d?.latestEditionId ?? null,
        rows,
        baseline,
        source: { ...captured.snapshot, capturedAt: undefined },
        unit: captured.ctx.unit,
        term: captured.ctx.term,
        people: captured.selected,
        candidates: source.candidates,
        invalid: captured.invalid,
      }),
    );
    return { context, rows, baseline, captured, incomplete, unitId, occurrenceId };
  }
  async preview(g: ProgramGrant, id: string | null, raw: unknown, match: string | null) {
    this.manage(g);
    const b = parse(commandInput, raw),
      expected = id ? version(match) : null;
    return this.db.readSnapshot(g.churchId.toHexString(), async (tx) => {
      await g.fence(tx);
      const d = id ? await this.raw(g, id, tx) : null;
      requireCondition(!d || d.version === expected, 412, "VERSION_CONFLICT");
      const p = await this.proposal(g, b, d, tx);
      return {
        context: p.context,
        action: b.action,
        before: d ? draftDto(d) : null,
        rows: p.rows,
        people: p.captured.people,
        snapshot: p.captured.snapshot,
        incomplete: p.incomplete,
        invalidMemberIds: p.captured.invalid,
        sourceAvailable: p.captured.available,
        willFinalize: b.action === "finalize",
        revision: (d?.latestRevision ?? 0) + 1,
      };
    });
  }
  private async history(
    g: ProgramGrant,
    d: ProgramDraft,
    before: ProgramDraft | null,
    event: string,
    reason: string | null,
    tx: ClientSession,
    op: ObjectId,
    requestId: string,
  ) {
    await this.histories.insertOne(
      {
        _id: new ObjectId(),
        churchId: g.churchId,
        programId: d._id,
        operationId: op,
        event,
        reason,
        before: before ? draftDto(before) : null,
        after: draftDto(d),
        actorId: g.actorId,
        actorKind: g.actorKind,
        occurredAt: this.now(),
      },
      { session: tx },
    );
    await this.audit.organization(
      `programs.${event}`,
      requestId,
      { kind: g.actorKind, id: g.actorId, churchId: g.actorKind === "owner" ? null : g.churchId },
      g.churchId,
      "program",
      d._id,
      [event],
      op,
      tx,
    );
  }
  async save(
    g: ProgramGrant,
    id: string | null,
    raw: unknown,
    key: string | null,
    match: string | null,
    requestId: string,
  ) {
    this.manage(g);
    const b = parse(commandInput, raw),
      expected = id ? version(match) : null;
    const guarded = {
      ...g,
      fence: async (tx: ClientSession) => {
        await g.fence(tx);
        this.manage(g);
        if (id) await this.raw(g, id, tx);
        else {
          requireCondition(b.unitId, 422, "VALIDATION_FAILED");
          await this.sources.organization.unit(g, b.unitId, tx, true);
        }
      },
    };
    try {
      return await this.ops.executeTenant(
        guarded,
        id ? "PATCH" : "POST",
        `programs/${g.churchId}/drafts${id ? `/${objectId(id)}` : ""}`,
        key,
        b,
        expected,
        async (tx, op) => {
          const old = id ? await this.raw(g, id, tx) : null;
          requireCondition(!old || old.version === expected, 412, "VERSION_CONFLICT");
          const p = await this.proposal(g, b, old, tx);
          requireCondition(b.preview === p.context, 412, "PROGRAM_PREVIEW_STALE");
          if (b.action === "finalize") {
            requireCondition(
              p.captured.available && !p.captured.invalid.length,
              422,
              "PROGRAM_SOURCE_UNAVAILABLE",
            );
            requireCondition(
              !p.incomplete || b.incompleteConfirmed,
              422,
              "PROGRAM_INCOMPLETE_CONFIRMATION",
            );
          }
          await this.sources.fence(g, p.captured, tx);
          const now = this.now(),
            d: ProgramDraft = {
              _id: old ? old._id : new ObjectId(),
              churchId: g.churchId,
              unitId: objectId(p.unitId),
              occurrenceId: objectId(p.occurrenceId),
              version: (old?.version ?? 0) + 1,
              state: b.action === "finalize" ? "finalized" : "draft",
              rows: p.rows,
              baseline: p.baseline,
              people: p.captured.people,
              snapshot: p.captured.snapshot,
              latestRevision: old?.latestRevision ?? 0,
              latestEditionId: old?.latestEditionId ?? null,
              createdAt: old?.createdAt ?? now,
              updatedAt: now,
            };
          if (b.action === "finalize") {
            const edition: ProgramEdition = {
              _id: new ObjectId(),
              churchId: g.churchId,
              programId: d._id,
              unitId: d.unitId,
              occurrenceId: d.occurrenceId,
              revision: d.latestRevision + 1,
              rows: d.rows,
              people: d.people,
              snapshot: d.snapshot,
              reason: b.reason,
              templateVersion: "P42-r1",
              actorId: g.actorId,
              actorKind: g.actorKind,
              createdAt: now,
            };
            await this.editions.insertOne(edition, { session: tx });
            d.latestRevision = edition.revision;
            d.latestEditionId = edition._id;
          }
          if (old) {
            const saved = await this.drafts.replaceOne(
              { _id: old._id, churchId: g.churchId, version: expected as number },
              d,
              { session: tx },
            );
            requireCondition(saved.matchedCount, 412, "VERSION_CONFLICT");
          } else await this.drafts.insertOne(d, { session: tx });
          await this.history(g, d, old, b.action, b.reason, tx, op, requestId);
          return {
            safeResult: {
              programId: d._id.toHexString(),
              version: d.version,
              editionId: d.latestEditionId?.toHexString() ?? null,
              revision: d.latestRevision,
            },
            resourceRefs: [{ type: "program", id: d._id.toHexString() }],
          };
        },
        id ? 200 : 201,
      );
    } catch (e) {
      if (
        e instanceof MongoServerError &&
        e.code === 11000 &&
        String(e.message).includes("program_occurrence_unique")
      )
        throw new AppError(409, "PROGRAM_EXISTS");
      throw e;
    }
  }
  async editionsPage(g: ProgramGrant, id: string, q: URLSearchParams) {
    this.query.allow(q, ["limit", "cursor", "revision"]);
    const revision = q.get("revision");
    requireCondition(
      !q.has("revision") ||
        (!!revision && /^[1-9][0-9]*$/.test(revision) && Number.isSafeInteger(Number(revision))),
      400,
      "INVALID_REQUEST",
    );
    const limit = this.query.limit(q),
      context = this.query.context(g, `editions/${id}`, revision),
      after = q.has("cursor") ? this.query.decode(q.get("cursor") as string, context) : null;
    return this.db.readSnapshot(g.churchId.toHexString(), async (tx) => {
      await g.fence(tx);
      await this.raw(g, id, tx);
      const rows = await this.editions
          .find(
            {
              churchId: g.churchId,
              programId: objectId(id),
              ...(revision ? { revision: Number(revision) } : {}),
              ...(after ? { _id: { $lt: objectId(after.id) } } : {}),
            },
            { session: tx },
          )
          .sort({ _id: -1 })
          .limit(limit + 1)
          .toArray(),
        more = rows.length > limit;
      requireCondition(!revision || rows.length, 404, "NOT_FOUND");
      rows.splice(limit);
      const last = rows.at(-1);
      return {
        items: rows.map(editionDto),
        nextCursor: more && last ? this.query.encode(context, "", last._id.toHexString()) : null,
      };
    });
  }
  async historyPage(g: ProgramGrant, id: string, q: URLSearchParams) {
    this.query.allow(q, ["limit", "cursor"]);
    const limit = this.query.limit(q),
      context = this.query.context(g, `history/${id}`, null),
      after = q.has("cursor") ? this.query.decode(q.get("cursor") as string, context) : null;
    return this.db.readSnapshot(g.churchId.toHexString(), async (tx) => {
      await g.fence(tx);
      await this.raw(g, id, tx);
      const rows = await this.histories
          .find(
            {
              churchId: g.churchId,
              programId: objectId(id),
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
  async operation(g: ProgramGrant, id: string) {
    this.manage(g);
    return this.ops.getTenant(g, id, "programs", async (tx, op) => {
      requireCondition(
        op.resourceRefs.length > 0 && op.resourceRefs.every((r) => r.type === "program"),
        403,
        "FORBIDDEN",
      );
      for (const r of op.resourceRefs) await this.raw(g, r.id, tx);
    });
  }
  async printable(g: ProgramGrant, id: string, revision: number | null, expected: number) {
    return this.db.readSnapshot(g.churchId.toHexString(), async (tx) => {
      await g.fence(tx);
      const d = await this.raw(g, id, tx);
      let row: ReturnType<typeof draftDto> | ReturnType<typeof editionDto>;
      if (revision !== null) {
        const e = await this.editions.findOne(
          { churchId: g.churchId, programId: d._id, revision },
          { session: tx },
        );
        requireCondition(e, 404, "NOT_FOUND");
        requireCondition(expected === revision, 412, "PROGRAM_PREVIEW_STALE");
        row = editionDto(e);
      } else {
        requireCondition(d.version === expected, 412, "VERSION_CONFLICT");
        row = draftDto(d);
      }
      const current = await this.current(g, d, tx);
      return {
        record: row,
        draft: revision === null,
        revision,
        current,
        warning:
          current.changed ||
          current.snapshot?.unitName !== row.snapshot.unitName ||
          current.snapshot?.termLabel !== row.snapshot.termLabel ||
          current.snapshot?.churchName !== row.snapshot.churchName ||
          !current.matches ||
          (!current.editable && current.snapshot === null) ||
          current.snapshot?.sourceVersion !== row.snapshot.sourceVersion ||
          current.snapshot?.label !== row.snapshot.label ||
          current.snapshot?.startAt !== row.snapshot.startAt
            ? "BẢN LỊCH SỬ — nguồn đã thay đổi hoặc không còn phù hợp"
            : current.editable
              ? null
              : "BẢN LỊCH SỬ — buổi đã bắt đầu hoặc lịch bị hủy",
      };
    });
  }
}
