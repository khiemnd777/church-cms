import { z } from "zod";
import { baptismSchema, daySchema, idSchema } from "../members/validation";

const text = (n: number) => z.string().normalize("NFC").trim().min(1).max(n);
export const personInput = z.discriminatedUnion("source", [
  z.strictObject({
    source: z.literal("member"),
    memberId: idSchema.transform((id) => id.toLowerCase()),
  }),
  z.strictObject({
    source: z.literal("external"),
    fullName: text(200),
    birthDate: daySchema.nullable(),
  }),
]);
const linked = z.strictObject({
  source: z.literal("member"),
  memberId: idSchema.transform((id) => id.toLowerCase()),
});
export const payloadInput = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("baptism"),
    person: linked,
    officiant: personInput.nullable(),
    place: text(200).nullable(),
  }),
  z.strictObject({
    kind: z.literal("dedication"),
    child: linked,
    parents: z
      .array(
        z.strictObject({ role: z.enum(["father", "mother", "guardian"]), person: personInput }),
      )
      .max(20),
    officiant: personInput.nullable(),
    place: text(200).nullable(),
  }),
  z.strictObject({
    kind: z.literal("marriage"),
    groom: personInput,
    bride: personInput,
    officiant: personInput.nullable(),
    place: text(200).nullable(),
    announcements: z
      .array(
        z.strictObject({
          date: daySchema,
          state: z.enum(["planned", "announced", "cancelled"]),
          note: text(500).nullable(),
        }),
      )
      .max(100),
  }),
  z.strictObject({
    kind: z.literal("funeral"),
    person: linked,
    deathOn: daySchema.nullable(),
    age: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(),
    place: text(200).nullable(),
  }),
  z.strictObject({
    kind: z.literal("communion"),
    officiant: personInput.nullable(),
    place: text(200).nullable(),
    count: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(),
  }),
]);
export const recordInput = z.strictObject({
  payload: payloadInput,
  date: daySchema.nullable(),
  historical: z.boolean(),
  note: text(1000).nullable(),
});
export const commandInput = z.strictObject({
  record: recordInput,
  state: z.enum(["draft", "planned", "recorded", "void"]),
  reason: text(500).nullable(),
  baptismAfter: baptismSchema.nullable(),
  preview: z.string().max(100).nullable(),
});
export type PersonInput = z.infer<typeof personInput>;
export type RecordInput = z.infer<typeof recordInput>;
export type RiteCommand = z.infer<typeof commandInput>;
