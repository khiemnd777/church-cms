import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { MongoError, ObjectId } from "mongodb";
import { createApp } from "../../api/app";
import type { TenantGrant } from "../../api/authorization/tenant-grant";
import { config } from "../../api/config";
import { digest } from "../../api/identity/crypto";
import { OwnerOperations } from "../../api/identity/owner-operations";
import { Identity } from "../../api/identity/service";
import { Database, initialize } from "../../api/infrastructure/database";
import { RateLimit } from "../../api/infrastructure/rate-limit";
import { businessDay } from "../../api/members/dates";
import { Members } from "../../api/members/service";

const conf = {
  ...config(),
  origin: "https://localhost:3454",
  database: `church_cms_test_members_${crypto.randomUUID().replaceAll("-", "")}`,
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
const visitor = {
  stage: "new",
  firstVisit: null,
  believedOn: null,
  referrer: null,
  caregiverId: null,
};
describe("P2.2 real Mongo/HTTP contracts", () => {
  test("AC01 immutable codes, nullable data, consent, atomic family, safe ledger/audit and exact replay", async () => {
    const c = await church(),
      b = mp(c.id),
      key = crypto.randomUUID(),
      payload = body();
    const first = await owner.write(b, payload, undefined, key),
      replay = await owner.write(b, payload, undefined, key);
    expect(first.status).toBe(201);
    expect(replay.status).toBe(200);
    expect(replay.json.meta.replayed).toBe(true);
    expect(replay.json.data).toEqual(first.json.data);
    const id = first.json.data.member.id,
      m = (await owner.call(`${b}/${id}`)).json.data;
    expect(m.code).toMatch(/^TH-[A-Z2-9]{10}$/);
    expect(m.family.code).toMatch(/^GD-/);
    expect(m.birthDate).toBeNull();
    expect(m.age).toBeNull();
    expect(m.assignment.unitIds).toEqual([]);
    expect(m.phone).toBe("0900123456");
    expect(m.consent.wordingVersion).toBe("member-consent-r1");
    expect(m.availability).toEqual({
      attendance: "available",
      giving: "not_available",
      qr: "available",
    });
    const stored = await db.db.collection("members").findOne({ _id: new ObjectId(id) });
    expect(stored?.consent.actorKind).toBe("owner");
    expect(stored?.consent.actorId).toEqual(stored?.createdBy);
    expect(
      await db.db.collection("families").countDocuments({ churchId: new ObjectId(c.id) }),
    ).toBe(1);
    expect(
      await db.db.collection("member_history").countDocuments({ memberId: new ObjectId(id) }),
    ).toBe(1);
    const op = await owner.call(`${b}/operations/${first.json.data.operationId}`);
    expect(op.status).toBe(200);
    expect(Object.keys(op.json.data.safeResult.member).sort()).toEqual(["code", "id", "version"]);
    expect(JSON.stringify(op.json)).not.toContain(payload.fullName);
    expect(JSON.stringify(op.json)).not.toContain(payload.phone);
    const audit = await db.audits.findOne({
      eventType: "members.created",
      targetId: new ObjectId(id),
    });
    expect(audit?.targetChurchId?.toHexString()).toBe(c.id);
    expect(audit?.actorKind).toBe("owner");
    expect(
      (await owner.write(b, { ...payload, fullName: "Changed" }, undefined, key)).json.error.code,
    ).toBe("IDEMPOTENCY_CONFLICT");
    const same = await made(c);
    expect(same.id).not.toBe(id);
    expect(same.code).not.toBe(m.code);
  });
  test("AC01 schema rejects missing consent, forged authority, fake dates and invalid axes without partial writes", async () => {
    const c = await church(),
      b = mp(c.id);
    for (const extra of [
      { consent: false },
      { birthDate: "2025-02-29" },
      { birthDate: "0000-01-01" },
      { birthDate: "2999-01-01" },
      { birthDate: "2020-01-01", baptism: { status: "baptized", date: "2019-01-01", place: null } },
      { baptism: { status: "unknown", date: "2020-01-01", place: null } },
      { type: "visitor", visitor, membership: "member" },
      { churchId: new ObjectId().toHexString() },
      { code: "TH-123" },
      { familyId: new ObjectId().toHexString() },
      { phone: 90012345 },
      { phone: "abc" },
      { assignment: { mode: "auto", unitIds: [new ObjectId().toHexString()] } },
    ]) {
      const r = await owner.write(b, body(extra));
      expect(r.status).toBe(422);
    }
    expect(await db.db.collection("members").countDocuments({ churchId: new ObjectId(c.id) })).toBe(
      0,
    );
    expect(
      await db.db.collection("families").countDocuments({ churchId: new ObjectId(c.id) }),
    ).toBe(0);
  });
  test("AC02 current roles, both realms, cross-tenant IDs/cursors/families/history and namespaces", async () => {
    const c = await church(),
      foreign = await church(),
      m = await made(c),
      otherMember = await made(foreign),
      b = mp(c.id),
      fp = mp(foreign.id);
    for (const role of ["pastor", "secretary", "treasurer", "member"]) {
      const { client } = await user(c, role),
        p = mp(c.id, "church"),
        allowed = ["pastor", "secretary"].includes(role);
      for (const url of [
        p,
        `${p}/summary`,
        `${p}/options`,
        `${base(c.id, "church")}/families`,
        `${p}/${m.id}`,
        `${p}/${m.id}/history`,
      ])
        expect((await client.call(url)).status).toBe(allowed ? 200 : 403);
      expect((await client.write(p, body({ fullName: `Role ${role}` }))).status).toBe(
        allowed ? 201 : 403,
      );
      expect((await client.call(b)).status).toBe(401);
      expect((await client.call(mp(foreign.id, "church"))).status).toBe(403);
      if (allowed) {
        expect((await client.call(`${p}/${otherMember.id}`)).status).toBe(404);
        expect((await client.call(`${p}/${otherMember.id}/history`)).status).toBe(404);
        expect(
          (await client.write(p, body({ family: { kind: "existing", id: otherMember.familyId } })))
            .json.error.code,
        ).toBe("FAMILY_NOT_FOUND");
        expect(
          (
            await client.write(`churches/${c.id}/organization/units`, {
              kind: "area",
              name: `No ${role}`,
            })
          ).status,
        ).toBe(role === "pastor" ? 201 : 403);
      }
    }
    const cursor = (await owner.call(`${b}?limit=1`)).json.data.nextCursor;
    expect(cursor).toBeTruthy();
    expect((await owner.call(`${fp}?limit=1&cursor=${cursor}`)).json.error.code).toBe(
      "CURSOR_CONTEXT_MISMATCH",
    );
    const r = await owner.write(b, body());
    expect((await other.call(`${b}/operations/${r.json.data.operationId}`)).status).toBe(404);
    expect((await owner.call(`${path(c.id)}/operations/${r.json.data.operationId}`)).status).toBe(
      404,
    );
    const org = await owner.write(`${path(c.id)}/units`, { kind: "area", name: "Namespace" });
    expect((await owner.call(`${b}/operations/${org.json.data.operationId}`)).status).toBe(404);
    const limited = await user(c, "pastor", false);
    expect((await limited.client.call(mp(c.id, "church"))).status).toBe(403);
  });
  test("AC02/AC07 CSRF, If-Match CAS two tabs, immutable identity and no delete", async () => {
    const c = await church(),
      m = await made(c),
      p = `${mp(c.id)}/${m.id}`;
    expect(
      (
        await owner.call(p, { fullName: "Bad origin" }, "PATCH", {
          origin: "https://elsewhere.test",
          "idempotency-key": crypto.randomUUID(),
          "if-match": '"1"',
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await owner.call(p, { fullName: "No CAS" }, "PATCH", {
          "idempotency-key": crypto.randomUUID(),
        })
      ).status,
    ).toBe(428);
    const r = await Promise.all([
      owner.write(p, { fullName: "Tab A" }, 1),
      other.write(p, { fullName: "Tab B" }, 1),
    ]);
    expect(r.map((x) => x.status).sort()).toEqual([200, 412]);
    expect((await owner.call(p)).headers.get("etag")).toBe('"2"');
    for (const extra of [
      { code: "changed" },
      { churchId: c.id },
      { type: "visitor" },
      { familyId: m.familyId },
      { participation: "deceased" },
    ])
      expect((await owner.write(p, extra, 2)).status).toBe(422);
    expect((await owner.call(p, undefined, "DELETE")).status).toBe(405);
    expect((await owner.call(`${p}/history`)).json.data.items).toHaveLength(2);
  });
  test("AC03 actual birthday aggregation handles leap convention, nullable dates and stable paging", async () => {
    const c = await church(),
      id = new ObjectId(c.id),
      baseMember = await made(c, { birthDate: "2000-02-29" });
    // A separate app clock exercises the real aggregation without changing stored DOBs.
    const identity = new Identity(db, rate, conf, () => new Date("2025-03-01T05:00:00Z"));
    const appAtDate = createApp(identity, conf, { log: () => {} }),
      saved = app;
    app = appAtDate;
    try {
      const march = await owner.call(`${mp(c.id)}?birthday=month:3&limit=1`);
      expect(march.status).toBe(200);
      expect(march.json.data.items.map((m: { id: string }) => m.id)).toContain(baseMember.id);
      expect(march.json.data.items[0].age).toBe(25);
      expect((await owner.call(`${mp(c.id)}?birthday=month:2`)).json.data.items).toHaveLength(0);
      expect((await owner.call(`${mp(c.id)}?birthday=week`)).json.data.items).toHaveLength(1);
    } finally {
      app = saved;
    }
    expect(await db.db.collection("members").countDocuments({ churchId: id })).toBe(1);
  });
  test("AC04 active catalogue, manual limits, unknown age, auto changes only at explicit intent", async () => {
    const c = await church(),
      b = mp(c.id),
      units = (await owner.call(`${path(c.id)}/units?limit=100`)).json.data.items;
    const service = (
      await owner.write(`${path(c.id)}/units`, { kind: "service_ministry", name: "Ban Âm nhạc" })
    ).json.data.unit;
    const board = units.find((u: { kind: string }) => u.kind === "board"),
      area = (await owner.write(`${path(c.id)}/units`, { kind: "area", name: "Khu 1" })).json.data
        .unit;
    for (const unitIds of [
      [board.id],
      [area.id],
      [new ObjectId().toHexString()],
      [service.id, service.id],
      Array.from({ length: 51 }, () => new ObjectId().toHexString()),
    ])
      expect((await owner.write(b, body({ assignment: { mode: "manual", unitIds } }))).status).toBe(
        422,
      );
    const m = await made(c, { birthDate: "2000-01-01" });
    expect(m.assignment.unitIds).toHaveLength(1);
    const saved = structuredClone(m.assignment);
    await db.db
      .collection("members")
      .updateOne({ _id: new ObjectId(m.id) }, { $set: { "assignment.asOfDate": "2025-01-01" } });
    expect((await owner.write(`${b}/${m.id}`, { phone: "00123456" }, 1)).status).toBe(200);
    const unchanged = (await owner.call(`${b}/${m.id}`)).json.data;
    expect(unchanged.assignment.unitIds).toEqual(saved.unitIds);
    expect(unchanged.assignment.asOfDate).toBe("2025-01-01");
    expect((await owner.write(`${b}/${m.id}`, { birthDate: null }, 2)).json.error.code).toBe(
      "ASSIGNMENT_CONTEXT_REQUIRED",
    );
    expect(
      (
        await owner.write(
          `${b}/${m.id}`,
          { birthDate: null, assignmentContext: { settingsVersion: 1, asOfDate: today() } },
          2,
        )
      ).status,
    ).toBe(200);
    expect((await owner.call(`${b}/${m.id}`)).json.data.assignment.unitIds).toEqual([]);
    const manual = await made(c, { assignment: { mode: "manual", unitIds: [service.id] } });
    expect(manual.assignment.unitIds).toEqual([service.id]);
    expect(
      (
        await owner.write(
          `${path(c.id)}/units/${service.id}/status`,
          { status: "inactive", reason: "Synthetic stop" },
          1,
        )
      ).status,
    ).toBe(200);
    expect((await owner.write(`${b}/${manual.id}`, { phone: "09876543" }, 1)).status).toBe(200);
    expect((await owner.call(`${b}/${manual.id}`)).json.data.units[0].status).toBe("inactive");
    expect(
      (await owner.write(b, body({ assignment: { mode: "manual", unitIds: [service.id] } }))).json
        .error.code,
    ).toBe("UNIT_NOT_AVAILABLE");
    expect(
      (await owner.write(b, body({ assignmentContext: { settingsVersion: 2, asOfDate: today() } })))
        .status,
    ).toBe(412);
    expect(
      (
        await owner.write(
          b,
          body({ assignmentContext: { settingsVersion: 1, asOfDate: "2025-01-01" } }),
        )
      ).status,
    ).toBe(412);
  });
  test("AC01/04 family links, unique head race, inactive area and cross-tenant catalogue", async () => {
    const c = await church(),
      f = await church(),
      b = mp(c.id),
      area = (await owner.write(`${path(c.id)}/units`, { kind: "area", name: "Khu A" })).json.data
        .unit,
      foreignArea = (await owner.write(`${path(f.id)}/units`, { kind: "area", name: "Khu khác" }))
        .json.data.unit;
    const m = await made(c, { family: { kind: "new", areaId: area.id } }),
      child = await made(c, {
        fullName: "Con synthetic",
        householdRole: "child",
        family: { kind: "existing", id: m.familyId },
      });
    expect(child.familyId).toBe(m.familyId);
    expect(child.family.areaId).toBe(area.id);
    expect((await owner.call(`${b}/${m.id}`)).json.data.familyMembers.items[0].id).toBe(child.id);
    expect(
      (await owner.write(b, body({ family: { kind: "existing", id: m.familyId } }))).json.error
        .code,
    ).toBe("FAMILY_HEAD_EXISTS");
    const noHead = await made(c, { householdRole: "other" }),
      payload = body({ family: { kind: "existing", id: noHead.familyId } }),
      r = await Promise.all([owner.write(b, payload), other.write(b, payload)]);
    expect(r.map((x) => x.status).sort()).toEqual([201, 409]);
    expect(
      (await owner.write(b, body({ family: { kind: "new", areaId: foreignArea.id } }))).json.error
        .code,
    ).toBe("UNIT_NOT_AVAILABLE");
    await owner.write(
      `${path(c.id)}/units/${area.id}/status`,
      { status: "inactive", reason: "Đóng khu" },
      1,
    );
    expect(
      (
        await owner.write(
          b,
          body({ family: { kind: "existing", id: m.familyId }, householdRole: "other" }),
        )
      ).status,
    ).toBe(422);
    expect((await owner.write(`${b}/${m.id}`, { phone: "00123456" }, 1)).status).toBe(200);
    expect((await owner.call(`${b}/${m.id}`)).json.data.family.areaStatus).toBe("inactive");
    const families = (await owner.call(`${base(c.id)}/families?q=${m.family.code}`)).json.data;
    expect(families.items[0].headName).toBe(m.fullName);
  });
  test("AC05 visitor stage/conversion retains identity, snapshots and nullable dates; no class or account binding", async () => {
    const c = await church(),
      b = mp(c.id),
      care = await made(c),
      m = await made(c, {
        type: "visitor",
        membership: null,
        visitor: { ...visitor, caregiverId: care.id },
      }),
      p = `${b}/${m.id}`;
    expect(m.caregiverName).toBe(care.fullName);
    expect(
      (
        await owner.write(
          `${p}/visitor-stage`,
          { stage: "exploring", believedOn: null, reason: "Đã gặp" },
          1,
        )
      ).status,
    ).toBe(200);
    const key = crypto.randomUUID(),
      payload = { effectiveOn: today(), believedOn: null, reason: "Xác nhận tin Chúa" };
    const headers = { "idempotency-key": key, "if-match": '"2"' };
    const converted = await owner.call(`${p}/conversion`, payload, "POST", headers);
    expect(converted.status).toBe(200);
    expect((await owner.call(`${p}/conversion`, payload, "POST", headers)).json.meta.replayed).toBe(
      true,
    );
    const after = (await owner.call(p)).json.data;
    expect(after.id).toBe(m.id);
    expect(after.code).toBe(m.code);
    expect(after.type).toBe("believer");
    expect(after.membership).toBe("preparatory");
    expect(after.visitor.stage).toBe("believed");
    expect(after.visitor.believedOn).toBeNull();
    expect(after.familyId).toBe(m.familyId);
    expect(
      (
        await owner.write(
          `${p}/visitor-stage`,
          { stage: "new", believedOn: null, reason: "Sai loại" },
          3,
        )
      ).json.error.code,
    ).toBe("NOT_A_VISITOR");
    const h = (await owner.call(`${p}/history`)).json.data.items;
    expect(h.map((x: { event: string }) => x.event)).toEqual([
      "conversion_changed",
      "visitor_stage_changed",
      "created",
    ]);
    expect(h[0].before.type).toBe("visitor");
    expect(h[0].after.type).toBe("believer");
    expect(h[0].changedFields.sort()).toEqual(["convertedOn", "membership", "type", "visitor"]);
    expect(
      await db.db
        .collection("accounts")
        .countDocuments({ churchId: new ObjectId(c.id), subjectMemberId: new ObjectId(m.id) }),
    ).toBe(0);
    expect(await db.db.listCollections({ name: "baptism_enrolments" }).toArray()).toHaveLength(0);
  });
  test("AC06 lifecycle reason/effective day/nullable event, default hides historical, explicit restoration", async () => {
    const c = await church(),
      m = await made(c),
      b = mp(c.id),
      p = `${b}/${m.id}`;
    expect(
      (
        await owner.write(
          `${p}/participation`,
          { status: "deceased", effectiveOn: today(), eventDate: null, reason: "" },
          1,
        )
      ).status,
    ).toBe(422);
    for (const [index, status] of ["long_absent", "transferred", "deceased", "active"].entries()) {
      expect(
        (
          await owner.write(
            `${p}/participation`,
            { status, effectiveOn: today(), eventDate: null, reason: `Synthetic ${status}` },
            index + 1,
          )
        ).status,
      ).toBe(200);
      expect((await owner.call(`${b}?q=${m.code}`)).json.data.items).toHaveLength(
        ["active", "long_absent"].includes(status) ? 1 : 0,
      );
      expect((await owner.call(`${b}?q=${m.code}&participation=all`)).json.data.items).toHaveLength(
        1,
      );
    }
    const h = (await owner.call(`${p}/history`)).json.data.items;
    expect(h).toHaveLength(5);
    expect(h[0].before.participation).toBe("deceased");
    expect(h[0].after.participation).toBe("active");
    expect(h[0].eventDate).toBeNull();
  });
  test("AC02 scoped keyset, summaries use same filters, word/code/phone search, family/area/unit and validation", async () => {
    const c = await church(),
      b = mp(c.id),
      first = await made(c, { fullName: "Nguyễn Văn An" }),
      second = await made(c, {
        fullName: "Nguyễn Văn An",
        type: "visitor",
        membership: null,
        visitor,
        householdRole: "child",
        family: { kind: "existing", id: first.familyId },
      });
    const p1 = (await owner.call(`${b}?limit=1`)).json.data,
      p2 = (await owner.call(`${b}?limit=1&cursor=${p1.nextCursor}`)).json.data;
    expect(p1.items).toHaveLength(1);
    expect(p2.items).toHaveLength(1);
    expect(p1.items[0].id).not.toBe(p2.items[0].id);
    expect(p2.nextCursor).toBeNull();
    for (const q of ["Văn An", "Nguyễn", "0900", first.code])
      expect((await owner.call(`${b}?q=${encodeURIComponent(q)}`)).json.data.items.length).toBe(
        q === first.code ? 1 : 2,
      );
    expect((await owner.call(`${b}?q=Van`)).json.data.items).toHaveLength(0);
    expect((await owner.call(`${b}?q=${encodeURIComponent("[.*")}`)).json.data.items).toHaveLength(
      0,
    );
    expect((await owner.call(`${b}/summary?familyId=${first.familyId}`)).json.data).toMatchObject({
      all: 2,
      believer: 1,
      visitor: 1,
      attendanceWindow: {
        until: expect.any(String),
        fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
    });
    expect(
      (await owner.call(`${b}?familyId=${first.familyId}&type=visitor`)).json.data.items[0].id,
    ).toBe(second.id);
    for (const query of [
      "limit=0",
      "limit=101",
      "limit=no",
      "sort=phone",
      "type=admin",
      "birthday=month:13",
      "familyId=no",
      "type=visitor&type=believer",
      `q=An&cursor=${p1.nextCursor}`,
      `cursor=${p1.nextCursor}x`,
    ])
      expect((await owner.call(`${b}?${query}`)).status).toBe(400);
    const h1 = (await owner.call(`${b}/${first.id}/history?limit=1`)).json.data;
    expect(h1.items).toHaveLength(1);
    expect(h1.nextCursor).toBeNull();
  });
  test("AC07 audit failure rolls back member/family/history/ledger, same intent can retry", async () => {
    const c = await church(),
      key = crypto.randomUUID(),
      b = mp(c.id),
      id = new ObjectId(c.id);
    await db.db.command({ collMod: "audit_events", validator: { $expr: { $eq: [1, 0] } } });
    try {
      expect((await owner.write(b, body(), undefined, key)).status).toBe(503);
      for (const name of ["members", "families", "member_history"])
        expect(await db.db.collection(name).countDocuments({ churchId: id })).toBe(0);
      expect(
        await db.db.collection("idempotency_operations").countDocuments({ keyHash: digest(key) }),
      ).toBe(0);
    } finally {
      await initialize(db.db);
    }
    expect((await owner.write(b, body(), undefined, key)).status).toBe(201);
  });
  test("AC07 unknown acknowledgement after real commit, original actor/namespace lookup and exact replay", async () => {
    const c = await church(),
      b = mp(c.id),
      actual = db.client.startSession.bind(db.client),
      key = crypto.randomUUID(),
      payload = body();
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
    let r: Awaited<ReturnType<Client["write"]>>;
    try {
      r = await owner.write(b, payload, undefined, key);
    } finally {
      spy.mockRestore();
    }
    expect(r.status).toBe(503);
    expect(r.json.error.code).toBe("OUTCOME_UNKNOWN");
    expect((await owner.call(`${b}/operations/${r.json.meta.operationId}`)).status).toBe(200);
    expect((await other.call(`${b}/operations/${r.json.meta.operationId}`)).status).toBe(404);
    expect((await owner.write(b, payload, undefined, key)).json.meta.replayed).toBe(true);
    expect(await db.db.collection("members").countDocuments({ churchId: new ObjectId(c.id) })).toBe(
      1,
    );
    expect(
      await db.db.collection("families").countDocuments({ churchId: new ObjectId(c.id) }),
    ).toBe(1);
  });
  test("AC07 in-flight permission revocation/suspension aborts real transaction with no partial writes", async () => {
    for (const action of ["permissions", "suspend"]) {
      const c = await church(),
        { client, id } = await user(c);
      let entered = () => {},
        resume = () => {},
        attempts = 0;
      const reached = new Promise<void>((r) => {
          entered = r;
        }),
        released = new Promise<void>((r) => {
          resume = r;
        });
      const original = Members.prototype.create;
      const spy = spyOn(Members.prototype, "create").mockImplementation(async function (
        this: Members,
        g: TenantGrant,
        ...args: Parameters<Members["create"]> extends [TenantGrant, ...infer R] ? R : never
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
                entered();
                await released;
              }
              await fence(tx);
            },
          },
          ...args,
        );
      });
      const inFlight = client.write(mp(c.id, "church"), body());
      await reached;
      spy.mockRestore();
      try {
        const r =
          action === "permissions"
            ? await owner.write(
                `${base(c.id)}/accounts/${id}/permissions`,
                { role: "member", scope: { kind: "self" } },
                (await owner.call(`${base(c.id)}/accounts/${id}`)).json.data.version,
              )
            : await owner.write(
                `${base(c.id)}/status`,
                { status: "suspended", reason: "Synthetic barrier" },
                1,
              );
        expect(r.status).toBe(200);
      } finally {
        resume();
      }
      expect([401, 403]).toContain((await inFlight).status);
      expect(attempts).toBeGreaterThanOrEqual(2);
      for (const name of ["members", "families", "member_history"])
        expect(await db.db.collection(name).countDocuments({ churchId: new ObjectId(c.id) })).toBe(
          0,
        );
      if (action === "suspend") {
        expect((await owner.call(mp(c.id))).status).toBe(403);
        const denied = await client.call(mp(c.id, "church"));
        expect(denied.status).toBe(401);
        // The failed in-flight response cleared the revoked cookie; the next request has no session.
        expect(denied.json.error.code).toBe("SESSION_EXPIRED");
      }
    }
  });
  test("AC02/03 filter composition, history paging, caregiver tenant and bounded indexed code access", async () => {
    const c = await church(),
      foreign = await church(),
      b = mp(c.id),
      area = (await owner.write(`${path(c.id)}/units`, { kind: "area", name: "Khu filter" })).json
        .data.unit,
      service = (
        await owner.write(`${path(c.id)}/units`, { kind: "service_ministry", name: "Ban filter" })
      ).json.data.unit;
    const m = await made(c, {
        birthDate: "2000-01-01",
        family: { kind: "new", areaId: area.id },
        assignment: { mode: "manual", unitIds: [service.id] },
        baptism: { status: "baptized", date: null, place: null },
      }),
      unrelated = await made(c),
      caregiver = await made(foreign);
    for (const query of [
      `areaId=${area.id}`,
      `unitId=${service.id}`,
      "baptism=baptized",
      `areaId=${area.id}&unitId=${service.id}&birthday=month:1&baptism=baptized`,
    ]) {
      const r = await owner.call(`${b}?${query}`);
      expect(r.status).toBe(200);
      expect(r.json.data.items.map((v: { id: string }) => v.id)).toEqual([m.id]);
      expect((await owner.call(`${b}/summary?${query}`)).json.data).toMatchObject({
        all: 1,
        believer: 1,
        visitor: 0,
        attendanceWindow: {
          until: expect.any(String),
          fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
        },
      });
    }
    expect((await owner.call(`${b}?areaId=${new ObjectId()}`)).json.data.items).toHaveLength(0);
    expect(
      (
        await owner.write(
          b,
          body({
            type: "visitor",
            membership: null,
            visitor: { ...visitor, caregiverId: caregiver.id },
          }),
        )
      ).json.error.code,
    ).toBe("CAREGIVER_NOT_AVAILABLE");
    for (let version = 1; version <= 3; version++)
      expect(
        (await owner.write(`${b}/${m.id}`, { phone: `090000000${version}` }, version)).status,
      ).toBe(200);
    const first = (await owner.call(`${b}/${m.id}/history?limit=2`)).json.data,
      next = (await owner.call(`${b}/${m.id}/history?limit=2&cursor=${first.nextCursor}`)).json
        .data;
    expect([...first.items, ...next.items].map((h: { version: number }) => h.version)).toEqual([
      4, 3, 2, 1,
    ]);
    expect(
      (await owner.call(`${b}/${unrelated.id}/history?limit=2&cursor=${first.nextCursor}`)).json
        .error.code,
    ).toBe("CURSOR_CONTEXT_MISMATCH");
    const doc = await db.db.collection("members").findOne({ _id: new ObjectId(m.id) });
    if (!doc) throw new Error("Missing fixture");
    await db.db.collection("members").insertMany(
      Array.from({ length: 300 }, (_, i) => ({
        ...doc,
        _id: new ObjectId(),
        code: `TH-SYNTH${String(i).padStart(5, "0")}`,
        fullName: `Synthetic ${i}`,
        nameKey: `synthetic ${i}`,
        nameTokens: [`synthetic ${i}`],
        householdRole: "other",
      })),
    );
    const page = await owner.call(`${b}?limit=100`);
    expect(page.json.data.items).toHaveLength(100);
    expect(page.json.data.nextCursor).toBeTruthy();
    const explain = await db.db
      .collection("members")
      .find({ churchId: new ObjectId(c.id), code: m.code })
      .explain("executionStats");
    expect(explain.executionStats.totalDocsExamined).toBe(1);
    expect(explain.executionStats.nReturned).toBe(1);
    await Bun.write(
      "output/p2.2/member-query-plan.json",
      JSON.stringify(
        { source: "302 synthetic rows; code equality only, not production SLA", plan: explain },
        null,
        2,
      ),
    );
  });
});
