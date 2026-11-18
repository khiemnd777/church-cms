const oid = { bsonType: "objectId" },
  text = { bsonType: "string" },
  integer = { bsonType: ["int", "long", "double"], minimum: 0, multipleOf: 1 },
  month = { ...text, pattern: "^(?!0000)[0-9]{4}-(0[1-9]|1[0-2])$" };
const object = (properties: Record<string, unknown>) => ({
  bsonType: "object",
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
});
const money = { ...text, pattern: "^-?[0-9]+$" };
export const periodSchemas = {
  finance_book_controls: object({
    _id: oid,
    closedThrough: { anyOf: [month, { bsonType: "null" }] },
    version: { ...integer, minimum: 1 },
    writeFence: integer,
  }),
  finance_period_closures: object({
    _id: oid,
    churchId: oid,
    code: text,
    throughPeriod: month,
    previousClosedThrough: { anyOf: [month, { bsonType: "null" }] },
    version: { enum: [1] },
    controlVersion: { ...integer, minimum: 2 },
    submissionId: text,
    payloadHash: text,
    actorId: oid,
    actorName: text,
    reason: { ...text, minLength: 1, maxLength: 500 },
    occurredAt: { bsonType: "date" },
    summary: object({
      netIncome: money,
      netExpense: money,
      openingBalance: money,
      closingBalance: money,
      rangeNetIncome: money,
      rangeNetExpense: money,
      ledgerCount: integer,
      rangeLedgerCount: integer,
      maxLedgerId: { bsonType: ["string", "null"] },
    }),
  }),
};
export const periodIndexes: Record<
  string,
  { key: Record<string, 1 | -1>; name: string; unique?: boolean }[]
> = {
  finance_period_closures: [
    { key: { churchId: 1, throughPeriod: 1 }, name: "finance_closure_period_unique", unique: true },
    {
      key: { churchId: 1, submissionId: 1 },
      name: "finance_closure_submission_unique",
      unique: true,
    },
    { key: { churchId: 1, code: 1 }, name: "finance_closure_code_unique", unique: true },
    { key: { churchId: 1, occurredAt: -1, _id: -1 }, name: "finance_closure_page" },
  ],
};
