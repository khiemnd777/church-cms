import { z } from "zod";
import { idSchema } from "../members/validation";
export const expenseDraft = z.strictObject({
  submissionId: z.uuid().transform((s) => s.toLowerCase()),
  fundId: idSchema.transform((s) => s.toLowerCase()),
  amount: z.string().regex(/^[1-9]\d{0,17}$/),
  attachmentId: idSchema.transform((s) => s.toLowerCase()).optional(),
  purpose: z.string().normalize("NFC").trim().min(1).max(500),
});
export const expenseDecision = z
  .strictObject({
    decision: z.enum(["approved", "rejected"]),
    reason: z.string().normalize("NFC").trim().max(500).default(""),
  })
  .refine((d) => d.decision !== "rejected" || d.reason.length > 0, {
    path: ["reason"],
    message: "Từ chối cần lý do.",
  });
export const expenseSubmit = z.strictObject({
  proposal: expenseDraft,
  previewToken: z.string().min(1).max(2048),
});
export const expenseDecide = z.strictObject({
  decision: expenseDecision,
  previewToken: z.string().min(1).max(2048),
});
export type ExpenseDraft = z.infer<typeof expenseDraft>;
