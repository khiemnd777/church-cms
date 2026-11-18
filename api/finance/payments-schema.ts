import { expenseDecisionSchema } from "./expenses-schema";

const oid = { bsonType: "objectId" },
  text = { bsonType: "string" };
const props = {
  _id: oid,
  churchId: oid,
  code: text,
  proposalId: oid,
  proposalCode: text,
  proposalVersion: { enum: [2] },
  contentHash: text,
  submissionId: text,
  payloadHash: text,
  actorId: oid,
  actorName: text,
  businessDate: text,
  period: text,
  fundId: oid,
  fundName: text,
  fundNameAtPayment: text,
  amount: { bsonType: "decimal" },
  purpose: { ...text, minLength: 1, maxLength: 500 },
  decision: expenseDecisionSchema,
  createdAt: { bsonType: "date" },
  version: { enum: [1, 2] },
  state: { enum: ["posted", "voided"] },
  voidReason: { ...text, minLength: 1, maxLength: 500 },
  voidedAt: { bsonType: "date" },
  voidedBy: oid,
  voidedName: text,
  voidHash: text,
};
export const paymentSchemas = {
  finance_payments: {
    bsonType: "object",
    additionalProperties: false,
    required: Object.keys(props).filter(
      (k) => !["state", "voidReason", "voidedAt", "voidedBy", "voidedName", "voidHash"].includes(k),
    ),
    properties: props,
  },
};
export const paymentIndexes: Record<
  string,
  { key: Record<string, 1 | -1>; name: string; unique?: boolean }[]
> = {
  finance_payments: [
    { key: { churchId: 1, proposalId: 1 }, name: "payment_proposal_unique", unique: true },
    { key: { churchId: 1, submissionId: 1 }, name: "payment_submission_unique", unique: true },
    { key: { churchId: 1, businessDate: -1, _id: -1 }, name: "payment_period_page" },
    { key: { churchId: 1, code: 1 }, name: "payment_code_unique", unique: true },
  ],
};
