import type { Prayers } from "../api/prayers/service";
import type { PrayerFields } from "../api/prayers/validation";
export type PrayerRow = Awaited<ReturnType<Prayers["list"]>>["items"][number];
export type PrayerPage = Awaited<ReturnType<Prayers["list"]>>;
export type PrayerDetail = Awaited<ReturnType<Prayers["get"]>>;
export type PrayerPreview = Awaited<ReturnType<Prayers["preview"]>>;
export type PrayerHistoryPage = Awaited<ReturnType<Prayers["history"]>>;
export const prayerCategories: Record<PrayerFields["category"], string> = {
  health: "Sức khỏe",
  family: "Gia đình",
  work: "Công việc",
  church: "Hội Thánh",
  study: "Học tập",
  thanksgiving: "Cảm tạ",
  other: "Khác",
};
export const prayerStates = {
  open: "Đang cầu nguyện",
  shared: "Đã chia sẻ",
  closed: "Đã kết thúc",
  cancelled: "Đã hủy",
};
export const prayerVisibility = { shared: "Chung nội bộ", pastoral: "Riêng tư · chỉ Mục sư" };
export const prayerActions = {
  create: "Thêm lời cầu thay",
  update: "Sửa lời cầu thay",
  correct: "Đính chính lời cầu thay",
  share: "Ghi nhận đã chia sẻ",
  close: "Kết thúc lời cầu thay",
  cancel: "Hủy lời cầu thay",
};
export const prayerDate = (day: string | null) =>
  day
    ? new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", dateStyle: "short" }).format(
        new Date(`${day}T00:00:00+07:00`),
      )
    : "Chưa rõ";
