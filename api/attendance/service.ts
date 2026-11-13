import { type ClientSession, type Filter, ObjectId } from "mongodb";
import { z } from "zod";
import type { Audit } from "../audit/service";
import type { CardResolver } from "../cards/models";
import { qrPayload } from "../cards/validation";
import { requireCondition } from "../errors";
import { objectId, parse, version } from "../http-validation";
import { digest, equal, sign } from "../identity/crypto";
import type { Database } from "../infrastructure/database";
import type { AttendanceCandidate, AttendanceMembers } from "../members/attendance";
import { businessDay, validDay } from "../members/dates";
import { escaped } from "../members/queries";
import { canonical, type Operations } from "../operations/service";
import type { Organization } from "../organization/service";
import { TenantQueries } from "../tenant-queries";
import {
  type AttendanceGrant,
  type AttendanceHistory,
  type AttendanceParticipant,
  type AttendanceSession,
  participantDto,
  rosterLimit,
  sessionDto,
} from "./models";
import type { PrepAttendancePort, PrepSessionRef } from "./prep-port";
import {
  createSession,
  emptyCommand,
  markCommand,
  openSession,
  reasonCommand,
  rosterCommand,
  updateSession,
} from "./validation";

const scanProof = z.strictObject({
  context: z.string(),
  sessionId: z.string().regex(/^[a-f0-9]{24}$/),
  cardId: z.string().regex(/^[a-f0-9]{24}$/),
  memberId: z.string().regex(/^[a-f0-9]{24}$/),
  cardVersion: z.number().int().min(1),
  rowVersion: z.number().int().min(1),
  generation: z.number().int().min(1),
  expires: z.number().int(),
});
const previewShape = z.strictObject({
  context: z.string(),
  fingerprint: z.string(),
  expires: z.number(),
});
type Candidate = AttendanceCandidate & { areaName: string | null };
type CommandResult = {
  sessionId: string;
  memberId?: string;
  version: number;
  generation: number;
  applied: boolean;
};
export class Attendance {
  private query: TenantQueries;
  constructor(
    private db: Database,
    private members: AttendanceMembers,
    private organization: Organization,
    private ops: Operations,
    private audit: Audit,
    private key: string,
    private now: () => Date,
    private cards?: CardResolver,
    private prep?: PrepAttendancePort,
  ) {
    this.query = new TenantQueries(key, now, "attendance");
  }
  private get sessions() {
    return this.db.db.collection<AttendanceSession>("attendance_sessions");
  }
  private get participants() {
    return this.db.db.collection<AttendanceParticipant>("attendance_participants");
  }
  private get histories() {
    return this.db.db.collection<AttendanceHistory>("attendance_history");
  }
  private manager(g: AttendanceGrant) {
    requireCondition(g.canManageAttendance && !g.unitScope, 403, "FORBIDDEN");
  }
  private async raw(g: AttendanceGrant, id: string, tx: ClientSession) {
    const s = await this.sessions.findOne(
      { _id: objectId(id), churchId: g.churchId },
      { session: tx },
    );
    requireCondition(s, 404, "NOT_FOUND");
    if (g.unitScope) {
      requireCondition(
        s.unitId && g.unitScope.some((id) => id.toLowerCase() === s.unitId?.toHexString()),
        404,
        "NOT_FOUND",
      );
      await this.organization.attendanceUnit(g.churchId, s.unitId, tx);
    }
    if (s.prepClass) {
      const prep = this.prep;
      requireCondition(prep, 503, "DEPENDENCY_UNAVAILABLE");
      await prep.read(g, s.prepClass, tx);
    }
    return s;
  }
  private async source(
    g: AttendanceGrant,
    s: AttendanceSession,
    tx: ClientSession,
    memberId?: ObjectId,
  ): Promise<{ rows: Candidate[]; fingerprint: string }> {
    const unit = s.unitId ? await this.organization.attendanceUnit(g.churchId, s.unitId, tx) : null;
    const prep = this.prep;
    let classSource: { rows: AttendanceCandidate[]; versionKey: string } | null = null;
    if (s.prepClass) {
      requireCondition(prep, 503, "DEPENDENCY_UNAVAILABLE");
      classSource = await prep.candidates(g, s.prepClass, tx, memberId);
    }
    const rows = classSource
      ? classSource.rows
      : await this.members.candidates(g.churchId, unit, tx, rosterLimit + 1, memberId);
    requireCondition(rows.length <= rosterLimit, 422, "ATTENDANCE_ROSTER_LIMIT");
    const labels = await this.organization.attendanceAreaLabels(
      g.churchId,
      rows.flatMap((r) => (r.areaId ? [r.areaId] : [])),
      tx,
    );
    const map = new Map(labels.map((a) => [a._id.toHexString(), a.name]));
    const candidates = rows.map((r) => ({
      ...r,
      areaName: r.areaId ? (map.get(r.areaId.toHexString()) ?? null) : null,
    }));
    return {
      rows: candidates,
      fingerprint: digest(
        canonical({
          sessionId: s._id.toHexString(),
          version: s.version,
          unitVersion: unit?.version ?? null,
          classVersion: classSource?.versionKey ?? null,
          rows: candidates.map((r) => [
            r._id.toHexString(),
            r.version,
            r.familyVersion,
            r.areaId?.toHexString() ?? null,
            r.areaName,
          ]),
        }),
      ),
    };
  }
  private participant(
    g: AttendanceGrant,
    s: AttendanceSession,
    r: Candidate,
  ): AttendanceParticipant {
    return {
      _id: new ObjectId(),
      churchId: g.churchId,
      sessionId: s._id,
      memberId: r._id,
      code: r.code,
      fullName: r.fullName,
      nameKey: r.nameKey,
      nameTokens: r.nameTokens,
      type: r.type,
      areaName: r.areaName,
      included: true,
      present: false,
      version: 1,
      capturedAt: this.now(),
    };
  }
  private async history(
    g: AttendanceGrant,
    s: AttendanceSession,
    event: string,
    before: Record<string, unknown> | null,
    after: Record<string, unknown>,
    reason: string | null,
    tx: ClientSession,
    operationId: ObjectId,
    requestId: string,
  ) {
    await this.histories.insertOne(
      {
        _id: new ObjectId(),
        churchId: g.churchId,
        sessionId: s._id,
        event,
        before,
        after,
        reason,
        actorId: g.actorId,
        actorKind: g.actorKind,
        operationId,
        occurredAt: this.now(),
      },
      { session: tx },
    );
    await this.audit.organization(
      `attendance.${event}`,
      requestId,
      { kind: g.actorKind, id: g.actorId, churchId: g.actorKind === "owner" ? null : g.churchId },
      g.churchId,
      "attendance_session",
      s._id,
      [event],
      operationId,
      tx,
    );
  }
  private async save(before: AttendanceSession, after: AttendanceSession, tx: ClientSession) {
    after.version = before.version + 1;
    after.updatedAt = this.now();
    const r = await this.sessions.replaceOne(
      { _id: before._id, churchId: before.churchId, version: before.version },
      after,
      { session: tx },
    );
    requireCondition(r.matchedCount, 412, "VERSION_CONFLICT");
  }
  private result(s: AttendanceSession, applied = true, memberId?: string): CommandResult {
    return {
      sessionId: s._id.toHexString(),
      version: s.version,
      generation: s.generation,
      applied,
      ...(memberId ? { memberId } : {}),
    };
  }
  private command(
    g: AttendanceGrant,
    id: string | null,
    suffix: string,
    method: string,
    key: string | null,
    body: unknown,
    expected: number | null,
    manager: boolean,
    mutate: (tx: ClientSession, op: ObjectId) => Promise<CommandResult>,
    status = 200,
  ) {
    if (manager) this.manager(g);
    // Operations invokes this fence before BOTH replay and mutation. A former
    // manager cannot replay an old management command after becoming a lead.
    const fenced: AttendanceGrant = {
      ...g,
      fence: async (tx) => {
        await g.fence(tx);
        if (manager) this.manager(g);
        if (id) {
          const s = await this.raw(g, id, tx);
          if (s.prepClass) requireCondition(g.canManageClasses, 403, "FORBIDDEN");
        }
      },
    };
    return this.ops.executeTenant(
      fenced,
      method,
      `attendance/${g.churchId}/sessions${id ? `/${objectId(id).toHexString()}` : ""}${suffix}`,
      key,
      body,
      expected,
      async (tx, op) => {
        if (id) {
          const session = await this.raw(g, id, tx);
          if (session.prepClass) {
            const prep = this.prep;
            requireCondition(prep, 503, "DEPENDENCY_UNAVAILABLE");
            await prep.writable(g, session.prepClass, tx);
          }
        }
        const result = await mutate(tx, op);
        return {
          safeResult: { ...result },
          resourceRefs: [{ type: "attendance_session", id: result.sessionId }],
        };
      },
      status,
    );
  }
  async createPrep(
    g: AttendanceGrant,
    id: ObjectId,
    ref: PrepSessionRef,
    body: { label: string; heldOn: string; location: string | null },
    tx: ClientSession,
    op: ObjectId,
    requestId: string,
  ) {
    const prep = this.prep;
    requireCondition(prep, 503, "DEPENDENCY_UNAVAILABLE");
    await prep.writable(g, ref, tx);
    await prep.validateDate(g, ref, body.heldOn, tx);
    const s: AttendanceSession = {
      _id: id,
      churchId: g.churchId,
      ...body,
      scope: "church",
      unitId: null,
      unitName: null,
      prepClass: ref,
      state: "draft",
      version: 1,
      generation: 1,
      rowCount: 0,
      includedCount: 0,
      presentCount: 0,
      capturedAt: null,
      createdAt: this.now(),
      updatedAt: this.now(),
    };
    await this.sessions.insertOne(s, { session: tx });
    await this.history(g, s, "created", null, sessionDto(s), null, tx, op, requestId);
    return sessionDto(s);
  }
  async prepStatus(g: AttendanceGrant, courseId: ObjectId, tx: ClientSession) {
    requireCondition(g.canReadClasses && !g.unitScope, 403, "FORBIDDEN");
    const filter = { churchId: g.churchId, "prepClass.courseId": courseId };
    const opened = await this.sessions.countDocuments(
      { ...filter, capturedAt: { $ne: null } },
      { session: tx },
    );
    const open = await this.sessions.countDocuments({ ...filter, state: "open" }, { session: tx });
    const closedLessons = await this.sessions.distinct(
      "prepClass.lessonId",
      { ...filter, state: "closed", "prepClass.kind": "regular" },
      { session: tx },
    );
    return { opened, open, closedLessons: closedLessons.map((id) => String(id)) };
  }
  async prepSessions(g: AttendanceGrant, courseId: ObjectId, ids: ObjectId[], tx: ClientSession) {
    requireCondition(g.canReadClasses && !g.unitScope && ids.length <= 100, 403, "FORBIDDEN");
    return (
      await this.sessions
        .find(
          { churchId: g.churchId, "prepClass.courseId": courseId, _id: { $in: ids } },
          { session: tx },
        )
        .toArray()
    ).map(sessionDto);
  }
  async prepCredits(g: AttendanceGrant, courseId: ObjectId, ids: ObjectId[], tx: ClientSession) {
    requireCondition(g.canReadClasses && !g.unitScope && ids.length <= 100, 403, "FORBIDDEN");
    if (!ids.length) return [];
    return this.sessions
      .aggregate<{ memberId: ObjectId; lessonId: ObjectId }>(
        [
          { $match: { churchId: g.churchId, "prepClass.courseId": courseId, state: "closed" } },
          {
            $lookup: {
              from: "attendance_participants",
              localField: "_id",
              foreignField: "sessionId",
              pipeline: [
                {
                  $match: {
                    churchId: g.churchId,
                    memberId: { $in: ids },
                    included: true,
                    present: true,
                  },
                },
                { $project: { memberId: 1 } },
              ],
              as: "present",
            },
          },
          { $unwind: "$present" },
          { $group: { _id: { memberId: "$present.memberId", lessonId: "$prepClass.lessonId" } } },
          { $project: { _id: 0, memberId: "$_id.memberId", lessonId: "$_id.lessonId" } },
        ],
        { session: tx },
      )
      .toArray();
  }
  async list(g: AttendanceGrant, q: URLSearchParams) {
    this.query.allow(q, ["from", "to", "state", "unitId", "limit", "cursor"]);
    const state = q.get("state"),
      from = q.get("from"),
      to = q.get("to");
    requireCondition(!state || ["draft", "open", "closed"].includes(state), 400, "INVALID_REQUEST");
    requireCondition(
      (!from || validDay(from)) && (!to || validDay(to)) && (!from || !to || from <= to),
      400,
      "INVALID_REQUEST",
    );
    const limit = this.query.limit(q),
      context = this.query.context(g, "sessions", [
        from,
        to,
        state,
        q.get("unitId"),
        g.unitScope ?? null,
      ]);
    return this.db.readSnapshot(g.churchId.toHexString(), async (tx) => {
      await g.fence(tx);
      const filter: Filter<AttendanceSession> = {
        churchId: g.churchId,
        ...(state ? { state: state as AttendanceSession["state"] } : {}),
        ...(from || to
          ? { heldOn: { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) } }
          : {}),
      };
      if (!g.canReadClasses) filter.prepClass = { $exists: false };
      if (g.unitScope) {
        const units = await this.organization.attendanceUnits(g.churchId, g.unitScope, tx);
        filter.unitId = { $in: units.map((u) => u._id) };
      }
      if (q.has("unitId")) {
        const id = objectId(q.get("unitId") as string);
        if (g.unitScope)
          requireCondition(
            g.unitScope.some((v) => objectId(v).equals(id)),
            404,
            "NOT_FOUND",
          );
        await this.organization.attendanceUnit(g.churchId, id, tx, !!g.unitScope);
        filter.unitId = id;
      }
      if (q.has("cursor")) {
        const c = this.query.decode(q.get("cursor") as string, context);
        filter.$or = [{ heldOn: { $lt: c.key } }, { heldOn: c.key, _id: { $lt: objectId(c.id) } }];
      }
      const rows = await this.sessions
        .find(filter, { session: tx })
        .sort({ heldOn: -1, _id: -1 })
        .limit(limit + 1)
        .toArray();
      const more = rows.length > limit;
      if (more) rows.pop();
      const last = rows.at(-1);
      return {
        items: rows.map(sessionDto),
        nextCursor:
          more && last ? this.query.encode(context, last.heldOn, last._id.toHexString()) : null,
      };
    });
  }
  async get(g: AttendanceGrant, id: string) {
    return this.db.readSnapshot(g.churchId.toHexString(), async (tx) => {
      await g.fence(tx);
      return sessionDto(await this.raw(g, id, tx));
    });
  }
  async candidates(g: AttendanceGrant, id: string, q: URLSearchParams) {
    this.manager(g);
    this.query.allow(q, ["q", "limit", "cursor"]);
    const term = (q.get("q") ?? "").normalize("NFC").trim().toLowerCase();
    requireCondition(term.length <= 100, 400, "INVALID_REQUEST");
    const limit = this.query.limit(q);
    return this.db.readSnapshot(g.churchId.toHexString(), async (tx) => {
      await g.fence(tx);
      const s = await this.raw(g, id, tx);
      requireCondition(s.state !== "closed", 409, "ATTENDANCE_STATE");
      const source = await this.source(g, s, tx);
      const context = this.query.context(g, `candidates/${id}`, [source.fingerprint, term]);
      let rows = source.rows.filter(
        (r) =>
          !term ||
          r.code.toLowerCase().startsWith(term) ||
          r.nameTokens.some((n) => n.startsWith(term)),
      );
      if (q.has("cursor")) {
        const c = this.query.decode(q.get("cursor") as string, context);
        rows = rows.filter(
          (r) => r.nameKey > c.key || (r.nameKey === c.key && r._id.toHexString() > c.id),
        );
      }
      const more = rows.length > limit;
      rows = rows.slice(0, limit);
      const last = rows.at(-1);
      const payload = Buffer.from(
        JSON.stringify({
          context: this.query.context(g, `open/${id}`, [s.version]),
          fingerprint: source.fingerprint,
          expires: this.now().getTime() + 5 * 60_000,
        }),
      ).toString("base64url");
      return {
        items: rows.map((r) => ({
          memberId: r._id.toHexString(),
          code: r.code,
          fullName: r.fullName,
          type: r.type,
          areaName: r.areaName,
        })),
        total: source.rows.length,
        sourceAsOf: this.now().toISOString(),
        previewToken: `${payload}.${sign(this.key, `attendance-preview:${payload}`)}`,
        nextCursor:
          more && last ? this.query.encode(context, last.nameKey, last._id.toHexString()) : null,
      };
    });
  }
  private checkPreview(
    g: AttendanceGrant,
    s: AttendanceSession,
    token: string,
    fingerprint: string,
  ) {
    const [payload, signature, ...rest] = token.split(".");
    requireCondition(
      payload &&
        signature &&
        !rest.length &&
        equal(signature, sign(this.key, `attendance-preview:${payload}`)),
      409,
      "ATTENDANCE_PREVIEW_STALE",
    );
    let value: unknown;
    try {
      value = JSON.parse(Buffer.from(payload, "base64url").toString());
    } catch {
      value = null;
    }
    const p = previewShape.safeParse(value);
    requireCondition(
      p.success &&
        p.data.expires > this.now().getTime() &&
        p.data.context === this.query.context(g, `open/${s._id}`, [s.version]) &&
        p.data.fingerprint === fingerprint,
      409,
      "ATTENDANCE_PREVIEW_STALE",
    );
  }
  async roster(g: AttendanceGrant, id: string, q: URLSearchParams) {
    this.query.allow(q, ["q", "included", "limit", "cursor"]);
    const term = (q.get("q") ?? "").normalize("NFC").trim().toLowerCase(),
      included = q.get("included") ?? "true";
    requireCondition(
      term.length <= 100 && ["true", "false", "all"].includes(included),
      400,
      "INVALID_REQUEST",
    );
    if (included !== "true") this.manager(g);
    const limit = this.query.limit(q);
    return this.db.readSnapshot(g.churchId.toHexString(), async (tx) => {
      await g.fence(tx);
      const s = await this.raw(g, id, tx);
      const context = this.query.context(g, `roster/${id}`, [term, included, s.generation]);
      const filter: Filter<AttendanceParticipant> = {
        churchId: g.churchId,
        sessionId: s._id,
        ...(included !== "all" ? { included: included === "true" } : {}),
      };
      const clauses: Filter<AttendanceParticipant>[] = [];
      if (term)
        clauses.push({
          $or: [
            { code: { $regex: `^${escaped(term.toUpperCase())}` } },
            { nameTokens: { $regex: `^${escaped(term)}` } },
          ],
        });
      if (q.has("cursor")) {
        const c = this.query.decode(q.get("cursor") as string, context);
        clauses.push({
          $or: [{ nameKey: { $gt: c.key } }, { nameKey: c.key, memberId: { $gt: objectId(c.id) } }],
        });
      }
      if (clauses.length) filter.$and = clauses;
      const rows = await this.participants
        .find(filter, { session: tx })
        .sort({ nameKey: 1, memberId: 1 })
        .limit(limit + 1)
        .toArray();
      const more = rows.length > limit;
      if (more) rows.pop();
      const last = rows.at(-1);
      return {
        session: sessionDto(s),
        items: rows.map((r) => participantDto(r, s.state)),
        nextCursor:
          more && last
            ? this.query.encode(context, last.nameKey, last.memberId.toHexString())
            : null,
      };
    });
  }
  async create(g: AttendanceGrant, raw: unknown, key: string | null, requestId: string) {
    this.manager(g);
    const b = parse(createSession, raw),
      id = new ObjectId();
    return this.command(
      g,
      null,
      "",
      "POST",
      key,
      b,
      null,
      true,
      async (tx, op) => {
        const unitId = b.unitId ? objectId(b.unitId) : null,
          unit = unitId ? await this.organization.attendanceUnit(g.churchId, unitId, tx) : null;
        const s: AttendanceSession = {
          ...b,
          _id: id,
          churchId: g.churchId,
          unitId,
          unitName: unit?.name ?? null,
          state: "draft",
          version: 1,
          generation: 1,
          rowCount: 0,
          includedCount: 0,
          presentCount: 0,
          capturedAt: null,
          createdAt: this.now(),
          updatedAt: this.now(),
        };
        await this.sessions.insertOne(s, { session: tx });
        await this.history(g, s, "created", null, sessionDto(s), null, tx, op, requestId);
        return this.result(s);
      },
      201,
    );
  }
  async patch(
    g: AttendanceGrant,
    id: string,
    raw: unknown,
    key: string | null,
    match: string | null,
    requestId: string,
  ) {
    this.manager(g);
    const b = parse(updateSession, raw),
      expected = version(match);
    return this.command(g, id, "", "PATCH", key, b, expected, true, async (tx, op) => {
      const old = await this.raw(g, id, tx);
      requireCondition(old.version === expected, 412, "VERSION_CONFLICT");
      if (old.state !== "draft")
        requireCondition(
          b.heldOn === undefined && b.scope === undefined && b.unitId === undefined && !!b.reason,
          422,
          "VALIDATION_FAILED",
        );
      const { reason, referenceConfirmed, ...fields } = b;
      const merged = parse(createSession, {
        label: old.label,
        heldOn: old.heldOn,
        location: old.location,
        scope: old.scope,
        unitId: old.unitId?.toHexString() ?? null,
        reportingKind: old.reportingKind ?? "general",
        ...fields,
      });
      if (old.prepClass) {
        requireCondition(
          merged.scope === "church" && merged.unitId === null && merged.reportingKind === "general",
          422,
          "VALIDATION_FAILED",
        );
        const prep = this.prep;
        requireCondition(prep, 503, "DEPENDENCY_UNAVAILABLE");
        await prep.validateDate(g, old.prepClass, merged.heldOn, tx);
      }
      if ((old.reportingKind ?? "general") !== merged.reportingKind)
        requireCondition(b.reason && referenceConfirmed, 422, "ATTENDANCE_REFERENCE_REASON");
      const unitId = merged.unitId ? objectId(merged.unitId) : null;
      const unit = unitId
        ? await this.organization.attendanceUnit(g.churchId, unitId, tx, old.state === "draft")
        : null;
      const s = { ...old, ...merged, unitId, unitName: unit?.name ?? null };
      await this.save(old, s, tx);
      await this.history(
        g,
        s,
        "metadata_changed",
        sessionDto(old),
        sessionDto(s),
        reason ?? null,
        tx,
        op,
        requestId,
      );
      return this.result(s);
    });
  }
  async transition(
    g: AttendanceGrant,
    id: string,
    action: "open" | "close" | "reopen" | "reset",
    raw: unknown,
    key: string | null,
    match: string | null,
    requestId: string,
  ) {
    this.manager(g);
    const expected = version(match);
    const b =
      action === "open"
        ? parse(openSession, raw)
        : action === "close"
          ? parse(emptyCommand, raw)
          : parse(reasonCommand, raw);
    return this.command(g, id, `/${action}`, "POST", key, b, expected, true, async (tx, op) => {
      const old = await this.raw(g, id, tx);
      requireCondition(old.version === expected, 412, "VERSION_CONFLICT");
      const s = { ...old };
      let before: Record<string, unknown> = sessionDto(old);
      if (action === "open") {
        requireCondition(old.state === "draft", 409, "ATTENDANCE_STATE");
        requireCondition(old.heldOn <= businessDay(this.now()), 422, "VALIDATION_FAILED");
        const source = await this.source(g, old, tx);
        this.checkPreview(g, old, (b as { previewToken: string }).previewToken, source.fingerprint);
        if (source.rows.length)
          await this.participants.insertMany(
            source.rows.map((r) => this.participant(g, s, r)),
            { session: tx },
          );
        s.state = "open";
        s.rowCount = source.rows.length;
        s.includedCount = source.rows.length;
        s.capturedAt = this.now();
      } else if (action === "close") {
        requireCondition(old.state === "open", 409, "ATTENDANCE_STATE");
        s.state = "closed";
      } else if (action === "reopen") {
        requireCondition(old.state === "closed", 409, "ATTENDANCE_STATE");
        s.state = "open";
      } else {
        requireCondition(old.state === "open", 409, "ATTENDANCE_STATE");
        const marked = await this.participants
          .find(
            { churchId: g.churchId, sessionId: s._id, present: true },
            { session: tx, projection: { memberId: 1 } },
          )
          .toArray();
        before = { ...before, presentMemberIds: marked.map((p) => p.memberId.toHexString()) };
        await this.participants.updateMany(
          { churchId: g.churchId, sessionId: s._id, present: true },
          { $set: { present: false }, $inc: { version: 1 } },
          { session: tx },
        );
        s.presentCount = 0;
      }
      s.generation++;
      await this.save(old, s, tx);
      await this.history(
        g,
        s,
        action,
        before,
        sessionDto(s),
        "reason" in b ? b.reason : null,
        tx,
        op,
        requestId,
      );
      return this.result(s);
    });
  }
  async mark(
    g: AttendanceGrant,
    id: string,
    memberId: string,
    raw: unknown,
    key: string | null,
    match: string | null,
    requestId: string,
  ) {
    const b = parse(markCommand, raw),
      expected = version(match),
      mid = objectId(memberId);
    return this.command(g, id, `/participants/${mid}`, "PATCH", key, b, expected, false, (tx, op) =>
      this.applyPresence(g, id, memberId, mid, b, expected, tx, op, requestId, { kind: "manual" }),
    );
  }
  private async applyPresence(
    g: AttendanceGrant,
    id: string,
    memberId: string,
    mid: ObjectId,
    b: { present: boolean; generation: number },
    expected: number,
    tx: ClientSession,
    op: ObjectId,
    requestId: string,
    source: { kind: "manual" } | { kind: "qr"; cardId: string; cardVersion: number },
  ) {
    const old = await this.raw(g, id, tx);
    requireCondition(old.state === "open", 409, "ATTENDANCE_STATE");
    requireCondition(old.generation === b.generation, 409, "ATTENDANCE_SESSION_CHANGED");
    const p = await this.participants.findOne(
      { churchId: g.churchId, sessionId: old._id, memberId: mid, included: true },
      { session: tx },
    );
    requireCondition(p, 404, "NOT_FOUND");
    requireCondition(p.version === expected, 412, "VERSION_CONFLICT");
    if (p.present === b.present) return this.result(old, false, memberId);
    const changed = await this.participants.updateOne(
      { _id: p._id, version: expected },
      { $set: { present: b.present }, $inc: { version: 1 } },
      { session: tx },
    );
    requireCondition(changed.matchedCount, 412, "VERSION_CONFLICT");
    const s = { ...old, presentCount: old.presentCount + (b.present ? 1 : -1) };
    await this.save(old, s, tx);
    await this.history(
      g,
      s,
      "marked",
      { memberId, present: p.present, version: p.version },
      {
        memberId,
        present: b.present,
        version: p.version + 1,
        source: source.kind,
        ...(source.kind === "qr" ? { cardId: source.cardId, cardVersion: source.cardVersion } : {}),
      },
      null,
      tx,
      op,
      requestId,
    );
    return this.result(s, true, memberId);
  }
  async qrResolution(g: AttendanceGrant, id: string, raw: unknown) {
    const b = parse(z.strictObject({ code: qrPayload, generation: z.number().int().min(1) }), raw);
    const cards = this.cards;
    requireCondition(cards, 503, "DEPENDENCY_UNAVAILABLE");
    return this.db.readSnapshot(g.churchId.toHexString(), async (tx) => {
      await g.fence(tx);
      const s = await this.raw(g, id, tx);
      requireCondition(s.state === "open", 409, "ATTENDANCE_STATE");
      requireCondition(s.generation === b.generation, 409, "ATTENDANCE_SESSION_CHANGED");
      const card = await cards.resolve(g.churchId, b.code, tx);
      const p = await this.participants.findOne(
        { churchId: g.churchId, sessionId: s._id, memberId: card.memberId, included: true },
        { session: tx },
      );
      requireCondition(p, 404, "QR_NOT_AVAILABLE");
      const value = {
        context: this.query.context(g, `scan/${s._id}`, []),
        sessionId: s._id.toHexString(),
        cardId: card.cardId.toHexString(),
        cardVersion: card.version,
        memberId: card.memberId.toHexString(),
        rowVersion: p.version,
        generation: s.generation,
        expires: this.now().getTime() + 60_000,
      };
      const payload = Buffer.from(JSON.stringify(value)).toString("base64url");
      return {
        resolutionToken: `${payload}.${sign(this.key, `attendance-scan:${payload}`)}`,
        participant: participantDto(p, s.state),
        session: sessionDto(s),
        expiresAt: new Date(value.expires).toISOString(),
      };
    });
  }
  async scan(
    g: AttendanceGrant,
    id: string,
    raw: unknown,
    key: string | null,
    match: string | null,
    requestId: string,
  ) {
    const b = parse(
        z.strictObject({
          resolutionToken: z.string().min(1).max(4096),
          generation: z.number().int().min(1),
        }),
        raw,
      ),
      expected = version(match);
    const [payload, signature, ...extra] = b.resolutionToken.split(".");
    requireCondition(
      payload &&
        signature &&
        !extra.length &&
        equal(signature, sign(this.key, `attendance-scan:${payload}`)),
      409,
      "QR_RESOLUTION_STALE",
    );
    let value: unknown;
    try {
      value = JSON.parse(Buffer.from(payload, "base64url").toString());
    } catch {
      value = null;
    }
    const proof = parse(scanProof, value);
    const cards = this.cards;
    requireCondition(cards, 503, "DEPENDENCY_UNAVAILABLE");
    return this.command(g, id, "/scans", "POST", key, b, expected, false, async (tx, op) => {
      // Proof expiry belongs to a new mutation, not to historical same-key replay.
      requireCondition(
        proof.context === this.query.context(g, `scan/${objectId(id)}`, []) &&
          proof.sessionId === objectId(id).toHexString() &&
          proof.rowVersion === expected &&
          proof.generation === b.generation &&
          proof.expires > this.now().getTime(),
        409,
        "QR_RESOLUTION_STALE",
      );
      await cards.verify(
        g.churchId,
        objectId(proof.cardId),
        objectId(proof.memberId),
        proof.cardVersion,
        tx,
      );
      return this.applyPresence(
        g,
        id,
        proof.memberId,
        objectId(proof.memberId),
        { present: true, generation: b.generation },
        expected,
        tx,
        op,
        requestId,
        { kind: "qr", cardId: proof.cardId, cardVersion: proof.cardVersion },
      );
    });
  }
  async changeRoster(
    g: AttendanceGrant,
    id: string,
    raw: unknown,
    key: string | null,
    match: string | null,
    requestId: string,
  ) {
    this.manager(g);
    const b = parse(rosterCommand, raw),
      expected = version(match),
      mid = objectId(b.memberId);
    return this.command(
      g,
      id,
      "/roster-changes",
      "POST",
      key,
      b,
      expected,
      true,
      async (tx, op) => {
        const old = await this.raw(g, id, tx);
        requireCondition(old.version === expected, 412, "VERSION_CONFLICT");
        requireCondition(old.state === "open", 409, "ATTENDANCE_STATE");
        const p = await this.participants.findOne(
          { churchId: g.churchId, sessionId: old._id, memberId: mid },
          { session: tx },
        );
        requireCondition(p || b.included, 404, "NOT_FOUND");
        if (p?.included === b.included) return this.result(old, false, b.memberId);
        const s = { ...old };
        if (b.included) {
          const { rows } = await this.source(g, s, tx, mid);
          requireCondition(rows[0], 422, "MEMBER_NOT_CURRENT");
          if (!p) {
            requireCondition(old.rowCount < rosterLimit, 422, "ATTENDANCE_ROSTER_LIMIT");
            await this.participants.insertOne(this.participant(g, s, rows[0]), { session: tx });
            s.rowCount++;
          } else
            await this.participants.updateOne(
              { _id: p._id },
              { $set: { included: true, present: false }, $inc: { version: 1 } },
              { session: tx },
            );
          s.includedCount++;
        } else if (p) {
          await this.participants.updateOne(
            { _id: p._id },
            { $set: { included: false, present: false }, $inc: { version: 1 } },
            { session: tx },
          );
          s.includedCount--;
          if (p.present) s.presentCount--;
        }
        await this.save(old, s, tx);
        await this.history(
          g,
          s,
          "roster_changed",
          p ? { memberId: b.memberId, included: p.included, present: p.present } : null,
          { memberId: b.memberId, included: b.included, present: false },
          b.reason,
          tx,
          op,
          requestId,
        );
        return this.result(s, true, b.memberId);
      },
    );
  }
  async historyPage(g: AttendanceGrant, id: string, q: URLSearchParams) {
    this.manager(g);
    this.query.allow(q, ["limit", "cursor"]);
    const limit = this.query.limit(q);
    return this.db.readSnapshot(g.churchId.toHexString(), async (tx) => {
      await g.fence(tx);
      const s = await this.raw(g, id, tx),
        context = this.query.context(g, `history/${id}`, []);
      const filter: Filter<AttendanceHistory> = { churchId: g.churchId, sessionId: s._id };
      if (q.has("cursor")) {
        const c = this.query.decode(q.get("cursor") as string, context),
          when = new Date(c.key);
        requireCondition(Number.isFinite(when.getTime()), 400, "INVALID_CURSOR");
        filter.$or = [
          { occurredAt: { $lt: when } },
          { occurredAt: when, _id: { $lt: objectId(c.id) } },
        ];
      }
      const rows = await this.histories
        .find(filter, { session: tx })
        .sort({ occurredAt: -1, _id: -1 })
        .limit(limit + 1)
        .toArray();
      const more = rows.length > limit;
      if (more) rows.pop();
      const last = rows.at(-1);
      return {
        items: rows.map((r) => ({
          id: r._id.toHexString(),
          event: r.event,
          reason: r.reason,
          before: r.before,
          after: r.after,
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
  async operation(g: AttendanceGrant, id: string) {
    return this.ops.getTenant(g, id, "attendance", async (tx, op) => {
      const ref = op.resourceRefs.find((r) => r.type === "attendance_session");
      requireCondition(ref, 404, "NOT_FOUND");
      await this.raw(g, ref.id, tx);
      if (
        !/^attendance\/[a-f0-9]{24}\/sessions\/[a-f0-9]{24}\/(?:participants\/[a-f0-9]{24}|scans)$/.test(
          op.routeKey,
        )
      )
        this.manager(g);
    });
  }
}
