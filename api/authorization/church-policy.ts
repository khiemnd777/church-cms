import { z } from "zod";
import { requireCondition } from "../errors";
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
  if (scope.kind === "assigned_units")
    requireCondition(
      new Set(scope.unitIds.map((id) => id.toLowerCase())).size === scope.unitIds.length,
      422,
      "VALIDATION_FAILED",
    );
}
// Only implemented capabilities are advertised; business modules extend this versioned catalogue in P2.
export const policyVersion = 13;
export const churchCapabilities = ["context:read", "policy:read"] as const;
export function capabilitiesFor(role: Role): readonly string[] {
  return role === "pastor"
    ? [
        "context:read",
        "policy:read",
        "organization:roster",
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
      ]
    : role === "secretary"
      ? [
          "context:read",
          "policy:read",
          "organization:roster",
          "organization:read",
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
          "members:read",
          "members:manage",
          "data:import",
          "data:export",
          "families:read",
          "families:manage",
        ]
      : role === "ministry_lead"
        ? [
            ...churchCapabilities,
            "organization:roster",
            "attendance:read",
            "attendance:mark",
            "attendance:scan",
          ]
        : churchCapabilities;
}
export function capabilityAllowed(capability: string, role: Role) {
  return capabilitiesFor(role).includes(capability);
}

export function policyMatrix() {
  return {
    policyVersion,
    rows: roles.map((role) => ({
      role,
      overview: role === "pastor" || role === "secretary" ? "Toàn bộ: xem" : "Không",
      profiles:
        role === "pastor" || role === "secretary"
          ? "Toàn bộ: xem/sửa"
          : role === "ministry_lead"
            ? "Ban mình: danh sách rút gọn"
            : "Chưa mở",
      families: role === "pastor" || role === "secretary" ? "Toàn bộ: xem/sửa" : "Không",
      organization:
        role === "pastor"
          ? "Toàn bộ: quản lý"
          : role === "secretary"
            ? "Toàn bộ: xem"
            : role === "ministry_lead"
              ? "Ban mình: xem"
              : "Không",
      dataExchange: role === "pastor" || role === "secretary" ? "Nhập/xuất có đối soát" : "Không",
      rites:
        role === "pastor" || role === "secretary" ? "Sổ lễ nghi và lớp dự bị: quản lý" : "Chưa mở",
      attendance:
        role === "pastor" || role === "secretary"
          ? "Toàn bộ: quản lý/điểm danh"
          : role === "ministry_lead"
            ? "Đơn vị được giao: điểm danh"
            : "Không",
      giving: "Chưa mở",
      expense: "Chưa mở",
      prayer: "Chưa mở",
    })),
  };
}
