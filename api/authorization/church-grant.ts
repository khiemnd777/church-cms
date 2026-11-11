import type { ClientSession, ObjectId } from "mongodb";
import type { Role, Scope } from "../identity/accounts-model";
export interface ChurchGrant {
  actorId: ObjectId;
  churchId: ObjectId;
  role: Role;
  scope: Scope;
  version: number;
  require: (capability: string) => void;
  fence: (tx: ClientSession) => Promise<void>;
}
