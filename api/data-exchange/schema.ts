const oid = { bsonType: "objectId" },
  date = { bsonType: "date" };
const owner = {
  _id: oid,
  churchId: oid,
  actorId: oid,
  actorKind: { enum: ["owner", "church_user"] },
  createdAt: date,
  expiresAt: date,
};
export const exchangeSchemas = {
  exchange_imports: {
    required: Object.keys(owner).concat([
      "source",
      "digest",
      "sheets",
      "version",
      "state",
      "outcomes",
    ]),
    properties: {
      ...owner,
      version: { bsonType: ["int", "double", "long"], minimum: 1 },
      state: { enum: ["review", "ready", "partial", "completed"] },
      updatedAt: date,
    },
  },
  exchange_exports: {
    required: Object.keys(owner).concat(["rows", "bytes", "digest", "count", "format"]),
    properties: owner,
  },
  exchange_sources: {
    required: ["_id", "churchId", "source", "externalId", "memberId", "createdAt", "jobId"],
    properties: {
      _id: oid,
      churchId: oid,
      memberId: oid,
      jobId: oid,
      createdAt: date,
      source: { bsonType: "string", minLength: 1, maxLength: 100 },
      externalId: { bsonType: "string", minLength: 1, maxLength: 200 },
    },
  },
};
export const exchangeIndexes: Record<
  string,
  { key: Record<string, 1 | -1>; name: string; unique?: boolean; expireAfterSeconds?: number }[]
> = {
  exchange_imports: [
    {
      key: {
        churchId: 1 as const,
        actorKind: 1 as const,
        actorId: 1 as const,
        createdAt: -1 as const,
        _id: -1 as const,
      },
      name: "import_actor_page",
    },
    { key: { expiresAt: 1 as const }, name: "import_expiry", expireAfterSeconds: 0 },
  ],
  exchange_exports: [
    { key: { expiresAt: 1 as const }, name: "export_expiry", expireAfterSeconds: 0 },
  ],
  exchange_sources: [
    {
      key: { churchId: 1 as const, source: 1 as const, externalId: 1 as const },
      name: "source_identity_unique",
      unique: true,
    },
  ],
};
