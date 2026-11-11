import type { ClientSession, ObjectId } from "mongodb";
// Public identity-facing contract: no collection handle or credential crosses this boundary.
export interface ChurchAccessInfo {
  id: ObjectId;
  code: string;
  name: string;
  status: "active" | "suspended";
  version: number;
}
export interface ChurchAccess {
  byCode(code: string): Promise<ChurchAccessInfo | null>;
  byId(id: ObjectId): Promise<ChurchAccessInfo | null>;
  fence(id: ObjectId, tx: ClientSession, activeOnly: boolean): Promise<void>;
}
