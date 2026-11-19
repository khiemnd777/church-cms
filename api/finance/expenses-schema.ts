const oid = { bsonType: "objectId" },
  text = { bsonType: "string" },
  date = { bsonType: "date" },
  integer = { bsonType: ["int", "long", "double"], minimum: 1, multipleOf: 1 };
const object = (properties: Record<string, unknown>) => ({
  bsonType: "object",
  additionalProperties: false,
  required: Object.keys(properties).filter(
    (k) =>
      !["payment", "voidedAt", "attachment", "expiresAt", "proposalId", "approvalBand"].includes(k),
  ),
  properties,
});
export const expenseDecisionSchema = object({
  actorId: oid,
  actorName: text,
  actorRole: { enum: ["pastor", "secretary", "treasurer"] },
  action: { enum: ["approved", "rejected"] },
  reason: { ...text, maxLength: 500 },
  decidedAt: date,
  settingsVersion: integer,
  fundVersion: integer,
  contentHash: text,
  proposalVersion: integer,
});
const sha256 = { ...text, pattern: "^[a-f0-9]{64}$" };
export const expenseSchemas = {
  finance_expense_attachments: {
    ...object({
      _id: oid,
      churchId: oid,
      actorId: oid,
      bytes: { bsonType: "binData" },
      type: { enum: ["image/jpeg", "image/png"] },
      hash: sha256,
      expiresAt: date,
      proposalId: oid,
    }),
    oneOf: [{ required: ["expiresAt"] }, { required: ["proposalId"] }],
  },
  finance_expense_proposals: object({
    _id: oid,
    churchId: oid,
    code: text,
    submissionId: text,
    payloadHash: text,
    contentHash: text,
    createdBy: oid,
    creatorName: text,
    creatorRole: { enum: ["pastor", "secretary", "treasurer", "ministry_lead"] },
    businessDate: text,
    fundId: oid,
    fundName: text,
    fundVersion: integer,
    amount: { bsonType: "decimal" },
    purpose: { ...text, minLength: 1, maxLength: 500 },
    settingsVersion: integer,
    approverRole: { enum: ["pastor", "secretary", "treasurer"] },
    approvalBand: { enum: ["below", "at_or_above"] },
    attachment: object({ id: oid, hash: sha256 }),
    payment: object({ id: oid, code: text, businessDate: text, voidedAt: date }),
    state: { enum: ["pending", "approved", "rejected", "paid", "payment_voided"] },
    version: integer,
    createdAt: date,
    decision: {
      anyOf: [{ bsonType: "null" }, expenseDecisionSchema],
    },
  }),
};
export const expenseIndexes: Record<
  string,
  {
    key: Record<string, 1 | -1>;
    name: string;
    unique?: boolean;
    expireAfterSeconds?: number;
    partialFilterExpression?: Record<string, unknown>;
  }[]
> = {
  finance_expense_attachments: [
    { key: { expiresAt: 1 }, name: "expense_attachment_expiry", expireAfterSeconds: 0 },
  ],
  finance_expense_proposals: [
    { key: { churchId: 1, submissionId: 1 }, name: "expense_submission_unique", unique: true },
    { key: { churchId: 1, code: 1 }, name: "expense_code_unique", unique: true },
    { key: { churchId: 1, businessDate: -1, _id: -1 }, name: "expense_page" },
    { key: { churchId: 1, createdBy: 1, businessDate: -1, _id: -1 }, name: "expense_own_page" },
    {
      key: { churchId: 1, approverRole: 1, state: 1, businessDate: -1, _id: -1 },
      name: "expense_review_page",
      partialFilterExpression: { approvalBand: { $exists: true } },
    },
    { key: { churchId: 1, fundId: 1, businessDate: -1, _id: -1 }, name: "expense_fund_page" },
  ],
};
