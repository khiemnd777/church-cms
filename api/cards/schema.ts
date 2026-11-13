const oid = { bsonType: "objectId" },
  date = { bsonType: "date" },
  version = { bsonType: ["int", "long", "double"], minimum: 1, multipleOf: 1 };
export const cardSchemas = {
  member_cards: {
    additionalProperties: false,
    required: [
      "_id",
      "churchId",
      "memberId",
      "publicId",
      "state",
      "version",
      "snapshot",
      "issuedAt",
      "issuedBy",
      "issuedByKind",
      "revokedAt",
      "createdAt",
      "updatedAt",
    ],
    properties: {
      _id: oid,
      churchId: oid,
      memberId: oid,
      publicId: { bsonType: "string", pattern: "^[A-Za-z0-9_-]{43}$" },
      state: { enum: ["active", "revoked"] },
      version,
      snapshot: {
        bsonType: "object",
        additionalProperties: false,
        required: ["fullName", "memberCode", "churchName", "churchCode"],
        properties: {
          fullName: { bsonType: "string" },
          memberCode: { bsonType: "string" },
          churchName: { bsonType: "string" },
          churchCode: { bsonType: "string" },
        },
      },
      issuedAt: date,
      issuedBy: oid,
      issuedByKind: { enum: ["owner", "church_user"] },
      revokedAt: { bsonType: ["date", "null"] },
      createdAt: date,
      updatedAt: date,
    },
    oneOf: [
      { properties: { state: { enum: ["active"] }, revokedAt: { bsonType: "null" } } },
      { properties: { state: { enum: ["revoked"] }, revokedAt: date } },
    ],
  },
  member_card_history: {
    additionalProperties: false,
    required: [
      "_id",
      "churchId",
      "memberId",
      "cardId",
      "event",
      "before",
      "after",
      "reason",
      "actorId",
      "actorKind",
      "operationId",
      "occurredAt",
    ],
    properties: {
      _id: oid,
      churchId: oid,
      memberId: oid,
      cardId: oid,
      event: { enum: ["issued", "replaced", "revoked"] },
      before: { bsonType: ["object", "null"] },
      after: { bsonType: "object" },
      reason: { bsonType: ["string", "null"] },
      actorId: oid,
      actorKind: { enum: ["owner", "church_user"] },
      operationId: oid,
      occurredAt: date,
    },
  },
};
// One current record per member (including revoked) is stronger than one active
// partial index. Replacement updates it atomically; history retains old revisions.
export const cardIndexes: Record<
  string,
  { key: Record<string, 1 | -1>; name: string; unique?: boolean }[]
> = {
  member_cards: [
    { key: { churchId: 1, memberId: 1 }, name: "member_card_unique", unique: true },
    { key: { publicId: 1 }, name: "card_public_unique", unique: true },
  ],
  member_card_history: [
    { key: { churchId: 1, memberId: 1, occurredAt: -1, _id: -1 }, name: "card_history_page" },
  ],
};
