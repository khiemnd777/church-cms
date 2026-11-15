import type { ClientSession, ObjectId } from "mongodb";
// Identity-backed, request-scoped authority; constructed only by authenticated transport.
export interface TenantGrant {
  canReadCare?: boolean;
  canManageCare?: boolean;
  actorKind: "owner" | "church_user";
  actorId: ObjectId;
  churchId: ObjectId;
  policyContext: string;
  canWrite: boolean;
  canReadAttendance?: boolean;
  prayerAudience?: "shared" | "all";
  unitScope?: readonly string[];
  canManageMemberships?: boolean;
  receiptScope?: "memberships";
  fence: (tx: ClientSession) => Promise<void>;
}
