import { z } from "zod";
import { AppError, requireCondition } from "../errors";
import { type Role, roles, type Scope } from "../identity/accounts-model";
export const roleSchema = z.enum(roles);
export const scopeSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("church") }),
  z.strictObject({ kind: z.literal("self") }),
  z.strictObject({
    kind: z.literal("assigned_units"),
    unitIds: z
      .array(z.string().regex(/^[a-f0-9]{24}$/i))
      .min(1)
      .max(50),
  }),
]);
export function validateRoleScope(role: Role, scope: Scope) {
  requireCondition(
    role === "member"
      ? scope.kind === "self"
      : role === "ministry_lead"
        ? scope.kind === "assigned_units"
        : scope.kind === "church",
    422,
    "VALIDATION_FAILED",
  );
  // P2 has no unit catalogue yet. Never authorize arbitrary IDs or silently widen the scope.
  if (scope.kind === "assigned_units") throw new AppError(422, "SCOPE_TARGET_NOT_AVAILABLE");
}
// Only implemented capabilities are advertised; business modules extend this versioned catalogue in P2.
export const policyVersion = 2;
export const churchCapabilities = ["context:read"] as const;
export function capabilitiesFor(role: Role): readonly string[] {
  return role === "pastor"
    ? ["context:read", "organization:read", "organization:manage"]
    : role === "secretary"
      ? ["context:read", "organization:read"]
      : churchCapabilities;
}
export function capabilityAllowed(capability: string, role: Role) {
  return capabilitiesFor(role).includes(capability);
}
