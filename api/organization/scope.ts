import type { ClientSession, ObjectId } from "mongodb";
import type { Scope } from "../identity/accounts-model";
// Public Identity -> Organization contract; supplied by composition root.
export interface UnitScopeValidator {
  validateScope(churchId: ObjectId, scope: Scope, tx: ClientSession): Promise<void>;
}
