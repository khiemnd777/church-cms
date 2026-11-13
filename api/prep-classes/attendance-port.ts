import type { ClientSession, ObjectId } from "mongodb";
import type { AttendanceGrant } from "../attendance/models";
import type { PrepAttendancePort, PrepSessionRef } from "../attendance/prep-port";
import { requireCondition } from "../errors";
import type { Database } from "../infrastructure/database";
import type { AttendanceMembers } from "../members/attendance";
import type { Course, Enrollment, Meeting } from "./models";
// PrepClasses owns this source/fence. It uses only the public Members read port.
export class PrepAttendanceSource implements PrepAttendancePort {
  constructor(
    private db: Database,
    private members: AttendanceMembers,
  ) {}
  private async context(g: AttendanceGrant, ref: PrepSessionRef, tx: ClientSession) {
    requireCondition(g.canReadClasses && !g.unitScope && !g.receiptScope, 403, "FORBIDDEN");
    const course = await this.db.db
      .collection<Course>("prep_courses")
      .findOne({ _id: ref.courseId, churchId: g.churchId }, { session: tx });
    const meeting = await this.db.db.collection<Meeting>("prep_meetings").findOne(
      {
        _id: ref.meetingId,
        churchId: g.churchId,
        courseId: ref.courseId,
        lessonId: ref.lessonId,
        kind: ref.kind,
      },
      { session: tx },
    );
    requireCondition(course && meeting, 404, "NOT_FOUND");
    return { course, meeting };
  }
  async read(g: AttendanceGrant, ref: PrepSessionRef, tx: ClientSession) {
    await this.context(g, ref, tx);
  }
  async writable(g: AttendanceGrant, ref: PrepSessionRef, tx: ClientSession) {
    const { course } = await this.context(g, ref, tx);
    requireCondition(g.canManageClasses, 403, "FORBIDDEN");
    requireCondition(course.state === "active", 409, "PREP_COURSE_STATE");
  }
  async validateDate(g: AttendanceGrant, ref: PrepSessionRef, heldOn: string, tx: ClientSession) {
    const { course, meeting } = await this.context(g, ref, tx);
    requireCondition(
      heldOn >= course.startOn && heldOn >= meeting.notBefore,
      422,
      "VALIDATION_FAILED",
    );
  }
  async candidates(
    g: AttendanceGrant,
    ref: PrepSessionRef,
    tx: ClientSession,
    memberId?: ObjectId,
  ) {
    const { course, meeting } = await this.context(g, ref, tx);
    if (memberId && meeting.memberIds && !meeting.memberIds.some((id) => id.equals(memberId)))
      return { rows: [], versionKey: JSON.stringify([course.version, meeting._id]) };
    const enrollments = await this.db.db
      .collection<Enrollment>("prep_enrollments")
      .find(
        {
          churchId: g.churchId,
          courseId: ref.courseId,
          state: "studying",
          ...(meeting.memberIds ? { memberId: { $in: meeting.memberIds } } : {}),
          ...(memberId ? { memberId } : {}),
        },
        { session: tx, projection: { memberId: 1, version: 1 } },
      )
      .sort({ _id: 1 })
      .limit(2001)
      .toArray();
    requireCondition(enrollments.length <= 2000, 422, "ATTENDANCE_ROSTER_LIMIT");
    const rows = await this.members.candidatesForIds(
      g.churchId,
      enrollments.map((e) => e.memberId),
      tx,
      2001,
    );
    return {
      rows,
      versionKey: JSON.stringify([
        course.version,
        meeting._id,
        enrollments.map((e) => [e.memberId, e.version]),
      ]),
    };
  }
}
