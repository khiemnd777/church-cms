import { z } from "zod";
import { daySchema, idSchema } from "../members/validation";

const text = (n: number) => z.string().normalize("NFC").trim().min(1).max(n);
export const reasonSchema = text(500);
const fields = {
  reportingKind: z.enum(["general", "sunday_reference"]).default("general"),
  label: text(200),
  heldOn: daySchema,
  location: text(500).nullable(),
  scope: z.enum(["church", "unit"]),
  unitId: idSchema.nullable(),
};
export const createSession = z
  .strictObject(fields)
  .refine((b) => (b.scope === "unit" ? !!b.unitId : b.unitId === null))
  .refine(
    (b) =>
      b.reportingKind !== "sunday_reference" ||
      (b.scope === "church" && new Date(`${b.heldOn}T00:00:00Z`).getUTCDay() === 0),
  );
export const updateSession = z
  .strictObject({
    reportingKind: fields.reportingKind.optional(),
    label: fields.label.optional(),
    heldOn: fields.heldOn.optional(),
    location: fields.location.optional(),
    scope: fields.scope.optional(),
    unitId: fields.unitId.optional(),
    reason: reasonSchema.optional(),
    referenceConfirmed: z.literal(true).optional(),
  })
  .refine((b) => Object.keys(b).some((k) => k !== "reason" && k !== "referenceConfirmed"));
export const openSession = z.strictObject({ previewToken: z.string().min(1).max(4096) });
export const emptyCommand = z.strictObject({});
export const reasonCommand = z.strictObject({ reason: reasonSchema });
export const rosterCommand = z.strictObject({
  memberId: idSchema,
  included: z.boolean(),
  reason: reasonSchema,
});
export const markCommand = z.strictObject({
  present: z.boolean(),
  generation: z.number().int().min(1),
});
