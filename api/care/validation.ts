import { z } from "zod";
import { daySchema, idSchema } from "../members/validation";
import { targetInput, fieldsInput as visitFields } from "../visitation/validation";

const text = (max: number) => z.string().normalize("NFC").trim().min(1).max(max);
export const careKinds = ["absence", "new_believer", "illness", "bereavement"] as const;
export const signalKinds = ["new_believer", "illness", "bereavement"] as const;
const common = {
  reason: text(500).nullable(),
  preview: z.string().max(100).nullable(),
  confirmed: z.boolean(),
};
export const signalFields = z.strictObject({
  occurredOn: daySchema,
  summary: text(500).nullable(),
});
export const signalInput = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("create"),
    target: targetInput,
    kind: z.enum(signalKinds),
    fields: signalFields,
    ...common,
  }),
  z.strictObject({ action: z.literal("correct"), fields: signalFields, ...common }),
  z.strictObject({ action: z.literal("end"), ...common }),
]);
export const alertInput = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("convert"),
    fields: visitFields.omit({ reasonCode: true }),
    mode: z.enum(["create", "link"]),
    caseId: idSchema.nullable(),
    caseVersion: z.number().int().min(1).nullable(),
    ...common,
  }),
  z.strictObject({ action: z.literal("dismiss"), ...common }),
]);
export const evaluateInput = z.strictObject({
  cursor: z.string().max(4096).nullable(),
  limit: z.number().int().min(1).max(100).default(25),
});
export type SignalCommand = z.infer<typeof signalInput>;
export type AlertCommand = z.infer<typeof alertInput>;
export type CareKind = (typeof careKinds)[number];
