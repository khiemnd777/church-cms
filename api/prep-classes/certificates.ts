import { type ClientSession, ObjectId } from "mongodb";
import type { TenantGrant } from "../authorization/tenant-grant";
import { requireCondition } from "../errors";
import type { Database } from "../infrastructure/database";
import { type Course, courseDto, type Enrollment, enrollmentDto } from "./models";
export class CertificateClasses {
  constructor(private db: Database) {}
  async get(g: TenantGrant, id: string, memberId: string, tx: ClientSession) {
    const c = await this.db.db
      .collection<Course>("prep_courses")
      .findOne({ _id: new ObjectId(id), churchId: g.churchId }, { session: tx });
    const e = await this.db.db
      .collection<Enrollment>("prep_enrollments")
      .findOne(
        { courseId: new ObjectId(id), memberId: new ObjectId(memberId), churchId: g.churchId },
        { session: tx },
      );
    requireCondition(c && e, 404, "NOT_FOUND");
    return { course: courseDto(c), enrollment: enrollmentDto(e) };
  }
  async fence(
    g: TenantGrant,
    id: string,
    memberId: string,
    courseVersion: number,
    enrollmentVersion: number,
    tx: ClientSession,
  ) {
    const c = await this.db.db
      .collection<Course>("prep_courses")
      .updateOne(
        { _id: new ObjectId(id), churchId: g.churchId, version: courseVersion },
        { $inc: { writeFence: 1 } },
        { session: tx },
      );
    const e = await this.db.db.collection<Enrollment>("prep_enrollments").updateOne(
      {
        courseId: new ObjectId(id),
        memberId: new ObjectId(memberId),
        churchId: g.churchId,
        version: enrollmentVersion,
      },
      { $inc: { writeFence: 1 } },
      { session: tx },
    );
    requireCondition(c.matchedCount && e.matchedCount, 412, "VERSION_CONFLICT");
  }
}
