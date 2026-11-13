import type { Attendance } from "../api/attendance/service";
export type SessionPage = Awaited<ReturnType<Attendance["list"]>>;
export type Session = Awaited<ReturnType<Attendance["get"]>>;
export type Roster = Awaited<ReturnType<Attendance["roster"]>>;
export type Participant = Roster["items"][number];
export type Candidates = Awaited<ReturnType<Attendance["candidates"]>>;
export type History = Awaited<ReturnType<Attendance["historyPage"]>>;
export const sessionStates = { draft: "Nháp", open: "Đang mở", closed: "Đã chốt" };
export const presenceStates = {
  present: "Có mặt",
  absent: "Vắng",
  unrecorded: "Chưa ghi nhận",
  excluded: "Đã loại khỏi danh sách",
};
export const attendanceEvents: Record<string, string> = {
  created: "Tạo buổi",
  metadata_changed: "Sửa thông tin",
  open: "Mở buổi",
  close: "Chốt buổi",
  reopen: "Mở lại",
  reset: "Làm lại",
  marked: "Đổi hiện diện",
  roster_changed: "Đổi danh sách",
};
