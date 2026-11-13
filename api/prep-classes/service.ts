import { type ClientSession, type Filter, ObjectId } from "mongodb";
import { z } from "zod";
import type { AttendanceGrant } from "../attendance/models";
import type { Attendance } from "../attendance/service";
import type { Audit } from "../audit/service";
import { requireCondition } from "../errors";
import { objectId, parse, version } from "../http-validation";
import type { Database } from "../infrastructure/database";
import type { AttendanceMembers } from "../members/attendance";
import { ageOn, businessDay } from "../members/dates";
import type { PrepMembers } from "../members/prep-classes";
import { escaped } from "../members/queries";
import type { Operations } from "../operations/service";
import type { Organization } from "../organization/service";
import { TenantQueries } from "../tenant-queries";
import { CertificateClasses } from "./certificates";
import {
  type ClassGrant,
  type ClassHistory,
  type Course,
  courseDto,
  type Enrollment,
  enrollmentDto,
  type Meeting,
} from "./models";
import {
  courseInput,
  coursePatch,
  enrollmentInput,
  interviewInput,
  meetingInput,
  reason,
  stateInput,
} from "./validation";

export class PrepClasses {
  private query: TenantQueries;
  certificatePort() {
    return new CertificateClasses(this.db);
  }
  constructor(
    private db: Database,
    private members: PrepMembers,
    private memberAttendance: AttendanceMembers,
    private organization: Organization,
    private attendance: Attendance,
    private ops: Operations,
    private audit: Audit,
    key: string,
    private now: () => Date,
  ) {
    this.query = new TenantQueries(key, now, "prep-classes");
  }
  private get courses() {
    return this.db.db.collection<Course>("prep_courses");
  }
  private get enrollments() {
    return this.db.db.collection<Enrollment>("prep_enrollments");
  }
  private get meetings() {
    return this.db.db.collection<Meeting>("prep_meetings");
  }
  private get histories() {
    return this.db.db.collection<ClassHistory>("prep_class_history");
  }
  private ag(g: ClassGrant): AttendanceGrant {
    return {
      ...g,
      canReadClasses: true,
      canManageClasses: g.canManageClasses,
      canManageAttendance: g.canManageClasses,
    };
  }
  private staff(g: ClassGrant, write = false, interview = false) {
    requireCondition(
      !g.unitScope &&
        !g.receiptScope &&
        (!write || g.canManageClasses) &&
        (!interview || g.canInterview),
      403,
      "FORBIDDEN",
    );
  }
  private async raw(g: ClassGrant, id: string, tx: ClientSession) {
    this.staff(g);
    const c = await this.courses.findOne(
      { _id: objectId(id), churchId: g.churchId },
      { session: tx },
    );
    requireCondition(c, 404, "NOT_FOUND");
    return c;
  }
  private async row(g: ClassGrant, c: Course, memberId: string, tx: ClientSession) {
    const row = await this.enrollments.findOne(
      { churchId: g.churchId, courseId: c._id, memberId: objectId(memberId) },
      { session: tx },
    );
    requireCondition(row, 404, "NOT_FOUND");
    return row;
  }
  private editable(c: Course) {
    requireCondition(c.state !== "closed", 409, "PREP_COURSE_STATE");
  }
  private async history(
    g: ClassGrant,
    c: Course,
    event: string,
    before: Record<string, unknown> | null,
    after: Record<string, unknown>,
    why: string | null,
    memberId: ObjectId | null,
    tx: ClientSession,
    op: ObjectId,
    requestId: string,
  ) {
    await this.histories.insertOne(
      {
        _id: new ObjectId(),
        churchId: g.churchId,
        courseId: c._id,
        memberId,
        event,
        before,
        after,
        reason: why,
        actorId: g.actorId,
        actorKind: g.actorKind,
        operationId: op,
        occurredAt: this.now(),
      },
      { session: tx },
    );
    await this.audit.organization(
      `prep.${event}`,
      requestId,
      { kind: g.actorKind, id: g.actorId, churchId: g.actorKind === "owner" ? null : g.churchId },
      g.churchId,
      "prep_course",
      c._id,
      [event],
      op,
      tx,
    );
  }
  private async save(c: Course, next: Course, tx: ClientSession) {
    next.version = c.version + 1;
    next.updatedAt = this.now();
    const r = await this.courses.replaceOne(
      { _id: c._id, churchId: c.churchId, version: c.version },
      next,
      { session: tx },
    );
    requireCondition(r.matchedCount, 412, "VERSION_CONFLICT");
  }
  private command(
    g: ClassGrant,
    id: string | null,
    suffix: string,
    method: string,
    key: string | null,
    body: unknown,
    expected: number | null,
    interview: boolean,
    mutate: (tx: ClientSession, op: ObjectId) => Promise<Record<string, unknown>>,
    status = 200,
  ) {
    this.staff(g, true, interview);
    const guarded = {
      ...g,
      fence: async (tx: ClientSession) => {
        this.staff(g, true, interview);
        await g.fence(tx);
        if (id) await this.raw(g, id, tx);
      },
    };
    return this.ops.executeTenant(
      guarded,
      method,
      `prep-classes/${g.churchId}/courses${id ? `/${objectId(id)}` : ""}${suffix}`,
      key,
      body,
      expected,
      async (tx, op) => {
        const result = await mutate(tx, op);
        return {
          safeResult: result,
          resourceRefs: [{ type: "prep_course", id: String(result.courseId) }],
        };
      },
      status,
    );
  }
  async list(g: ClassGrant, q: URLSearchParams) {
    this.staff(g);
    this.query.allow(q, ["state", "q", "limit", "cursor"]);
    const limit = this.query.limit(q),
      state = q.get("state"),
      term = (q.get("q") ?? "").trim().normalize("NFC");
    requireCondition(
      !state || ["draft", "active", "closed"].includes(state),
      400,
      "INVALID_REQUEST",
    );
    requireCondition(term.length <= 100, 400, "INVALID_REQUEST");
    return this.db.readSnapshot(g.churchId.toHexString(), async (tx) => {
      await g.fence(tx);
      const context = this.query.context(g, "courses", [state, term]),
        filter: Filter<Course> = {
          churchId: g.churchId,
          ...(state ? { state: state as Course["state"] } : {}),
          ...(term ? { name: { $regex: escaped(term), $options: "i" } } : {}),
        };
      if (q.has("cursor")) {
        const v = this.query.decode(q.get("cursor") as string, context);
        filter.$or = [
          { startOn: { $lt: v.key } },
          { startOn: v.key, _id: { $lt: objectId(v.id) } },
        ];
      }
      const rows = await this.courses
          .find(filter, { session: tx })
          .sort({ startOn: -1, _id: -1 })
          .limit(limit + 1)
          .toArray(),
        more = rows.length > limit;
      if (more) rows.pop();
      const last = rows.at(-1);
      return {
        items: rows.map(courseDto),
        nextCursor:
          more && last ? this.query.encode(context, last.startOn, last._id.toHexString()) : null,
      };
    });
  }
  async get(g: ClassGrant, id: string) {
    return this.db.readSnapshot(g.churchId.toHexString(), async (tx) => {
      await g.fence(tx);
      const c = await this.raw(g, id, tx),
        status = await this.attendance.prepStatus(this.ag(g), c._id, tx);
      return {
        ...courseDto(c),
        planLocked: status.opened > 0,
        startLocked:
          status.opened > 0 ||
          !!(await this.meetings.countDocuments(
            { churchId: g.churchId, courseId: c._id },
            { session: tx },
          )),
        openSessions: status.open,
        closedLessonIds: status.closedLessons,
      };
    });
  }
  async create(g: ClassGrant, raw: unknown, key: string | null, requestId: string) {
    const body = parse(courseInput, raw),
      id = new ObjectId();
    return this.command(
      g,
      null,
      "",
      "POST",
      key,
      body,
      null,
      false,
      async (tx, op) => {
        const c: Course = {
          _id: id,
          churchId: g.churchId,
          ...body,
          lessons: body.lessons.map((title) => ({ id: new ObjectId(), title })),
          state: "draft",
          version: 1,
          enrollmentCount: 0,
          createdAt: this.now(),
          updatedAt: this.now(),
        };
        await this.courses.insertOne(c, { session: tx });
        await this.history(g, c, "created", null, courseDto(c), null, null, tx, op, requestId);
        return { courseId: id.toHexString(), version: 1 };
      },
      201,
    );
  }
  async patch(
    g: ClassGrant,
    id: string,
    raw: unknown,
    key: string | null,
    match: string | null,
    requestId: string,
  ) {
    const body = parse(coursePatch, raw),
      expected = version(match);
    return this.command(g, id, "", "PATCH", key, body, expected, false, async (tx, op) => {
      const c = await this.raw(g, id, tx);
      this.editable(c);
      requireCondition(c.version === expected, 412, "VERSION_CONFLICT");
      const status = await this.attendance.prepStatus(this.ag(g), c._id, tx),
        titles = c.lessons.map((l) => l.title);
      if (status.opened)
        requireCondition(
          JSON.stringify(titles) === JSON.stringify(body.lessons) && body.startOn === c.startOn,
          409,
          "PREP_PLAN_LOCKED",
        );
      const meetings = await this.meetings.countDocuments(
        { churchId: g.churchId, courseId: c._id },
        { session: tx },
      );
      if (meetings) requireCondition(body.startOn === c.startOn, 409, "PREP_PLAN_LOCKED");
      const removed = c.lessons.slice(body.lessons.length).map((l) => l.id);
      if (removed.length)
        requireCondition(
          !(await this.meetings.countDocuments(
            { churchId: g.churchId, courseId: c._id, lessonId: { $in: removed } },
            { session: tx },
          )),
          409,
          "PREP_PLAN_LOCKED",
        );
      const { reason: why, ...data } = body;
      const next: Course = {
        ...c,
        ...data,
        lessons: body.lessons.map((title, i) => ({
          id: c.lessons[i]?.id ?? new ObjectId(),
          title,
        })),
      };
      await this.save(c, next, tx);
      await this.history(
        g,
        next,
        "metadata_changed",
        courseDto(c),
        courseDto(next),
        why,
        null,
        tx,
        op,
        requestId,
      );
      return { courseId: id, version: next.version };
    });
  }
  async transition(
    g: ClassGrant,
    id: string,
    action: "activate" | "close" | "reopen",
    raw: unknown,
    key: string | null,
    match: string | null,
    requestId: string,
  ) {
    const body = parse(z.strictObject({ reason }), raw),
      expected = version(match);
    return this.command(g, id, `/${action}`, "POST", key, body, expected, false, async (tx, op) => {
      const c = await this.raw(g, id, tx);
      requireCondition(c.version === expected, 412, "VERSION_CONFLICT");
      requireCondition(
        c.state === (action === "activate" ? "draft" : action === "close" ? "active" : "closed"),
        409,
        "PREP_COURSE_STATE",
      );
      const status = await this.attendance.prepStatus(this.ag(g), c._id, tx);
      if (action === "close") requireCondition(status.open === 0, 409, "PREP_OPEN_SESSIONS");
      const next = {
        ...c,
        state: action === "close" ? ("closed" as const) : ("active" as const),
      };
      await this.save(c, next, tx);
      await this.history(
        g,
        next,
        action,
        courseDto(c),
        courseDto(next),
        body.reason,
        null,
        tx,
        op,
        requestId,
      );
      return { courseId: id, version: next.version };
    });
  }
  async candidates(g: ClassGrant, id: string, q: URLSearchParams) {
    this.staff(g, true);
    this.query.allow(q, ["q", "limit", "cursor"]);
    const term = (q.get("q") ?? "").trim().normalize("NFC").toLowerCase(),
      limit = this.query.limit(q);
    requireCondition(term.length <= 100, 400, "INVALID_REQUEST");
    return this.db.readSnapshot(g.churchId.toHexString(), async (tx) => {
      await g.fence(tx);
      const c = await this.raw(g, id, tx);
      this.editable(c);
      const context = this.query.context(g, `candidates/${id}`, [term]),
        after = q.has("cursor") ? this.query.decode(q.get("cursor") as string, context) : null,
        rows = await this.members.candidates(g.churchId, term, after, limit + 1, tx),
        more = rows.length > limit;
      if (more) rows.pop();
      const last = rows.at(-1);
      return {
        items: rows.map((m) => ({
          memberId: m._id.toHexString(),
          fullName: m.fullName,
          code: m.code,
          unknownBaptism: m.baptism.status === "unknown",
        })),
        nextCursor:
          more && last ? this.query.encode(context, last.nameKey, last._id.toHexString()) : null,
      };
    });
  }
  private async eligible(
    g: ClassGrant,
    mid: ObjectId,
    confirmUnknown: boolean,
    why: string | null,
    tx: ClientSession,
  ) {
    const m = await this.members.identity(g.churchId, mid, tx);
    requireCondition(m.eligible, 422, "PREP_NOT_ELIGIBLE");
    if (m.baptism.status === "unknown")
      requireCondition(confirmUnknown && !!why, 422, "PREP_CONFIRM_UNKNOWN");
    return m;
  }
  async enroll(g: ClassGrant, id: string, raw: unknown, key: string | null, requestId: string) {
    const b = parse(enrollmentInput, raw);
    return this.command(
      g,
      id,
      "/enrollments",
      "POST",
      key,
      b,
      null,
      false,
      async (tx, op) => {
        const c = await this.raw(g, id, tx);
        this.editable(c);
        const mid = objectId(b.memberId),
          m = await this.eligible(g, mid, b.confirmUnknown, b.reason, tx);
        requireCondition(c.enrollmentCount < 2000, 422, "ATTENDANCE_ROSTER_LIMIT");
        requireCondition(
          !(await this.enrollments.findOne(
            { churchId: g.churchId, courseId: c._id, memberId: mid },
            { session: tx },
          )),
          409,
          "PREP_ALREADY_ENROLLED",
        );
        const member = (await this.memberAttendance.candidatesForIds(g.churchId, [mid], tx, 1))[0],
          labels = member?.areaId
            ? await this.organization.attendanceAreaLabels(g.churchId, [member.areaId], tx)
            : [];
        const e: Enrollment = {
          _id: new ObjectId(),
          churchId: g.churchId,
          courseId: c._id,
          memberId: mid,
          fullName: m.fullName,
          code: m.code,
          nameKey: m.nameKey,
          birthDate: m.birthDate,
          areaName: labels[0]?.name ?? null,
          state: "studying",
          version: 1,
          interview: null,
          createdAt: this.now(),
          updatedAt: this.now(),
        };
        await this.enrollments.insertOne(e, { session: tx });
        const next = { ...c, enrollmentCount: c.enrollmentCount + 1 };
        await this.save(c, next, tx);
        await this.history(
          g,
          next,
          "enrolled",
          null,
          enrollmentDto(e),
          b.reason,
          mid,
          tx,
          op,
          requestId,
        );
        return { courseId: id, memberId: b.memberId, version: e.version };
      },
      201,
    );
  }
  async changeEnrollment(
    g: ClassGrant,
    id: string,
    memberId: string,
    raw: unknown,
    key: string | null,
    match: string | null,
    requestId: string,
  ) {
    const b = parse(stateInput, raw),
      expected = version(match);
    return this.command(
      g,
      id,
      `/enrollments/${objectId(memberId)}/state`,
      "POST",
      key,
      b,
      expected,
      false,
      async (tx, op) => {
        const c = await this.raw(g, id, tx);
        this.editable(c);
        const e = await this.row(g, c, memberId, tx);
        requireCondition(e.version === expected, 412, "VERSION_CONFLICT");
        if (b.state === "studying" && e.state !== b.state)
          await this.eligible(g, e.memberId, b.confirmUnknown, b.reason, tx);
        if (e.state === b.state)
          return { courseId: id, memberId, version: e.version, applied: false };
        const next = { ...e, state: b.state, version: e.version + 1, updatedAt: this.now() };
        await this.enrollments.replaceOne({ _id: e._id, version: expected }, next, { session: tx });
        await this.history(
          g,
          c,
          "enrollment_state",
          enrollmentDto(e),
          enrollmentDto(next),
          b.reason,
          e.memberId,
          tx,
          op,
          requestId,
        );
        return { courseId: id, memberId, version: next.version };
      },
    );
  }
  async interview(
    g: ClassGrant,
    id: string,
    memberId: string,
    raw: unknown,
    key: string | null,
    match: string | null,
    requestId: string,
  ) {
    const b = parse(interviewInput, raw),
      expected = version(match);
    requireCondition(b.heldOn <= businessDay(this.now()), 422, "VALIDATION_FAILED");
    return this.command(
      g,
      id,
      `/enrollments/${objectId(memberId)}/interview`,
      "POST",
      key,
      b,
      expected,
      true,
      async (tx, op) => {
        const c = await this.raw(g, id, tx);
        this.editable(c);
        const e = await this.row(g, c, memberId, tx);
        requireCondition(e.version === expected, 412, "VERSION_CONFLICT");
        const next = {
          ...e,
          version: e.version + 1,
          updatedAt: this.now(),
          interview: {
            heldOn: b.heldOn,
            interviewer: b.interviewer,
            actorId: g.actorId,
            actorKind: g.actorKind,
          },
        };
        await this.enrollments.replaceOne({ _id: e._id, version: expected }, next, { session: tx });
        await this.history(
          g,
          c,
          "interview_recorded",
          enrollmentDto(e),
          enrollmentDto(next),
          b.reason,
          e.memberId,
          tx,
          op,
          requestId,
        );
        return { courseId: id, memberId, version: next.version };
      },
    );
  }
  async enrollmentPage(g: ClassGrant, id: string, q: URLSearchParams) {
    this.staff(g);
    this.query.allow(q, ["q", "state", "limit", "cursor"]);
    const term = (q.get("q") ?? "").trim().normalize("NFC").toLowerCase(),
      state = q.get("state"),
      limit = this.query.limit(q);
    requireCondition(
      term.length <= 100 && (!state || ["studying", "withdrawn"].includes(state)),
      400,
      "INVALID_REQUEST",
    );
    return this.db.readSnapshot(g.churchId.toHexString(), async (tx) => {
      await g.fence(tx);
      const c = await this.raw(g, id, tx),
        context = this.query.context(g, `enrollments/${id}`, [term, state]),
        filter: Filter<Enrollment> = {
          churchId: g.churchId,
          courseId: c._id,
          ...(state ? { state: state as Enrollment["state"] } : {}),
        };
      const predicates: Filter<Enrollment>[] = [];
      if (term)
        predicates.push({
          $or: [
            { nameKey: { $regex: escaped(term), $options: "i" } },
            { code: { $regex: `^${escaped(term)}`, $options: "i" } },
          ],
        });
      if (q.has("cursor")) {
        const v = this.query.decode(q.get("cursor") as string, context);
        predicates.push({
          $or: [{ nameKey: { $gt: v.key } }, { nameKey: v.key, _id: { $gt: objectId(v.id) } }],
        });
      }
      if (predicates.length) filter.$and = predicates;
      const rows = await this.enrollments
          .find(filter, { session: tx })
          .sort({ nameKey: 1, _id: 1 })
          .limit(limit + 1)
          .toArray(),
        more = rows.length > limit;
      if (more) rows.pop();
      const last = rows.at(-1),
        ag = this.ag(g),
        credits = await this.attendance.prepCredits(
          ag,
          c._id,
          rows.map((e) => e.memberId),
          tx,
        ),
        status = await this.attendance.prepStatus(ag, c._id, tx);
      return {
        items: rows.map((e) => {
          const learned = new Set(
            credits
              .filter((p) => p.memberId.equals(e.memberId))
              .map((p) => p.lessonId.toHexString()),
          );
          return {
            ...enrollmentDto(e),
            ageAtStart:
              e.birthDate && e.birthDate <= c.startOn ? ageOn(e.birthDate, c.startOn) : null,
            creditedLessonIds: c.lessons
              .filter((l) => learned.has(l.id.toHexString()))
              .map((l) => l.id.toHexString()),
            makeupLessonIds: c.lessons
              .filter(
                (l) =>
                  status.closedLessons.includes(l.id.toHexString()) &&
                  !learned.has(l.id.toHexString()),
              )
              .map((l) => l.id.toHexString()),
            requiredLessons: c.lessons.length,
          };
        }),
        openSessions: status.open,
        nextCursor:
          more && last ? this.query.encode(context, last.nameKey, last._id.toHexString()) : null,
      };
    });
  }
  async meeting(g: ClassGrant, id: string, raw: unknown, key: string | null, requestId: string) {
    const b = parse(meetingInput, raw);
    return this.command(
      g,
      id,
      "/meetings",
      "POST",
      key,
      b,
      null,
      false,
      async (tx, op) => {
        const c = await this.raw(g, id, tx);
        requireCondition(c.state === "active", 409, "PREP_COURSE_STATE");
        const lid = objectId(b.lessonId),
          lesson = c.lessons.find((l) => l.id.equals(lid));
        requireCondition(lesson, 404, "NOT_FOUND");
        requireCondition(b.heldOn >= c.startOn, 422, "VALIDATION_FAILED");
        const ag = this.ag(g);
        let notBefore = c.startOn;
        if (b.kind === "regular")
          requireCondition(
            !(await this.meetings.findOne(
              { churchId: g.churchId, courseId: c._id, lessonId: lid, kind: "regular" },
              { session: tx },
            )),
            409,
            "PREP_REGULAR_EXISTS",
          );
        else {
          const regular = await this.meetings.findOne(
            { churchId: g.churchId, courseId: c._id, lessonId: lid, kind: "regular" },
            { session: tx },
          );
          requireCondition(regular, 409, "PREP_MAKEUP_UNAVAILABLE");
          const original = (
            await this.attendance.prepSessions(ag, c._id, [regular.sessionId], tx)
          )[0];
          requireCondition(
            original?.state === "closed" && b.heldOn >= original.heldOn,
            409,
            "PREP_MAKEUP_UNAVAILABLE",
          );
          notBefore = original.heldOn;
          const ids = (b.memberIds ?? []).map(objectId);
          requireCondition(
            (await this.enrollments.countDocuments(
              { churchId: g.churchId, courseId: c._id, state: "studying", memberId: { $in: ids } },
              { session: tx },
            )) === ids.length,
            422,
            "PREP_NOT_ENROLLED",
          );
          for (let i = 0; i < ids.length; i += 100) {
            const credits = await this.attendance.prepCredits(ag, c._id, ids.slice(i, i + 100), tx);
            requireCondition(
              !credits.some((p) => p.lessonId.equals(lid)),
              409,
              "PREP_ALREADY_CREDITED",
            );
          }
        }
        const mid = new ObjectId(),
          sid = new ObjectId(),
          meeting: Meeting = {
            _id: mid,
            churchId: g.churchId,
            courseId: c._id,
            lessonId: lid,
            sessionId: sid,
            kind: b.kind,
            notBefore,
            memberIds: b.memberIds ? b.memberIds.map(objectId) : null,
            createdAt: this.now(),
          };
        await this.meetings.insertOne(meeting, { session: tx });
        const label = `${c.name} · ${b.kind === "makeup" ? "Học bù · " : ""}${lesson.title}`.slice(
          0,
          200,
        );
        await this.attendance.createPrep(
          ag,
          sid,
          { courseId: c._id, meetingId: mid, lessonId: lid, kind: b.kind },
          { label, heldOn: b.heldOn, location: b.location },
          tx,
          op,
          requestId,
        );
        await this.history(
          g,
          c,
          "meeting_created",
          null,
          { sessionId: sid.toHexString(), lessonId: b.lessonId, kind: b.kind },
          null,
          null,
          tx,
          op,
          requestId,
        );
        return { courseId: id, sessionId: sid.toHexString() };
      },
      201,
    );
  }
  async meetingPage(g: ClassGrant, id: string, q: URLSearchParams) {
    this.staff(g);
    this.query.allow(q, ["limit", "cursor"]);
    const limit = this.query.limit(q);
    return this.db.readSnapshot(g.churchId.toHexString(), async (tx) => {
      await g.fence(tx);
      const c = await this.raw(g, id, tx),
        context = this.query.context(g, `meetings/${id}`, []),
        filter: Filter<Meeting> = { churchId: g.churchId, courseId: c._id };
      if (q.has("cursor")) {
        const v = this.query.decode(q.get("cursor") as string, context),
          t = new Date(v.key);
        requireCondition(Number.isFinite(t.getTime()), 400, "INVALID_CURSOR");
        filter.$or = [{ createdAt: { $lt: t } }, { createdAt: t, _id: { $lt: objectId(v.id) } }];
      }
      const rows = await this.meetings
          .find(filter, { session: tx })
          .sort({ createdAt: -1, _id: -1 })
          .limit(limit + 1)
          .toArray(),
        more = rows.length > limit;
      if (more) rows.pop();
      const last = rows.at(-1),
        sessions = await this.attendance.prepSessions(
          this.ag(g),
          c._id,
          rows.map((m) => m.sessionId),
          tx,
        );
      return {
        items: rows.map((m) => ({
          id: m._id.toHexString(),
          lessonId: m.lessonId.toHexString(),
          kind: m.kind,
          memberIds: m.memberIds?.map((id) => id.toHexString()) ?? null,
          session: sessions.find((s) => s.id === m.sessionId.toHexString()) ?? null,
        })),
        nextCursor:
          more && last
            ? this.query.encode(context, last.createdAt.toISOString(), last._id.toHexString())
            : null,
      };
    });
  }
  async historyPage(g: ClassGrant, id: string, q: URLSearchParams) {
    this.staff(g);
    this.query.allow(q, ["limit", "cursor"]);
    const limit = this.query.limit(q);
    return this.db.readSnapshot(g.churchId.toHexString(), async (tx) => {
      await g.fence(tx);
      const c = await this.raw(g, id, tx),
        context = this.query.context(g, `history/${id}`, []),
        filter: Filter<ClassHistory> = { churchId: g.churchId, courseId: c._id };
      if (q.has("cursor")) {
        const v = this.query.decode(q.get("cursor") as string, context),
          t = new Date(v.key);
        requireCondition(Number.isFinite(t.getTime()), 400, "INVALID_CURSOR");
        filter.$or = [{ occurredAt: { $lt: t } }, { occurredAt: t, _id: { $lt: objectId(v.id) } }];
      }
      const rows = await this.histories
          .find(filter, { session: tx })
          .sort({ occurredAt: -1, _id: -1 })
          .limit(limit + 1)
          .toArray(),
        more = rows.length > limit;
      if (more) rows.pop();
      const last = rows.at(-1);
      return {
        items: rows.map((h) => ({
          id: h._id.toHexString(),
          event: h.event,
          before: h.before,
          after: h.after,
          reason: h.reason,
          actorKind: h.actorKind,
          actorId: h.actorId.toHexString(),
          occurredAt: h.occurredAt.toISOString(),
        })),
        nextCursor:
          more && last
            ? this.query.encode(context, last.occurredAt.toISOString(), last._id.toHexString())
            : null,
      };
    });
  }
  async memberCourses(g: ClassGrant, memberId: string, q: URLSearchParams) {
    this.staff(g);
    this.query.allow(q, ["limit", "cursor"]);
    const limit = this.query.limit(q);
    return this.db.readSnapshot(g.churchId.toHexString(), async (tx) => {
      await g.fence(tx);
      await this.members.identity(g.churchId, objectId(memberId), tx);
      const context = this.query.context(g, `member/${objectId(memberId)}`, []),
        filter: Filter<Enrollment> = { churchId: g.churchId, memberId: objectId(memberId) };
      if (q.has("cursor")) {
        const v = this.query.decode(q.get("cursor") as string, context),
          t = new Date(v.key);
        requireCondition(Number.isFinite(t.getTime()), 400, "INVALID_CURSOR");
        filter.$or = [{ createdAt: { $lt: t } }, { createdAt: t, _id: { $lt: objectId(v.id) } }];
      }
      const rows = await this.enrollments
          .find(filter, { session: tx })
          .sort({ createdAt: -1, _id: -1 })
          .limit(limit + 1)
          .toArray(),
        more = rows.length > limit;
      if (more) rows.pop();
      const last = rows.at(-1),
        courses = await this.courses
          .find(
            { churchId: g.churchId, _id: { $in: rows.map((e) => e.courseId) } },
            { session: tx },
          )
          .toArray();
      return {
        items: rows.map((e) => ({
          course: courses.find((c) => c._id.equals(e.courseId))
            ? courseDto(courses.find((c) => c._id.equals(e.courseId)) as Course)
            : null,
          state: e.state,
          interview: enrollmentDto(e).interview,
        })),
        nextCursor:
          more && last
            ? this.query.encode(context, last.createdAt.toISOString(), last._id.toHexString())
            : null,
      };
    });
  }
  async operation(g: ClassGrant, id: string) {
    this.staff(g);
    return this.ops.getTenant(g, id, "prep-classes", async (tx, op) => {
      this.staff(g, true, op.routeKey.endsWith("/interview"));
      const ref = op.resourceRefs.find((r) => r.type === "prep_course");
      requireCondition(ref, 404, "NOT_FOUND");
      await this.raw(g, ref.id, tx);
    });
  }
}
