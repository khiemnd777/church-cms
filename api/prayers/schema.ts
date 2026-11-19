const oid = { bsonType: "objectId" },
  text = { bsonType: "string" },
  nullable = { bsonType: ["string", "null"] },
  date = { bsonType: "date" };
const object = (properties: Record<string, unknown>) => ({
  bsonType: "object",
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
});
const request = object({
  _id: oid,
  churchId: oid,
  code: text,
  version: { bsonType: ["int", "long", "double"], minimum: 1, multipleOf: 1 },
  visibility: { enum: ["shared", "pastoral"] },
  state: { enum: ["open", "shared", "closed", "cancelled"] },
  content: { ...text, minLength: 1, maxLength: 2000 },
  contentKey: text,
  category: { enum: ["health", "family", "work", "church", "study", "thanksgiving", "other"] },
  receivedOn: nullable,
  requester: {
    oneOf: [
      object({ kind: { enum: ["none"] } }),
      object({ kind: { enum: ["member"] }, id: text }),
      object({ kind: { enum: ["text"] }, name: { ...text, minLength: 1, maxLength: 200 } }),
    ],
  },
  requesterSnapshot: object({
    kind: { enum: ["none", "member", "text"] },
    id: nullable,
    code: nullable,
    name: nullable,
  }),
  requesterNameKey: text,
  sharedOn: nullable,
  closeReason: nullable,
  closedAt: { bsonType: ["date", "null"] },
  createdAt: date,
  updatedAt: date,
});
export const prayerSchemas = {
  prayer_requests: {
    ...request,
    properties: {
      ...request.properties,
      portalSubmission: object({
        accountId: oid,
        memberId: oid,
        key: { ...text, pattern: "^[0-9a-f-]{36}$" },
        payloadHash: { ...text, pattern: "^[0-9a-f]{64}$" },
      }),
    },
    anyOf: [
      { not: { required: ["portalSubmission"] } },
      {
        required: ["portalSubmission"],
        properties: {
          visibility: { enum: ["pastoral"] },
          state: { enum: ["open", "closed", "cancelled"] },
          sharedOn: { bsonType: "null" },
          requester: { properties: { kind: { enum: ["member"] } } },
        },
      },
    ],
  },
  prayer_history: object({
    _id: oid,
    churchId: oid,
    prayerId: oid,
    event: { enum: ["create", "update", "correct", "share", "close", "cancel"] },
    operationId: oid,
    reason: nullable,
    before: { bsonType: ["object", "null"] },
    after: { bsonType: "object" },
    actorId: oid,
    actorKind: { enum: ["owner", "church_user"] },
    occurredAt: date,
  }),
};
export const prayerIndexes: Record<
  string,
  {
    key: Record<string, 1 | -1>;
    name: string;
    unique?: boolean;
    partialFilterExpression?: Record<string, unknown>;
  }[]
> = {
  prayer_requests: [
    { key: { churchId: 1, code: 1 }, name: "prayer_code_unique", unique: true },
    { key: { churchId: 1, visibility: 1, state: 1, _id: -1 }, name: "prayer_visible_state_page" },
    { key: { churchId: 1, visibility: 1, _id: -1 }, name: "prayer_visible_page" },
    { key: { churchId: 1, state: 1, _id: -1 }, name: "prayer_state_page" },
    { key: { churchId: 1, _id: -1 }, name: "prayer_page" },
    {
      key: { churchId: 1, "portalSubmission.accountId": 1, "portalSubmission.key": 1 },
      name: "prayer_portal_submission_unique",
      unique: true,
      partialFilterExpression: { "portalSubmission.key": { $exists: true } },
    },
    {
      key: {
        churchId: 1,
        "portalSubmission.accountId": 1,
        "portalSubmission.memberId": 1,
        _id: -1,
      },
      name: "prayer_portal_personal_page",
      partialFilterExpression: { visibility: "pastoral" },
    },
  ],
  prayer_history: [{ key: { churchId: 1, prayerId: 1, _id: -1 }, name: "prayer_history_page" }],
};
