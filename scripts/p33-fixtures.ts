import { ObjectId } from "mongodb";
import type { Database } from "../api/infrastructure/database";
import type { Member } from "../api/members/models";
import type { Enrollment } from "../api/prep-classes/models";
// Large enrollment setup only. Public API enrollment behavior is exercised separately.
export async function seedPrepEnrollments(
  db: Database,
  churchId: string,
  courseId: string,
  count: number,
) {
  if (!/^church_cms_test_/.test(db.db.databaseName) || count < 1 || count > 2000)
    throw new Error("Disposable synthetic database and bounded enrollment fixtures only");
  const church = new ObjectId(churchId),
    course = new ObjectId(courseId),
    now = new Date();
  const rows = await db.db
    .collection<Member>("members")
    .find({
      churchId: church,
      type: "believer",
      membership: "preparatory",
      participation: { $in: ["active", "long_absent"] },
    })
    .sort({ _id: 1 })
    .limit(count)
    .toArray();
  if (rows.length !== count) throw new Error("Insufficient eligible synthetic members");
  const data: Enrollment[] = rows.map((m) => ({
    _id: new ObjectId(),
    churchId: church,
    courseId: course,
    memberId: m._id,
    fullName: m.fullName,
    code: m.code,
    nameKey: m.nameKey,
    birthDate: m.birthDate,
    areaName: null,
    state: "studying",
    version: 1,
    interview: null,
    createdAt: now,
    updatedAt: now,
  }));
  await db.db.collection<Enrollment>("prep_enrollments").insertMany(data);
  const changed = await db.db
    .collection("prep_courses")
    .updateOne(
      { _id: course, churchId: church },
      { $set: { enrollmentCount: count }, $inc: { version: 1 } },
    );
  if (!changed.matchedCount) throw new Error("Synthetic course missing");
  return data;
}
