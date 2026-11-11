import { type ClientSession, type Db, MongoClient, MongoError } from "mongodb";
import type { Config } from "../config";
import { AppError } from "../errors";
import type { AuditEvent, Credential, Owner, Session } from "../identity/models";
import { organizationSchemas } from "../organization/schema";
export class Database {
  readonly client: MongoClient;
  readonly db: Db;
  constructor(c: Config) {
    this.client = new MongoClient(c.mongoUrl, {
      serverSelectionTimeoutMS: 2000,
      connectTimeoutMS: 2000,
      socketTimeoutMS: 5000,
      maxPoolSize: 15,
    });
    this.db = this.client.db(c.database);
  }
  get owners() {
    return this.db.collection<Owner>("owners");
  }
  get credentials() {
    return this.db.collection<Credential>("credentials");
  }
  get sessions() {
    return this.db.collection<Session>("sessions");
  }
  get audits() {
    return this.db.collection<AuditEvent>("audit_events");
  }
  async transaction<T>(body: (session: ClientSession) => Promise<T>): Promise<T> {
    const session = this.client.startSession();
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        session.startTransaction({
          readConcern: { level: "snapshot" },
          writeConcern: { w: "majority", wtimeoutMS: 5000 },
          maxCommitTimeMS: 5000,
        });
        try {
          const result = await body(session);
          for (let commit = 0; commit < 3; commit++) {
            try {
              await session.commitTransaction();
              return result;
            } catch (error) {
              if (
                error instanceof MongoError &&
                error.hasErrorLabel("UnknownTransactionCommitResult")
              ) {
                if (commit === 2) throw new AppError(503, "OUTCOME_UNKNOWN");
                continue;
              }
              throw error;
            }
          }
        } catch (error) {
          if (error instanceof AppError && error.code === "OUTCOME_UNKNOWN") throw error;
          if (session.inTransaction()) await session.abortTransaction();
          if (
            error instanceof MongoError &&
            error.hasErrorLabel("TransientTransactionError") &&
            attempt < 2
          ) {
            await Bun.sleep(10 + Math.random() * 30);
            continue;
          }
          throw error;
        }
      }
      throw new AppError(503, "DEPENDENCY_UNAVAILABLE");
    } finally {
      await session.endSession();
    }
  }
  async ready() {
    await this.db.command({ ping: 1 });
    const hello = await this.db.admin().command({ hello: 1 });
    if (!hello.setName) throw new Error("replica set required");
    await this.transaction(async (session) => {
      await this.db
        .collection("platform_guard")
        .findOne({ _id: "owner-registry" as never }, { session });
    });
    await checkIndexes(this.db);
  }
}
const oid = { bsonType: "objectId" };
const date = { bsonType: "date" };
const integer = { bsonType: ["int", "long", "double"] };
const common = {
  _id: oid,
  version: integer,
  writeFence: integer,
  createdAt: date,
  updatedAt: date,
};
const definitions = {
  ...organizationSchemas,
  churches: {
    required: [
      "_id",
      "code",
      "name",
      "nameKey",
      "province",
      "status",
      "version",
      "writeFence",
      "createdAt",
      "updatedAt",
    ],
    properties: {
      ...common,
      code: { bsonType: "string", pattern: "^HT-[A-Z2-9]{10}$" },
      name: { bsonType: "string", minLength: 1, maxLength: 160 },
      nameKey: { bsonType: "string", minLength: 1, maxLength: 320 },
      province: { bsonType: "string", minLength: 1, maxLength: 160 },
      district: { bsonType: "string", maxLength: 160 },
      address: { bsonType: "string", maxLength: 500 },
      contact: {
        bsonType: "object",
        additionalProperties: false,
        properties: {
          name: { bsonType: "string", maxLength: 160 },
          phone: { bsonType: "string", maxLength: 32 },
          email: { bsonType: "string", maxLength: 254 },
        },
      },
      createdBy: oid,
      updatedBy: oid,
      version: { ...integer, minimum: 1 },
      status: { enum: ["active", "suspended"] },
    },
  },
  accounts: {
    required: [
      "_id",
      "churchId",
      "email",
      "emailKey",
      "displayName",
      "displayNameKey",
      "role",
      "scope",
      "status",
      "authEpoch",
      "version",
      "writeFence",
      "createdAt",
      "updatedAt",
    ],
    properties: {
      ...common,
      churchId: oid,
      email: { bsonType: "string" },
      emailKey: { bsonType: "string" },
      role: { enum: ["pastor", "secretary", "treasurer", "ministry_lead", "member"] },
      scope: {
        bsonType: "object",
        required: ["kind"],
        additionalProperties: false,
        properties: {
          kind: { enum: ["church", "self", "assigned_units"] },
          unitIds: {
            bsonType: "array",
            minItems: 1,
            maxItems: 50,
            uniqueItems: true,
            items: { bsonType: "string", pattern: "^[a-f0-9]{24}$" },
          },
        },
        oneOf: [
          { properties: { kind: { enum: ["church", "self"] } }, not: { required: ["unitIds"] } },
          { required: ["unitIds"], properties: { kind: { enum: ["assigned_units"] } } },
        ],
      },
      subjectMemberId: oid,
      status: { enum: ["active", "locked"] },
      authEpoch: integer,
    },
    oneOf: [
      {
        properties: {
          role: { enum: ["pastor", "secretary", "treasurer"] },
          scope: { properties: { kind: { enum: ["church"] } } },
        },
      },
      {
        properties: {
          role: { enum: ["member"] },
          scope: { properties: { kind: { enum: ["self"] } } },
        },
      },
      {
        properties: {
          role: { enum: ["ministry_lead"] },
          scope: { properties: { kind: { enum: ["assigned_units"] } } },
        },
      },
    ],
    not: {
      anyOf: [
        { required: ["platformRole"] },
        { required: ["memberships"] },
        { required: ["churchIds"] },
      ],
    },
  },
  owners: {
    required: [
      "_id",
      "email",
      "emailKey",
      "displayName",
      "status",
      "authEpoch",
      "version",
      "writeFence",
      "createdAt",
      "updatedAt",
    ],
    properties: {
      ...common,
      email: { bsonType: "string" },
      emailKey: { bsonType: "string" },
      displayName: { bsonType: "string" },
      status: { enum: ["active", "locked"] },
      authEpoch: integer,
    },
    not: {
      anyOf: [
        { required: ["churchId"] },
        { required: ["memberships"] },
        { required: ["platformRole"] },
      ],
    },
  },
  credentials: {
    required: [
      "_id",
      "principalKind",
      "principalId",
      "churchId",
      "passwordHash",
      "kind",
      "credentialVersion",
      "writeFence",
      "updatedAt",
    ],
    properties: {
      ...common,
      principalKind: { enum: ["owner", "church_user"] },
      principalId: oid,
      churchId: { bsonType: ["objectId", "null"] },
      passwordHash: { bsonType: "string" },
      kind: { enum: ["temporary", "permanent"] },
      temporaryExpiresAt: date,
      credentialVersion: integer,
    },
    oneOf: [
      { properties: { principalKind: { enum: ["owner"] }, churchId: { bsonType: "null" } } },
      { properties: { principalKind: { enum: ["church_user"] }, churchId: oid } },
    ],
    anyOf: [
      { properties: { kind: { enum: ["permanent"] } } },
      { required: ["temporaryExpiresAt"], properties: { kind: { enum: ["temporary"] } } },
    ],
  },
  sessions: {
    required: [
      "_id",
      "tokenHash",
      "realm",
      "churchId",
      "kind",
      "csrfTokenHash",
      "csrfKeyVersion",
      "createdAt",
      "lastActivityAt",
      "absoluteExpiresAt",
      "writeFence",
    ],
    properties: {
      ...common,
      tokenHash: { bsonType: "string" },
      realm: { enum: ["owner", "church"] },
      principalId: oid,
      churchId: { bsonType: ["objectId", "null"] },
      kind: { enum: ["bootstrap", "password_change", "full"] },
      authEpoch: integer,
      credentialVersion: integer,
      csrfTokenHash: { bsonType: "string" },
      csrfKeyVersion: integer,
      lastActivityAt: date,
      lastPasswordVerifiedAt: date,
      absoluteExpiresAt: date,
      revokedAt: date,
    },
    oneOf: [
      { properties: { kind: { enum: ["bootstrap"] } }, not: { required: ["principalId"] } },
      {
        required: ["principalId", "authEpoch", "credentialVersion"],
        properties: {
          kind: { enum: ["password_change", "full"] },
          realm: { enum: ["owner"] },
          churchId: { bsonType: "null" },
        },
      },
      {
        required: ["principalId", "authEpoch", "credentialVersion", "churchId"],
        properties: {
          kind: { enum: ["password_change", "full"] },
          realm: { enum: ["church"] },
          churchId: oid,
        },
      },
    ],
  },
  audit_events: {
    required: [
      "_id",
      "occurredAt",
      "actorKind",
      "actorChurchId",
      "targetChurchId",
      "eventType",
      "targetType",
      "outcome",
      "changedFields",
      "safeSummary",
      "requestId",
    ],
    properties: {
      _id: oid,
      occurredAt: date,
      actorKind: { enum: ["owner", "church_user", "system", "anonymous"] },
      actorId: oid,
      actorChurchId: { bsonType: ["objectId", "null"] },
      targetChurchId: { bsonType: ["objectId", "null"] },
      eventType: { bsonType: "string" },
      targetType: { bsonType: "string" },
      outcome: { enum: ["success", "denied", "failure"] },
      changedFields: { bsonType: "array", items: { bsonType: "string" } },
      safeSummary: { bsonType: "string" },
      requestId: { bsonType: "string" },
    },
  },
  idempotency_operations: {
    required: [
      "_id",
      "method",
      "routeKey",
      "keyHash",
      "payloadHash",
      "status",
      "resourceRefs",
      "safeResult",
      "createdAt",
      "expiresAt",
    ],
    oneOf: [
      {
        required: ["ownerId"],
        not: {
          anyOf: [
            { required: ["schemaVersion"] },
            { required: ["actorKind"] },
            { required: ["actorId"] },
            { required: ["churchId"] },
          ],
        },
      },
      {
        required: ["schemaVersion", "actorKind", "actorId", "churchId"],
        not: { required: ["ownerId"] },
      },
    ],
    properties: {
      _id: oid,
      ownerId: oid,
      schemaVersion: { enum: [2] },
      actorKind: { enum: ["owner", "church_user"] },
      actorId: oid,
      churchId: oid,
      method: { bsonType: "string" },
      routeKey: { bsonType: "string" },
      keyHash: { bsonType: "string" },
      payloadHash: { bsonType: "string" },
      status: { enum: ["completed"] },
      createdAt: date,
      expiresAt: date,
    },
  },
  platform_guard: {
    required: ["_id", "activeOwnerCount", "version"],
    properties: {
      _id: { enum: ["owner-registry"] },
      activeOwnerCount: { ...integer, minimum: 0 },
      version: integer,
    },
  },
};
const indexes: Record<
  string,
  {
    key: Record<string, 1 | -1>;
    name: string;
    unique?: boolean;
    expireAfterSeconds?: number;
    partialFilterExpression?: Record<string, unknown>;
  }[]
