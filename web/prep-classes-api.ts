import type { PrepClasses } from "../api/prep-classes/service";
export type Course = Awaited<ReturnType<PrepClasses["get"]>>;
export type CoursePage = Awaited<ReturnType<PrepClasses["list"]>>;
export type EnrollmentPage = Awaited<ReturnType<PrepClasses["enrollmentPage"]>>;
export type Enrollment = EnrollmentPage["items"][number];
export type MeetingPage = Awaited<ReturnType<PrepClasses["meetingPage"]>>;
export type ClassHistory = Awaited<ReturnType<PrepClasses["historyPage"]>>;
export type ClassCandidates = Awaited<ReturnType<PrepClasses["candidates"]>>;
export const courseStates = { draft: "Nháp", active: "Đang học", closed: "Đã đóng" };
