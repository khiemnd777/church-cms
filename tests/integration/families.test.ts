import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { MongoError, ObjectId } from "mongodb";
import { createApp } from "../../api/app";
import type { TenantGrant } from "../../api/authorization/tenant-grant";
import { config } from "../../api/config";
import { FamilyApplication } from "../../api/families/application";
import { digest } from "../../api/identity/crypto";
import { OwnerOperations } from "../../api/identity/owner-operations";
import { Identity } from "../../api/identity/service";
import { Database, initialize } from "../../api/infrastructure/database";
import { RateLimit } from "../../api/infrastructure/rate-limit";
import { businessDay } from "../../api/members/dates";

const conf = {
  ...config(),
  origin: "https://localhost:3454",
  database: `church_cms_test_families_${crypto.randomUUID().replaceAll("-", "")}`,
  csrfKey: crypto.randomUUID() + crypto.randomUUID(),
};
if (!["localhost", "127.0.0.1"].includes(new URL(conf.mongoUrl).hostname))
  throw new Error("Only local synthetic MongoDB");
const db = new Database(conf),
  rate = new RateLimit(conf.redisUrl, conf.csrfKey);
let app: ReturnType<typeof createApp>, owner: Client, other: Client;
const logs: object[] = [];
class Client {
  jar = new Map<string, string>();
  csrf = "";
  ip = crypto.randomUUID();
  constructor(public realm: "owner" | "church" = "owner") {}
  async call(
    path: string,
    body?: object,
    method = body ? "POST" : "GET",
    headers: Record<string, string> = {},
  ) {
    const response = await app(
      new Request(`${conf.origin}/api/v1/${path}`, {
        method,
        headers: {
          cookie: [...this.jar].map(([k, v]) => `${k}=${v}`).join(";"),
          ...(body
            ? { "content-type": "application/json", origin: conf.origin, "x-csrf-token": this.csrf }
            : {}),
          ...headers,
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
      { ip: this.ip },
    );
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(";")[0] as string,
        i = pair.indexOf("=");
      if (pair.slice(i + 1)) this.jar.set(pair.slice(0, i), pair.slice(i + 1));
      else this.jar.delete(pair.slice(0, i));
    }
    const json = response.status === 204 ? null : await response.json();
    if (json?.data?.csrfToken) this.csrf = json.data.csrfToken;
    return { status: response.status, json, headers: response.headers };
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
  const email = `${crypto.randomUUID()}@example.test`,
    made = await owner.write(`owner/churches/${c.id}/accounts`, {
      email,
      displayName: "Người synthetic",
      role,
      scope: { kind: role === "member" ? "self" : "church" },
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
  const identity = new Identity(db, rate, conf);
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
const bodyMember = body;
const fp = (id: string, realm: "owner" | "church" = "owner") => `${base(id, realm)}/families`;
const metadata = (extra: object = {}) => ({
  name: null,
  address: null,
  notes: null,
  sinceYear: null,
  areaId: null,
  ...extra,
});
const change = (
  m: { id: string; version: number; householdRole: string },
  role = m.householdRole,
) => ({ id: m.id, version: m.version, role });
async function family(c: { id: string }, extra: object = {}) {
  const r = await owner.write(fp(c.id), metadata(extra));
  expect(r.status).toBe(201);
  return (await owner.call(`${fp(c.id)}/${r.json.data.family.id}`)).json.data;
}
async function detail(c: { id: string }, id: string) {
  return (await owner.call(`${fp(c.id)}/${id}`)).json.data;
}
async function command(
  c: { id: string },
  id: string,
  kind: string,
  body: object,
  client = owner,
  expected?: number,
  key = crypto.randomUUID(),
  preview = false,
) {
  const realm = client.realm,
    p = `${fp(c.id, realm)}/${id}/${preview ? "preview" : { roles: "roles", transfer: "transfers", split: "splits", merge: "merges" }[kind as "roles"]}`,
    version = expected ?? (await client.call(`${fp(c.id, realm)}/${id}`)).json.data.version;
  return client.call(p, { kind, ...body }, kind === "roles" && !preview ? "PATCH" : "POST", {
    "if-match": `"${version}"`,
    "idempotency-key": key,
  });
}
const reason = () => ({ reason: "Synthetic family action", effectiveOn: today() });
describe("P2.3 family real transaction contracts", () => {
  test("AC01 create/edit nullable metadata, immutable IDs, consent unaffected and safe replay/history", async () => {
    const c = await church(),
      key = crypto.randomUUID(),
      payload = metadata({
        name: " Gia đình   An ",
        address: "01 đường synthetic",
        notes: "Thông tin synthetic",
      }),
      r = await owner.write(fp(c.id), payload, undefined, key);
    expect(r.status).toBe(201);
    const id = r.json.data.family.id,
      f = await detail(c, id);
    expect(f.name).toBe("Gia đình An");
    expect(f.sinceYear).toBeNull();
    expect(f.head).toBeNull();
    expect(f.count).toBe(0);
    expect(f.status).toBe("active");
    expect(f.code).toMatch(/^GD-/);
    const replay = await owner.write(fp(c.id), payload, undefined, key);
    expect(replay.json.meta.replayed).toBe(true);
    expect(replay.json.data).toEqual(r.json.data);
    expect((await owner.call(`${fp(c.id)}/operations/${r.json.data.operationId}`)).status).toBe(
      200,
    );
    expect(JSON.stringify(r.json)).not.toContain("đường");
    expect(
      (await owner.write(`${fp(c.id)}/${id}`, { address: null, sinceYear: 2001 }, 1)).status,
    ).toBe(200);
    expect((await detail(c, id)).name).toBe(f.name);
    expect((await detail(c, id)).address).toBeNull();
    expect((await detail(c, id)).sinceYear).toBe(2001);
    const audit = await db.audits.findOne({
      eventType: "families.updated",
      targetId: new ObjectId(id),
    });
    expect(audit?.changedFields.sort()).toEqual(["address", "sinceYear"]);
    expect((await owner.call(`${fp(c.id)}/${id}/history`)).json.data.items[0].actorId).toMatch(
      /^[a-f0-9]{24}$/,
    );
    for (const body of [
      { id: new ObjectId().toHexString() },
      { code: "GD-X" },
      { churchId: c.id },
      { status: "merged" },
      { mergedIntoId: new ObjectId().toHexString() },
      { sinceYear: 9999 },
      { sinceYear: 0 },
      { sinceYear: 2000.5 },
      {},
    ])
      expect((await owner.write(`${fp(c.id)}/${id}`, body, 2)).status).toBe(422);
    expect((await owner.call(`${fp(c.id)}/${id}`, undefined, "DELETE")).status).toBe(405);
    expect(
      (await owner.call(`${fp(c.id)}/${id}/history`)).json.data.items.map(
        (h: { event: string }) => h.event,
      ),
    ).toEqual(["updated", "created"]);
  });
  test("AC01 area active tenant fence and preview-only effects, legacy P2.2 picker remains code based", async () => {
    const c = await church(),
      foreign = await church(),
      f = await family(c),
      m = await made(c, { family: { kind: "existing", id: f.id }, householdRole: "other" }),
      a = (await owner.write(`${path(c.id)}/units`, { kind: "area", name: "Khu mới" })).json.data
        .unit,
      otherArea = (
        await owner.write(`${path(foreign.id)}/units`, { kind: "area", name: "Khu khác" })
      ).json.data.unit;
    const current = await detail(c, f.id),
      beforeHistory = await db.db.collection("family_history").countDocuments();
    const p = await command(
      c,
      f.id,
      "area",
      { ...reason(), areaId: a.id },
      owner,
      current.version,
      undefined,
      true,
    );
    expect(p.status).toBe(200);
    expect(p.json.data.sourceAfter.count).toBe(1);
    expect(p.json.data.areaAfter).toBe("Khu mới");
    expect(await db.db.collection("family_history").countDocuments()).toBe(beforeHistory);
    expect((await detail(c, f.id)).version).toBe(current.version);
    expect(
      (await owner.write(`${fp(c.id)}/${f.id}`, { areaId: a.id }, current.version)).json.error.code,
    ).toBe("FAMILY_REASON_REQUIRED");
    expect(
      (
        await owner.write(
          `${fp(c.id)}/${f.id}`,
          { areaId: otherArea.id, ...reason() },
          current.version,
        )
      ).json.error.code,
    ).toBe("UNIT_NOT_AVAILABLE");
    expect(
      (await owner.write(`${fp(c.id)}/${f.id}`, { areaId: a.id, ...reason() }, current.version))
        .status,
    ).toBe(200);
    expect((await owner.call(`${mp(c.id)}/${m.id}`)).json.data.family.areaName).toBe("Khu mới");
    expect((await owner.call(`${fp(c.id)}?q=${f.code}`)).json.data.items[0].id).toBe(f.id);
    await owner.write(
      `${path(c.id)}/units/${a.id}/status`,
      { status: "inactive", reason: "Test stop" },
      1,
    );
    expect((await owner.write(fp(c.id), metadata({ areaId: a.id }))).json.error.code).toBe(
      "UNIT_NOT_AVAILABLE",
    );
    expect(
      (await owner.write(`${fp(c.id)}/${f.id}`, { notes: "Giữ khu vực cũ" }, current.version + 1))
        .status,
    ).toBe(200);
  });
  test("AC03 atomic head swap, no inferred head, historical head remains on participation change", async () => {
    const c = await church(),
      head = await made(c),
      child = await made(c, {
        fullName: "Con synthetic",
        family: { kind: "existing", id: head.familyId },
        householdRole: "child",
      }),
      before = (await owner.call(`${mp(c.id)}/${head.id}`)).json.data;
    const body = { ...reason(), roleChanges: [change(head, "spouse"), change(child, "head")] },
      preview = await command(c, head.familyId, "roles", body, owner, undefined, undefined, true);
    expect(preview.status).toBe(200);
    expect(preview.json.data.sourceAfter.head).toBe(child.fullName);
    expect((await command(c, head.familyId, "roles", body)).status).toBe(200);
    const a = (await owner.call(`${mp(c.id)}/${head.id}`)).json.data,
      b = (await owner.call(`${mp(c.id)}/${child.id}`)).json.data;
    expect(a.householdRole).toBe("spouse");
    expect(b.householdRole).toBe("head");
    for (const key of ["assignment", "consent", "baptism", "participation", "phone"])
      expect(a[key]).toEqual(before[key]);
    expect(
      (await command(c, head.familyId, "roles", { ...reason(), roleChanges: [change(a, "head")] }))
        .json.error.code,
    ).toBe("FAMILY_HEAD_EXISTS");
    await owner.write(
      `${mp(c.id)}/${child.id}/participation`,
      { status: "deceased", eventDate: null, ...reason() },
      b.version,
    );
    expect((await detail(c, head.familyId)).head.id).toBe(child.id);
    const latest = (await owner.call(`${mp(c.id)}/${child.id}`)).json.data;
    expect(
      (
        await command(c, head.familyId, "roles", {
          ...reason(),
          roleChanges: [change(latest, "other")],
        })
      ).status,
    ).toBe(200);
    expect((await detail(c, head.familyId)).head).toBeNull();
    expect(
      (
        await command(c, head.familyId, "roles", {
          ...reason(),
          roleChanges: [change({ ...latest, version: latest.version + 1 }, "head")],
        })
      ).status,
    ).toBe(422);
  });
  test("AC04 transfer and exact replay preserve identity/history/profile, reject duplicate/foreign/stale role changes", async () => {
    const c = await church(),
      source = await made(c),
      target = await made(c),
      child = await made(c, {
        fullName: "Người chuyển synthetic",
        family: { kind: "existing", id: source.familyId },
        householdRole: "child",
      }),
      t = await detail(c, target.familyId),
      s = await detail(c, source.familyId),
      key = crypto.randomUUID(),
      body = {
        ...reason(),
        targetFamilyId: t.id,
        targetVersion: t.version,
        moves: [change(child, "other")],
        roleChanges: [],
      };
    const p = await command(c, s.id, "transfer", body, owner, s.version, undefined, true);
    expect(p.status).toBe(200);
    expect(p.json.data.sourceAfter.count).toBe(1);
    expect(p.json.data.targetAfter.count).toBe(2);
    expect((await owner.call(`${mp(c.id)}/${child.id}`)).json.data.familyId).toBe(s.id);
    const r = await command(c, s.id, "transfer", body, owner, s.version, key);
    expect(r.status).toBe(200);
    expect(
      (await command(c, s.id, "transfer", body, owner, s.version, key)).json.meta.replayed,
    ).toBe(true);
    const after = (await owner.call(`${mp(c.id)}/${child.id}`)).json.data;
    expect(after.familyId).toBe(t.id);
    expect(after.code).toBe(child.code);
    expect(after.id).toBe(child.id);
    expect(after.assignment).toEqual(child.assignment);
    expect(after.consent).toEqual(child.consent);
    const h = (await owner.call(`${mp(c.id)}/${child.id}/history`)).json.data.items[0];
    expect(h.event).toBe("family_changed");
    expect(h.before.familyId).toBe(s.id);
    expect(h.after.familyId).toBe(t.id);
    const histories = (await owner.call(`${fp(c.id)}/${s.id}/history`)).json.data.items;
    expect(histories[0].related[0].id).toBe(t.id);
    expect((await detail(c, t.id)).version).toBe(t.version + 1);
    expect(
      (
        await command(c, s.id, "transfer", {
          ...body,
          targetVersion: t.version + 1,
          moves: [change(child), change(child)],
        })
      ).status,
    ).toBe(422);
    expect(
      (await command(c, s.id, "transfer", { ...body, targetVersion: t.version + 1 })).json.error
        .code,
    ).toBe("VERSION_CONFLICT");
  });
  test("AC04 split creates new code with lineage, empty source retained, replay creates only one family", async () => {
    const c = await church(),
      m = await made(c),
      s = await detail(c, m.familyId),
      before = await db.db.collection("families").countDocuments({ churchId: new ObjectId(c.id) }),
      key = crypto.randomUUID(),
      body = { ...reason(), newFamily: metadata(), moves: [change(m)], roleChanges: [] };
    const preview = await command(c, s.id, "split", body, owner, s.version, undefined, true);
    expect(preview.status).toBe(200);
    expect(
      await db.db.collection("families").countDocuments({ churchId: new ObjectId(c.id) }),
    ).toBe(before);
    const r = await command(c, s.id, "split", body, owner, s.version, key);
    expect(r.status).toBe(200);
    expect((await command(c, s.id, "split", body, owner, s.version, key)).json.meta.replayed).toBe(
      true,
    );
    const newId = r.json.data.family.id,
      t = await detail(c, newId);
    expect(newId).not.toBe(s.id);
    expect(t.code).not.toBe(s.code);
    expect(t.sinceYear).toBeNull();
    expect(t.count).toBe(1);
    expect((await detail(c, s.id)).count).toBe(0);
    expect((await detail(c, s.id)).status).toBe("active");
    const h = (await owner.call(`${fp(c.id)}/${newId}/history`)).json.data.items[0];
    expect(h.event).toBe("split_created");
    expect(h.related[0].id).toBe(s.id);
  });
  test("AC04 merge includes transferred/deceased, source code retained and merged family refuses writes/joins", async () => {
    const c = await church(),
      head = await made(c),
      target = await made(c),
      child = await made(c, {
        fullName: "Historical synthetic",
        family: { kind: "existing", id: head.familyId },
        householdRole: "child",
      });
    await owner.write(
      `${mp(c.id)}/${child.id}/participation`,
      { status: "deceased", eventDate: null, ...reason() },
      1,
    );
    const deceased = (await owner.call(`${mp(c.id)}/${child.id}`)).json.data,
      s = await detail(c, head.familyId),
      t = await detail(c, target.familyId),
      body = {
        ...reason(),
        targetFamilyId: t.id,
        targetVersion: t.version,
        moves: [change(head, "other"), change(deceased)],
        roleChanges: [],
      };
    const r = await command(c, s.id, "merge", body);
    expect(r.status).toBe(200);
    const closed = await detail(c, s.id);
    expect(closed.code).toBe(s.code);
    expect(closed.status).toBe("merged");
    expect(closed.mergedInto.id).toBe(t.id);
    expect(closed.count).toBe(0);
    expect((await detail(c, t.id)).count).toBe(3);
    expect((await owner.call(`${mp(c.id)}/${child.id}`)).json.data.participation).toBe("deceased");
    expect((await owner.call(`${fp(c.id)}?q=${s.code}`)).json.data.items).toHaveLength(0);
    expect(
      (await owner.call(`${fp(c.id)}?view=cards&status=merged&q=${s.code}`)).json.data.items[0].id,
    ).toBe(s.id);
    expect(
      (
        await owner.write(
          mp(c.id),
          bodyMember({ family: { kind: "existing", id: s.id }, householdRole: "other" }),
        )
      ).json.error.code,
    ).toBe("FAMILY_MERGED");
    expect(
      (await owner.write(`${fp(c.id)}/${s.id}`, { notes: "No" }, closed.version)).json.error.code,
    ).toBe("FAMILY_MERGED");
    const next = await family(c),
      list = (await owner.call(`${fp(c.id)}/${t.id}/members?limit=100`)).json.data.items;
    expect(
      (
        await command(c, t.id, "merge", {
          ...reason(),
          targetFamilyId: next.id,
          targetVersion: next.version,
          moves: list.map((m: Parameters<typeof change>[0]) => change(m)),
          roleChanges: [],
        })
      ).status,
    ).toBe(200);
    expect((await detail(c, s.id)).mergedInto.id).toBe(t.id);
    expect((await detail(c, t.id)).mergedInto.id).toBe(next.id);
  });
  test("AC04 100-profile bound never partially merges and requires complete source roster", async () => {
    const c = await church(),
      m = await made(c),
      target = await family(c),
      template = await db.db.collection("members").findOne({ _id: new ObjectId(m.id) });
    if (!template) throw new Error("Missing fixture");
    await db.db.collection("members").insertMany(
      Array.from({ length: 100 }, (_, i) => ({
        ...template,
        _id: new ObjectId(),
        code: `TH-LIMIT${String(i).padStart(4, "0")}`,
        householdRole: "other",
      })),
    );
    const r = await command(c, m.familyId, "merge", {
      ...reason(),
      targetFamilyId: target.id,
      targetVersion: target.version,
      moves: [change(m)],
      roleChanges: [],
    });
    expect(r.json.error.code).toBe("FAMILY_COMMAND_LIMIT");
    expect((await detail(c, m.familyId)).count).toBe(101);
    expect((await detail(c, target.id)).count).toBe(0);
  });
  test("AC02 card search/paging, six-person preview, historical roster and context-bound cursors/history", async () => {
    const c = await church(),
      m = await made(c, { fullName: "Nguyễn Văn Tìm" });
    for (let i = 0; i < 7; i++)
      await made(c, {
        fullName: `Con synthetic ${i}`,
        family: { kind: "existing", id: m.familyId },
        householdRole: "child",
      });
    await family(c, { name: "Tên hộ tìm" });
    const cards = (await owner.call(`${fp(c.id)}?view=cards&q=${encodeURIComponent("Văn Tìm")}`))
      .json.data;
    expect(cards.items).toHaveLength(1);
    expect(cards.items[0].count).toBe(8);
    expect(cards.items[0].people).toHaveLength(6);
    expect(
      (await owner.call(`${fp(c.id)}?view=cards&q=${encodeURIComponent("Tên hộ")}`)).json.data
        .items,
    ).toHaveLength(1);
    const page = (await owner.call(`${fp(c.id)}?view=cards&limit=1`)).json.data,
      next = (await owner.call(`${fp(c.id)}?view=cards&limit=1&cursor=${page.nextCursor}`)).json
        .data;
    expect(next.items[0].id).not.toBe(page.items[0].id);
    expect(
      (await owner.call(`${fp(c.id)}?view=cards&q=X&cursor=${page.nextCursor}`)).json.error.code,
    ).toBe("CURSOR_CONTEXT_MISMATCH");
    for (const q of [
      "view=cards&limit=51",
      "view=cards&limit=0",
      "view=cards&limit=abc",
      "view=cards&sort=name",
      "view=cards&status=deleted",
      "view=cards&q=a&q=b",
    ])
      expect((await owner.call(`${fp(c.id)}?${q}`)).status).toBe(400);
    const p = (await owner.call(`${fp(c.id)}/${m.familyId}/members?limit=2`)).json.data,
      p2 = (await owner.call(`${fp(c.id)}/${m.familyId}/members?limit=2&cursor=${p.nextCursor}`))
        .json.data;
    expect(new Set([...p.items, ...p2.items].map((v) => v.id)).size).toBe(4);
    const h = (await owner.call(`${fp(c.id)}/${m.familyId}/history?limit=2`)).json.data,
      h2 = (await owner.call(`${fp(c.id)}/${m.familyId}/history?limit=2&cursor=${h.nextCursor}`))
        .json.data;
    expect(h.items.map((v: { version: number }) => v.version)).toEqual([8, 7]);
    expect(h2.items.map((v: { version: number }) => v.version)).toEqual([6, 5]);
  });
  test("AC03/07 preview CAS invalidated by P2.2 joins, selected profile edits and concurrent commands", async () => {
    const c = await church(),
      m = await made(c),
      target = await family(c),
      s = await detail(c, m.familyId),
      payload = {
        ...reason(),
        targetFamilyId: target.id,
        targetVersion: target.version,
        moves: [change(m)],
        roleChanges: [],
      };
    expect(
      (await command(c, s.id, "transfer", payload, owner, s.version, undefined, true)).status,
    ).toBe(200);
    await made(c, { family: { kind: "existing", id: s.id }, householdRole: "child" });
    expect((await command(c, s.id, "transfer", payload, owner, s.version)).status).toBe(412);
    expect((await owner.call(`${mp(c.id)}/${m.id}`)).json.data.familyId).toBe(s.id);
    const current = await detail(c, s.id);
    await owner.write(`${mp(c.id)}/${m.id}`, { phone: "0123456789" }, 1);
    expect((await command(c, s.id, "transfer", payload, owner, current.version)).status).toBe(412);
    const member = (await owner.call(`${mp(c.id)}/${m.id}`)).json.data,
      commandBody = { ...payload, moves: [change(member)] },
      results = await Promise.all([
        command(c, s.id, "transfer", commandBody, owner, current.version),
        command(c, s.id, "transfer", commandBody, other, current.version),
      ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 412]);
    expect((await detail(c, target.id)).count).toBe(1);
  });
  test("AC05 roles, tenant/realm/operations namespace and current suspend deny", async () => {
    const c = await church(),
      foreign = await church(),
      f = await family(c),
      otherF = await family(foreign);
    for (const role of ["pastor", "secretary", "treasurer", "member"]) {
      const { client } = await user(c, role),
        allowed = role === "pastor" || role === "secretary",
        p = fp(c.id, "church");
      for (const url of [
        p,
        `${p}?view=cards`,
        `${p}/${f.id}`,
        `${p}/${f.id}/members`,
        `${p}/${f.id}/history`,
      ])
        expect((await client.call(url)).status).toBe(allowed ? 200 : 403);
      expect((await client.write(p, metadata())).status).toBe(allowed ? 201 : 403);
      expect((await client.call(fp(c.id))).status).toBe(401);
      expect((await client.call(fp(foreign.id, "church"))).status).toBe(403);
      if (allowed) {
        expect((await client.call(`${p}/${otherF.id}`)).status).toBe(404);
        expect(
          (
            await command(
              c,
              f.id,
              "merge",
              {
                ...reason(),
                targetFamilyId: otherF.id,
                targetVersion: 1,
                moves: [],
                roleChanges: [],
              },
              client,
              1,
            )
          ).status,
        ).toBe(404);
      }
    }
    const r = await owner.write(fp(c.id), metadata());
    expect((await other.call(`${fp(c.id)}/operations/${r.json.data.operationId}`)).status).toBe(
      404,
    );
    expect((await owner.call(`${mp(c.id)}/operations/${r.json.data.operationId}`)).status).toBe(
      404,
    );
    const member = await made(c);
    const op = (await owner.call(`${mp(c.id)}/${member.id}/history`)).json.data;
    expect(op.items).toHaveLength(1);
    expect(
      (
        await owner.call(`${fp(c.id)}/${f.id}`, { notes: "No header" }, "PATCH", {
          "idempotency-key": crypto.randomUUID(),
        })
      ).status,
    ).toBe(428);
    expect(
      (
        await owner.call(`${fp(c.id)}/${f.id}`, { notes: "CSRF" }, "PATCH", {
          "if-match": '"1"',
          "idempotency-key": crypto.randomUUID(),
          origin: "https://bad.test",
        })
      ).status,
    ).toBe(403);
  });
  test("AC06 audit validator failure rolls back members, family versions, lineage, ledger and history", async () => {
    const c = await church(),
      m = await made(c),
      s = await detail(c, m.familyId),
      key = crypto.randomUUID(),
      payload = { ...reason(), newFamily: metadata(), moves: [change(m)], roleChanges: [] },
      counts = Object.fromEntries(
        await Promise.all(
          ["families", "family_history", "member_history"].map(async (n) => [
            n,
            await db.db.collection(n).countDocuments({ churchId: new ObjectId(c.id) }),
          ]),
        ),
      );
    await db.db.command({ collMod: "audit_events", validator: { $expr: { $eq: [1, 0] } } });
    try {
      expect((await command(c, s.id, "split", payload, owner, s.version, key)).status).toBe(503);
      for (const n of Object.keys(counts))
        expect(await db.db.collection(n).countDocuments({ churchId: new ObjectId(c.id) })).toBe(
          counts[n],
        );
      expect((await detail(c, s.id)).version).toBe(s.version);
      expect(
        await db.db.collection("idempotency_operations").countDocuments({ keyHash: digest(key) }),
      ).toBe(0);
    } finally {
      await initialize(db.db);
    }
    expect((await command(c, s.id, "split", payload, owner, s.version, key)).status).toBe(200);
  });
  test("AC06 real commit with lost acknowledgement resolves only original actor and exact command replay", async () => {
    const c = await church(),
      m = await made(c),
      s = await detail(c, m.familyId),
      payload = { ...reason(), newFamily: metadata(), moves: [change(m)], roleChanges: [] },
      key = crypto.randomUUID(),
      actual = db.client.startSession.bind(db.client);
    const spy = spyOn(db.client, "startSession").mockImplementation((...args) => {
      const session = actual(...args),
        commit = session.commitTransaction.bind(session);
      session.commitTransaction = async () => {
        await commit();
        const e = new MongoError("Synthetic lost ack");
        e.addErrorLabel("UnknownTransactionCommitResult");
        throw e;
      };
      return session;
    });
    let r: Awaited<ReturnType<typeof command>>;
    try {
      r = await command(c, s.id, "split", payload, owner, s.version, key);
    } finally {
      spy.mockRestore();
    }
    expect(r.status).toBe(503);
    expect(r.json.error.code).toBe("OUTCOME_UNKNOWN");
    expect((await owner.call(`${fp(c.id)}/operations/${r.json.meta.operationId}`)).status).toBe(
      200,
    );
    expect(
      (await command(c, s.id, "split", payload, owner, s.version, key)).json.meta.replayed,
    ).toBe(true);
    expect(
      await db.db.collection("families").countDocuments({ churchId: new ObjectId(c.id) }),
    ).toBe(2);
  });
  test("AC05/06 in-flight revoke/suspend prevents family command commit", async () => {
    for (const kind of ["permissions", "suspend"]) {
      const c = await church(),
        m = await made(c),
        s = await detail(c, m.familyId),
        { client, id } = await user(c),
        payload = { ...reason(), newFamily: metadata(), moves: [change(m)], roleChanges: [] };
      let enter = () => {},
        release = () => {},
        attempts = 0;
      const reached = new Promise<void>((r) => {
          enter = r;
        }),
        released = new Promise<void>((r) => {
          release = r;
        }),
        original = FamilyApplication.prototype.command;
      const spy = spyOn(FamilyApplication.prototype, "command").mockImplementation(async function (
        this: FamilyApplication,
        g: TenantGrant,
        ...args: Parameters<FamilyApplication["command"]> extends [TenantGrant, ...infer R]
          ? R
          : never
      ) {
        const fence = g.fence;
        return original.call(
          this,
          {
            ...g,
            fence: async (tx) => {
              await db.db
                .collection("accounts")
                .findOne({ _id: new ObjectId(id) }, { session: tx });
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
      const pending = command(c, s.id, "split", payload, client, s.version);
      await reached;
      spy.mockRestore();
      try {
        const r =
          kind === "permissions"
            ? await owner.write(
                `${base(c.id)}/accounts/${id}/permissions`,
                { role: "member", scope: { kind: "self" } },
                (await owner.call(`${base(c.id)}/accounts/${id}`)).json.data.version,
              )
            : await owner.write(
                `${base(c.id)}/status`,
                { status: "suspended", reason: "Barrier" },
                1,
              );
        expect(r.status).toBe(200);
      } finally {
        release();
      }
      expect([401, 403]).toContain((await pending).status);
      expect(attempts).toBeGreaterThanOrEqual(2);
      expect(
        await db.db.collection("families").countDocuments({ churchId: new ObjectId(c.id) }),
      ).toBe(1);
      expect(
        (
          await db.db.collection("members").findOne({ _id: new ObjectId(m.id) })
        )?.familyId.toHexString(),
      ).toBe(s.id);
    }
  });
  test("AC01 explicit resumable P2.2 family metadata migration preserves codes/links/dates without fabricating history", async () => {
    const c = await church(),
      id = new ObjectId(),
      createdAt = new Date("2020-01-01T00:00:00Z"),
      legacy = {
        _id: id,
        churchId: new ObjectId(c.id),
        code: "GD-LEGACYTEST",
        areaId: null,
        version: 1,
        writeFence: 0,
        createdAt,
        updatedAt: createdAt,
        createdBy: new ObjectId(),
      };
    await db.db.command({ collMod: "families", validator: {} });
    await db.db.collection("families").insertOne(legacy);
    try {
      await expect(initialize(db.db)).rejects.toThrow("upgrade-families-p23");
      await initialize(db.db, { upgradeFamiliesP23: true });
      await initialize(db.db, { upgradeFamiliesP23: true });
      const row = await db.db.collection("families").findOne({ _id: id });
      expect(row?.code).toBe(legacy.code);
      expect(row?.createdAt).toEqual(createdAt);
      expect(row?.sinceYear).toBeNull();
      expect(row?.name).toBeNull();
      expect(row?.status).toBe("active");
      expect(await db.db.collection("family_history").countDocuments({ familyId: id })).toBe(0);
    } finally {
      await initialize(db.db, { upgradeFamiliesP23: true });
    }
  });
  test("AC02 query plans with 300 synthetic families; scoped code keyset remains bounded", async () => {
    const c = await church(),
      f = await family(c),
      template = await db.db.collection("families").findOne({ _id: new ObjectId(f.id) });
    if (!template) throw new Error("Missing family fixture");
    await db.db.collection("families").insertMany(
      Array.from({ length: 300 }, (_, i) => ({
        ...template,
        _id: new ObjectId(),
        code: `GD-SYNTH${String(i).padStart(5, "0")}`,
        name: `Synthetic household ${i}`,
      })),
    );
    const r = await owner.call(`${fp(c.id)}?view=cards`);
    expect(r.status).toBe(200);
    expect(r.json.data.items).toHaveLength(12);
    expect(r.json.data.nextCursor).toBeTruthy();
    expect(
      (await other.call(`${fp(c.id)}?view=cards&cursor=${r.json.data.nextCursor}`)).json.error.code,
    ).toBe("CURSOR_CONTEXT_MISMATCH");
    const plan = await db.db
      .collection("families")
      .find({ churchId: new ObjectId(c.id), code: f.code })
      .explain("executionStats");
    expect(plan.executionStats.totalDocsExamined).toBe(1);
    expect(plan.executionStats.nReturned).toBe(1);
    await Bun.write(
      "output/p2.3/family-query-plan.json",
      JSON.stringify(
        { source: "301 synthetic families; code equality only; no production SLA", plan },
        null,
        2,
      ),
    );
  });
  test("AC04/06 stale catalogue, incomplete merge and source=target reject without partial effects", async () => {
    const c = await church(),
      m = await made(c),
      child = await made(c, {
        family: { kind: "existing", id: m.familyId },
        householdRole: "child",
      }),
      area = (await owner.write(`${path(c.id)}/units`, { kind: "area", name: "Khu race" })).json
        .data.unit,
      t = await family(c, { areaId: area.id }),
      s = await detail(c, m.familyId),
      payload = {
        ...reason(),
        targetFamilyId: t.id,
        targetVersion: t.version,
        moves: [change(m)],
        roleChanges: [],
      };
    expect((await command(c, s.id, "merge", payload)).status).toBe(412);
    expect(
      (
        await command(c, s.id, "transfer", {
          ...payload,
          targetFamilyId: s.id,
          targetVersion: s.version,
        })
      ).status,
    ).toBe(422);
    expect(
      (await command(c, s.id, "transfer", payload, owner, s.version, undefined, true)).status,
    ).toBe(200);
    await owner.write(
      `${path(c.id)}/units/${area.id}/status`,
      { status: "inactive", reason: "Preview race" },
      1,
    );
    expect((await command(c, s.id, "transfer", payload)).json.error.code).toBe(
      "UNIT_NOT_AVAILABLE",
    );
    expect((await detail(c, s.id)).count).toBe(2);
    expect((await detail(c, t.id)).count).toBe(0);
    expect((await owner.call(`${mp(c.id)}/${child.id}`)).json.data.familyId).toBe(s.id);
  });
});
