import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { MongoError, ObjectId } from "mongodb";
import { createApp } from "../../api/app";
import type { TenantGrant } from "../../api/authorization/tenant-grant";
import { config } from "../../api/config";
import { type ImportDto, type ImportField, importFields } from "../../api/data-exchange/contracts";
import { csvRows, decodeFile, makeFile } from "../../api/data-exchange/files";
import { DataExchange } from "../../api/data-exchange/service";
import { AppError } from "../../api/errors";
import { OwnerOperations } from "../../api/identity/owner-operations";
import { Identity } from "../../api/identity/service";
import { Database, initialize } from "../../api/infrastructure/database";
import { RateLimit } from "../../api/infrastructure/rate-limit";
import { businessDay } from "../../api/members/dates";
import { resourceCode } from "../../api/resource-code";

const conf = {
  ...config(),
  origin: "https://localhost:3454",
  database: `church_cms_test_exchange_${crypto.randomUUID().replaceAll("-", "")}`,
  csrfKey: crypto.randomUUID() + crypto.randomUUID(),
};
if (!["localhost", "127.0.0.1"].includes(new URL(conf.mongoUrl).hostname))
  throw new Error("Only local synthetic MongoDB");
const db = new Database(conf),
  rate = new RateLimit(conf.redisUrl, conf.csrfKey);
let app: ReturnType<typeof createApp>, owner: Client, other: Client;
const logs: object[] = [];
let identity: Identity;
class Client {
  jar = new Map<string, string>();
  csrf = "";
  ip = crypto.randomUUID();
  constructor(public realm: "owner" | "church" = "owner") {}
  async call(
    path: string,
    body?: object | Uint8Array,
    method = body ? "POST" : "GET",
    headers: Record<string, string> = {},
  ) {
    const response = await app(
      new Request(`${conf.origin}/api/v1/${path}`, {
        method,
        headers: {
          cookie: [...this.jar].map(([k, v]) => `${k}=${v}`).join(";"),
          ...(body
            ? {
                "content-type":
                  body instanceof Uint8Array ? "application/octet-stream" : "application/json",
                origin: conf.origin,
                "x-csrf-token": this.csrf,
              }
            : {}),
          ...headers,
        },
        ...(body
          ? { body: body instanceof Uint8Array ? (body as BodyInit) : JSON.stringify(body) }
          : {}),
      }),
      { ip: this.ip },
    );
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(";")[0] as string,
        i = pair.indexOf("=");
      if (pair.slice(i + 1)) this.jar.set(pair.slice(0, i), pair.slice(i + 1));
      else this.jar.delete(pair.slice(0, i));
    }
    const binary =
      response.headers.get("content-type")?.includes("text/csv") ||
      response.headers.get("content-type")?.includes("spreadsheetml");
    const bytes = binary ? new Uint8Array(await response.arrayBuffer()) : null;
    const json = response.status === 204 || binary ? null : await response.json();
    if (json?.data?.csrfToken) this.csrf = json.data.csrfToken;
    return { status: response.status, json, headers: response.headers, bytes };
  }
  async login(email: string, password: string, code?: string) {
    await this.call(`auth/csrf?realm=${this.realm}`);
    return this.call(`${this.realm === "owner" ? "owner/" : ""}auth/login`, {
      email,
      password,
      ...(code ? { churchCode: code } : {}),
    });
  }
  write(
    path: string,
    body: object,
    version?: number,
    key: string = crypto.randomUUID(),
    extra: Record<string, string> = {},
  ) {
    return this.call(path, body, version === undefined ? "POST" : "PATCH", {
      "idempotency-key": key,
      ...(version ? { "if-match": `"${version}"` } : {}),
      ...extra,
    });
  }
}
const defaults = { unitType: "area", defaultAssignmentMode: "auto" };
const path = (id: string, realm: "owner" | "church" = "owner") =>
  `${realm === "owner" ? "owner/" : ""}churches/${id}/organization`;
