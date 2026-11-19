const oid = { bsonType: "objectId" },
  date = { bsonType: "date" },
  text = { bsonType: "string" };
const object = (properties: Record<string, unknown>) => ({
  required: Object.keys(properties).filter(
    (k) => !["financeWriteFence", "expenseWriteFence", "approvalThreshold"].includes(k),
  ),
  additionalProperties: false,
  properties,
});
const stamps = {
  version: { bsonType: ["int", "long", "double"], minimum: 1, multipleOf: 1 },
  createdAt: date,
  updatedAt: date,
};
export const financeSchemas = {
  finance_settings: object({
    expenseWriteFence: { bsonType: ["int", "long", "double"], minimum: 0, multipleOf: 1 },
    _id: oid,
    ...stamps,
    proposerRoles: {
      bsonType: "array",
      maxItems: 3,
      uniqueItems: true,
      items: { enum: ["secretary", "treasurer", "ministry_lead"] },
    },
    approverRole: { enum: ["pastor", "secretary", "treasurer"] },
    approvalThreshold: {
      anyOf: [
        { bsonType: "null" },
        {
          bsonType: "object",
          ...object({
            amount: { ...text, pattern: "^[1-9][0-9]{0,17}$" },
            belowRole: { enum: ["pastor", "secretary", "treasurer"] },
            atOrAboveRole: { enum: ["pastor", "secretary", "treasurer"] },
          }),
        },
      ],
    },
  }),
  finance_funds: object({
    _id: oid,
    churchId: oid,
    ...stamps,
    name: { ...text, minLength: 1, maxLength: 100 },
    nameKey: { ...text, minLength: 1, maxLength: 100 },
    status: { enum: ["active", "inactive"] },
    financeWriteFence: { bsonType: ["int", "long", "double"], minimum: 0, multipleOf: 1 },
  }),
  finance_history: object({
    _id: oid,
    churchId: oid,
    targetType: {
      enum: [
        "settings",
        "fund",
        "giving_code",
        "receipt",
        "expense_proposal",
        "payment",
        "period_closure",
      ],
    },
    targetId: oid,
    event: {
      enum: [
        "initialized",
        "configured",
        "created",
        "renamed",
        "status_changed",
        "posted",
        "voided",
        "submitted",
        "approved",
        "rejected",
        "paid",
        "payment_voided",
        "closed",
      ],
    },
    actorId: oid,
    actorName: { ...text, minLength: 1, maxLength: 200 },
    operationId: oid,
    occurredAt: date,
    reason: { bsonType: ["string", "null"] },
    before: { bsonType: ["object", "null"] },
    after: { bsonType: "object" },
  }),
};
export const financeIndexes: Record<
  string,
  { key: Record<string, 1 | -1>; name: string; unique?: boolean }[]
> = {
  finance_funds: [
    { key: { churchId: 1, nameKey: 1, _id: 1 }, name: "finance_fund_page" },
    { key: { churchId: 1, status: 1, nameKey: 1, _id: 1 }, name: "finance_fund_status_page" },
    { key: { churchId: 1, nameKey: 1 }, name: "finance_fund_name_unique", unique: true },
  ],
  finance_history: [
    { key: { churchId: 1, targetType: 1, targetId: 1, _id: -1 }, name: "finance_history_page" },
  ],
};
