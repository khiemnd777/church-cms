import type { Decimal128, ObjectId } from "mongodb";
export interface GivingCode {
  _id: ObjectId;
  churchId: ObjectId;
  memberId: ObjectId;
  code: string;
  memberCode: string;
  memberName: string;
  status: "active" | "inactive";
  version: number;
  writeFence: number;
  createdAt: Date;
  updatedAt: Date;
}
export interface ReceiptLine {
  givingId: ObjectId;
  givingCode: string;
  memberId: ObjectId;
  memberCode: string;
  memberName: string;
  amount: Decimal128;
}
export interface Receipt {
  _id: ObjectId;
  churchId: ObjectId;
  code: string;
  submissionId: string;
  actorId: ObjectId;
  payloadHash: string;
  businessDate: string;
  period: string;
  fundId: ObjectId;
  fundName: string;
  sourceReference: string;
  purpose: string;
  mode: "aggregate" | "itemized";
  total: Decimal128;
  lines: ReceiptLine[];
  state: "posted" | "voided";
  version: number;
  replacesReceiptId: ObjectId | null;
  voidReason: string | null;
  voidedAt: Date | null;
  createdAt: Date;
}
export interface FinancePeriod {
  _id: string;
  churchId: ObjectId;
  period: string;
  state: "open" | "closed";
  version: number;
  writeFence: number;
}
export interface LedgerEntry {
  _id: ObjectId;
  churchId: ObjectId;
  receiptId?: ObjectId;
  receiptCode?: string;
  paymentId?: ObjectId;
  paymentCode?: string;
  proposalId?: ObjectId;
  proposalCode?: string;
  fundId: ObjectId;
  fundName: string;
  businessDate: string;
  period: string;
  kind: "receipt" | "void" | "payment" | "payment_void";
  amount: Decimal128;
  occurredAt: Date;
}
