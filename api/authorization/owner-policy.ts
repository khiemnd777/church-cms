import { AppError } from "../errors";
import type { Session } from "../identity/models";
export const ownerCapabilities = [
  "churches:manage",
  "accounts:manage",
  "audit:read",
  "organization:read",
  "organization:manage",
  "overview:read",
  "attendance:read",
  "attendance:mark",
  "attendance:manage",
  "attendance:scan",
  "cards:read",
  "cards:manage",
  "certificates:read",
  "certificates:manage",
  "rites:read",
  "rites:manage",
  "classes:read",
  "classes:manage",
  "classes:interview",
  "members:read",
  "members:manage",
  "data:import",
  "data:export",
  "families:read",
  "families:manage",
] as const;
export function requireFull(session: Session) {
  if (session.kind !== "full") throw new AppError(403, "PASSWORD_CHANGE_REQUIRED");
}
