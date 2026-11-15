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
const assignment = {
  oneOf: [
    object({ mode: { enum: ["member"] }, memberId: text }),
    object({ mode: { enum: ["unassigned"] } }),
    object({ mode: { enum: ["not_applicable"] } }),
  ],
};
const row = object({
  id: text,
  templateKey: {
    enum: ["guide", "praise", "opening", "word", "discussion", "notices", "closing", null],
  },
  title: { ...text, minLength: 1, maxLength: 200 },
  detail: { ...text, maxLength: 1000 },
  assignment,
});
const rows = { bsonType: "array", minItems: 1, maxItems: 50, items: row };
const people = {
  bsonType: "array",
  maxItems: 50,
  items: object({ id: text, code: text, fullName: text }),
};
const snapshot = object({
  churchName: text,
  unitName: text,
  label: text,
  startAt: text,
  endAt: text,
  location: nullable,
  scripture: nullable,
  theme: nullable,
  sourceVersion: integer,
  sourceAvailable: { bsonType: "bool" },
  termLabel: nullable,
  capturedAt: text,
});
export const programSchemas = {
  program_drafts: object({
    _id: oid,
    churchId: oid,
    unitId: oid,
    occurrenceId: oid,
    version: { ...integer, minimum: 1 },
    state: { enum: ["draft", "finalized"] },
    rows,
    baseline: rows,
    people,
    snapshot,
    latestRevision: integer,
    latestEditionId: { bsonType: ["objectId", "null"] },
    createdAt: date,
    updatedAt: date,
  }),
  program_editions: object({
    _id: oid,
    churchId: oid,
    programId: oid,
    unitId: oid,
    occurrenceId: oid,
    revision: { ...integer, minimum: 1 },
    rows,
    people,
    snapshot,
    reason: nullable,
    templateVersion: { enum: ["P42-r1"] },
    actorId: oid,
    actorKind: { enum: ["owner", "church_user"] },
    createdAt: date,
  }),
  program_history: object({
    _id: oid,
    churchId: oid,
    programId: oid,
    operationId: oid,
    event: { enum: ["create", "save", "regenerate", "amend", "finalize"] },
    reason: nullable,
    before: { bsonType: ["object", "null"] },
    after: { bsonType: "object" },
    actorId: oid,
    actorKind: { enum: ["owner", "church_user"] },
    occurredAt: date,
  }),
};
export const programIndexes: Record<
  string,
  { key: Record<string, 1 | -1>; name: string; unique?: boolean }[]
> = {
  program_drafts: [
    {
      key: { churchId: 1, unitId: 1, occurrenceId: 1 },
      name: "program_occurrence_unique",
      unique: true,
    },
    { key: { churchId: 1, unitId: 1, _id: -1 }, name: "program_unit_page" },
    { key: { churchId: 1, _id: -1 }, name: "program_page" },
  ],
  program_editions: [
    {
      key: { churchId: 1, programId: 1, revision: 1 },
      name: "program_edition_unique",
      unique: true,
    },
    { key: { churchId: 1, programId: 1, _id: -1 }, name: "program_edition_page" },
  ],
  program_history: [{ key: { churchId: 1, programId: 1, _id: -1 }, name: "program_history_page" }],
};
