const oid = { bsonType: "objectId" },
  text = { bsonType: "string" },
  date = { bsonType: "date" },
  integer = { bsonType: ["int", "long", "double"], minimum: 1, multipleOf: 1 },
  decimal = { bsonType: "decimal" };
const object = (properties: Record<string, unknown>) => ({
  bsonType: "object",
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
});
export const transactionSchemas = {
  finance_giving_codes: object({
    _id: oid,
    churchId: oid,
    memberId: oid,
    code: text,
    memberCode: text,
    memberName: text,
    status: { enum: ["active", "inactive"] },
    version: integer,
    writeFence: { ...integer, minimum: 0 },
    createdAt: date,
    updatedAt: date,
  }),
  finance_receipts: object({
    _id: oid,
    churchId: oid,
    code: text,
    submissionId: text,
    actorId: oid,
    payloadHash: text,
    businessDate: text,
    period: text,
    fundId: oid,
    fundName: text,
    sourceReference: text,
    purpose: text,
    mode: { enum: ["aggregate", "itemized"] },
    total: decimal,
    lines: {
      bsonType: "array",
      maxItems: 100,
      items: object({
        givingId: oid,
        givingCode: text,
        memberId: oid,
        memberCode: text,
        memberName: text,
        amount: decimal,
      }),
    },
    state: { enum: ["posted", "voided"] },
    version: integer,
    replacesReceiptId: { bsonType: ["objectId", "null"] },
    voidReason: { bsonType: ["string", "null"] },
    voidedAt: { bsonType: ["date", "null"] },
    createdAt: date,
  }),
  finance_periods: object({
    _id: text,
    churchId: oid,
    period: text,
    state: { enum: ["open", "closed"] },
    version: integer,
    writeFence: { ...integer, minimum: 0 },
  }),
  finance_ledger: {
    bsonType: "object",
    additionalProperties: false,
    required: [
      "_id",
      "churchId",
      "fundId",
      "fundName",
      "businessDate",
      "period",
      "kind",
      "amount",
      "occurredAt",
    ],
    properties: {
      _id: oid,
      churchId: oid,
      receiptId: oid,
      receiptCode: text,
      paymentId: oid,
      paymentCode: text,
      proposalId: oid,
      proposalCode: text,
      fundId: oid,
      fundName: text,
      businessDate: text,
      period: text,
      kind: { enum: ["receipt", "void", "payment", "payment_void"] },
      amount: decimal,
      occurredAt: date,
    },
    oneOf: [
      {
        required: ["receiptId", "receiptCode"],
        properties: { kind: { enum: ["receipt", "void"] } },
        not: {
          anyOf: [
            { required: ["paymentId"] },
            { required: ["paymentCode"] },
            { required: ["proposalId"] },
            { required: ["proposalCode"] },
          ],
        },
      },
      {
        required: ["paymentId", "paymentCode", "proposalId", "proposalCode"],
        properties: { kind: { enum: ["payment", "payment_void"] } },
        not: { anyOf: [{ required: ["receiptId"] }, { required: ["receiptCode"] }] },
      },
    ],
  },
};
type Index = {
  key: Record<string, 1 | -1>;
  name: string;
  unique?: boolean;
  partialFilterExpression?: Record<string, unknown>;
};
export const transactionIndexes: Record<string, Index[]> = {
  finance_giving_codes: [
    { key: { churchId: 1, memberId: 1 }, name: "finance_giving_member_unique", unique: true },
    { key: { churchId: 1, code: 1 }, name: "finance_giving_code_unique", unique: true },
    { key: { churchId: 1, status: 1, code: 1, _id: 1 }, name: "finance_giving_page" },
  ],
  finance_receipts: [
    { key: { churchId: 1, submissionId: 1 }, name: "finance_submission_unique", unique: true },
    { key: { churchId: 1, sourceReference: 1 }, name: "finance_source_unique", unique: true },
    { key: { churchId: 1, code: 1 }, name: "finance_receipt_code_unique", unique: true },
    {
      key: { churchId: 1, replacesReceiptId: 1 },
      name: "finance_replacement_unique",
      unique: true,
      partialFilterExpression: { replacesReceiptId: { $type: "objectId" } },
    },
    { key: { churchId: 1, businessDate: -1, _id: -1 }, name: "finance_receipt_page" },
    {
      key: { churchId: 1, fundId: 1, businessDate: -1, _id: -1 },
      name: "finance_receipt_fund_page",
    },
    {
      key: { churchId: 1, "lines.givingId": 1, businessDate: -1, _id: -1 },
      name: "finance_person_receipt_page",
    },
    {
      key: { churchId: 1, "lines.memberId": 1, period: 1, businessDate: -1, _id: -1 },
      name: "finance_self_receipt_page",
      partialFilterExpression: { mode: "itemized" },
    },
  ],
  finance_periods: [
    { key: { churchId: 1, period: 1 }, name: "finance_period_unique", unique: true },
  ],
  finance_ledger: [
    {
      key: { churchId: 1, receiptId: 1, kind: 1 },
      name: "finance_ledger_once",
      unique: true,
      partialFilterExpression: { receiptId: { $type: "objectId" } },
    },
    {
      key: { churchId: 1, paymentId: 1, kind: 1 },
      name: "finance_payment_ledger_once",
      unique: true,
      partialFilterExpression: { paymentId: { $type: "objectId" } },
    },
    { key: { churchId: 1, fundId: 1 }, name: "finance_book_fund" },
    { key: { churchId: 1, businessDate: -1, _id: -1 }, name: "finance_ledger_page" },
    {
      key: { churchId: 1, fundId: 1, businessDate: -1, _id: -1 },
      name: "finance_ledger_fund_page",
    },
  ],
};
