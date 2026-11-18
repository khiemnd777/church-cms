import { randomBytes } from "node:crypto";
export const resourceCode = (
  prefix: "TH" | "GD" | "TV" | "CT" | "NC" | "DN" | "DH" | "PT" | "DX" | "PC" | "KS",
) =>
  `${prefix}-${Array.from(randomBytes(10), (b) => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[b & 31]).join("")}`;
