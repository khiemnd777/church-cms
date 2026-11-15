import { type ClientSession, type Filter, ObjectId } from "mongodb";
import type { Audit } from "../audit/service";
import type { TenantGrant } from "../authorization/tenant-grant";
import { requireCondition } from "../errors";
import { objectId, parse, version } from "../http-validation";
import { digest } from "../identity/crypto";
import type { Database } from "../infrastructure/database";
import { businessDay, shiftDay, validDay } from "../members/dates";
import type { SchedulingMembers } from "../members/scheduling";
import { canonical, type Operations } from "../operations/service";
import type { Organization } from "../organization/service";
import { TenantQueries } from "../tenant-queries";
import {
  type ScheduleGrant,
  type ScheduleHistory,
  type ScheduleRow,
  type ScheduleSeries,
  type ScheduleState,
  scheduleDto,
} from "./models";
import {
  commandInput,
  expand,
  type ScheduleCommand,
  type ScheduleInput,
  times,
} from "./validation";
export class Scheduling {
  private query: TenantQueries;
  constructor(
    private db: Database,
    private members: SchedulingMembers,
    private organization: Organization,
    private ops: Operations,
    private audit: Audit,
    key: string,
    private now: () => Date,
  ) {
    this.query = new TenantQueries(key, now, "scheduling");
  }
  private get rows() {
    return this.db.db.collection<ScheduleRow>("schedule_occurrences");
  }
  private get series() {
    return this.db.db.collection<ScheduleSeries>("schedule_series");
  }
  private get states() {
    return this.db.db.collection<ScheduleState>("schedule_state");
  }
  private get histories() {
    return this.db.db.collection<ScheduleHistory>("schedule_history");
  }
  private manager(g: ScheduleGrant) {
    requireCondition(g.canManageSchedule && !g.unitScope && !g.receiptScope, 403, "FORBIDDEN");
  }
  private async raw(g: ScheduleGrant, id: string, tx: ClientSession) {
    const r = await this.rows.findOne({ _id: objectId(id), churchId: g.churchId }, { session: tx });
    requireCondition(r, 404, "NOT_FOUND");
    if (g.unitScope) {
      requireCondition(
        r.state === "scheduled" &&
          r.input.scope === "unit" &&
          !!r.input.unitId &&
          g.unitScope.includes(r.input.unitId),
        404,
        "NOT_FOUND",
      );
      const active = await this.organization.attendanceUnits(g.churchId, [r.input.unitId], tx);
      requireCondition(active.length === 1, 404, "NOT_FOUND");
    }
    return r;
  }
  // Programs reads only its own unit-bound source. A moved source reveals no other unit metadata.
  async programSource(
    g: TenantGrant,
    id: string,
    unitId: string,
    tx: ClientSession,
    fence = false,
  ) {
    const r = await this.rows.findOne({ _id: objectId(id), churchId: g.churchId }, { session: tx });
    const matches = !!r && r.input.scope === "unit" && r.input.unitId === unitId;
    if (!r || !matches) return { matches: false, editable: false, source: null };
    const editable = r.state === "scheduled" && r.startAt > this.now() && !r.superseded;
    if (fence) {
      requireCondition(editable, 412, "PROGRAM_SOURCE_STALE");
      const saved = await this.rows.updateOne(
        {
          _id: r._id,
          churchId: g.churchId,
          version: r.version,
          state: "scheduled",
          "input.unitId": unitId,
        },
        { $inc: { programFence: 1 } },
        { session: tx },
      );
      requireCondition(saved.matchedCount, 412, "PROGRAM_SOURCE_STALE");
    }
    return { matches: true, editable, source: scheduleDto(r) };
  }
  async programOccurrences(g: TenantGrant, unitId: string, q: URLSearchParams) {
    this.query.allow(q, ["from", "to", "limit", "cursor"]);
    const from = q.get("from") ?? businessDay(this.now());
    requireCondition(validDay(from), 400, "INVALID_REQUEST");
    const to = q.get("to") ?? shiftDay(from, 90);
    requireCondition(
      validDay(to) && to >= from && to <= shiftDay(from, 91),
      400,
      "INVALID_REQUEST",
    );
    const limit = this.query.limit(q);
    return this.db.readSnapshot(g.churchId.toHexString(), async (tx) => {
      await g.fence(tx);
      const context = this.query.context(g, `program-occurrences/${unitId}`, [
          from,
          to,
          await this.revision(g, tx),
        ]),
        after = q.has("cursor") ? this.query.decode(q.get("cursor") as string, context) : null;
      const f: Filter<ScheduleRow> = {
        churchId: g.churchId,
        "input.scope": "unit",
        "input.unitId": unitId,
        state: "scheduled",
        startAt: {
          $gt: this.now(),
          $gte: new Date(`${from}T00:00:00+07:00`),
          $lt: new Date(`${shiftDay(to, 1)}T00:00:00+07:00`),
        },
      };
      if (after) {
        requireCondition(Number.isFinite(Date.parse(after.key)), 400, "INVALID_CURSOR");
        f.$or = [
          { startAt: { $gt: new Date(after.key) } },
          { startAt: new Date(after.key), _id: { $gt: objectId(after.id) } },
        ];
      }
      const rows = await this.rows
          .find(f, { session: tx })
          .sort({ startAt: 1, _id: 1 })
          .limit(limit + 1)
          .toArray(),
        more = rows.length > limit;
      rows.splice(limit);
      const last = rows.at(-1);
      return {
        items: rows.map((r) => ({
          id: r._id.toHexString(),
          label: r.input.label,
          startAt: r.startAt.toISOString(),
          version: r.version,
        })),
        nextCursor:
          more && last
            ? this.query.encode(context, last.startAt.toISOString(), last._id.toHexString())
            : null,
      };
    });
  }
  private async revision(g: TenantGrant, tx: ClientSession) {
    return (await this.states.findOne({ _id: g.churchId }, { session: tx }))?.revision ?? 0;
  }
  async get(g: ScheduleGrant, id: string) {
    return this.db.readSnapshot(g.churchId.toHexString(), async (tx) => {
      await g.fence(tx);
      return scheduleDto(await this.raw(g, id, tx));
    });
  }
  async list(g: ScheduleGrant, q: URLSearchParams) {
    this.query.allow(q, [
      "from",
      "to",
      "scope",
      "unitId",
      "state",
      "kind",
      "limit",
      "cursor",
      "sundays",
    ]);
    requireCondition(!q.has("sundays") || q.get("sundays") === "true", 400, "INVALID_REQUEST");
    const from = q.get("from") ?? businessDay(this.now());
    requireCondition(validDay(from), 400, "INVALID_REQUEST");
    const to = q.get("to") ?? shiftDay(from, 41),
      scope = q.get("scope"),
      unit = q.get("unitId"),
      state = q.get("state"),
      kind = q.get("kind"),
      limit = this.query.limit(q);
    requireCondition(
      validDay(from) && validDay(to) && to >= from && to <= shiftDay(from, 91),
      400,
      "INVALID_REQUEST",
    );
    requireCondition(!scope || ["church", "unit"].includes(scope), 400, "INVALID_REQUEST");
    requireCondition(
      !state || ["draft", "scheduled", "cancelled"].includes(state),
      400,
      "INVALID_REQUEST",
    );
    requireCondition(!kind || ["worship", "activity"].includes(kind), 400, "INVALID_REQUEST");
    if (unit) objectId(unit);
    return this.db.readSnapshot(g.churchId.toHexString(), async (tx) => {
      await g.fence(tx);
      const revision = await this.revision(g, tx),
        context = this.query.context(g, "occurrences", [
          from,
          to,
          scope,
          unit,
          state,
          kind,
          q.get("sundays"),
          revision,
          g.unitScope ?? null,
        ]);
      const after = q.has("cursor") ? this.query.decode(q.get("cursor") as string, context) : null;
      const filter: Filter<ScheduleRow> = {
        churchId: g.churchId,
        startAt: {
          $gte: new Date(`${from}T00:00:00+07:00`),
          $lt: new Date(`${shiftDay(to, 1)}T00:00:00+07:00`),
        },
        ...(scope ? { "input.scope": scope } : {}),
        ...(unit ? { "input.unitId": unit } : {}),
        ...(kind ? { "input.kind": kind } : {}),
        ...(state ? { state: state as ScheduleRow["state"] } : {}),
      };
      if (q.has("sundays"))
        filter.$expr = {
          $eq: [{ $dayOfWeek: { date: "$startAt", timezone: "Asia/Ho_Chi_Minh" } }, 1],
        };
      if (g.unitScope) {
        const active = await this.organization.attendanceUnits(g.churchId, g.unitScope, tx);
        filter["input.scope"] = "unit";
        filter["input.unitId"] = {
          $in: active.map((u) => u._id.toHexString()).filter((id) => !unit || id === unit),
        };
        filter.state = state && state !== "scheduled" ? { $in: [] } : "scheduled";
        if (scope === "church") filter["input.unitId"] = { $in: [] };
      }
      if (after) {
        requireCondition(Number.isFinite(Date.parse(after.key)), 400, "INVALID_CURSOR");
        filter.$or = [
          { startAt: { $gt: new Date(after.key) } },
          { startAt: new Date(after.key), _id: { $gt: objectId(after.id) } },
        ];
      }
      const rows = await this.rows
          .find(filter, { session: tx })
          .sort({ startAt: 1, _id: 1 })
          .limit(limit + 1)
          .toArray(),
        more = rows.length > limit;
      rows.splice(limit);
      const last = rows.at(-1);
      return {
        items: rows.map(scheduleDto),
        nextCursor:
          more && last
            ? this.query.encode(context, last.startAt.toISOString(), last._id.toHexString())
            : null,
        revision,
        from,
        to,
        canManage: g.canManageSchedule,
        principalKey: `${g.actorKind}:${g.actorId}:${g.policyContext}`,
        scope: g.unitScope ?? null,
      };
    });
  }
  async people(g: ScheduleGrant, q: URLSearchParams) {
    this.manager(g);
    this.query.allow(q, ["q", "limit", "cursor"]);
    const term = (q.get("q") ?? "").normalize("NFC").trim(),
      limit = this.query.limit(q);
    requireCondition(term.length <= 100, 400, "INVALID_REQUEST");
    return this.db.readSnapshot(g.churchId.toHexString(), async (tx) => {
      await g.fence(tx);
      const context = this.query.context(g, "people", term),
        after = q.has("cursor") ? this.query.decode(q.get("cursor") as string, context) : null,
        rows = await this.members.page(g, term, after, limit + 1, tx),
        more = rows.length > limit;
      rows.splice(limit);
      const last = rows.at(-1);
      return {
        items: rows.map((r) => ({ id: r._id.toHexString(), fullName: r.fullName, code: r.code })),
        nextCursor:
          more && last ? this.query.encode(context, last.nameKey, last._id.toHexString()) : null,
      };
    });
  }
  async units(g: ScheduleGrant, q: URLSearchParams) {
    this.manager(g);
    return this.organization.schedulingUnits(g, q);
  }
  private async capture(
    g: ScheduleGrant,
    i: ScheduleInput,
    old: ScheduleRow | null,
    tx: ClientSession,
  ) {
    const current = [] as { id: string; version: number }[],
      units = [] as { id: ObjectId; version: number }[];
    const person = async (id: string | null, oldId: string | null, name: string | null) => {
      if (!id) return null;
      if (old && id === oldId) return name;
      const m = await this.members.identity(g, id, tx);
      current.push(m);
      return m.fullName;
    };
    const unit = async (
      id: string | null,
      oldId: string | null,
      name: string | null,
      choir = false,
    ) => {
      if (!id) return null;
      if (old && id === oldId) return name;
      const u = await this.organization.schedulingUnit(g.churchId, objectId(id), tx, choir);
      units.push(u);
      return u.name;
    };
    const speakerId = i.speaker?.source === "member" ? i.speaker.memberId : null,
      oldSpeaker = old?.input.speaker?.source === "member" ? old.input.speaker.memberId : null;
    return {
      current,
      units,
      unitName: await unit(i.unitId, old?.input.unitId ?? null, old?.unitName ?? null),
      speakerName:
        i.speaker?.source === "external"
          ? i.speaker.fullName
          : await person(speakerId, oldSpeaker, old?.speakerName ?? null),
      leaderName: await person(i.leaderId, old?.input.leaderId ?? null, old?.leaderName ?? null),
      choirName: await unit(i.choirId, old?.input.choirId ?? null, old?.choirName ?? null, true),
      memberIds: [...new Set([speakerId, i.leaderId].filter((v): v is string => !!v))].map(
        objectId,
      ),
    };
  }
  private async proposal(
    g: ScheduleGrant,
    b: ScheduleCommand,
    old: ScheduleRow | null,
    tx: ClientSession,
  ) {
    times(b.input);
    const now = this.now();
    requireCondition(!old || old.state !== "cancelled", 422, "SCHEDULE_CANCELLED");
    requireCondition(!!old || b.state !== "cancelled", 422, "VALIDATION_FAILED");
    if (old && old.startAt <= now) {
      requireCondition(
        b.range === "one" &&
          !!b.reason &&
          b.state === old.state &&
          b.input.day === old.input.day &&
          b.input.startTime === old.input.startTime &&
          b.input.endDay === old.input.endDay &&
          b.input.endTime === old.input.endTime &&
          b.input.scope === old.input.scope &&
          b.input.unitId === old.input.unitId,
        422,
        "SCHEDULE_PAST_LOCKED",
      );
    } else if (b.state !== "cancelled")
      requireCondition(times(b.input).start > now, 422, "SCHEDULE_PAST_LOCKED");
    if (old) requireCondition(!!b.reason, 422, "REASON_REQUIRED");
    if (old?.state === "scheduled" && b.state !== "cancelled")
      requireCondition(b.state === "scheduled", 422, "VALIDATION_FAILED");
    const series = old
      ? await this.series.findOne({ _id: old.seriesId, churchId: g.churchId }, { session: tx })
      : null;
    requireCondition(!old || series, 404, "NOT_FOUND");
    const affected = old
      ? b.range === "one"
        ? [old]
        : await this.rows
            .find(
              {
                churchId: g.churchId,
                seriesId: old.seriesId,
                state: { $ne: "cancelled" },
                slot: { $gte: old.slot },
                startAt: { $gt: now },
              },
              { session: tx },
            )
            .limit(201)
            .toArray()
      : [];
    const cancelledExceptions =
      old && b.range === "future"
        ? await this.rows
            .find(
              {
                churchId: g.churchId,
                seriesId: old.seriesId,
                state: "cancelled",
                exception: true,
                superseded: false,
                slot: { $gte: old.slot },
                startAt: { $gt: now },
              },
              { session: tx },
            )
            .limit(201)
            .toArray()
        : [];
    requireCondition(
      affected.length + cancelledExceptions.length <= 200,
      422,
      "SCHEDULE_OCCURRENCE_LIMIT",
    );
    requireCondition(affected.length <= 200, 422, "SCHEDULE_OCCURRENCE_LIMIT");
    const slots = b.state === "cancelled" ? [] : expand(b.input, !!old && b.range === "one");
    const remaining =
      old && b.range === "future"
        ? await this.rows.countDocuments(
            {
              churchId: g.churchId,
              seriesId: old.seriesId,
              state: { $ne: "cancelled" },
              _id: { $nin: affected.map((r) => r._id) },
            },
            { session: tx },
          )
        : 0;
    requireCondition(remaining + slots.length <= 200, 422, "SCHEDULE_OCCURRENCE_LIMIT");
    const snapshots =
      b.state === "cancelled" && old
        ? {
            current: [],
            units: [],
            unitName: old.unitName,
            speakerName: old.speakerName,
            leaderName: old.leaderName,
            choirName: old.choirName,
            memberIds: old.memberIds,
          }
        : await this.capture(g, b.input, old && b.range === "one" ? old : null, tx);
    const conflicts: {
      occurrenceId: string | null;
      label: string;
      startAt: string;
      candidate: string;
    }[] = [];
    if (b.state === "scheduled") {
      for (const s of slots) {
        const refs: Filter<ScheduleRow>[] = [];
        if (snapshots.memberIds.length) refs.push({ memberIds: { $in: snapshots.memberIds } });
        if (b.input.choirId) refs.push({ "input.choirId": b.input.choirId });
        if (refs.length) {
          const rows = await this.rows
            .find(
              {
                churchId: g.churchId,
                state: "scheduled",
                _id: { $nin: affected.map((r) => r._id) },
                startAt: { $lt: s.end },
                endAt: { $gt: s.start },
                $or: refs,
              },
              { session: tx },
            )
            .limit(101)
            .toArray();
          requireCondition(
            rows.length <= 100 && conflicts.length + rows.length <= 200,
            422,
            "SCHEDULE_CONFLICT_LIMIT",
          );
          conflicts.push(
            ...rows.map((r) => ({
              occurrenceId: r._id.toHexString(),
              label: r.input.label,
              startAt: r.startAt.toISOString(),
              candidate: s.start.toISOString(),
            })),
          );
        }
      }
      // Recurrence period is at least a day and duration <=24h, so generated slots cannot overlap each other.
    }
    const revision = await this.revision(g, tx),
      exceptions = affected.filter((r) => r.exception).length + cancelledExceptions.length;
    const context = digest(
      canonical({
        actor: [g.actorKind, g.actorId, g.churchId, g.policyContext],
        revision,
        body: { ...b, preview: null, conflictsConfirmed: false, exceptionsConfirmed: false },
        old: old ? scheduleDto(old) : null,
        affected: affected.map((r) => [r._id, r.version]),
        cancelledExceptions: cancelledExceptions.map((r) => [r._id, r.version]),
        seriesVersion: series?.version ?? 0,
        snapshots,
        slots,
        conflicts,
      }),
    );
    return {
      context,
      revision,
      series,
      affected,
      cancelledExceptions,
      slots,
      snapshots,
      conflicts,
      exceptions,
    };
  }
  async preview(g: ScheduleGrant, id: string | null, raw: unknown, match: string | null) {
    this.manager(g);
    const b = parse(commandInput, raw),
      expected = id ? version(match) : null;
    return this.db.readSnapshot(g.churchId.toHexString(), async (tx) => {
      await g.fence(tx);
      const old = id ? await this.raw(g, id, tx) : null;
      requireCondition(!old || old.version === expected, 412, "VERSION_CONFLICT");
      const p = await this.proposal(g, b, old, tx);
      return {
        context: p.context,
        before: old ? scheduleDto(old) : null,
        after: {
          input: b.input,
          state: b.state,
          speakerName: p.snapshots.speakerName,
          leaderName: p.snapshots.leaderName,
          choirName: p.snapshots.choirName,
          unitName: p.snapshots.unitName,
        },
        cancelled:
          old && (b.range === "future" || b.state === "cancelled")
            ? p.affected.map(scheduleDto)
            : [],
        keptPast: !!old && b.range === "future",
        created: p.slots.map((s) => ({
          day: s.day,
          startAt: s.start.toISOString(),
          endAt: s.end.toISOString(),
        })),
        exceptions: p.exceptions,
        exceptionsItems: [...p.affected.filter((r) => r.exception), ...p.cancelledExceptions].map(
          scheduleDto,
        ),
        conflicts: p.conflicts,
      };
    });
  }
  private async history(
    g: ScheduleGrant,
    r: ScheduleRow,
    event: string,
    before: ScheduleRow | null,
    reason: string | null,
    tx: ClientSession,
    op: ObjectId,
    requestId: string,
  ) {
    await this.histories.insertOne(
      {
        _id: new ObjectId(),
        churchId: g.churchId,
        occurrenceId: r._id,
        operationId: op,
        event,
        before: before ? scheduleDto(before) : null,
        after: scheduleDto(r),
        reason,
        actorId: g.actorId,
        actorKind: g.actorKind,
        occurredAt: this.now(),
      },
      { session: tx },
    );
    await this.audit.organization(
      `scheduling.${event}`,
      requestId,
      { kind: g.actorKind, id: g.actorId, churchId: g.actorKind === "owner" ? null : g.churchId },
      g.churchId,
      "schedule",
      r._id,
      [event],
      op,
      tx,
    );
  }
  async save(
    g: ScheduleGrant,
    id: string | null,
    raw: unknown,
    key: string | null,
    match: string | null,
    requestId: string,
  ) {
    this.manager(g);
    const b = parse(commandInput, raw),
      expected = id ? version(match) : null;
    const guarded = {
      ...g,
      fence: async (tx: ClientSession) => {
        this.manager(g);
        await g.fence(tx);
        if (id) await this.raw(g, id, tx);
      },
    };
    return this.ops.executeTenant(
      guarded,
      id ? "PATCH" : "POST",
      `scheduling/${g.churchId}/occurrences${id ? `/${objectId(id)}` : ""}`,
      key,
      b,
      expected,
      async (tx, op) => {
        const old = id ? await this.raw(g, id, tx) : null;
        requireCondition(!old || old.version === expected, 412, "VERSION_CONFLICT");
        const p = await this.proposal(g, b, old, tx);
        requireCondition(b.preview === p.context, 412, "SCHEDULE_PREVIEW_STALE");
        requireCondition(
          !p.conflicts.length || (b.conflictsConfirmed && !!b.reason),
          422,
          "SCHEDULE_CONFLICT_CONFIRMATION",
        );
        requireCondition(
          !p.exceptions || b.range !== "future" || b.exceptionsConfirmed,
          422,
          "SCHEDULE_EXCEPTION_CONFIRMATION",
        );
        // Every calendar writer claims the same tenant revision: concurrent inserts cannot evade overlap review.
        const revision = await this.states.updateOne(
          { _id: g.churchId, revision: p.revision },
          { $inc: { revision: 1 } },
          { session: tx },
        );
        if (!revision.matchedCount) {
          requireCondition(p.revision === 0, 412, "SCHEDULE_PREVIEW_STALE");
          await this.states.insertOne({ _id: g.churchId, revision: 1 }, { session: tx });
        }
        for (const m of p.snapshots.current) await this.members.fence(g, m.id, m.version, tx);
        for (const u of p.snapshots.units)
          await this.organization.fenceSchedulingUnit(g.churchId, u.id, u.version, tx);
        const now = this.now(),
          seriesId = old?.seriesId ?? new ObjectId(),
          generation = p.series
            ? b.range === "future"
              ? p.series.generation + 1
              : p.series.generation
            : 1;
        if (!p.series)
          await this.series.insertOne(
            {
              _id: seriesId,
              churchId: g.churchId,
              generation,
              version: 1,
              input: b.input,
              createdAt: now,
              updatedAt: now,
            },
            { session: tx },
          );
        else {
          const saved = await this.series.updateOne(
            { _id: seriesId, churchId: g.churchId, version: p.series.version },
            {
              $set: {
                generation,
                updatedAt: now,
                ...(b.range === "future" ? { input: b.input } : {}),
              },
              $inc: { version: 1 },
            },
            { session: tx },
          );
          requireCondition(saved.matchedCount, 412, "VERSION_CONFLICT");
        }
        const changed: string[] = [];
        if (old && (b.range === "future" || b.state === "cancelled"))
          for (const before of [...p.affected, ...p.cancelledExceptions]) {
            const r = {
              ...before,
              state: "cancelled" as const,
              exception: b.range === "one" ? true : before.exception,
              superseded: b.range === "future",
              version: before.version + 1,
              updatedAt: now,
            };
            const saved = await this.rows.replaceOne(
              { _id: before._id, churchId: g.churchId, version: before.version },
              r,
              { session: tx },
            );
            requireCondition(saved.matchedCount, 412, "VERSION_CONFLICT");
            await this.history(
              g,
              r,
              before.state === "cancelled" ? "superseded" : "cancelled",
              before,
              b.reason,
              tx,
              op,
              requestId,
            );
            changed.push(r._id.toHexString());
          }
        if (b.state !== "cancelled")
          for (const slot of p.slots) {
            const single = old && b.range === "one" ? old : null;
            const day = businessDay(slot.end);
            const r: ScheduleRow = {
              _id: single ? single._id : new ObjectId(),
              churchId: g.churchId,
              seriesId,
              generation: single ? single.generation : generation,
              slot: single ? single.slot : slot.start.toISOString(),
              input: { ...b.input, day: slot.day, endDay: day },
              startAt: slot.start,
              endAt: slot.end,
              state: b.state,
              unitName: p.snapshots.unitName,
              speakerName: p.snapshots.speakerName,
              leaderName: p.snapshots.leaderName,
              choirName: p.snapshots.choirName,
              memberIds: p.snapshots.memberIds,
              version: (single?.version ?? 0) + 1,
              exception: !!single,
              superseded: false,
              programFence: single?.programFence ?? 0,
              createdAt: single?.createdAt ?? now,
              updatedAt: now,
            };
            if (single) {
              const saved = await this.rows.replaceOne(
                { _id: single._id, churchId: g.churchId, version: expected as number },
                r,
                { session: tx },
              );
              requireCondition(saved.matchedCount, 412, "VERSION_CONFLICT");
            } else await this.rows.insertOne(r, { session: tx });
            await this.history(
              g,
              r,
              single ? "corrected" : "created",
              single,
              b.reason,
              tx,
              op,
              requestId,
            );
            changed.push(r._id.toHexString());
          }
        return {
          safeResult: {
            occurrenceId: changed.at(-1) ?? id,
            seriesId: seriesId.toHexString(),
            changed: changed.length,
          },
          resourceRefs: [{ type: "schedule", id: seriesId.toHexString() }],
        };
      },
      id ? 200 : 201,
    );
  }
  async historyPage(g: ScheduleGrant, id: string, q: URLSearchParams) {
    this.manager(g);
    this.query.allow(q, ["limit", "cursor"]);
    const limit = this.query.limit(q),
      context = this.query.context(g, `history/${id}`, null),
      after = q.has("cursor") ? this.query.decode(q.get("cursor") as string, context) : null;
    if (after) requireCondition(Number.isFinite(Date.parse(after.key)), 400, "INVALID_CURSOR");
    return this.db.readSnapshot(g.churchId.toHexString(), async (tx) => {
      await g.fence(tx);
      await this.raw(g, id, tx);
      const filter: Filter<ScheduleHistory> = {
        churchId: g.churchId,
        occurrenceId: objectId(id),
        ...(after
          ? {
              $or: [
                { occurredAt: { $lt: new Date(after.key) } },
                { occurredAt: new Date(after.key), _id: { $lt: objectId(after.id) } },
              ],
            }
          : {}),
      };
      const rows = await this.histories
          .find(filter, { session: tx })
          .sort({ occurredAt: -1, _id: -1 })
          .limit(limit + 1)
          .toArray(),
        more = rows.length > limit;
      rows.splice(limit);
      const last = rows.at(-1);
      return {
        items: rows.map((r) => ({
          id: r._id.toHexString(),
          event: r.event,
          before: r.before,
          after: r.after,
          reason: r.reason,
          actorKind: r.actorKind,
          actorId: r.actorId.toHexString(),
          occurredAt: r.occurredAt.toISOString(),
        })),
        nextCursor:
          more && last
            ? this.query.encode(context, last.occurredAt.toISOString(), last._id.toHexString())
            : null,
      };
    });
  }
  async operation(g: ScheduleGrant, id: string) {
    this.manager(g);
    return this.ops.getTenant(g, id, "scheduling", async (tx, op) => {
      requireCondition(
        op.resourceRefs.every((r) => r.type === "schedule"),
        403,
        "FORBIDDEN",
      );
      for (const ref of op.resourceRefs)
        requireCondition(
          await this.series.findOne(
            { _id: objectId(ref.id), churchId: g.churchId },
            { session: tx },
          ),
          404,
          "NOT_FOUND",
        );
    });
  }
}
