import { z } from "zod";
import { idSchema as rawId } from "../members/validation";

const id = rawId.transform((v) => v.toLowerCase());
const text = (n: number) => z.string().normalize("NFC").trim().min(1).max(n);
export const templateKeys = [
  "guide",
  "praise",
  "opening",
  "word",
  "discussion",
  "notices",
  "closing",
] as const;
export const assignmentInput = z.discriminatedUnion("mode", [
  z.strictObject({ mode: z.literal("member"), memberId: id }),
  z.strictObject({ mode: z.literal("unassigned") }),
  z.strictObject({ mode: z.literal("not_applicable") }),
]);
export const rowInput = z.strictObject({
  id: z.string().uuid(),
  templateKey: z.enum(templateKeys).nullable(),
  title: text(200),
  detail: z.string().normalize("NFC").trim().max(1000),
  assignment: assignmentInput,
});
export const rowsInput = z
  .array(rowInput)
  .min(1)
  .max(50)
  .refine(
    (rows) =>
      new Set(rows.map((r) => r.id)).size === rows.length &&
      new Set(rows.flatMap((r) => (r.templateKey ? [r.templateKey] : []))).size ===
        rows.filter((r) => r.templateKey).length,
  );
export const commandInput = z.strictObject({
  action: z.enum(["create", "save", "regenerate", "amend", "finalize"]),
  unitId: id.nullable(),
  occurrenceId: id.nullable(),
  rows: rowsInput.nullable(),
  reason: text(500).nullable(),
  preview: z.string().max(100).nullable(),
  incompleteConfirmed: z.boolean(),
});
export type ProgramRow = z.infer<typeof rowInput>;
export type ProgramCommand = z.infer<typeof commandInput>;
export type ProgramAssignment = z.infer<typeof assignmentInput>;
export const templateTitles = [
  "Hướng dẫn chương trình",
  "Ca ngợi",
  "Cầu nguyện mở đầu",
  "Chia sẻ Lời Chúa",
  "Thảo luận, sinh hoạt nhóm",
  "Thông báo của ban",
  "Cầu nguyện kết thúc",
] as const;