async function newOwner() {
  const fixture = await new OwnerOperations(db).create({
      email: `${crypto.randomUUID()}@example.test`,
      displayName: "Owner synthetic",
    }),
    c = new Client(),
    pw = `Owner 🌿 ${crypto.randomUUID()}`;
  expect((await c.login(fixture.email, fixture.temporaryPassword)).status).toBe(200);
  expect(
    (await c.call("owner/auth/change-initial-password", { newPassword: pw, confirmation: pw }))
      .status,
  ).toBe(204);
  expect((await c.login(fixture.email, pw)).status).toBe(200);
  return c;
}
async function church(configure = true) {
  const r = await owner.write("owner/churches", {
    name: `Hội Thánh synthetic ${crypto.randomUUID()}`,
    province: "Đà Nẵng",
  });
  expect(r.status).toBe(201);
  const c = r.json.data.church as { id: string; code: string };
  if (configure) expect((await owner.write(`${path(c.id)}/settings`, defaults)).status).toBe(201);
  return c;
}
async function user(c: { id: string; code: string }, role = "pastor", permanent = true) {
  const scope =
    role === "ministry_lead"
      ? {
          kind: "assigned_units",
          unitIds: [
            (
              await owner.write(`${path(c.id)}/units`, {
                kind: "area",
                name: `Khu ${crypto.randomUUID()}`,
              })
            ).json.data.unit.id,
          ],
        }
      : { kind: role === "member" ? "self" : "church" };
  const email = `${crypto.randomUUID()}@example.test`,
    made = await owner.write(`owner/churches/${c.id}/accounts`, {
      email,
      displayName: "Người synthetic",
      role,
      scope,
    });
  expect(made.status).toBe(201);
  const client = new Client("church"),
    pw = `Người 🕊 ${crypto.randomUUID()}`;
  expect(
    (await client.login(email, made.json.data.temporaryCredential.password, c.code)).status,
  ).toBe(200);
  if (permanent) {
    expect(
      (await client.call("auth/change-initial-password", { newPassword: pw, confirmation: pw }))
        .status,
    ).toBe(204);
    expect((await client.login(email, pw, c.code)).status).toBe(200);
  }
  return { client, id: made.json.data.account.id as string };
}
beforeAll(async () => {
  await db.client.connect();
  await initialize(db.db);
  await rate.connect();
  identity = new Identity(db, rate, conf);
  await identity.initialize();
  app = createApp(identity, conf, { log: (r) => logs.push(r) });
  owner = await newOwner();
  other = await newOwner();
});
afterAll(async () => {
  if (db.db.databaseName === conf.database) await db.db.dropDatabase();
  await db.client.close();
  if (rate.client.isOpen) rate.client.destroy();
});
const base = (id: string, realm: "owner" | "church" = "owner") =>
  `${realm === "owner" ? "owner/" : ""}churches/${id}`;
const mp = (id: string, realm: "owner" | "church" = "owner") => `${base(id, realm)}/members`;
const today = () => businessDay();
const body = (extra: object = {}) => ({
  fullName: "Nguyễn An synthetic",
  gender: "unknown",
  birthDate: null,
  phone: "0900123456",
  type: "believer",
  membership: "preparatory",
  householdRole: "head",
  baptism: { status: "unknown", date: null, place: null },
  visitor: null,
  family: { kind: "new", areaId: null },
  assignment: { mode: "auto", unitIds: [] },
  assignmentContext: { settingsVersion: 1, asOfDate: today() },
  consent: true,
  ...extra,
});
async function made(c: { id: string }, extra: object = {}) {
  const r = await owner.write(mp(c.id), body(extra));
  expect(r.status).toBe(201);
  return (await owner.call(`${mp(c.id)}/${r.json.data.member.id}`)).json.data;
}
const _visitor = {
  stage: "new",
  firstVisit: null,
  believedOn: null,
  referrer: null,
  caregiverId: null,
};
const xp = (c: { id: string }, client = owner) =>
  `${client.realm === "owner" ? "owner/" : ""}churches/${c.id}/data-exchange`;
const input = (externalId: string, extra: Partial<Record<ImportField, string>> = {}) => ({
  externalId,
  fullName: `Nguyễn ${externalId} synthetic`,
  gender: "unknown",
  birthDate: "1990-01-02",
  type: "believer",
  membership: "member",
  participation: "active",
  familyKey: externalId,
  householdRole: "head",
  assignmentMode: "auto",
  baptismStatus: "unknown",
  consent: "true",
  ...extra,
});
async function stage(
  c: { id: string },
  entries: Partial<Record<ImportField, string>>[],
  options: { source?: string; format?: "csv" | "xlsx"; client?: Client; key?: string } = {},
) {
  const client = options.client ?? owner,
    format = options.format ?? "csv",
    file = await makeFile(
      importFields,
      entries.map((r) => importFields.map((f) => r[f] ?? "")),
      format,
    );
  const r = await client.call(`${xp(c, client)}/imports`, file.bytes, "POST", {
    "idempotency-key": options.key ?? crypto.randomUUID(),
    "x-file-format": format,
    "x-import-source": encodeURIComponent(options.source ?? "Synthetic"),
  });
  expect(r.status).toBe(201);
  return r.json.data.importId as string;
}
const job = async (c: { id: string }, id: string, client = owner) =>
  (await client.call(`${xp(c, client)}/imports/${id}`)).json.data;
