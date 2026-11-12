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
import { OrganizationRuntime } from "../../api/organization/runtime";

const conf = {
  ...config(),
  origin: "https://localhost:3454",
  database: `church_cms_test_p24_${crypto.randomUUID().replaceAll("-", "")}`,
  csrfKey: crypto.randomUUID() + crypto.randomUUID(),
};
if (!["localhost", "127.0.0.1"].includes(new URL(conf.mongoUrl).hostname))
  throw new Error("Only local synthetic MongoDB");
const db = new Database(conf),
  rate = new RateLimit(conf.redisUrl, conf.csrfKey);
let app: ReturnType<typeof createApp>, owner: Client;
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
async function user(
  c: { id: string; code: string },
  role = "pastor",
  permanent = true,
  unitIds: string[] = [],
) {
  const email = `${crypto.randomUUID()}@example.test`,
    made = await owner.write(`owner/churches/${c.id}/accounts`, {
      email,
      displayName: "Người synthetic",
      role,
      scope:
        role === "ministry_lead"
          ? { kind: "assigned_units", unitIds }
          : { kind: role === "member" ? "self" : "church" },
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

const reason = () => ({ reason: "Synthetic P24", effectiveOn: today() });
async function unit(c: { id: string }, kind = "service_ministry") {
  const r = await owner.write(`${path(c.id)}/units`, {
    kind,
    name: `Đơn vị ${crypto.randomUUID()}`,
  });
  expect(r.status).toBe(201);
  return r.json.data.unit;
}
function cmd(
  c: { id: string },
  tail: string,
  b: object,
  v?: number,
  client = owner,
  key = crypto.randomUUID(),
  method = "POST",
) {
  return client.call(`${path(c.id, client.realm)}/${tail}`, b, method, {
    "idempotency-key": key,
    ...(v ? { "if-match": `"${v}"` } : {}),
  });
}
async function member(c: { id: string }, extra: object = {}) {
  return made(c, { membership: "member", birthDate: "1995-04-04", ...extra });
}
async function term(c: { id: string }, appointments: object[] = [], extra: object = {}) {
  const r = await cmd(c, "board-terms", {
    ...reason(),
    label: "Nhiệm kỳ synthetic",
    startOn: today(),
    endOn: "2030-12-31",
    appointments,
    ...extra,
  });
  expect(r.status).toBe(201);
  return r.json.data.term;
}
describe("P2.4 organization actual roster and bounded access", () => {
  test("AC01 unit metadata, immutable system names but editable leadership, eligibility and history", async () => {
    const c = await church(),
      m = await member(c),
      units = (await owner.call(`${path(c.id)}/units?kind=age_ministry`)).json.data.items,
      u = units[0];
    const r = await cmd(
      c,
      `units/${u.id}/details`,
      { ...reason(), leaderMemberId: m.id, scheduleText: "Chủ nhật 09:00" },
      1,
      owner,
      crypto.randomUUID(),
      "PATCH",
    );
    expect(r.status).toBe(200);
    expect(r.json.data.unit.version).toBe(2);
    expect(
      (
        await cmd(
          c,
          `units/${u.id}/details`,
          { ...reason(), leaderMemberId: m.id, scheduleText: null },
          1,
          owner,
          crypto.randomUUID(),
          "PATCH",
        )
      ).status,
    ).toBe(412);
    const foreign = await member(await church());
    expect(
      (
        await cmd(
          c,
          `units/${u.id}/details`,
          { ...reason(), leaderMemberId: foreign.id, scheduleText: null },
          2,
          owner,
          crypto.randomUUID(),
          "PATCH",
        )
      ).status,
    ).toBe(422);
    const h = await owner.call(`${path(c.id)}/units/${u.id}/history`);
    expect(h.json.data.items).toHaveLength(1);
    expect(h.json.data.items[0].before.leaderMemberId).toBeNull();
    expect(h.json.data.items[0].after.leaderMemberId).toBe(m.id);
    const overview = await owner.call(`${path(c.id)}/overview?kind=age_ministry`);
    expect(overview.status).toBe(200);
    expect(
      overview.json.data.items.find((i: { id: string }) => i.id === u.id).leader.fullName,
    ).toBe(m.fullName);
    expect(
      await db.db.collection("accounts").countDocuments({ churchId: new ObjectId(c.id) }),
    ).toBe(0);
  });
  test("AC02 add/remove service preserves auto age, recalculation preserves services and supports explicit create", async () => {
    const c = await church(),
      u = await unit(c),
      m = await member(c),
      old = m.assignment.unitIds;
    const payload = { ...reason(), changes: [{ id: m.id, version: m.version, add: true }] },
      key = crypto.randomUUID();
    expect((await cmd(c, `units/${u.id}/membership-preview`, payload, u.version)).status).toBe(200);
    expect((await cmd(c, `units/${u.id}/memberships`, payload, u.version, owner, key)).status).toBe(
      200,
    );
    expect(
      (await cmd(c, `units/${u.id}/memberships`, payload, u.version, owner, key)).json.meta
        .replayed,
    ).toBe(true);
    let current = (await owner.call(`${mp(c.id)}/${m.id}`)).json.data;
    expect(current.assignment.mode).toBe("auto");
    expect(current.assignment.unitIds).toEqual([...old, u.id]);
    expect(current.familyId).toBe(m.familyId);
    expect(
      (
        await owner.write(
          `${mp(c.id)}/${m.id}`,
          { birthDate: "1960-04-04", assignmentContext: body().assignmentContext },
          current.version,
        )
      ).status,
    ).toBe(200);
    current = (await owner.call(`${mp(c.id)}/${m.id}`)).json.data;
    expect(current.assignment.unitIds).toContain(u.id);
    expect(current.assignment.unitIds.some((id: string) => old.includes(id))).toBe(false);
    const n = await member(c, {
      assignment: { mode: "auto", unitIds: [], serviceUnitIds: [u.id] },
    });
    expect(n.assignment.unitIds).toContain(u.id);
    expect(
      (
        await cmd(
          c,
          `units/${u.id}/memberships`,
          { ...reason(), changes: [{ id: m.id, version: current.version, add: false }] },
          1,
        )
      ).status,
    ).toBe(200);
    current = (await owner.call(`${mp(c.id)}/${m.id}`)).json.data;
    expect(current.assignment.mode).toBe("auto");
    expect(current.assignment.unitIds).not.toContain(u.id);
    expect(current.assignment.unitIds).toHaveLength(1);
  });
  test("AC03 draft/null dates, confirm overlap guards, amendment/close immutable history", async () => {
    const c = await church(),
      m = await member(c),
      a = { memberId: m.id, position: "secretary" },
      t = await term(c, [a], { startOn: null, endOn: null });
    expect((await cmd(c, `board-terms/${t.id}/confirm`, reason(), 1)).status).toBe(409);
    const saved = await cmd(
      c,
      `board-terms/${t.id}`,
      { ...reason(), label: t.label, startOn: today(), endOn: "2030-12-31", appointments: [a] },
      1,
      owner,
      crypto.randomUUID(),
      "PATCH",
    );
    expect(saved.status).toBe(200);
    const confirmed = await cmd(c, `board-terms/${t.id}/confirm`, reason(), 2);
    expect(confirmed.status).toBe(200);
    const another = await term(c);
    expect((await cmd(c, `board-terms/${another.id}/confirm`, reason(), 1)).json.error.code).toBe(
      "TERM_OVERLAP",
    );
    const amended = await cmd(
      c,
      `board-terms/${t.id}/amend`,
      {
        ...reason(),
        label: t.label,
        startOn: today(),
        endOn: "2030-12-31",
        appointments: [{ memberId: m.id, position: "treasurer" }],
      },
      3,
    );
    expect(amended.status).toBe(200);
    const closed = await cmd(c, `board-terms/${t.id}/close`, reason(), 4);
    expect(closed.status).toBe(200);
    expect(closed.json.data.term.closedOn).toBe(today());
    expect(
      (
        await cmd(
          c,
          `board-terms/${t.id}`,
          { ...reason(), label: "Rewrite", startOn: null, endOn: null, appointments: [] },
          5,
          owner,
          crypto.randomUUID(),
          "PATCH",
        )
      ).status,
    ).toBe(409);
    const h = await owner.call(`${path(c.id)}/board-terms/${t.id}/history?limit=2`);
    expect(h.json.data.items).toHaveLength(2);
    expect(h.json.data.nextCursor).toBeTruthy();
    expect(
      (
        await owner.call(
          `${path(c.id)}/board-terms/${t.id}/history?limit=2&cursor=${h.json.data.nextCursor}`,
        )
      ).json.data.items,
    ).toHaveLength(2);
    expect(
      await db.db.collection("accounts").countDocuments({ churchId: new ObjectId(c.id) }),
    ).toBe(0);
  });
  test("AC03 duplicate positions/person, eligibility at confirmation, cancellation and concurrent term confirmation", async () => {
    const c = await church(),
      m = await member(c),
      n = await member(c);
    const r = await cmd(c, "board-terms", {
      ...reason(),
      label: "Trùng",
      startOn: null,
      endOn: null,
      appointments: [
        { memberId: m.id, position: "secretary" },
        { memberId: n.id, position: "secretary" },
      ],
    });
    expect(r.status).toBe(422);
    const t = await term(c, [{ memberId: m.id, position: "deacon" }]);
    await owner.write(
      `${mp(c.id)}/${m.id}/participation`,
      { ...reason(), status: "deceased", eventDate: today() },
      m.version,
    );
    expect((await cmd(c, `board-terms/${t.id}/confirm`, reason(), 1)).status).toBe(422);
    expect((await cmd(c, `board-terms/${t.id}/cancel`, reason(), 1)).status).toBe(200);
    const x = await term(c),
      y = await term(c);
    const concurrent = await Promise.all([
      cmd(c, `board-terms/${x.id}/confirm`, reason(), 1),
      cmd(c, `board-terms/${y.id}/confirm`, reason(), 1),
    ]);
    expect(concurrent.map((r) => r.status).sort()).toEqual([200, 409]);
  });
  test("AC04 assigned_units validation, no board/foreign/inactive/duplicates, bounded roster DTO", async () => {
    const c = await church(),
      u = await unit(c),
      area = await unit(c, "area"),
      m = await member(c, { family: { kind: "new", areaId: area.id } });
    const board = (await owner.call(`${path(c.id)}/units?kind=board`)).json.data.items[0];
    for (const ids of [[board.id], [(await unit(await church())).id], [u.id, u.id], []]) {
      const r = await owner.write(`${base(c.id)}/accounts`, {
        email: `${crypto.randomUUID()}@example.test`,
        displayName: "Lead",
        role: "ministry_lead",
        scope: { kind: "assigned_units", unitIds: ids },
      });
      expect(r.status).toBe(422);
    }
    const { client } = await user(c, "ministry_lead", true, [area.id]);
    const r = await client.call(`${path(c.id, "church")}/units/${area.id}/members`);
    expect(r.status).toBe(200);
    expect(r.json.data.total).toBe(1);
    expect(Object.keys(r.json.data.items[0]).sort()).toEqual([
      "age",
      "code",
      "fullName",
      "id",
      "participation",
      "unitId",
    ]);
    expect(r.json.data.items[0].id).toBe(m.id);
    expect((await client.call(`${path(c.id, "church")}/units/${u.id}/members`)).status).toBe(404);
    const overview = await client.call(`${path(c.id, "church")}/overview`);
    expect(overview.json.data.items).toHaveLength(1);
    expect(overview.json.data.items[0].leaderMemberId).toBeNull();
    expect(overview.json.data.items[0].householdCount).toBeNull();
    for (const tail of [
      "members",
      `members/${m.id}`,
      `members/${m.id}/history`,
      "members/summary",
      "families",
      `families/${m.familyId}`,
      "organization/settings",
      "organization/units",
      "organization/board-terms",
      `organization/units/${area.id}/history`,
      `organization/operations/${new ObjectId()}`,
    ])
      expect((await client.call(`${base(c.id, "church")}/${tail}`)).status).toBe(403);
    expect(
      (await client.call(`${path(c.id, "church")}/units/${area.id}/members?phone=090`)).status,
    ).toBe(400);
  });
  test("AC04/05 scoped search/count/keyset, inactive scope no fallback and context-bound cursor", async () => {
    const c = await church(),
      area = await unit(c, "area"),
      outside = await unit(c, "area");
    for (let i = 0; i < 3; i++)
      await member(c, { fullName: `Trong ban ${i}`, family: { kind: "new", areaId: area.id } });
    await member(c, { fullName: "Bí mật ngoài ban", family: { kind: "new", areaId: outside.id } });
    const { client, id } = await user(c, "ministry_lead", true, [area.id, outside.id]);
    const p = `${path(c.id, "church")}/units/${area.id}/members`,
      first = await client.call(`${p}?limit=2`);
    expect(first.json.data.total).toBe(3);
    expect(first.json.data.items).toHaveLength(2);
    const cursor = first.json.data.nextCursor;
    expect((await client.call(`${p}?limit=2&cursor=${cursor}`)).json.data.items).toHaveLength(1);
    expect((await client.call(`${p}?q=${encodeURIComponent("Bí mật")}`)).json.data.total).toBe(0);
    expect(
      (await client.call(`${path(c.id, "church")}/units/${outside.id}/members?cursor=${cursor}`))
        .status,
    ).toBe(400);
    const change = await owner.write(
      `${base(c.id)}/accounts/${id}/permissions`,
      { role: "ministry_lead", scope: { kind: "assigned_units", unitIds: [area.id] } },
      (await owner.call(`${base(c.id)}/accounts/${id}`)).json.data.version,
    );
    expect(change.status).toBe(200);
    expect((await client.call(`${p}?cursor=${cursor}`)).status).toBe(400);
    await owner.write(
      `${path(c.id)}/units/${area.id}/status`,
      { status: "inactive", reason: "Synthetic" },
      1,
    );
    expect((await client.call(`${p}`)).status).toBe(404);
    expect((await client.call(`${path(c.id, "church")}/overview`)).json.data.items).toHaveLength(0);
    expect((await client.call(`churches/${c.id}/context`)).status).toBe(200);
  });
  test("AC05 existing family area updates immediately change scoped roster without modifying accounts", async () => {
    const c = await church(),
      area = await unit(c, "area"),
      other = await unit(c, "area"),
      m = await member(c, { family: { kind: "new", areaId: area.id } }),
      lead = await user(c, "ministry_lead", true, [area.id]);
    expect(
      (await lead.client.call(`${path(c.id, "church")}/units/${area.id}/members`)).json.data.total,
    ).toBe(1);
    const f = (await owner.call(`${base(c.id)}/families/${m.familyId}`)).json.data;
    expect(
      (
        await owner.write(
          `${base(c.id)}/families/${m.familyId}`,
          {
            name: f.name,
            address: f.address,
            notes: f.notes,
            sinceYear: f.sinceYear,
            areaId: other.id,
            ...reason(),
          },
          f.version,
        )
      ).status,
    ).toBe(200);
    expect(
      (await lead.client.call(`${path(c.id, "church")}/units/${area.id}/members`)).json.data.total,
    ).toBe(0);
  });
  test("AC05 in-flight snapshot revoke blocks roster; every retry fences latest account", async () => {
    const c = await church(),
      area = await unit(c, "area"),
      lead = await user(c, "ministry_lead", true, [area.id]);
    await member(c, { family: { kind: "new", areaId: area.id } });
    let enter = () => {},
      release = () => {},
      attempts = 0;
    const reached = new Promise<void>((r) => {
        enter = r;
      }),
      released = new Promise<void>((r) => {
        release = r;
      }),
      original = OrganizationRuntime.prototype.roster;
    const spy = spyOn(OrganizationRuntime.prototype, "roster").mockImplementation(async function (
      this: OrganizationRuntime,
      g: TenantGrant,
      ...args: [string, URLSearchParams]
    ) {
      const fence = g.fence;
      return original.call(
        this,
        {
          ...g,
          fence: async (tx) => {
            await db.db
              .collection("accounts")
              .findOne({ _id: new ObjectId(lead.id) }, { session: tx });
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
    const reading = lead.client.call(`${path(c.id, "church")}/units/${area.id}/members`);
    await reached;
    spy.mockRestore();
    try {
      expect(
        (
          await owner.write(
            `${base(c.id)}/accounts/${lead.id}/permissions`,
            { role: "member", scope: { kind: "self" } },
            (
              await owner.call(`${base(c.id)}/accounts/${lead.id}`)
            ).json.data.version,
          )
        ).status,
      ).toBe(200);
    } finally {
      release();
    }
    const r = await reading;
    expect(r.status).toBe(401);
    expect(r.json.error.code).toBe("SESSION_REVOKED");
    expect(r.json.data).toBeUndefined();
    expect(attempts).toBeGreaterThan(1);
  });
  test("AC06 stale batch rolls back all changes, real audit validator failure rolls back history/ledger", async () => {
    const c = await church(),
      u = await unit(c),
      m = await member(c),
      n = await member(c),
      payload = {
        ...reason(),
        changes: [
          { id: m.id, version: m.version, add: true },
          { id: n.id, version: 99, add: true },
        ],
      };
    expect((await cmd(c, `units/${u.id}/memberships`, payload, 1)).status).toBe(412);
    expect((await owner.call(`${mp(c.id)}/${m.id}`)).json.data.version).toBe(1);
    const key = crypto.randomUUID();
    await db.db.command({
      collMod: "audit_events",
      validator: { eventType: { $ne: "members.service_membership_changed" } },
      validationLevel: "strict",
      validationAction: "error",
    });
    try {
      expect(
        (
          await cmd(
            c,
            `units/${u.id}/memberships`,
            { ...reason(), changes: [{ id: m.id, version: 1, add: true }] },
            1,
            owner,
            key,
          )
        ).status,
      ).toBe(503);
      expect((await owner.call(`${mp(c.id)}/${m.id}`)).json.data.version).toBe(1);
      expect(
        await db.db.collection("idempotency_operations").countDocuments({ keyHash: digest(key) }),
      ).toBe(0);
      expect(
        await db.db
          .collection("organization_history")
          .countDocuments({ targetId: new ObjectId(u.id) }),
      ).toBe(0);
    } finally {
      await initialize(db.db);
    }
  });
  test("AC06 committed unknown acknowledgement replays exactly once and receipt actor isolation", async () => {
    const c = await church(),
      t = await term(c),
      key = crypto.randomUUID(),
      actual = db.client.startSession.bind(db.client);
    const spy = spyOn(db.client, "startSession").mockImplementation((...args) => {
      const s = actual(...args),
        commit = s.commitTransaction.bind(s);
      s.commitTransaction = async () => {
        await commit();
        const e = new MongoError("Synthetic lost ack");
        e.addErrorLabel("UnknownTransactionCommitResult");
        throw e;
      };
      return s;
    });
    let r: Awaited<ReturnType<typeof cmd>>;
    try {
      r = await cmd(c, `board-terms/${t.id}/confirm`, reason(), 1, owner, key);
    } finally {
      spy.mockRestore();
    }
    expect(r.status).toBe(503);
    expect(r.json.error.code).toBe("OUTCOME_UNKNOWN");
    expect((await owner.call(`${path(c.id)}/operations/${r.json.meta.operationId}`)).status).toBe(
      200,
    );
    expect(
      (await cmd(c, `board-terms/${t.id}/confirm`, reason(), 1, owner, key)).json.meta.replayed,
    ).toBe(true);
    const other = await newOwner();
    expect((await other.call(`${path(c.id)}/operations/${r.json.meta.operationId}`)).status).toBe(
      404,
    );
    expect(
      await db.db
        .collection("organization_history")
        .countDocuments({ targetId: new ObjectId(t.id), event: "term_confirm" }),
    ).toBe(1);
  });
  test("AC04 policy backend and role matrix, secretary memberships only, CSRF/method/query guards", async () => {
    const c = await church(),
      u = await unit(c),
      m = await member(c),
      sec = await user(c, "secretary"),
      treasurer = await user(c, "treasurer");
    const policy = await treasurer.client.call(`${base(c.id, "church")}/authorization/policy`);
    expect(policy.status).toBe(200);
    expect(
      policy.json.data.rows.find((r: { role: string }) => r.role === "ministry_lead").profiles,
    ).toContain("Ban mình");
    expect((await treasurer.client.call(`${path(c.id, "church")}/overview`)).status).toBe(403);
    expect(
      (
        await cmd(
          c,
          `units/${u.id}/details`,
          { ...reason(), leaderMemberId: null, scheduleText: null },
          1,
          sec.client,
          crypto.randomUUID(),
          "PATCH",
        )
      ).status,
    ).toBe(403);
    const r = await cmd(
      c,
      `units/${u.id.toUpperCase()}/memberships`,
      { ...reason(), changes: [{ id: m.id, version: 1, add: true }] },
      1,
      sec.client,
    );
    expect(r.status).toBe(200);
    expect(
      (await sec.client.call(`${path(c.id, "church")}/operations/${r.json.data.operationId}`))
        .status,
    ).toBe(200);
    expect(
      (
        await cmd(
          c,
          "board-terms",
          { ...reason(), label: "Denied", startOn: null, endOn: null, appointments: [] },
          undefined,
          sec.client,
        )
      ).status,
    ).toBe(403);
    expect((await owner.call(`${path(c.id)}/overview?unexpected=1`)).status).toBe(400);
    expect((await owner.call(`${path(c.id)}/overview`, {}, "POST")).status).toBe(405);
    expect(
      (
        await owner.call(
          `${path(c.id)}/units/${u.id}/details`,
          { ...reason(), leaderMemberId: null, scheduleText: null },
          "PATCH",
          { "x-csrf-token": "wrong", "if-match": '"1"' },
        )
      ).status,
    ).toBe(403);
  });
  test("AC05 snapshot races with service removal, family area change, unit stop and church suspension", async () => {
    for (const kind of ["service", "area", "inactive", "suspend"]) {
      const c = await church(),
        u = await unit(c, kind === "service" ? "service_ministry" : "area"),
        outside = await unit(c, "area"),
        m = await member(
          c,
          kind === "service"
            ? { assignment: { mode: "auto", unitIds: [], serviceUnitIds: [u.id] } }
            : { family: { kind: "new", areaId: u.id } },
        ),
        lead = await user(c, "ministry_lead", true, [u.id]);
      let enter = () => {},
        release = () => {},
        attempts = 0;
      const reached = new Promise<void>((r) => {
          enter = r;
        }),
        released = new Promise<void>((r) => {
          release = r;
        }),
        original = OrganizationRuntime.prototype.roster;
      const spy = spyOn(OrganizationRuntime.prototype, "roster").mockImplementation(async function (
        this: OrganizationRuntime,
        g: TenantGrant,
        ...args: [string, URLSearchParams]
      ) {
        const fence = g.fence;
        return original.call(
          this,
          {
            ...g,
            fence: async (tx) => {
              await db.db
                .collection("accounts")
                .findOne({ _id: new ObjectId(lead.id) }, { session: tx });
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
      const reading = lead.client.call(`${path(c.id, "church")}/units/${u.id}/members`);
      await reached;
      spy.mockRestore();
      try {
        const changed =
          kind === "service"
            ? await cmd(
                c,
                `units/${u.id}/memberships`,
                { ...reason(), changes: [{ id: m.id, version: 1, add: false }] },
                1,
              )
            : kind === "area"
              ? await owner.write(
                  `${base(c.id)}/families/${m.familyId}`,
                  { areaId: outside.id, ...reason() },
                  (await owner.call(`${base(c.id)}/families/${m.familyId}`)).json.data.version,
                )
              : kind === "inactive"
                ? await owner.write(
                    `${path(c.id)}/units/${u.id}/status`,
                    { status: "inactive", reason: "Synthetic" },
                    1,
                  )
                : await owner.write(
                    `${base(c.id)}/status`,
                    { status: "suspended", reason: "Synthetic" },
                    1,
                  );
        expect(changed.status).toBe(200);
      } finally {
        release();
      }
      const r = await reading;
      expect(attempts).toBeGreaterThanOrEqual(2);
      if (kind === "service" || kind === "area") {
        expect(r.status).toBe(200);
        expect(r.json.data.total).toBe(0);
        expect(r.json.data.items).toHaveLength(0);
      } else {
        expect(kind === "inactive" ? [404] : [401, 403]).toContain(r.status);
        expect(r.json.data).toBeUndefined();
      }
    }
  });
  test("AC02/04 batch/input bounds and inactive assigned target remain deny-by-default", async () => {
    const c = await church(),
      u = await unit(c),
      m = await member(c);
    for (const changes of [
      [
        { id: m.id, version: 1, add: true },
        { id: m.id, version: 1, add: false },
      ],
      Array.from({ length: 101 }, () => ({
        id: new ObjectId().toHexString(),
        version: 1,
        add: true,
      })),
    ])
      expect((await cmd(c, `units/${u.id}/memberships`, { ...reason(), changes }, 1)).status).toBe(
        422,
      );
    await owner.write(
      `${path(c.id)}/units/${u.id}/status`,
      { status: "inactive", reason: "Synthetic" },
      1,
    );
    const target = {
      email: `${crypto.randomUUID()}@example.test`,
      displayName: "Synthetic",
      role: "ministry_lead",
      scope: { kind: "assigned_units", unitIds: [u.id] },
    };
    expect((await owner.write(`${base(c.id)}/accounts`, target)).status).toBe(422);
    expect(
      (
        await owner.write(`${base(c.id)}/accounts`, {
          ...target,
          scope: {
            kind: "assigned_units",
            unitIds: Array.from({ length: 51 }, () => new ObjectId().toHexString()),
          },
        })
      ).status,
    ).toBe(422);
    const history = await owner.call(`${mp(c.id)}/${m.id}/history`);
    expect(history.json.data.items).toHaveLength(1);
  });
});
