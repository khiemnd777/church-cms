import { z } from "zod";
import { validDay } from "../members/dates";

export const reportMetrics = {
  baptized_members: "Tín hữu chính thức đã Báp-têm",
  preparatory_members: "Tín hữu dự bị",
  children: "Thiếu nhi",
  visitors: "Thân hữu đang theo dõi",
  believed_visitors: "Thân hữu tin Chúa trong kỳ",
  believer_families: "Gia đình tín hữu",
  baptisms: "Báp-têm",
  dedications: "Dâng con",
  marriages: "Thành hôn",
  funerals: "An táng",
  sunday_average: "Hiện diện bình quân bốn Chúa nhật",
  areas: "Đơn vị sinh hoạt",
  transferred: "Chuyển đi trong kỳ",
} as const;
export type Metric = keyof typeof reportMetrics;
export type MetricValues = Record<Metric, number | null>;
export type TemplateCell = { text: string; metric?: Metric; bold?: boolean };
export type Layout = { name: string; widths: number[]; rows: TemplateCell[][] };
export type ReportCell = { value: string | number; bold?: boolean };
export type ReportDocument = {
  church: string;
  template: string;
  from: string;
  to: string;
  day: string;
  capturedAt: string;
  warnings: string[];
  widths: number[];
  rows: ReportCell[][];
};
export const reportTime = (at: string) =>
  new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "short",
    timeStyle: "medium",
    timeZone: "Asia/Ho_Chi_Minh",
  }).format(new Date(at));
export const reportMark = "BÁO CÁO NỘI BỘ";
export const reportLimits = { upload: 512 * 1024, rows: 100, columns: 6, text: 180 };
const id = z
  .string()
  .regex(/^[a-f0-9]{24}$/i)
  .transform((v) => v.toLowerCase());
const date = z.string().refine(validDay);
export const previewInput = z.strictObject({
  templateId: id,
  from: date,
  to: date,
  previousId: id.optional(),
  reason: z.string().trim().min(1).max(300).optional(),
});
export const activeInput = z.strictObject({
  activeId: id.nullable(),
  selectionVersion: z.number().int().nonnegative(),
  version: z.number().int().positive(),
});
export const issueInput = z.strictObject({ previewId: id, confirm: z.literal(true) });
