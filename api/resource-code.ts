import { randomBytes } from "node:crypto";
export const resourceCode = (prefix: "TH" | "GD") =>
  `${prefix}-${Array.from(randomBytes(10), (b) => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[b & 31]).join("")}`;
