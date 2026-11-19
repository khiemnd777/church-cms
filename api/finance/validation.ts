import { z } from "zod";

export const normalizeFundName = (s: string) => s.normalize("NFC").trim().replace(/\s+/gu, " ");
export const fundName = z.string().transform(normalizeFundName).pipe(z.string().min(1).max(100));
export const fundInput = z.strictObject({ name: fundName });
export const fundStatusInput = z.strictObject({
  status: z.enum(["active", "inactive"]),
  reason: z.string().normalize("NFC").trim().min(1).max(500),
});
const approver = z.enum(["pastor", "secretary", "treasurer"]);
export const settingsInput = z.strictObject({
  proposerRoles: z
    .array(z.enum(["secretary", "treasurer", "ministry_lead"]))
    .max(3)
    .refine((roles) => new Set(roles).size === roles.length)
    .transform((roles) => [...roles].sort()),
  approverRole: approver,
  approvalThreshold: z
    .strictObject({
      amount: z.string().regex(/^[1-9]\d{0,17}$/),
      belowRole: approver,
      atOrAboveRole: approver,
    })
    .nullable()
    .optional(),
});
export type FinanceSettingsInput = z.infer<typeof settingsInput>;