const rows = async (c: { id: string }, id: string, client = owner) =>
  (await client.call(`${xp(c, client)}/imports/${id}/rows?limit=100`)).json.data;
async function patch(c: { id: string }, id: string, body: object, client = owner) {
  const j = await job(c, id, client),
    r = await client.write(`${xp(c, client)}/imports/${id}`, body, j.version);
  expect(r.status).toBe(200);
  return job(c, id, client);
}
async function prepare(c: { id: string }, id: string, client = owner) {
  const j = await job(c, id, client),
    r = await client.call(`${xp(c, client)}/imports/${id}/prepare`, {}, "POST", {
      "idempotency-key": crypto.randomUUID(),
      "if-match": `"${j.version}"`,
    });
  expect(r.status).toBe(200);
  return job(c, id, client);
}
async function batch(
  c: { id: string },
  id: string,
  client = owner,
  j?: ImportDto,
  key = crypto.randomUUID(),
) {
  const current: ImportDto = j ?? (await job(c, id, client));
  return client.call(
    `${xp(c, client)}/imports/${id}/batches`,
    { token: current.planToken, nextBatch: current.nextBatch, consent: true },
    "POST",
    { "idempotency-key": key, "if-match": `"${current.version}"` },
  );
}
const count = (c: { id: string }, collection = "members") =>
  db.db.collection(collection).countDocuments({ churchId: new ObjectId(c.id) });

