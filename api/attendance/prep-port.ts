import type { ClientSession, ObjectId } from "mongodb";
import type { AttendanceCandidate } from "../members/attendance";
import type { AttendanceGrant } from "./models";
export interface PrepSessionRef {
  courseId: ObjectId;
  meetingId: ObjectId;
  lessonId: ObjectId;
  kind: "regular" | "makeup";
}
export interface PrepAttendancePort {
  read(g: AttendanceGrant, ref: PrepSessionRef, tx: ClientSession): Promise<void>;
  writable(g: AttendanceGrant, ref: PrepSessionRef, tx: ClientSession): Promise<void>;
  candidates(
    g: AttendanceGrant,
    ref: PrepSessionRef,
    tx: ClientSession,
    memberId?: ObjectId,
  ): Promise<{ rows: AttendanceCandidate[]; versionKey: string }>;
  validateDate(
    g: AttendanceGrant,
    ref: PrepSessionRef,
    heldOn: string,
    tx: ClientSession,
  ): Promise<void>;
}
