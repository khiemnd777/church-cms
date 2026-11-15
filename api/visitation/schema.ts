const oid = { bsonType: "objectId" },
  text = { bsonType: "string" },
  nullable = { bsonType: ["string", "null"] },
  date = { bsonType: "date" },
  integer = { bsonType: ["int", "long", "double"], minimum: 0, multipleOf: 1 };
const object = (properties: Record<string, unknown>) => ({
  bsonType: "object",
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
});
const person = object({ id: text, code: text, fullName: text });
const snapshot = object({
  kind: { enum: ["member", "family"] },
  id: text,
  code: text,
  name: text,
  phone: nullable,
  familyId: nullable,
  familyCode: nullable,
  familyName: nullable,
  address: nullable,
});
export const visitationSchemas = {
  visitation_cases: object({
    _id: oid,
    churchId: oid,
    code: text,
    version: { ...integer, minimum: 1 },
    state: { enum: ["open", "completed", "cancelled"] },
    targetKind: { enum: ["member", "family"] },
    targetId: oid,
    targetSnapshot: snapshot,
    targetNameKey: text,
    reasonCode: { enum: ["absence", "illness", "new_believer", "bereavement", "other"] },
    description: { ...text, minLength: 1, maxLength: 2000 },
    priority: { enum: ["normal", "high"] },
    plannedOn: nullable,
    assigneeId: { bsonType: ["objectId", "null"] },
    assigneeSnapshot: { oneOf: [person, { bsonType: "null" }] },
    entryCount: integer,
    visitedCount: integer,
    closeReason: nullable,
    closedAt: { bsonType: ["date", "null"] },
    createdAt: date,
    updatedAt: date,
  }),
  visitation_entries: object({
    _id: oid,
    churchId: oid,
    caseId: oid,
    version: { ...integer, minimum: 1 },
    visitedOn: text,
    participantIds: { bsonType: "array", minItems: 1, maxItems: 10, uniqueItems: true, items: oid },
    participants: { bsonType: "array", minItems: 1, maxItems: 10, items: person },
    outcome: { enum: ["visited", "not_met", "declined"] },
    note: { ...text, minLength: 1, maxLength: 2000 },
    targetSnapshot: snapshot,
    createdAt: date,
    updatedAt: date,
  }),
  visitation_history: object({
    _id: oid,
    churchId: oid,
    caseId: oid,
    entryId: { bsonType: ["objectId", "null"] },
    event: { enum: ["create", "update", "record", "correct", "complete", "cancel"] },
    operationId: oid,
    reason: nullable,
    before: { bsonType: ["object", "null"] },
    after: { bsonType: "object" },
    actorId: oid,
    actorKind: { enum: ["owner", "church_user"] },
    occurredAt: date,
  }),
};
export const visitationIndexes: Record<
  string,
  {
    key: Record<string, 1 | -1>;
    name: string;
    unique?: boolean;
    partialFilterExpression?: Record<string, unknown>;
  }[]
> = {
  visitation_cases: [
    {
      key: { churchId: 1, targetKind: 1, targetId: 1, reasonCode: 1 },
      name: "visitation_open_unique",
      unique: true,
      partialFilterExpression: { state: "open" },
    },
    { key: { churchId: 1, code: 1 }, name: "visitation_code_unique", unique: true },
    { key: { churchId: 1, state: 1, _id: -1 }, name: "visitation_state_page" },
    { key: { churchId: 1, _id: -1 }, name: "visitation_page" },
    { key: { churchId: 1, targetNameKey: 1, _id: -1 }, name: "visitation_name" },
    { key: { churchId: 1, state: 1, assigneeId: 1, _id: -1 }, name: "visitation_assignee" },
    { key: { churchId: 1, state: 1, plannedOn: 1, _id: -1 }, name: "visitation_planned" },
  ],
  visitation_entries: [{ key: { churchId: 1, caseId: 1, _id: -1 }, name: "visitation_entry_page" }],
  visitation_history: [
    { key: { churchId: 1, caseId: 1, _id: -1 }, name: "visitation_history_page" },
  ],
};
