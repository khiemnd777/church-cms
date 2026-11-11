import type { ClientSession, ObjectId } from "mongodb";
// Only Identity constructs grants after checking the current owner realm/session/capability.
// Callers receive a commit-time fence, never credential/session documents or password hashes.
export interface OwnerGrant {
  actorId: ObjectId;
  fence: (tx: ClientSession) => Promise<void>;
}
