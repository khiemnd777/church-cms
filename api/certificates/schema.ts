const oid = { bsonType: "objectId" },
  nullableId = { bsonType: ["objectId", "null"] },
  text = { bsonType: "string" },
  nullableText = { bsonType: ["string", "null"] },
  date = { bsonType: "date" },
  integer = { bsonType: ["int", "long", "double"], minimum: 1, multipleOf: 1 },
  object = { bsonType: "object" },
  pages = { bsonType: "array", minItems: 1, maxItems: 10, items: object },
  binary = { bsonType: "binData" };
const strict = (properties: Record<string, unknown>) => ({
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
});
export const certificateSchemas = {
  certificate_drafts: strict({
    _id: oid,
    churchId: oid,
    input: object,
    previousEditionId: nullableId,
    reason: nullableText,
    version: integer,
    state: { enum: ["draft", "issued"] },
    editionId: nullableId,
    createdAt: date,
    updatedAt: date,
  }),
  certificate_editions: strict({
    _id: oid,
    churchId: oid,
    draftId: oid,
    lineageId: oid,
    revision: integer,
    version: integer,
    state: { enum: ["issued", "superseded", "revoked"] },
    snapshot: object,
    pages,
    memberIds: { bsonType: "array", maxItems: 24, items: oid },
    pdf: binary,
    docx: binary,
    pdfHash: text,
    docxHash: text,
    faithConfirmed: { bsonType: "bool" },
    issuedAt: date,
    actorId: oid,
    actorKind: { enum: ["owner", "church_user"] },
  }),
  certificate_previews: strict({
    _id: oid,
    churchId: oid,
    draftId: oid,
    draftVersion: integer,
    actorId: oid,
    actorKind: { enum: ["owner", "church_user"] },
    context: text,
    snapshot: object,
    pages,
    pdf: binary,
    docx: binary,
    pdfHash: text,
    docxHash: text,
    createdAt: date,
    expiresAt: date,
  }),
  certificate_history: strict({
    _id: oid,
    churchId: oid,
    draftId: oid,
    editionId: nullableId,
    event: text,
    reason: nullableText,
    actorId: oid,
    actorKind: { enum: ["owner", "church_user"] },
    operationId: oid,
    occurredAt: date,
    before: { bsonType: ["object", "null"] },
    after: object,
  }),
};
export const certificateIndexes: Record<
  string,
  {
    key: Record<string, 1 | -1>;
    name: string;
    unique?: boolean;
    partialFilterExpression?: object;
    expireAfterSeconds?: number;
  }[]
> = {
  certificate_drafts: [
    { key: { churchId: 1, createdAt: -1, _id: -1 }, name: "certificate_drafts_page" },
  ],
  certificate_editions: [
    {
      key: { churchId: 1, lineageId: 1, revision: -1 },
      name: "certificate_revision_unique",
      unique: true,
    },
    {
      key: { churchId: 1, lineageId: 1 },
      name: "certificate_current_unique",
      unique: true,
      partialFilterExpression: { state: "issued" },
    },
    { key: { churchId: 1, issuedAt: -1, _id: -1 }, name: "certificate_editions_page" },
    { key: { churchId: 1, memberIds: 1, issuedAt: -1, _id: -1 }, name: "certificate_member_page" },
  ],
  certificate_previews: [
    { key: { churchId: 1, actorId: 1, draftId: 1 }, name: "certificate_preview_owner" },
    { key: { expiresAt: 1 }, name: "certificate_preview_ttl", expireAfterSeconds: 0 },
  ],
  certificate_history: [
    { key: { churchId: 1, draftId: 1, occurredAt: -1, _id: -1 }, name: "certificate_history_page" },
  ],
};
