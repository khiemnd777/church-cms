import { z } from "zod";
import { daySchema, idSchema } from "../members/validation";

const text = (max: number) => z.string().normalize("NFC").trim().min(1).max(max);
export const categories = [
  "health",
  "family",
  "work",
  "church",
  "study",
  "thanksgiving",
  "other",
] as const;
export const requesterInput = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("none") }),
  z.strictObject({ kind: z.literal("member"), id: idSchema.transform((s) => s.toLowerCase()) }),
  z.strictObject({ kind: z.literal("text"), name: text(200) }),
]);
export const fieldsInput = z.strictObject({
  content: text(2000),
  category: z.enum(categories),
  receivedOn: daySchema.nullable(),
  requester: requesterInput,
});
const common = {
  reason: text(500).nullable(),
  preview: z.string().max(100).nullable(),
  confirmed: z.boolean(),
};
export const commandInput = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("create"),
    visibility: z.enum(["shared", "pastoral"]),
    fields: fieldsInput,
    ...common,
  }),
  z.strictObject({ action: z.literal("update"), fields: fieldsInput, ...common }),
  z.strictObject({
    action: z.literal("correct"),
    fields: fieldsInput,
    sharedOn: daySchema.optional(),
    ...common,
  }),
  z.strictObject({ action: z.literal("share"), sharedOn: daySchema, ...common }),
  z.strictObject({ action: z.literal("close"), ...common }),
  z.strictObject({ action: z.literal("cancel"), ...common }),
]);
export type PrayerCommand = z.infer<typeof commandInput>;
export type PrayerFields = z.infer<typeof fieldsInput>;
export type PrayerRequester = z.infer<typeof requesterInput>;
