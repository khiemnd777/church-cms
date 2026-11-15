import { z } from "zod";
import { daySchema, idSchema } from "../members/validation";

const id = idSchema.transform((v) => v.toLowerCase());
const text = (max: number) => z.string().normalize("NFC").trim().min(1).max(max);
export const reasonCodes = ["absence", "illness", "new_believer", "bereavement", "other"] as const;
export const fieldsInput = z.strictObject({
  reasonCode: z.enum(reasonCodes),
  description: text(2000),
  priority: z.enum(["normal", "high"]),
  plannedOn: daySchema.nullable(),
  assigneeId: id.nullable(),
});
export const targetInput = z.strictObject({ kind: z.enum(["member", "family"]), id });
export const entryInput = z.strictObject({
  visitedOn: daySchema,
  participantIds: z
    .array(id)
    .min(1)
    .max(10)
    .refine((ids) => new Set(ids).size === ids.length),
  outcome: z.enum(["visited", "not_met", "declined"]),
  note: text(2000),
});
const common = {
  reason: text(500).nullable(),
  preview: z.string().max(100).nullable(),
  confirmed: z.boolean(),
};
export const commandInput = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("create"),
    target: targetInput,
    fields: fieldsInput,
    ...common,
  }),
  z.strictObject({ action: z.literal("update"), fields: fieldsInput, ...common }),
  z.strictObject({ action: z.literal("record"), entry: entryInput, ...common }),
  z.strictObject({
    action: z.literal("correct"),
    entryId: id,
    entryVersion: z.number().int().min(1),
    entry: entryInput,
    ...common,
  }),
  z.strictObject({ action: z.literal("complete"), ...common }),
  z.strictObject({ action: z.literal("cancel"), ...common }),
]);
export type VisitCommand = z.infer<typeof commandInput>;
export type VisitFields = z.infer<typeof fieldsInput>;
export type VisitEntryInput = z.infer<typeof entryInput>;
export type VisitTarget = z.infer<typeof targetInput>;
