import type { ObjectId } from "mongodb";
export interface BookControl {
  _id: ObjectId;
  closedThrough: string | null;
  version: number;
  writeFence: number;
}
export interface BookSummary {
  netIncome: string;
  netExpense: string;
  openingBalance: string;
  closingBalance: string;
  rangeNetIncome: string;
  rangeNetExpense: string;
  ledgerCount: number;
  rangeLedgerCount: number;
  maxLedgerId: string | null;
}
export interface PeriodClosure {
  _id: ObjectId;
  churchId: ObjectId;
  code: string;
  throughPeriod: string;
  previousClosedThrough: string | null;
  version: number;
  controlVersion: number;
  submissionId: string;
  payloadHash: string;
  actorId: ObjectId;
  actorName: string;
  reason: string;
  occurredAt: Date;
  summary: BookSummary;
}
