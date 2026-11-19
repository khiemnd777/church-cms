const oid = { bsonType: "objectId" };
const num = { bsonType: ["int", "long", "double"], minimum: 1, multipleOf: 1 };
const date = { bsonType: "date" };
const str = { bsonType: "string" };
const obj = { bsonType: "object" };
const bin = { bsonType: "binData" };
const nullableId = { bsonType: ["objectId", "null"] };
const schema = (properties: Record<string, unknown>) => ({
  required: Object.keys(properties),
  properties,
});
export const reportSchemas = {
  report_templates: schema({
    _id: oid,
    churchId: oid,
    version: num,
    state: { enum: ["checked", "retired"] },
    layout: obj,
    actorId: oid,
    createdAt: date,
  }),
  report_template_selection: schema({
    _id: oid,
    activeId: nullableId,
    version: num,
    writeFence: { ...num, minimum: 0 },
  }),
  report_previews: schema({
    _id: oid,
    churchId: oid,
    actorId: oid,
    actorKind: str,
    context: str,
    templateId: oid,
    selectionVersion: num,
    document: obj,
    previousId: nullableId,
    reason: { bsonType: ["string", "null"] },
    pdf: bin,
    xlsx: bin,
    expiresAt: date,
  }),
  report_editions: schema({
    _id: oid,
    churchId: oid,
    previewId: oid,
    templateId: oid,
    actorId: oid,
    actorKind: str,
    document: obj,
    pdf: bin,
    xlsx: bin,
    pdfHash: str,
    xlsxHash: str,
    issuedAt: date,
    lineageId: oid,
    revision: num,
    supersededBy: nullableId,
    previousId: nullableId,
    reason: { bsonType: ["string", "null"] },
  }),
};
export const reportIndexes: Record<
  string,
  { key: Record<string, 1 | -1>; name: string; unique?: boolean; expireAfterSeconds?: number }[]
> = {
  report_templates: [{ key: { churchId: 1, _id: -1 }, name: "report_template_page" }],
  report_previews: [
    { key: { expiresAt: 1 }, name: "report_preview_expiry", expireAfterSeconds: 0 },
    { key: { churchId: 1, expiresAt: 1 }, name: "report_preview_quota" },
  ],
  report_editions: [
    { key: { churchId: 1, _id: -1 }, name: "report_edition_page" },
    { key: { churchId: 1, previewId: 1 }, name: "report_edition_once", unique: true },
    {
      key: { churchId: 1, lineageId: 1, revision: 1 },
      name: "report_edition_revision",
      unique: true,
    },
  ],
};