describe("P2.5 real Mongo/HTTP import-export", () => {
  test("AC01 CSV preview has no domain writes; atomic create/history/registry; exact replay and actor-bound safe receipt", async () => {
    const c = await church(),
      id = await stage(c, [input("AC01", { phone: "0900000001" })]);
    expect(await count(c)).toBe(0);
    expect(await count(c, "families")).toBe(0);
    expect((await rows(c, id)).counts).toEqual({
      create: 1,
      link: 0,
      skip: 0,
      review: 0,
      error: 0,
    });
    const j = await prepare(c, id),
      key = crypto.randomUUID(),
      r = await batch(c, id, owner, j, key);
    expect(r.status).toBe(200);
    expect(r.json.data.state).toBe("completed");
    const replay = await batch(c, id, owner, j, key);
    expect(replay.status).toBe(200);
    expect(replay.json.meta.replayed).toBe(true);
    expect(await count(c)).toBe(1);
    expect(await count(c, "families")).toBe(1);
    expect(await count(c, "exchange_sources")).toBe(1);
    expect(await count(c, "member_history")).toBe(1);
    expect(await count(c, "family_history")).toBe(1);
    const receipt = await owner.call(`${xp(c)}/operations/${r.json.data.operationId}`);
    expect(receipt.status).toBe(200);
    expect(JSON.stringify(receipt.json)).not.toContain("Nguyễn");
    expect(JSON.stringify(receipt.json)).not.toContain("0900000001");
    expect((await other.call(`${xp(c)}/operations/${r.json.data.operationId}`)).status).toBe(404);
    const profile = await db.db.collection("members").findOne({ churchId: new ObjectId(c.id) });
    expect(profile?.phone).toBe("0900000001");
    expect(profile?.consent.confirmed).toBe(true);
    expect(profile?.assignment.unitIds.length).toBe(1);
    expect((await rows(c, id)).items[0].outcome.action).toBe("created");
    const recon = await owner.call(`${xp(c)}/imports/${id}/reconciliation?format=xlsx`);
    expect(recon.status).toBe(200);
    const table = await decodeFile(recon.bytes as Uint8Array, "xlsx");
    expect(table[0]?.rows[0]?.[3]).toBe("created");
    expect(JSON.stringify(logs)).not.toContain("0900000001");
  });
  test("AC02 XLSX shared-family metadata and service+auto age preserve domain rules", async () => {
    const c = await church();
    const u = await owner.write(`${path(c.id)}/units`, {
      kind: "service_ministry",
      name: "Ban Nhạc synthetic",
    });
    expect(u.status).toBe(201);
    const area = await owner.write(`${path(c.id)}/units`, {
      kind: "area",
      name: "Khu A synthetic",
    });
    expect(area.status).toBe(201);
    const shared = {
      familyKey: "HO-01",
      familyName: "Gia đình synthetic",
      familyAddress: "Địa chỉ synthetic",
      area: "Khu A synthetic",
      serviceMinistries: "Ban Nhạc synthetic",
    };
    const id = await stage(
      c,
      [
        input("AC02-A", shared),
        input("AC02-B", {
          ...shared,
          householdRole: "spouse",
          type: "visitor",
          membership: "",
          visitorStage: "exploring",
        }),
      ],
      { format: "xlsx" },
    );
    expect((await rows(c, id)).counts.error).toBe(0);
    await prepare(c, id);
    expect((await batch(c, id)).status).toBe(200);
    const fs = await db.db
      .collection("families")
      .find({ churchId: new ObjectId(c.id) })
      .toArray();
    expect(fs.length).toBe(1);
    expect(fs[0]?.name).toBe(shared.familyName);
    expect(fs[0]?.address).toBe(shared.familyAddress);
    const ms = await db.db
      .collection("members")
      .find({ churchId: new ObjectId(c.id) })
      .toArray();
    expect(ms.length).toBe(2);
    expect(ms.every((m) => m.familyId.equals(fs[0]?._id))).toBe(true);
    expect(ms.every((m) => m.assignment.unitIds.length === 2)).toBe(true);
  });
  test("AC03 in-file external duplicate, invalid dates and missing consent require explicit skip", async () => {
    const c = await church(),
      id = await stage(c, [
        input("DUP"),
        input("DUP", { birthDate: "2025-02-30", consent: "false" }),
      ]);
    expect((await rows(c, id)).counts.error).toBe(2);
    const j = await job(c, id);
    expect(
      (
        await owner.call(`${xp(c)}/imports/${id}/prepare`, {}, "POST", {
          "idempotency-key": crypto.randomUUID(),
          "if-match": `"${j.version}"`,
        })
      ).status,
    ).toBe(422);
    expect(await count(c)).toBe(0);
    await patch(c, id, { decisions: { 3: { action: "skip", reason: "Dòng sai/trùng" } } });
    await prepare(c, id);
    expect((await batch(c, id)).status).toBe(200);
    expect(await count(c)).toBe(1);
  });
  test("AC04 candidate link does not change profile, family, lifecycle or consent", async () => {
    const c = await church(),
      m = await made(c, { birthDate: "1990-01-02" }),
      id = await stage(c, [
        input("LINK", { fullName: m.fullName, phone: m.phone, memberCode: m.code }),
      ]);
    const preview = await rows(c, id);
    expect(preview.counts.review).toBe(1);
    expect(preview.items[0].candidates[0].code).toBe(m.code);
    await patch(c, id, {
      decisions: { 2: { action: "link", memberCode: m.code, reason: "Đối chiếu đúng hồ sơ" } },
    });
    await prepare(c, id);
    expect((await batch(c, id)).status).toBe(200);
    expect(await count(c)).toBe(1);
    expect((await owner.call(`${mp(c.id)}/${m.id}`)).json.data.version).toBe(m.version);
    expect(await count(c, "exchange_sources")).toBe(1);
  });
  test("AC05 re-upload after ledger TTL and source/code conflict never duplicates", async () => {
    const c = await church(),
      id = await stage(c, [input("SOURCE-1")]);
    await prepare(c, id);
    expect((await batch(c, id)).status).toBe(200);
    await db.db.collection("idempotency_operations").deleteMany({ churchId: new ObjectId(c.id) });
    const again = await stage(c, [input("SOURCE-1", { fullName: "Đã đổi tên trong file" })]);
    expect((await rows(c, again)).counts.skip).toBe(1);
    await prepare(c, again);
    expect((await batch(c, again)).status).toBe(200);
    expect(await count(c)).toBe(1);
    const otherMember = await made(c),
      conflict = await stage(c, [input("SOURCE-1", { memberCode: otherMember.code })]);
    expect((await rows(c, conflict)).counts.error).toBe(1);
  });
  test("AC06 same-source concurrent jobs: one create; other must re-review", async () => {
    const c = await church(),
      a = await stage(c, [input("RACE")]),
      b = await stage(c, [input("RACE")]);
    await prepare(c, a);
    await prepare(c, b);
    const results = await Promise.all([batch(c, a), batch(c, b)]);
    expect(results.filter((r) => r.status === 200).length).toBe(1);
    expect(results.some((r) => r.status === 412 || r.status === 409)).toBe(true);
    expect(await count(c)).toBe(1);
    expect(await count(c, "exchange_sources")).toBe(1);
  });
  test("AC07 aborted second batch preserves first 100, reports partial, then resumes remaining only", async () => {
    const c = await church(),
      id = await stage(
        c,
        Array.from({ length: 101 }, (_, i) => input(`PART-${i}`)),
      );
    await prepare(c, id);
    const first = await batch(c, id);
    expect(first.status).toBe(200);
    expect(first.json.data.state).toBe("partial");
    expect(await count(c)).toBe(100);
    const auditSpy = spyOn(identity.audit, "organization").mockImplementation(async (...args) => {
      if (args[0] === "members.created") throw new AppError(503, "DEPENDENCY_UNAVAILABLE");
    });
    try {
      expect((await batch(c, id)).status).toBe(503);
    } finally {
      auditSpy.mockRestore();
    }
    expect(await count(c)).toBe(100);
    expect(await count(c, "exchange_sources")).toBe(100);
    expect(await count(c, "families")).toBe(100);
    const j = await job(c, id);
    expect(j.state).toBe("partial");
    expect(j.processed).toBe(100);
    expect(j.planToken).toBeNull();
    const recon = await owner.call(`${xp(c)}/imports/${id}/reconciliation?format=csv`);
    expect(recon.status).toBe(200);
    const data = await decodeFile(recon.bytes as Uint8Array, "csv");
    expect(data[0]?.rows.filter((r) => r[3] === "created").length).toBe(100);
    expect(data[0]?.rows.filter((r) => r[3] === "not_written").length).toBe(1);
    await prepare(c, id);
    expect((await batch(c, id)).status).toBe(200);
    expect(await count(c)).toBe(101);
    expect((await job(c, id)).state).toBe("completed");
  }, 30000);
  test("AC08 stale settings, family or target version invalidates preview", async () => {
    const c = await church(),
      m = await made(c, { phone: null }),
      id = await stage(c, [
        input("STALE", { familyCode: m.family.code, familyKey: "", householdRole: "child" }),
      ]);
    await prepare(c, id);
    await db.db
      .collection("families")
      .updateOne({ _id: new ObjectId(m.family.id) }, { $inc: { version: 1 } });
    expect((await batch(c, id)).status).toBe(412);
    expect(await count(c)).toBe(1);
    expect((await job(c, id)).planToken).toBeNull();
    await prepare(c, id);
    await db.db
      .collection("church_settings")
      .updateOne({ _id: new ObjectId(c.id) }, { $inc: { version: 1 } });
    expect((await batch(c, id)).status).toBe(412);
  });
  test("AC09 actor/church ACL, strict scope, CSRF and hard expiry before TTL cleanup", async () => {
    const c = await church(),
      otherChurch = await church(),
      id = await stage(c, [input("ACL")]);
    expect((await other.call(`${xp(c)}/imports/${id}`)).status).toBe(404);
    expect((await owner.call(`${xp(otherChurch)}/imports/${id}`)).status).toBe(404);
    const lead = await user(c, "ministry_lead");
    const secretary = await user(c, "secretary"),
      treasurer = await user(c, "treasurer"),
      pastor = await user(c, "pastor"),
      member = await user(c, "member");
    for (const who of [treasurer.client, member.client, lead.client]) {
      expect((await who.call(`${xp(c, who)}/imports`)).status).toBe(403);
      expect((await who.call(`${xp(c, who)}/templates?format=csv`)).status).toBe(403);
      expect(
        (
          await who.call(`${xp(c, who)}/exports/preview`, {
            filters: {},
            columns: ["code"],
            format: "csv",
          })
        ).status,
      ).toBe(403);
    }
    for (const who of [secretary.client, pastor.client]) {
      expect((await who.call(`${xp(c, who)}/templates?format=xlsx`)).status).toBe(200);
      expect((await who.call(`${xp(c, who)}/imports/${id}`)).status).toBe(404);
    }
    expect(
      (
        await owner.call(`${xp(c)}/imports`, new Uint8Array([1]), "POST", {
          "x-csrf-token": "bad",
          "x-file-format": "csv",
          "x-import-source": "Synthetic",
          "idempotency-key": crypto.randomUUID(),
        })
      ).status,
    ).toBe(403);
    await db.db
      .collection("exchange_imports")
      .updateOne({ _id: new ObjectId(id) }, { $set: { expiresAt: new Date(0) } });
    expect((await owner.call(`${xp(c)}/imports/${id}`)).status).toBe(404);
    expect((await owner.call(`${xp(c)}/imports?bad=1`)).status).toBe(400);
  });
  test("AC10 export includes all filtered records, fixed snapshot bytes/hash, text preservation and fresh permission", async () => {
    const c = await church(),
      id = await stage(
        c,
        Array.from({ length: 31 }, (_, i) =>
          input(`EXPORT-${i}`, { phone: `0900000${String(i).padStart(3, "0")}` }),
        ),
      );
    await prepare(c, id);
    expect((await batch(c, id)).status).toBe(200);
    const payload = {
        filters: { participation: "current" },
        columns: ["code", "fullName", "phone", "birthDate", "familyCode"],
        format: "xlsx",
      },
      preview = await owner.call(`${xp(c)}/exports/preview`, payload);
    expect(preview.status).toBe(200);
    expect(preview.json.data.count).toBe(31);
    const madeFile = await owner.write(`${xp(c)}/exports`, {
      ...payload,
      previewToken: preview.json.data.previewToken,
    });
    expect(madeFile.status).toBe(201);
    const exported = madeFile.json.data.export;
    const downloaded = await owner.call(`${xp(c)}/exports/${exported.id}/download`);
    expect(downloaded.status).toBe(200);
    expect(downloaded.headers.get("cache-control")).toBe("no-store");
    expect(
      new Bun.CryptoHasher("sha256").update(downloaded.bytes as Uint8Array).digest("hex"),
    ).toBe(exported.digest);
    const table = await decodeFile(downloaded.bytes as Uint8Array, "xlsx");
    expect(table[0]?.rows.length).toBe(31);
    expect(table[0]?.rows.every((r) => r[2]?.startsWith("0900000"))).toBe(true);
    await made(c, { fullName: "Thêm sau khi xuất", phone: null });
    const again = await owner.call(`${xp(c)}/exports/${exported.id}/download`);
    expect(again.bytes).toEqual(downloaded.bytes);
    expect((await other.call(`${xp(c)}/exports/${exported.id}/download`)).status).toBe(404);
    await db.db
      .collection("exchange_exports")
      .updateOne({ _id: new ObjectId(exported.id) }, { $set: { expiresAt: new Date(0) } });
    expect((await owner.call(`${xp(c)}/exports/${exported.id}/download`)).status).toBe(404);
    const bad = await owner.call(`${xp(c)}/exports/preview`, {
      ...payload,
      columns: ["passwordHash"],
    });
    expect(bad.status).toBe(422);
    const stale = await owner.write(`${xp(c)}/exports`, {
      ...payload,
      previewToken: preview.json.data.previewToken,
    });
    expect(stale.status).toBe(412);
  }, 30000);
  test("AC11 role revocation and church suspension block pending import and existing export file", async () => {
    const c = await church(),
      u = await user(c, "secretary"),
      id = await stage(c, [input("ROLE")], { client: u.client });
    const roleReady = await prepare(c, id, u.client);
    const p = { filters: {}, columns: ["code"], format: "csv" },
      pr = await u.client.call(`${xp(c, u.client)}/exports/preview`, p),
      ex = await u.client.write(`${xp(c, u.client)}/exports`, {
        ...p,
        previewToken: pr.json.data.previewToken,
      });
    expect(ex.status).toBe(201);
    await db.db
      .collection("accounts")
      .updateOne(
        { _id: new ObjectId(u.id) },
        { $set: { role: "treasurer" }, $inc: { version: 1 } },
      );
    expect((await batch(c, id, u.client, roleReady)).status).toBe(403);
    expect(
      (await u.client.call(`${xp(c, u.client)}/exports/${ex.json.data.export.id}/download`)).status,
    ).toBe(403);
    expect(await count(c)).toBe(0);
    const owned = await stage(c, [input("SUSPEND")]);
    const suspendReady = await prepare(c, owned);
    await db.db
      .collection("churches")
      .updateOne(
        { _id: new ObjectId(c.id) },
        { $set: { status: "suspended" }, $inc: { version: 1 } },
      );
    expect((await batch(c, owned, owner, suspendReady)).status).toBe(403);
    expect((await owner.call(`${xp(c)}/imports/${owned}`)).status).toBe(403);
  });
  test("AC12 whole failed batch rolls back members/families/registry/history/audit/ledger", async () => {
    const c = await church(),
      id = await stage(c, [input("ROLL-A"), input("ROLL-B")]);
    await prepare(c, id);
    let created = 0;
    const original = identity.audit.organization.bind(identity.audit),
      spy = spyOn(identity.audit, "organization").mockImplementation(async (...args) => {
        if (args[0] === "members.created" && ++created === 2)
          throw new AppError(422, "VALIDATION_FAILED");
        return original(...args);
      });
    try {
      expect((await batch(c, id)).status).toBe(422);
    } finally {
      spy.mockRestore();
    }
    for (const col of [
      "members",
      "families",
      "exchange_sources",
      "member_history",
      "family_history",
    ])
      expect(await count(c, col)).toBe(0);
    expect(
      await db.db
        .collection("idempotency_operations")
        .countDocuments({ churchId: new ObjectId(c.id), routeKey: { $regex: "/batches$" } }),
    ).toBe(0);
    expect((await job(c, id)).processed).toBe(0);
  });
  test("AC13 unknown commit acknowledgement returns operationId; lookup and exact replay recover without duplicate", async () => {
    const c = await church(),
      id = await stage(c, [input("UNKNOWN")]),
      ready = await prepare(c, id),
      key = crypto.randomUUID(),
      actual = db.client.startSession.bind(db.client);
    const spy = spyOn(db.client, "startSession").mockImplementation((...args) => {
      const s = actual(...args),
        commit = s.commitTransaction.bind(s);
      s.commitTransaction = async () => {
        await commit();
        const e = new MongoError("Synthetic unknown ack");
        e.addErrorLabel("UnknownTransactionCommitResult");
        throw e;
      };
      return s;
    });
    let result: Awaited<ReturnType<typeof batch>>;
    try {
      result = await batch(c, id, owner, ready, key);
    } finally {
      spy.mockRestore();
    }
    expect(result.status).toBe(503);
    expect(result.json.error.code).toBe("OUTCOME_UNKNOWN");
    expect((await owner.call(`${xp(c)}/operations/${result.json.meta.operationId}`)).status).toBe(
      200,
    );
    expect((await batch(c, id, owner, ready, key)).json.meta.replayed).toBe(true);
    expect(await count(c)).toBe(1);
    expect((await job(c, id)).state).toBe("completed");
  });
  test("AC14 new household groups cannot split across batches or invent conflicting metadata/heads", async () => {
    const c = await church(),
      id = await stage(
        c,
        Array.from({ length: 101 }, (_, i) =>
          input(`GROUP-${i}`, { familyKey: "ONE", householdRole: i === 0 ? "head" : "child" }),
        ),
      );
    expect((await rows(c, id)).counts.error).toBe(101);
    expect(await count(c)).toBe(0);
    const conflict = await stage(c, [
      input("G-A", { familyKey: "HO", familyName: "A" }),
      input("G-B", { familyKey: "HO", familyName: "B" }),
    ]);
    expect((await rows(c, conflict)).counts.error).toBe(2);
    const m = await made(c, { phone: null }),
      existing = await stage(c, [input("HEAD", { familyCode: m.family.code, familyKey: "" })]);
    expect((await rows(c, existing)).items[0].errors.join(" ")).toContain("chủ hộ");
  });
  test("AC15 changed candidate set and linked profile version require new review", async () => {
    const c = await church(),
      id = await stage(c, [input("NEW-CAND", { phone: "0900000022" })]);
    await prepare(c, id);
    await made(c, { fullName: "Người khác synthetic", phone: "0900000022" });
    expect((await batch(c, id)).status).toBe(412);
    expect(await count(c)).toBe(1);
    const r = await rows(c, id);
    expect(r.counts.review).toBe(1);
    const code = r.items[0].candidates[0].code;
    await patch(c, id, {
      decisions: { 2: { action: "link", memberCode: code, reason: "Đã đối chiếu" } },
    });
    await prepare(c, id);
    await db.db
      .collection("members")
      .updateOne({ churchId: new ObjectId(c.id), code }, { $inc: { version: 1 } });
    expect((await batch(c, id)).status).toBe(412);
    expect(await count(c, "exchange_sources")).toBe(0);
  });
  test("AC16 authority change during real snapshot fence aborts batch before any domain writes", async () => {
    for (const action of ["permissions", "suspend"]) {
      const c = await church(),
        u = await user(c, "secretary"),
        id = await stage(c, [input(`FENCE-${action}`)], { client: u.client }),
        ready = await prepare(c, id, u.client);
      let enter = () => {},
        release = () => {},
        attempts = 0;
      const entered = new Promise<void>((r) => {
          enter = r;
        }),
        released = new Promise<void>((r) => {
          release = r;
        });
      const original = DataExchange.prototype.batch,
        spy = spyOn(DataExchange.prototype, "batch").mockImplementation(async function (
          this: DataExchange,
          g: TenantGrant,
          ...args: Parameters<DataExchange["batch"]> extends [TenantGrant, ...infer R] ? R : never
        ) {
          const fence = g.fence;
          return original.call(
            this,
            {
              ...g,
              fence: async (tx) => {
                await db.db
                  .collection("accounts")
                  .findOne({ _id: new ObjectId(u.id) }, { session: tx });
                if (++attempts === 1) {
                  enter();
                  await released;
                }
                await fence(tx);
              },
            },
            ...args,
          );
        });
      const inFlight = batch(c, id, u.client, ready);
      await entered;
      spy.mockRestore();
      try {
        if (action === "permissions")
          await db.db
            .collection("accounts")
            .updateOne(
              { _id: new ObjectId(u.id) },
              { $set: { role: "treasurer" }, $inc: { version: 1 } },
            );
        else
          await db.db
            .collection("churches")
            .updateOne(
              { _id: new ObjectId(c.id) },
              { $set: { status: "suspended" }, $inc: { version: 1 } },
            );
      } finally {
        release();
      }
      expect([401, 403]).toContain((await inFlight).status);
      expect(attempts).toBeGreaterThanOrEqual(2);
      for (const col of ["members", "families", "exchange_sources", "member_history"])
        expect(await count(c, col)).toBe(0);
    }
  });
  test("AC17 actual 5000-row export works; 5001 rejected and filtering precedes count", async () => {
    const c = await church(),
      m = await made(c, { phone: null }),
      sample = await db.db.collection("members").findOne({ _id: new ObjectId(m.id) });
    expect(sample).toBeTruthy();
    const seeded = Array.from({ length: 5000 }, () => ({
      ...sample,
      _id: new ObjectId(),
      code: resourceCode("TH"),
      householdRole: "child",
    }));
    await db.db.collection("members").insertMany(seeded);
    const payload = {
      filters: { participation: "current" },
      columns: ["code", "fullName", "phone"],
      format: "csv",
    };
    expect((await owner.call(`${xp(c)}/exports/preview`, payload)).status).toBe(413);
    expect(
      (
        await owner.call(`${xp(c)}/exports/preview`, {
          ...payload,
          filters: { q: "Không có tên synthetic" },
        })
      ).json.data.count,
    ).toBe(0);
    await db.db.collection("members").deleteOne({ _id: seeded[0]?._id });
    const start = performance.now(),
      preview = await owner.call(`${xp(c)}/exports/preview`, payload);
    expect(preview.status).toBe(200);
    expect(preview.json.data.count).toBe(5000);
    const file = await owner.write(`${xp(c)}/exports`, {
      ...payload,
      previewToken: preview.json.data.previewToken,
    });
    expect(file.status).toBe(201);
    const downloaded = await owner.call(`${xp(c)}/exports/${file.json.data.export.id}/download`);
    expect(downloaded.status).toBe(200);
    expect(csvRows(downloaded.bytes as Uint8Array, 5000).length).toBe(5001);
    await Bun.write(
      "output/p2.5/export-boundary.json",
      JSON.stringify(
        {
          status: "PASS",
          rows: 5000,
          rejectedRows: 5001,
          previewGenerateDownloadMs: performance.now() - start,
          bytes: downloaded.bytes?.length,
          limits: "Synthetic local, no production SLA",
        },
        null,
        2,
      ),
    );
  }, 30000);
});
