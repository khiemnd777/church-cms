const oid = { bsonType: "objectId" },
  text = { bsonType: "string" },
  nullable = { bsonType: ["string", "null"] },
  date = { bsonType: "date" },
  bool = { bsonType: "bool" },
  integer = { bsonType: ["int", "long", "double"], minimum: 1, multipleOf: 1 };
const object = (properties: Record<string, unknown>) => ({
  bsonType: "object",
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
});
const snapshot = object({ kind: { enum: ["member", "family"] }, id: text, code: text, name: text });
const common = {
  _id: oid,
  churchId: oid,
  code: text,
  version: integer,
  targetKind: { enum: ["member", "family"] },
  targetId: oid,
  targetSnapshot: snapshot,
  targetNameKey: text,
  createdAt: date,
  updatedAt: date,
};
export const careSchemas = {
  care_signals: object({
    ...common,
    kind: { enum: ["new_believer", "illness", "bereavement"] },
    occurredOn: text,
    summary: nullable,
    state: { enum: ["open", "ended"] },
  }),
  care_alerts: object({
    ...common,
    kind: { enum: ["absence", "new_believer", "illness", "bereavement"] },
    state: { enum: ["pending", "linked", "dismissed", "expired"] },
    episodeActive: bool,
    availability: { enum: ["eligible", "unknown", "ineligible"] },
    evidence: {
      bsonType: "array",
      maxItems: 5,
      items: object({
        type: { enum: ["attendance", "belief", "signal"] },
        id: text,
        version: integer,
        day: text,
        summary: nullable,
      }),
    },
    caseId: { bsonType: ["objectId", "null"] },
    decisionReason: nullable,
    lastEvaluatedAt: date,
  }),
  care_history: object({
    _id: oid,
    churchId: oid,
    resourceKind: { enum: ["signal", "alert"] },
    resourceId: oid,
    event: text,
    before: { bsonType: ["object", "null"] },
    after: { bsonType: "object" },
    reason: nullable,
    actorId: oid,
    actorKind: { enum: ["owner", "church_user"] },
    operationId: oid,
    occurredAt: date,
  }),
  care_assessments: object({
    _id: oid,
    lastEvaluatedAt: date,
    lastCompleteAt: { bsonType: ["date", "null"] },
    complete: bool,
    context: text,
  }),
};
export const careIndexes: Record<
  string,
  {
    key: Record<string, 1 | -1>;
    name: string;
    unique?: boolean;
    partialFilterExpression?: Record<string, unknown>;
  }[]
> = {
  care_signals: [
    { key: { churchId: 1, code: 1 }, name: "care_signal_code_unique", unique: true },
    {
      key: { churchId: 1, targetKind: 1, targetId: 1, kind: 1 },
      name: "care_signal_open_unique",
      unique: true,
      partialFilterExpression: { state: "open" },
    },
    { key: { churchId: 1, state: 1, _id: 1 }, name: "care_signal_scan" },
    { key: { churchId: 1, _id: -1 }, name: "care_signal_page" },
  ],
  care_alerts: [
    { key: { churchId: 1, code: 1 }, name: "care_alert_code_unique", unique: true },
    {
      key: { churchId: 1, targetKind: 1, targetId: 1, kind: 1 },
      name: "care_episode_unique",
      unique: true,
      partialFilterExpression: { episodeActive: true },
    },
    { key: { churchId: 1, state: 1, _id: -1 }, name: "care_alert_state_page" },
    { key: { churchId: 1, _id: -1 }, name: "care_alert_page" },
    { key: { churchId: 1, episodeActive: 1, _id: 1 }, name: "care_alert_scan" },
  ],
  care_history: [
    { key: { churchId: 1, resourceKind: 1, resourceId: 1, _id: -1 }, name: "care_history_page" },
  ],
};
