const oid = { bsonType: "objectId" },
  text = { bsonType: "string" },
  nullableText = { bsonType: ["string", "null"] },
  date = { bsonType: "date" },
  number = { bsonType: ["int", "long", "double"], minimum: 0, multipleOf: 1 };
const object = (properties: Record<string, unknown>) => ({
  bsonType: "object",
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
});
const person = {
  oneOf: [
    object({ source: { enum: ["member"] }, memberId: text }),
    object({ source: { enum: ["external"] }, fullName: text, birthDate: nullableText }),
  ],
};
const linked = object({ source: { enum: ["member"] }, memberId: text });
const optionalPerson = { anyOf: [person, { bsonType: "null" }] };
const payload = {
  oneOf: [
    object({
      kind: { enum: ["baptism"] },
      person: linked,
      officiant: optionalPerson,
      place: nullableText,
    }),
    object({
      kind: { enum: ["dedication"] },
      child: linked,
      parents: {
        bsonType: "array",
        maxItems: 20,
        items: object({ role: { enum: ["father", "mother", "guardian"] }, person }),
      },
      officiant: optionalPerson,
      place: nullableText,
    }),
    object({
      kind: { enum: ["marriage"] },
      groom: person,
      bride: person,
      officiant: optionalPerson,
      place: nullableText,
      announcements: {
        bsonType: "array",
        maxItems: 100,
        items: object({
          date: text,
          state: { enum: ["planned", "announced", "cancelled"] },
          note: nullableText,
        }),
      },
    }),
    object({
      kind: { enum: ["funeral"] },
      person: linked,
      deathOn: nullableText,
      age: { ...number, bsonType: ["int", "long", "double", "null"] },
      place: nullableText,
    }),
    object({
      kind: { enum: ["communion"] },
      officiant: optionalPerson,
      place: nullableText,
      count: { ...number, bsonType: ["int", "long", "double", "null"] },
    }),
  ],
};
export const riteSchemas = {
  rite_records: object({
    _id: oid,
    churchId: oid,
    kind: { enum: ["baptism", "dedication", "marriage", "funeral", "communion"] },
    input: object({
      payload,
      date: nullableText,
      historical: { bsonType: "bool" },
      note: nullableText,
    }),
    people: {
      bsonType: "array",
      maxItems: 24,
      items: object({
        source: { enum: ["member", "external"] },
        memberId: nullableText,
        fullName: text,
        birthDate: nullableText,
        code: nullableText,
        version: { ...number, bsonType: ["int", "long", "double", "null"] },
      }),
    },
    memberIds: { bsonType: "array", maxItems: 24, items: oid },
    subjectMemberId: { bsonType: ["objectId", "null"] },
    searchTokens: { bsonType: "array", items: text },
    state: { enum: ["draft", "planned", "recorded", "void"] },
    writeFence: number,
    version: { ...number, minimum: 1 },
    recordedAt: { bsonType: ["date", "null"] },
    createdAt: date,
    updatedAt: date,
  }),
  rite_history: object({
    _id: oid,
    churchId: oid,
    riteId: oid,
    event: text,
    before: { bsonType: ["object", "null"] },
    after: { bsonType: "object" },
    reason: nullableText,
    actorId: oid,
    actorKind: { enum: ["owner", "church_user"] },
    operationId: oid,
    occurredAt: date,
  }),
};
export const riteIndexes: Record<
  string,
  {
    key: Record<string, 1 | -1>;
    name: string;
    unique?: boolean;
    partialFilterExpression?: object;
  }[]
> = {
  rite_records: [
    { key: { churchId: 1, kind: 1, "input.date": -1, _id: -1 }, name: "rites_page" },
    { key: { churchId: 1, memberIds: 1, "input.date": -1, _id: -1 }, name: "rites_member" },
    { key: { churchId: 1, kind: 1, state: 1, "input.date": 1, _id: 1 }, name: "rites_next" },
    {
      key: { churchId: 1, subjectMemberId: 1 },
      name: "rites_baptism_current",
      unique: true,
      partialFilterExpression: { kind: "baptism", state: "recorded" },
    },
  ],
  rite_history: [
    { key: { churchId: 1, riteId: 1, occurredAt: -1, _id: -1 }, name: "rites_history" },
  ],
};

riteSchemas.rite_records.required = riteSchemas.rite_records.required.filter(
  (k) => k !== "writeFence",
);
