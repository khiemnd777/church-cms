import type { Rites } from "../api/rites/service";
export type RitePage = Awaited<ReturnType<Rites["list"]>>;
export type Rite = Awaited<ReturnType<Rites["get"]>>;
export type RiteRow = RitePage["items"][number];
export type RitePeople = Awaited<ReturnType<Rites["peoplePage"]>>;
export type RitePreview = Awaited<ReturnType<Rites["preview"]>>;
export type RiteHistory = Awaited<ReturnType<Rites["historyPage"]>>;
export const riteNames = {
  baptism: "Báp-têm",
  dedication: "Dâng con",
  marriage: "Thành hôn",
  funeral: "An táng",
  communion: "Tiệc Thánh",
};
export const riteStates = {
  draft: "Nháp",
  planned: "Dự kiến",
  recorded: "Đã ghi nhận",
  void: "Đã hủy",
};
export const riteTabs = [
  { id: "bap", label: "Báp-têm" },
  { id: "class", label: "Lớp dự bị" },
  { id: "ded", label: "Dâng con" },
  { id: "wed", label: "Thành hôn" },
  { id: "fun", label: "An táng" },
  { id: "com", label: "Tiệc Thánh" },
];
export const tabKinds = {
  bap: "baptism",
  ded: "dedication",
  wed: "marriage",
  fun: "funeral",
  com: "communion",
} as const;
export const kindTabs = {
  baptism: "bap",
  dedication: "ded",
  marriage: "wed",
  funeral: "fun",
  communion: "com",
} as const;
export const dateLabel = (v: string | null) => (v ? v.split("-").reverse().join("/") : "Chưa rõ");
