const oid = { bsonType: "objectId" },
  date = { bsonType: "date" },
  text = { bsonType: "string" },
  nullable = { bsonType: ["string", "null"] },
  integer = { bsonType: ["int", "long", "double"], minimum: 0, multipleOf: 1 };
const object = (properties: Record<string, unknown>) => ({
  bsonType: "object",
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
});
const input = object({
  label: { ...text, minLength: 1, maxLength: 200 },
  kind: { enum: ["worship", "activity"] },
  scope: { enum: ["church", "unit"] },
  unitId: nullable,
  day: text,
  startTime: text,
  endDay: text,
  endTime: text,
  location: nullable,
  scripture: nullable,
  theme: nullable,
  speaker: {
    oneOf: [
      object({ source: { enum: ["member"] }, memberId: text }),
      object({ source: { enum: ["external"] }, fullName: text }),
      { bsonType: "null" },
    ],
  },
  leaderId: nullable,
  choirId: nullable,
  communion: { bsonType: "bool" },
  repeat: {
    oneOf: [
      object({ kind: { enum: ["once"] } }),
      object({
        kind: { enum: ["weekly"] },
        interval: { ...integer, minimum: 1, maximum: 4 },
        weekdays: {
          bsonType: "array",
          minItems: 1,
          maxItems: 7,
          uniqueItems: true,
          items: { ...integer, maximum: 6 },
        },
        until: text,
      }),
      object({
        kind: { enum: ["monthly"] },
        weekday: { ...integer, maximum: 6 },
        ordinals: {
          bsonType: "array",
          minItems: 1,
          maxItems: 5,
          uniqueItems: true,
          items: { ...integer, minimum: 1, maximum: 5 },
        },
        until: text,
      }),
    ],
  },
});
export const scheduleSchemas = {
  schedule_state: object({ _id: oid, revision: integer }),
  schedule_series: object({
    _id: oid,
    churchId: oid,
    generation: { ...integer, minimum: 1 },
    version: { ...integer, minimum: 1 },
    input,
    createdAt: date,
    updatedAt: date,
  }),
  schedule_occurrences: object({
    _id: oid,
    churchId: oid,
    seriesId: oid,
    generation: { ...integer, minimum: 1 },
    slot: text,
    input,
    startAt: date,
    endAt: date,
    state: { enum: ["draft", "scheduled", "cancelled"] },
    unitName: nullable,
    speakerName: nullable,
    leaderName: nullable,
    choirName: nullable,
    memberIds: { bsonType: "array", maxItems: 2, uniqueItems: true, items: oid },
    version: { ...integer, minimum: 1 },
    exception: { bsonType: "bool" },
    superseded: { bsonType: "bool" },
    programFence: integer,
    createdAt: date,
    updatedAt: date,
  }),
  schedule_history: object({
    _id: oid,
    churchId: oid,
    occurrenceId: oid,
    operationId: oid,
    event: text,
    before: { bsonType: ["object", "null"] },
    after: { bsonType: "object" },
    reason: nullable,
    actorId: oid,
    actorKind: { enum: ["owner", "church_user"] },
    occurredAt: date,
  }),
};
export const scheduleIndexes: Record<
  string,
  { key: Record<string, 1 | -1>; name: string; unique?: boolean }[]
> = {
  schedule_state: [],
  schedule_series: [{ key: { churchId: 1, _id: 1 }, name: "schedule_series_tenant" }],
  schedule_occurrences: [
    {
      key: { churchId: 1, seriesId: 1, superseded: 1, state: 1, slot: 1 },
      name: "schedule_future",
    },
    { key: { churchId: 1, startAt: 1, _id: 1 }, name: "schedule_page" },
    {
      key: { churchId: 1, seriesId: 1, generation: 1, slot: 1 },
      name: "schedule_slot_unique",
      unique: true,
    },
    { key: { churchId: 1, memberIds: 1, startAt: 1 }, name: "schedule_people_time" },
    { key: { churchId: 1, "input.choirId": 1, startAt: 1 }, name: "schedule_choir_time" },
    {
      key: { churchId: 1, "input.unitId": 1, state: 1, startAt: 1, _id: 1 },
      name: "schedule_unit_time",
    },
  ],
  schedule_history: [
    {
      key: { churchId: 1, occurrenceId: 1, occurredAt: -1, _id: -1 },
      name: "schedule_history_page",
    },
  ],
};

// Additive fence for Programs; legacy P4.1 rows remain valid until explicitly maintained.
scheduleSchemas.schedule_occurrences.required =
  scheduleSchemas.schedule_occurrences.required.filter((k) => k !== "programFence");
