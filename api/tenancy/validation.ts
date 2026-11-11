import { z } from "zod";

const text = (max: number) =>
  z
    .string()
    .trim()
    .refine(
      (s) =>
        [...s].length <= max &&
        [...s].every((c) => (c.codePointAt(0) ?? 0) >= 32 && c.codePointAt(0) !== 127),
    );
const nonempty = (max: number) => text(max).refine((s) => s.length > 0);
const contact = z.strictObject({
  name: text(160).optional(),
  phone: text(32).optional(),
  email: z
    .string()
    .trim()
    .email()
    .max(254)
    .regex(/^[\x20-\x7e]+$/)
    .optional(),
});
const fields = {
  name: nonempty(160),
  province: nonempty(160),
  district: text(160).nullable().optional(),
  address: text(500).nullable().optional(),
  contact: contact.nullable().optional(),
};
export const createChurch = z.strictObject(fields);
export const updateChurch = createChurch
  .partial()
  .extend({
    contact: z
      .strictObject({
        name: text(160).nullable().optional(),
        phone: text(32).nullable().optional(),
        email: contact.shape.email.unwrap().nullable().optional(),
      })
      .nullable()
      .optional(),
  })
  .refine((obj) => Object.keys(obj).length > 0);
export const statusChurch = z.strictObject({
  status: z.enum(["active", "suspended"]),
  reason: nonempty(200),
});
export { objectId, parse, version } from "../http-validation";
