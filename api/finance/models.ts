import type { ObjectId } from "mongodb";
import type { TenantGrant } from "../authorization/tenant-grant";
import type { FinanceSettingsInput } from "./validation";

// Created only by authenticated church transport, never from client fields.
export interface FinanceGrant extends TenantGrant {
  financeRole: "pastor" | "treasurer";
  actorName: string;
}
interface Stamps {
  version: number;
  createdAt: Date;
  updatedAt: Date;
}
export interface FinanceSettings extends FinanceSettingsInput, Stamps {
  expenseWriteFence?: number;
  _id: ObjectId; // singleton per church
}
export interface Fund extends Stamps {
  financeWriteFence?: number;
  _id: ObjectId;
  churchId: ObjectId;
  name: string;
  nameKey: string;
  status: "active" | "inactive";
}
export interface FinanceHistory {
  _id: ObjectId;
  churchId: ObjectId;
  targetType:
    | "settings"
    | "fund"
    | "giving_code"
    | "receipt"
    | "expense_proposal"
    | "payment"
    | "period_closure";
  targetId: ObjectId;
  event:
    | "initialized"
    | "configured"
    | "created"
    | "renamed"
    | "status_changed"
    | "posted"
    | "voided"
    | "submitted"
    | "approved"
    | "rejected"
    | "paid"
    | "payment_voided"
    | "closed";
  actorId: ObjectId;
  actorName: string;
  operationId: ObjectId;
  occurredAt: Date;
  reason: string | null;
  before: object | null;
  after: object;
}
export const settingsDto = (s: FinanceSettings) => ({
  version: s.version,
  proposerRoles: s.proposerRoles,
  approverRole: s.approverRole,
  createdAt: s.createdAt.toISOString(),
  updatedAt: s.updatedAt.toISOString(),
});
export const fundDto = (f: Fund) => ({
  id: f._id.toHexString(),
  version: f.version,
  name: f.name,
  status: f.status,
  createdAt: f.createdAt.toISOString(),
  updatedAt: f.updatedAt.toISOString(),
});
