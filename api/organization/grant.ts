import type { ClientSession, ObjectId } from "mongodb";
// Constructed only at the authenticated HTTP boundary. Never supplied from a request body.
export interface OrganizationGrant {
  actorKind: "owner" | "church_user";
  actorId: ObjectId;
  churchId: ObjectId;
  policyContext: string;
  canWrite: boolean;
  fence: (tx: ClientSession) => Promise<void>;
}
