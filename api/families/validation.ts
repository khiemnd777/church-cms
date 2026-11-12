import { z } from "zod";
import { normalized } from "../members/models";
import { daySchema, idSchema } from "../members/validation";

const text = (max: number) => z.string().transform(normalized).pipe(z.string().min(1).max(max));
export const familyFields = {
  name: text(200).nullable(),
  address: text(500).nullable(),
  notes: text(1000).nullable(),
  sinceYear: z.number().int().min(1).max(9999).nullable(),
  areaId: idSchema.nullable(),
};
export const familyCreate = z.strictObject(familyFields);
export const familyPatch = familyCreate
  .partial()
  .extend({ reason: text(500).optional(), effectiveOn: daySchema.optional() })
  .refine((v) => Object.keys(v).some((k) => k !== "reason" && k !== "effectiveOn"));
const change = z.strictObject({
  id: idSchema,
  version: z.number().int().min(1),
  role: z.enum(["head", "spouse", "child", "relative", "other"]),
});
const context = { effectiveOn: daySchema, reason: text(500) };
const moving = {
  ...context,
  moves: z.array(change).max(100),
  roleChanges: z.array(change).max(100),
};
export const familyCommand = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("roles"),
    ...context,
    roleChanges: z.array(change).min(1).max(100),
  }),
  z
    .strictObject({
      kind: z.literal("transfer"),
      ...moving,
      targetFamilyId: idSchema,
      targetVersion: z.number().int().min(1),
    })
    .refine((v) => v.moves.length > 0),
  z
    .strictObject({ kind: z.literal("split"), ...moving, newFamily: familyCreate })
    .refine((v) => v.moves.length > 0),
  z.strictObject({
    kind: z.literal("merge"),
    ...moving,
    targetFamilyId: idSchema,
    targetVersion: z.number().int().min(1),
  }),
  z.strictObject({ kind: z.literal("area"), ...context, areaId: idSchema.nullable() }),
]);
export type FamilyCommand = z.infer<typeof familyCommand>;
export type RoleChange = z.infer<typeof change>;
export type FamilyInput = z.infer<typeof familyCreate>;
