import type { Scheduling } from "../api/scheduling/service";
import type { ScheduleCommand } from "../api/scheduling/validation";
export type SchedulePage = Awaited<ReturnType<Scheduling["list"]>>;
export type ScheduleRow = SchedulePage["items"][number];
export type SchedulePreview = Awaited<ReturnType<Scheduling["preview"]>>;
export type ScheduleHistory = Awaited<ReturnType<Scheduling["historyPage"]>>;
export type { ScheduleCommand };
export const scheduleStates = { draft: "Bản nháp", scheduled: "Đã xếp lịch", cancelled: "Đã hủy" };
export const scheduleDate = (date: string) =>
  new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(date));
