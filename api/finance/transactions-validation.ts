import { z } from "zod";
import { daySchema, idSchema } from "../members/validation";

const text = (max: number) => z.string().normalize("NFC").trim().min(1).max(max);
const amount = z.string().regex(/^[1-9]\d{0,17}$/);
const common = {
  submissionId: z.uuid().transform((s) => s.toLowerCase()),
  businessDate: daySchema,
  fundId: idSchema.transform((s) => s.toLowerCase()),
  sourceReference: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9][A-Z0-9._/-]{0,63}$/),
  purpose: text(500),
  replacesReceiptId: idSchema
    .transform((s) => s.toLowerCase())
    .nullable()
    .default(null),
};
export const receiptInput = z.discriminatedUnion("mode", [
  z.strictObject({ ...common, mode: z.literal("aggregate"), amount }),
  z.strictObject({
    ...common,
    mode: z.literal("itemized"),
    lines: z
      .array(z.strictObject({ givingId: idSchema.transform((s) => s.toLowerCase()), amount }))
      .min(1)
      .max(100),
  }),
]);
export type ReceiptInput = z.infer<typeof receiptInput>;
export const postInput = z.strictObject({
  receipt: receiptInput,
  previewToken: z.string().min(1).max(2048),
});
export const givingInput = z.strictObject({ memberId: idSchema.transform((s) => s.toLowerCase()) });
export const givingStatusInput = z.strictObject({
  status: z.enum(["active", "inactive"]),
  reason: text(500),
});
export const voidInput = z.strictObject({ reason: text(500), confirmed: z.literal(true) });
