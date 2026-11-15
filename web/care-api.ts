import type { alertDto, signalDto } from "../api/care/models";
import type { Care } from "../api/care/service";
export type SuggestionRow = ReturnType<typeof alertDto>;
export type NeedRow = ReturnType<typeof signalDto>;
export type SuggestionPage = Awaited<ReturnType<Care["list"]>>;
export type SuggestionDetail = Awaited<ReturnType<Care["get"]>>;
export type NeedPreview = Awaited<ReturnType<Care["previewSignal"]>>;
export type SuggestionPreview = Awaited<ReturnType<Care["previewAlert"]>>;
export type SuggestionHistory = Awaited<ReturnType<Care["history"]>>;
export const needKinds = {
  absence: "Vắng 3 Chúa nhật",
  new_believer: "Tân tín hữu",
  illness: "Đau ốm",
  bereavement: "Gia đình có tang",
};
export const suggestionStates = {
  pending: "Chờ duyệt",
  linked: "Đã liên kết",
  dismissed: "Đã bỏ qua",
  expired: "Không còn áp dụng",
};
export const needStates = { open: "Nguồn đang mở", ended: "Nguồn đã kết thúc" };
export const careEvents = {
  create: "Ghi nhận nguồn",
  correct: "Đính chính nguồn",
  end: "Kết thúc nguồn",
  evaluate: "Đánh giá nguồn",
  expire: "Nguồn hết điều kiện",
  convert: "Chuyển / liên kết thăm viếng",
  dismiss: "Bỏ qua có lý do",
};
