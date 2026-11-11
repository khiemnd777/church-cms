import { AppError } from "../errors";
import type { Session } from "../identity/models";
export const ownerCapabilities = ["churches:manage", "accounts:manage", "audit:read"] as const;
export function requireFull(session: Session) {
  if (session.kind !== "full") throw new AppError(403, "PASSWORD_CHANGE_REQUIRED");
}
