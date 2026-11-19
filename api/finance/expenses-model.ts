import type { Binary, Decimal128, ObjectId } from "mongodb";
import type { TenantGrant } from "../authorization/tenant-grant";
import type { Role } from "../identity/accounts-model";
import type { ExpenseImageType } from "./expense-image";
export interface ExpenseAttachment {
  _id: ObjectId;
  churchId: ObjectId;
  actorId: ObjectId;
  bytes: Binary;
  type: ExpenseImageType;
  hash: string;
  expiresAt?: Date;
  proposalId?: ObjectId;
}
export interface ExpenseGrant extends TenantGrant {
  role: Role;
  actorName: string;
}
export interface ExpenseDecision {
  actorId: ObjectId;
  actorName: string;
  actorRole: Role;
  action: "approved" | "rejected";
  reason: string;
  decidedAt: Date;
  settingsVersion: number;
  fundVersion: number;
  contentHash: string;
  proposalVersion: number;
}
export interface ExpenseProposal {
  _id: ObjectId;
  churchId: ObjectId;
  code: string;
  submissionId: string;
  payloadHash: string;
  contentHash: string;
  createdBy: ObjectId;
  creatorName: string;
  creatorRole: Role;
  businessDate: string;
  fundId: ObjectId;
  fundName: string;
  fundVersion: number;
  amount: Decimal128;
  purpose: string;
  settingsVersion: number;
  approverRole: Role;
  approvalBand?: "below" | "at_or_above";
  attachment?: { id: ObjectId; hash: string };
  payment?: { id: ObjectId; code: string; businessDate: string; voidedAt?: Date };
  state: "pending" | "approved" | "rejected" | "paid" | "payment_voided";
  version: number;
  createdAt: Date;
  decision: ExpenseDecision | null;
}
