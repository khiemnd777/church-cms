import { z } from "zod";
import { validDay } from "./dates";
import { normalized } from "./models";

const text = (max: number) => z.string().transform(normalized).pipe(z.string().min(1).max(max));
export const idSchema = z.string().regex(/^[a-f0-9]{24}$/i);
export const daySchema = z.string().refine(validDay, "Ngày không hợp lệ.");
const optionalText = (max: number) => text(max).nullable();
export const baptismSchema = z
  .strictObject({
    status: z.enum(["unknown", "not_baptized", "baptized"]),
    date: daySchema.nullable(),
    place: optionalText(200),
  })
  .refine((b) => b.status === "baptized" || (!b.date && !b.place));
export const visitorFields = {
  firstVisit: daySchema.nullable(),
  believedOn: daySchema.nullable(),
  referrer: optionalText(200),
  caregiverId: idSchema.nullable(),
};
export const visitorSchema = z.strictObject({
  stage: z.enum(["new", "exploring", "believed"]),
  ...visitorFields,
});
export const assignmentSchema = z
  .strictObject({
    mode: z.enum(["auto", "manual"]),
    unitIds: z.array(idSchema).max(50),
    serviceUnitIds: z.array(idSchema).max(50).optional(),
  })
  .refine(
    (a) =>
      new Set(a.unitIds.map((id) => id.toLowerCase())).size === a.unitIds.length &&
      (a.mode !== "auto" || a.unitIds.length === 0) &&
      (!a.serviceUnitIds ||
        (new Set(a.serviceUnitIds.map((id) => id.toLowerCase())).size === a.serviceUnitIds.length &&
          a.unitIds.length + a.serviceUnitIds.length <= 50)),
  );
export const contextSchema = z.strictObject({
  settingsVersion: z.number().int().min(1),
  asOfDate: daySchema,
});
const profile = {
  fullName: text(200),
  gender: z.enum(["male", "female", "unknown"]),
  birthDate: daySchema.nullable(),
  phone: optionalText(40).refine(
    (p) => p === null || (/^\+?[\d\s().-]+$/.test(p) && p.replace(/\D/g, "").length >= 5),
  ),
  membership: z.enum(["preparatory", "member", "child"]).nullable(),
  householdRole: z.enum(["head", "spouse", "child", "relative", "other"]),
  baptism: baptismSchema,
};
export const createMember = z
  .strictObject({
    ...profile,
    type: z.enum(["believer", "visitor"]),
    visitor: visitorSchema.nullable(),
    family: z.discriminatedUnion("kind", [
      z.strictObject({ kind: z.literal("existing"), id: idSchema }),
      z.strictObject({ kind: z.literal("new"), areaId: idSchema.nullable() }),
    ]),
    assignment: assignmentSchema,
    assignmentContext: contextSchema,
    consent: z.literal(true),
  })
  .refine((v) =>
    v.type === "visitor" ? v.membership === null && !!v.visitor : !!v.membership && !v.visitor,
  );
export const updateMember = z
  .strictObject({
    fullName: profile.fullName.optional(),
    gender: profile.gender.optional(),
    birthDate: profile.birthDate.optional(),
    phone: profile.phone.optional(),
    membership: profile.membership.optional(),
    householdRole: profile.householdRole.optional(),
    baptism: profile.baptism.optional(),
    visitor: z.strictObject(visitorFields).optional(),
    assignment: assignmentSchema.optional(),
    assignmentContext: contextSchema.optional(),
  })
  .refine((v) => Object.keys(v).some((k) => k !== "assignmentContext"));
export const stageMember = z.strictObject({
  stage: z.enum(["new", "exploring", "believed"]),
  believedOn: daySchema.nullable(),
  reason: text(500),
});
export const convertMember = z.strictObject({
  effectiveOn: daySchema,
  believedOn: daySchema.nullable(),
  reason: text(500),
});
export const participationMember = z.strictObject({
  status: z.enum(["active", "long_absent", "transferred", "deceased"]),
  effectiveOn: daySchema,
  eventDate: daySchema.nullable(),
  reason: text(500),
});