> = {
  church_settings: [],
  organization_units: [
    { key: { churchId: 1, namespace: 1, nameKey: 1 }, name: "unit_name_unique", unique: true },
    {
      key: { churchId: 1, systemKey: 1 },
      name: "system_unit_unique",
      unique: true,
      partialFilterExpression: { systemKey: { $exists: true } },
    },
    { key: { churchId: 1, kind: 1, status: 1, nameKey: 1, _id: 1 }, name: "unit_kind_status_name" },
    { key: { churchId: 1, nameKey: 1, _id: 1 }, name: "unit_name" },
  ],
  churches: [
    { key: { code: 1 }, name: "code_unique", unique: true },
    { key: { status: 1, nameKey: 1, _id: 1 }, name: "status_name" },
    { key: { nameKey: 1, _id: 1 }, name: "name" },
  ],
  accounts: [
    { key: { churchId: 1, emailKey: 1 }, name: "church_email_unique", unique: true },
    { key: { churchId: 1, displayNameKey: 1, _id: 1 }, name: "church_name" },
    { key: { churchId: 1, status: 1, role: 1, _id: 1 }, name: "church_status_role" },
  ],
  owners: [{ key: { emailKey: 1 }, name: "email_unique", unique: true }],
  credentials: [
    { key: { principalKind: 1, principalId: 1 }, name: "principal_unique", unique: true },
    { key: { churchId: 1, principalId: 1 }, name: "church_principal" },
  ],
  sessions: [
    { key: { tokenHash: 1 }, name: "token_unique", unique: true },
    { key: { realm: 1, principalId: 1, churchId: 1 }, name: "realm_principal" },
    { key: { absoluteExpiresAt: 1 }, name: "session_expiry", expireAfterSeconds: 0 },
  ],
  audit_events: [
    { key: { targetChurchId: 1, occurredAt: -1, _id: -1 }, name: "tenant_time" },
    { key: { occurredAt: -1, _id: -1 }, name: "time" },
  ],
  idempotency_operations: [
    {
      key: { ownerId: 1, method: 1, routeKey: 1, keyHash: 1 },
      name: "operation_unique",
      unique: true,
      partialFilterExpression: { ownerId: { $exists: true } },
    },
    {
      key: { actorKind: 1, actorId: 1, churchId: 1, method: 1, routeKey: 1, keyHash: 1 },
      name: "operation_v2_unique",
      unique: true,
      partialFilterExpression: { schemaVersion: 2 },
    },
    { key: { expiresAt: 1 }, name: "operation_expiry", expireAfterSeconds: 0 },
  ],
};
export async function initialize(db: Db, options: { upgradeOperationsV2?: boolean } = {}) {
  const exists = await db.listCollections({ name: "idempotency_operations" }).hasNext();
  const legacy = exists
    ? (await db.collection("idempotency_operations").listIndexes().toArray()).find(
        (i) => i.name === "operation_unique",
      )
    : null;
  if (legacy && !legacy.partialFilterExpression && !options.upgradeOperationsV2)
    throw new Error(
      "Stop local HTTP writers; rerun db:init --upgrade-operations-v2 after reviewing the local runbook",
    );
  for (const [name, schema] of Object.entries(definitions)) {
    const validator = { $jsonSchema: { bsonType: "object", ...schema } };
    if (await db.listCollections({ name }).hasNext())
      await db.command({
        collMod: name,
        validator,
        validationLevel: "strict",
        validationAction: "error",
      });
    else
      await db.createCollection(name, {
        validator,
        validationLevel: "strict",
        validationAction: "error",
      });
  }
  if (legacy && !legacy.partialFilterExpression) {
    // Explicit maintenance upgrade only: retain all v1 rows and TTL; writers must be stopped.
    const v2 = indexes.idempotency_operations?.find((i) => i.name === "operation_v2_unique");
    if (v2) await db.collection("idempotency_operations").createIndexes([v2]);
    await db.collection("idempotency_operations").dropIndex("operation_unique");
  }
  for (const [name, specs] of Object.entries(indexes))
    if (specs.length) await db.collection(name).createIndexes(specs);
  await db
    .collection("platform_guard")
    .updateOne(
      { _id: "owner-registry" as never },
      { $setOnInsert: { activeOwnerCount: 0, version: 1 } },
      { upsert: true },
    );
}
async function checkIndexes(db: Db) {
  for (const [name, specs] of Object.entries(indexes)) {
    const actual = await db.collection(name).listIndexes().toArray();
    for (const spec of specs) {
      const found = actual.find((i) => i.name === spec.name);
      if (
        !found ||
        JSON.stringify(found.key) !== JSON.stringify(spec.key) ||
        !!found.unique !== !!spec.unique ||
        found.expireAfterSeconds !== spec.expireAfterSeconds ||
        JSON.stringify(found.partialFilterExpression ?? null) !==
          JSON.stringify(spec.partialFilterExpression ?? null)
      )
        throw new Error("required index missing");
    }
  }
}
