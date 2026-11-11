import { z } from "zod";
import { normalizeName } from "./models";

const text = (max: number) => z.string().transform(normalizeName).pipe(z.string().min(1).max(max));
export const configFields = {
  unitType: z.enum(["area", "cell_group", "branch", "custom"]),
  customUnitLabel: text(40).nullable().optional(),
  defaultAssignmentMode: z.enum(["auto", "manual"]),
};
export const createSettings = z.strictObject(configFields);
export const updateSettings = z
  .strictObject({
    unitType: configFields.unitType.optional(),
    customUnitLabel: configFields.customUnitLabel,
    defaultAssignmentMode: configFields.defaultAssignmentMode.optional(),
  })
  .refine((v) => Object.keys(v).length > 0);
export const createUnit = z.strictObject({
  kind: z.enum(["service_ministry", "area"]),
  name: text(100),
});
export const updateUnit = z.strictObject({ name: text(100) });
export const statusUnit = z.strictObject({
  status: z.enum(["active", "inactive"]),
  reason: text(500),
});
