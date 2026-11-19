import { afterAll, beforeAll, expect, spyOn, test } from "bun:test";
import { type ClientSession, ObjectId } from "mongodb";
import { createApp } from "../../api/app";
import { Audit } from "../../api/audit/service";
import { config } from "../../api/config";
import { Identity } from "../../api/identity/service";
import { Database, initialize } from "../../api/infrastructure/database";
import { RateLimit } from "../../api/infrastructure/rate-limit";
import { businessDay } from "../../api/members/dates";
import type { Member } from "../../api/members/models";
import type { Prayer } from "../../api/prayers/models";
import { Prayers } from "../../api/prayers/service";
import {
  SyntheticClient,
  seedP2,
  syntheticChurch,
  syntheticOwner,
  syntheticUser,
} from "../../scripts/p2-fixtures";
import { createCertificateRite, riteFixture } from "../../scripts/p35-fixtures";
import {
  prayerCommon,
  prayerCreate,
  prayerEdit,
  prayerRoot,
  prayerSave,
} from "../../scripts/p44-fixtures";

const conf = {
  ...config(),
  origin: "https://localhost:3517",
  database: `church_cms_test_p63_${crypto.randomUUID().replaceAll("-", "")}`,
  csrfKey: crypto.randomUUID() + crypto.randomUUID(),
};
for (const address of [conf.mongoUrl, conf.redisUrl]) {
  if (!["localhost", "127.0.0.1"].includes(new URL(address).hostname))
    throw Error("Local synthetic only");
}
const db = new Database(conf),
  rate = new RateLimit(conf.redisUrl, conf.csrfKey);
let app: ReturnType<typeof createApp>, owner: SyntheticClient, ownerId: string;
const client = (realm: "owner" | "church") => {
  const ip = crypto.randomUUID();
  return new SyntheticClient(realm, conf.origin, (request) => app(request, { ip }));
};
const ownerPath = (id: string, account: string) => `owner/churches/${id}/accounts/${account}`;
const portal = (id: string) => `churches/${id}/portal`;
beforeAll(async () => {
  await db.client.connect();
  await initialize(db.db);
  await rate.connect();
  const identity = new Identity(db, rate, conf);
  await identity.initialize();
  app = createApp(identity, conf, { log: () => {} });
  owner = client("owner");
  ownerId = (await syntheticOwner(db, owner)).id;
});
afterAll(async () => {
  await db.db.dropDatabase();
  expect(
    (await db.client.db("admin").admin().listDatabases()).databases.some(
      (x) => x.name === conf.database,
    ),
  ).toBe(false);
  await db.client.close();
  if (rate.client.isOpen) rate.client.destroy();
});
async function church() {
  const c = await syntheticChurch(owner, `Cổng synthetic ${crypto.randomUUID()}`);
  await seedP2(db, c.id, ownerId, 8);
  const profiles = await db.db
    .collection<Member>("members")
    .find({ churchId: new ObjectId(c.id), type: "believer", participation: "active" })
    .sort({ _id: 1 })
    .toArray();
  return { ...c, profiles };
}
async function account(c: { id: string; code: string }, role = "member") {
  const user = client("church"),
    identity = await syntheticUser(owner, user, c, role);
  return { user, ...identity, path: ownerPath(c.id, identity.id) };
}
async function focus(path: string, code: string) {
  const r = await owner.call(`${path}/subject-options?q=${encodeURIComponent(code)}`);
  expect(r.status).toBe(200);
  expect(r.payload.data.items).toHaveLength(1);
  return r.payload.data.items[0] as { id: string; version: number; fullName: string; code: string };
}
const bind = (path: string, m: { id: string; version: number }, v: number, key?: string) =>
  owner.call(
    `${path}/subject`,
    { memberId: m.id, memberVersion: m.version, reason: "Đã đối chiếu synthetic", confirm: true },
    { method: "PATCH", version: v, key },
  );
const versionOf = async (path: string) => (await owner.call(path)).payload.data.version as number;
const assertRelogin = async (c: { code: string }, a: Awaited<ReturnType<typeof account>>) =>
  expect((await a.user.login(a.email, a.password, c.code)).status).toBe(200);

test("owner confirms a same-tenant eligible member; concurrent claim creates one binding and invalidates only the successful account", async () => {
  const c = await church(),
    other = await church();
  const a = await account(c),
    b = await account(c);
  const record = c.profiles[0];
  if (!record || !other.profiles[0]) throw Error("Synthetic member missing");
  const candidate = await focus(a.path, record.code);
  expect((await a.user.call(`${portal(c.id)}/profile`)).payload.data).toEqual({
    state: "unlinked",
    profile: null,
  });
  expect((await a.user.call(`${portal(c.id)}/rites`)).status).toBe(403);
  expect((await a.user.call(`${a.path}/subject-options`)).status).toBe(401);
  expect((await owner.call(`${portal(c.id)}/profile`)).status).toBe(401);
  expect((await a.user.call(`${portal(other.id)}/profile`)).status).toBe(404);
  expect(
    (
      await bind(
        a.path,
        { id: other.profiles[0]._id.toHexString(), version: other.profiles[0].version },
        await versionOf(a.path),
      )
    ).status,
  ).toBe(404);
  expect(
    (await bind(a.path, { ...candidate, version: candidate.version + 1 }, await versionOf(a.path)))
      .status,
  ).toBe(412);
  expect(
    (
      await owner.call(
        `${a.path}/subject`,
        { memberId: candidate.id, memberVersion: candidate.version, reason: "x", confirm: false },
        { method: "PATCH", version: await versionOf(a.path) },
      )
    ).status,
  ).toBe(422);
  const contenders = [a, b],
    versions = await Promise.all(contenders.map((u) => versionOf(u.path)));
  const keys = contenders.map(() => crypto.randomUUID());
  const replies = await Promise.all(
    contenders.map((u, i) => bind(u.path, candidate, versions[i] ?? 0, keys[i])),
  );
  expect(replies.map((r) => r.status).sort()).toEqual([200, 409]);
  const won = replies.findIndex((r) => r.status === 200),
    winner = contenders[won],
    loser = contenders[1 - won];
  if (!winner || !loser) throw Error("Link race did not produce a winner");
  const loserResponse = replies.find((r) => r.status === 409);
  expect(loserResponse?.payload.error.code).toBe("PORTAL_SUBJECT_TAKEN");
  const replay = await bind(winner.path, candidate, versions[won] ?? 0, keys[won]);
  expect(replay.status).toBe(200);
  expect(replay.payload.meta.replayed).toBe(true);
  const receipt = await owner.call(`owner/operations/${replay.payload.data.operationId}`);
  expect(receipt.status).toBe(200);
  expect(receipt.payload.data.safeResult.account.subjectMemberId).toBe(candidate.id);
  expect((await winner.user.call(`${portal(c.id)}/profile`)).status).toBe(401);
  expect((await loser.user.call(`${portal(c.id)}/profile`)).payload.data.state).toBe("unlinked");
  await assertRelogin(c, winner);
  const view = await winner.user.call(`${portal(c.id)}/profile`);
  expect(view.status).toBe(200);
  expect(view.headers.get("cache-control")).toBe("no-store");
  expect(Object.keys(view.payload.data.profile).sort()).toEqual(
    [
      "baptism",
      "birthDate",
      "code",
      "fullName",
      "gender",
      "membership",
      "participation",
      "phone",
    ].sort(),
  );
  expect(view.payload.data.profile.code).toBe(record.code);
  expect(
    await db.db
      .collection("account_subject_history")
      .countDocuments({ churchId: new ObjectId(c.id) }),
  ).toBe(1);
  const secondAccount = await owner.call(`owner/churches/${other.id}/accounts`, {
    email: winner.email,
    displayName: "Cùng email tenant khác",
    role: "member",
    scope: { kind: "self" },
  });
  expect(secondAccount.status).toBe(201);
  expect(secondAccount.payload.data.account.subjectMemberId).toBeUndefined();
}, 30000);

test("rite page returns only one's participant role and cursor fails after binding to a different member", async () => {
  const c = await church(),
    a = await account(c);
  const own = c.profiles[0],
    second = c.profiles[1];
  if (!own || !second) throw Error("Synthetic member missing");
  await createCertificateRite(owner, c.id, own._id.toHexString(), "baptism");
  await createCertificateRite(owner, c.id, own._id.toHexString(), "marriage");
  const extra = riteFixture("dedication", second._id.toHexString());
  if (extra.record.payload.kind !== "dedication") throw Error("Fixture");
  extra.record.payload.officiant = { source: "member", memberId: own._id.toHexString() };
  extra.record.note = "Ghi chú riêng synthetic không được trả";
  const rPath = `owner/churches/${c.id}/rites/records`;
  const prepared = await owner.call(`${rPath}/preview`, extra);
  expect(prepared.status).toBe(200);
  expect(
    (await owner.call(rPath, { ...extra, preview: prepared.payload.data.context })).status,
  ).toBe(201);
  expect((await bind(a.path, await focus(a.path, own.code), await versionOf(a.path))).status).toBe(
    200,
  );
  await assertRelogin(c, a);
  const home = `${portal(c.id)}/rites`;
  const page = (await a.user.call(`${home}?limit=1`)).payload.data;
  expect(page.items).toHaveLength(1);
  expect(page.nextCursor).toBeTruthy();
  const more = await a.user.call(`${home}?limit=1&cursor=${encodeURIComponent(page.nextCursor)}`);
  expect(more.status).toBe(200);
  expect(more.payload.data.nextCursor).toBeNull();
  const rows = [...page.items, ...more.payload.data.items];
  expect(rows.map((row) => row.kind).sort()).toEqual(["baptism", "marriage"]);
  expect(rows.find((row) => row.kind === "marriage").roles).toEqual(["Chú rể"]);
  expect(Object.keys(rows[0]).sort()).toEqual(["id", "kind", "date", "place", "roles"].sort());
  expect(JSON.stringify(rows)).not.toContain("Người ngoài synthetic");
  expect((await a.user.call(`${home}?memberId=${second._id}`)).status).toBe(400);
  expect((await a.user.call(`churches/${c.id}/members/${second._id}`)).status).toBe(403);
  expect(
    (await bind(a.path, await focus(a.path, second.code), await versionOf(a.path))).status,
  ).toBe(200);
  expect((await a.user.call(`${portal(c.id)}/profile`)).status).toBe(401);
  await assertRelogin(c, a);
  expect(
    (await a.user.call(`${home}?limit=1&cursor=${encodeURIComponent(page.nextCursor)}`)).status,
  ).toBe(400);
  expect((await a.user.call(`${portal(c.id)}/profile`)).payload.data.profile.code).toBe(
    second.code,
  );
}, 30000);

test("inactive then restored requires deliberate reconfirmation; unlink, lock and role change remove access", async () => {
  const c = await church(),
    a = await account(c),
    m = c.profiles[0];
  if (!m) throw Error("Synthetic member missing");
  expect((await bind(a.path, await focus(a.path, m.code), await versionOf(a.path))).status).toBe(
    200,
  );
  await assertRelogin(c, a);
  const memberPath = `owner/churches/${c.id}/members/${m._id}`;
  for (const status of ["transferred", "active"]) {
    const v = await versionOf(memberPath);
    const res = await owner.call(
      `${memberPath}/participation`,
      {
        status,
        effectiveOn: businessDay(),
        eventDate: null,
        reason: "Đổi trạng thái synthetic",
      },
      { method: "PATCH", version: v },
    );
    expect(res.status).toBe(200);
    expect((await a.user.call(`${portal(c.id)}/profile`)).payload.data).toEqual({
      state: "unavailable",
      profile: null,
    });
    expect((await a.user.call(`${portal(c.id)}/rites`)).status).toBe(403);
    expect((await a.user.call(`${portal(c.id)}/giving`)).status).toBe(403);
  }
  expect((await bind(a.path, await focus(a.path, m.code), await versionOf(a.path))).status).toBe(
    200,
  );
  expect((await a.user.call(`${portal(c.id)}/profile`)).status).toBe(401);
  await assertRelogin(c, a);
  expect((await a.user.call(`${portal(c.id)}/profile`)).payload.data.state).toBe("linked");
  expect(
    (
      await owner.call(
        `${a.path}/subject`,
        { memberId: null, reason: "Gỡ synthetic", confirm: true },
        { method: "PATCH", version: await versionOf(a.path) },
      )
    ).status,
  ).toBe(200);
  expect((await a.user.call(`${portal(c.id)}/profile`)).status).toBe(401);
  await assertRelogin(c, a);
  expect((await a.user.call(`${portal(c.id)}/profile`)).payload.data.state).toBe("unlinked");
  expect((await bind(a.path, await focus(a.path, m.code), await versionOf(a.path))).status).toBe(
    200,
  );
  await assertRelogin(c, a);
  expect(
    (
      await owner.call(
        `${a.path}/status`,
        { status: "locked", reason: "Khóa synthetic" },
        { method: "PATCH", version: await versionOf(a.path) },
      )
    ).status,
  ).toBe(200);
  expect((await a.user.call(`${portal(c.id)}/profile`)).status).toBe(401);
  expect(
    (
      await owner.call(
        `${a.path}/status`,
        { status: "active", reason: "Mở synthetic" },
        { method: "PATCH", version: await versionOf(a.path) },
      )
    ).status,
  ).toBe(200);
  await assertRelogin(c, a);
  const role = await owner.call(
    `${a.path}/permissions`,
    { role: "secretary", scope: { kind: "church" } },
    { method: "PATCH", version: await versionOf(a.path) },
  );
  expect(role.status).toBe(200);
  expect(role.payload.data.account.subjectMemberId).toBeUndefined();
  expect((await a.user.call(`${portal(c.id)}/profile`)).status).toBe(401);
  await assertRelogin(c, a);
  expect((await a.user.call(`${portal(c.id)}/profile`)).status).toBe(403);
}, 30000);

for (const projection of ["profile", "giving", "prayers"]) {
  test(`a ${projection} request authorized just before relink loses its old result at the transaction fence`, async () => {
    const c = await church(),
      a = await account(c),
      first = c.profiles[0],
      second = c.profiles[1];
    if (!first || !second) throw Error("Synthetic member missing");
    expect(
      (await bind(a.path, await focus(a.path, first.code), await versionOf(a.path))).status,
    ).toBe(200);
    await assertRelogin(c, a);
    const candidate = await focus(a.path, second.code),
      v = await versionOf(a.path);
    let enter = () => {},
      release = () => {};
    const entered = new Promise<void>((resolve) => {
      enter = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const original = db.readSnapshot.bind(db);
    const barrier = spyOn(db, "readSnapshot").mockImplementationOnce(
      async <T>(scope: string, body: (tx: ClientSession) => Promise<T>) => {
        enter();
        await gate;
        return original(scope, body);
      },
    );
    const earlier = a.user.call(`${portal(c.id)}/${projection}`);
    try {
      await entered;
      expect((await bind(a.path, candidate, v)).status).toBe(200);
    } finally {
      release();
      barrier.mockRestore();
    }
    const denied = await earlier;
    expect(denied.status).toBe(401);
    expect(denied.payload.data).toBeUndefined();
    expect(JSON.stringify(denied.payload)).not.toContain(first.code);
    await assertRelogin(c, a);
    expect((await a.user.call(`${portal(c.id)}/profile`)).payload.data.profile.code).toBe(
      second.code,
    );
  }, 30000);
}

test("P64 Finance returns exact private giving across shared, aggregate, void and replacement receipts", async () => {
  const c = await church(),
    other = await church(),
    a = await account(c),
    b = await account(c),
    pastor = await account(c, "pastor"),
    treasurer = await account(c, "treasurer"),
    secretary = await account(c, "secretary");
  const [first, second, third] = c.profiles;
  if (!first || !second || !third) throw Error("Synthetic members missing");
  const endpoint = `${portal(c.id)}/giving`,
    root = `churches/${c.id}/finance`;
  expect((await a.user.call(endpoint)).payload.error.code).toBe("PORTAL_LINK_REQUIRED");
  for (const s of [pastor, treasurer, secretary])
    expect((await s.user.call(endpoint)).status).toBe(403);
  expect((await owner.call(endpoint)).status).toBe(401);
  expect((await owner.call(`owner/churches/${c.id}/portal/giving`)).status).toBe(404);
  expect((await a.user.call(`${portal(other.id)}/giving`)).status).toBe(404);
  expect((await a.user.call(endpoint, {})).status).toBe(405);

  for (const [who, profile] of [
    [a, first],
    [b, second],
  ] as const) {
    expect(
      (await bind(who.path, await focus(who.path, profile.code), await versionOf(who.path))).status,
    ).toBe(200);
    await assertRelogin(c, who);
  }
  for (const query of [
    "period=2026-13",
    "period=0000-01",
    "period=2026-01&period=2026-02",
    "cursor=",
    "limit=101",
    `memberId=${second._id}`,
    "givingId=any",
  ]) {
    expect((await a.user.call(`${endpoint}?${query}`)).status).toBe(400);
  }

  const fundName = "Quỹ thử P64";
  const fund = await pastor.user.call(`${root}/funds`, { name: fundName });
  expect(fund.status).toBe(201);
  async function issue(member: Member) {
    const r = await treasurer.user.call(`${root}/giving-codes`, {
      memberId: member._id.toHexString(),
    });
    expect(r.status).toBe(201);
    return r.payload.data.givingId as string;
  }
  const mine = await issue(first),
    theirs = await issue(second);
  async function post(day: string, input: object) {
    const receipt = {
      submissionId: crypto.randomUUID(),
      fundId: fund.payload.data.fundId,
      businessDate: day,
      sourceReference: `INTERNAL-${crypto.randomUUID()}`,
      purpose: "Mục đích nội bộ synthetic",
      ...input,
    };
    const preview = await treasurer.user.call(`${root}/receipts/preview`, receipt);
    expect(preview.status).toBe(200);
    const r = await treasurer.user.call(`${root}/receipts`, {
      receipt,
      previewToken: preview.payload.data.previewToken,
    });
    expect(r.status).toBe(201);
    return r.payload.data.receiptId as string;
  }
  const day = "2026-01-31";
  await post(day, { mode: "itemized", lines: [{ givingId: mine, amount: "11" }] });
  const original = await post(day, {
    mode: "itemized",
    lines: [
      { givingId: mine, amount: "9007199254740993" },
      { givingId: mine, amount: "7" },
      { givingId: theirs, amount: "300" },
    ],
  });
  await post(day, { mode: "aggregate", amount: "999999" });
  await post("2025-12-31", { mode: "itemized", lines: [{ givingId: mine, amount: "19" }] });
  const period = `${endpoint}?period=2026-01`;
  const firstPage = await a.user.call(`${period}&limit=1`);
  expect(firstPage.status).toBe(200);
  expect(firstPage.headers.get("cache-control")).toBe("no-store");
  expect(firstPage.payload.data).toEqual({
    period: "2026-01",
    net: "9007199254741011",
    items: [{ businessDate: day, fundName, amount: "9007199254741000", state: "posted" }],
    nextCursor: expect.any(String),
  });
  const cursor = encodeURIComponent(firstPage.payload.data.nextCursor);
  const nextPage = await a.user.call(`${period}&limit=1&cursor=${cursor}`);
  expect(nextPage.payload.data).toEqual({
    period: "2026-01",
    net: "9007199254741011",
    items: [{ businessDate: day, fundName, amount: "11", state: "posted" }],
    nextCursor: null,
  });
  expect((await b.user.call(period)).payload.data).toEqual({
    period: "2026-01",
    net: "300",
    items: [{ businessDate: day, fundName, amount: "300", state: "posted" }],
    nextCursor: null,
  });
  expect((await b.user.call(`${period}&cursor=${cursor}`)).payload.error.code).toBe(
    "CURSOR_CONTEXT_MISMATCH",
  );
  expect(
    (await a.user.call(`${endpoint}?period=2026-02&cursor=${cursor}`)).payload.error.code,
  ).toBe("CURSOR_CONTEXT_MISMATCH");

  const voided = await treasurer.user.call(
    `${root}/receipts/${original}/void`,
    {
      reason: "Lý do nội bộ synthetic",
      confirmed: true,
    },
    { version: 1 },
  );
  expect(voided.status).toBe(200);
  await post("2026-02-01", {
    mode: "itemized",
    replacesReceiptId: original,
    lines: [{ givingId: mine, amount: "125" }],
  });
  const codeStatus = await treasurer.user.call(
    `${root}/giving-codes/${mine}/status`,
    { status: "inactive", reason: "Ngừng mã thử" },
    { method: "PATCH", version: 1 },
  );
  expect(codeStatus.status).toBe(200);

  const ledger = db.db.collection("finance_ledger");
  const financesBefore = await ledger
    .find({ churchId: new ObjectId(c.id) })
    .sort({ _id: 1 })
    .toArray();
  const january = await a.user.call(period);
  expect(january.payload.data.net).toBe("11");
  expect(january.payload.data.items).toContainEqual({
    businessDate: day,
    fundName,
    amount: "9007199254741000",
    state: "voided",
  });
  expect(january.payload.data.items).toHaveLength(2);
  expect((await a.user.call(`${endpoint}?period=2026-02`)).payload.data).toEqual({
    period: "2026-02",
    net: "125",
    items: [{ businessDate: "2026-02-01", fundName, amount: "125", state: "posted" }],
    nextCursor: null,
  });
  expect((await a.user.call(`${endpoint}?period=2026-03`)).payload.data).toEqual({
    period: "2026-03",
    net: "0",
    items: [],
    nextCursor: null,
  });
  expect(
    await ledger
      .find({ churchId: new ObjectId(c.id) })
      .sort({ _id: 1 })
      .toArray(),
  ).toEqual(financesBefore);
  expect((await a.user.call(`${root}/receipts/${original}`)).status).toBe(403);

  expect(
    (await bind(a.path, await focus(a.path, third.code), await versionOf(a.path))).status,
  ).toBe(200);
  expect((await a.user.call(`${period}&cursor=${cursor}`)).status).toBe(401);
  await assertRelogin(c, a);
  expect((await a.user.call(`${period}&cursor=${cursor}`)).payload.error.code).toBe(
    "CURSOR_CONTEXT_MISMATCH",
  );
  expect((await a.user.call(period)).payload.data.net).toBe("0");
}, 30_000);

test("P65 portal visibility, source attribution, status projection and durable intent reconciliation", async () => {
  const c = await church(),
    other = await church(),
    a = await account(c),
    b = await account(c),
    pastor = await account(c, "pastor"),
    secretary = await account(c, "secretary"),
    outside = await account(other, "pastor");
  const [first, second, third] = c.profiles;
  if (!first || !second || !third) throw Error("Synthetic members missing");
  const path = `${portal(c.id)}/prayers`,
    cId = new ObjectId(c.id),
    aid = new ObjectId(a.id);
  const intent = { category: "family", content: "Riêng tư tín hữu P65 synthetic", confirmed: true };
  const key = crypto.randomUUID();
  const op = (url: string, x = intent) => a.user.call(url, x, { key });
  expect((await op(path)).payload.error.code).toBe("PORTAL_LINK_REQUIRED");
  expect((await owner.call(path)).status).toBe(401);
  expect((await pastor.user.call(path, intent)).status).toBe(403);
  expect((await op(`${portal(other.id)}/prayers`)).status).toBe(404);
  for (const [who, m] of [
    [a, first],
    [b, second],
  ] as const) {
    expect(
      (await bind(who.path, await focus(who.path, m.code), await versionOf(who.path))).status,
    ).toBe(200);
    await assertRelogin(c, who);
  }
  expect(
    (await a.user.call(path, intent, { key, headers: { origin: "https://example.test" } })).payload
      .error.code,
  ).toBe("CSRF_FAILED");
  expect((await op(path, { ...intent, confirmed: false })).payload.error.code).toBe(
    "PRAYER_CONFIRMATION_REQUIRED",
  );
  for (const extras of [
    { audience: "shared" },
    { requester: { kind: "member", id: second._id } },
    { accountId: b.id },
  ])
    expect((await op(path, { ...intent, ...extras })).status).toBe(422);
  expect((await a.user.call(`${path}?memberId=${second._id}`)).status).toBe(400);
  expect((await a.user.call(`${path}/${new ObjectId()}`, intent, { method: "PATCH" })).status).toBe(
    404,
  );
  const enteredByStaff = await prayerSave(
    pastor.user,
    c,
    prayerCreate("pastoral", {
      requester: { kind: "member", id: first._id.toHexString() },
      content: "Nhập hộ P65 synthetic",
    }),
  );
  expect(enteredByStaff.status).toBe(201);
  expect((await a.user.call(path)).payload.data.items).toEqual([]);

  const replies = await Promise.all([op(path), op(path)]);
  expect(replies.map((x) => x.status)).toContain(201);
  expect(replies.every((reply) => [200, 201, 409].includes(reply.status))).toBe(true);
  const initial = replies.find((x) => x.status === 201);
  expect(initial?.payload.data).toEqual({ code: expect.any(String), status: "sent" });
  const retry = await op(path);
  expect(retry.status).toBe(200);
  expect(retry.payload.meta.replayed).toBe(true);
  expect(retry.payload.data).toEqual(initial?.payload.data);
  expect((await op(path, { ...intent, content: "Nội dung khác" })).payload.error.code).toBe(
    "IDEMPOTENCY_CONFLICT",
  );

  const prayers = db.db.collection<Prayer>("prayer_requests");
  const stored = await prayers.findOne({ churchId: cId, "portalSubmission.accountId": aid });
  if (!stored) throw Error("Portal prayer missing");
  const storedId = stored._id.toHexString();
  expect(stored).toMatchObject({
    requester: { kind: "member", id: first._id.toHexString() },
    visibility: "pastoral",
    state: "open",
  });
  expect(stored.portalSubmission?.memberId.equals(first._id)).toBe(true);
  await expect(
    prayers.insertOne({ ...stored, _id: new ObjectId(), code: "CT-DUPLICATE-INTENT" }),
  ).rejects.toMatchObject({ code: 11000 });
  await expect(
    prayers.updateOne({ _id: stored._id }, { $set: { visibility: "shared" } }),
  ).rejects.toMatchObject({ code: 121 });
  const operations = db.db.collection("idempotency_operations");
  const opRow = await operations.findOne({
    churchId: cId,
    routeKey: `prayers/${c.id}/portal-submission`,
  });
  if (!opRow) throw Error("Retry receipt missing");
  expect(JSON.stringify(opRow)).not.toContain(intent.content);
  await operations.updateOne(
    { _id: opRow._id },
    { $set: { createdAt: new Date(Date.now() - 26 * 60 * 60_000) } },
  );
  const expired = await op(path);
  expect(expired.status).toBe(200);
  expect(expired.payload.data).toEqual(retry.payload.data);
  await operations.deleteOne({ _id: opRow._id });
  const removed = await op(path);
  expect(removed.status).toBe(200);
  expect(removed.payload.data).toEqual(retry.payload.data);
  expect(await prayers.countDocuments({ churchId: cId, "portalSubmission.key": key })).toBe(1);
  const renewed = await operations.findOne({
    churchId: cId,
    routeKey: `prayers/${c.id}/portal-submission`,
    actorId: aid,
  });
  if (!renewed) throw Error("Reconciled receipt missing");

  expect((await a.user.call(path)).headers.get("cache-control")).toBe("no-store");
  expect((await a.user.call(path)).payload.data.items).toEqual([
    {
      id: storedId,
      code: stored.code,
      category: "family",
      content: intent.content,
      submittedAt: stored.createdAt.toISOString(),
      status: "sent",
    },
  ]);
  expect((await b.user.call(path)).payload.data.items).toEqual([]);
  const ownB = await b.user.call(path, { ...intent, content: "Của tín hữu thứ hai" }, { key });
  expect(ownB.status).toBe(201);
  expect((await b.user.call(path)).payload.data.items).toHaveLength(1);

  for (const who of [owner, secretary.user, outside.user]) {
    const staff = prayerRoot(c, who);
    const list = await who.call(`${staff}?q=${encodeURIComponent(intent.content)}&state=all`);
    if (who === outside.user) expect(list.status).toBe(404);
    else {
      expect(list.payload.data.items).toEqual([]);
      expect(list.payload.data.summary.total).toBe(0);
      expect((await who.call(`${staff}?state=all`)).payload.data.summary.total).toBe(0);
    }
    expect((await who.call(`${staff}/${storedId}`)).status).toBe(404);
    expect((await who.call(`${staff}/${storedId}/history`)).status).toBe(404);
    expect((await who.call(`${staff}/operations/${renewed._id}`)).status).toBe(404);
  }
  expect(
    (await owner.call(`owner/audit-events?churchId=${c.id}&eventType=prayer.create`)).payload.data
      .items,
  ).toEqual([]);
  expect(
    (await pastor.user.call(`${prayerRoot(c, pastor.user)}/operations/${renewed._id}`)).status,
  ).toBe(404);
  expect((await a.user.call(`${prayerRoot(c, a.user)}/operations/${renewed._id}`)).status).toBe(
    403,
  );

  const staffPath = `${prayerRoot(c, pastor.user)}/${storedId}`;
  const detail = (await pastor.user.call(staffPath)).payload.data;
  expect(detail).toMatchObject({ fromPortal: true, content: intent.content });
  const history = await pastor.user.call(`${staffPath}/history`);
  expect(
    history.payload.data.items.map((e: { actorId: string; event: string }) => [e.actorId, e.event]),
  ).toEqual([[a.id, "create"]]);
  expect(
    (
      await pastor.user.call(
        `${staffPath}/preview`,
        {
          action: "share",
          ...prayerCommon,
          reason: "Thử chia sẻ",
          sharedOn: businessDay(),
        },
        { version: 1 },
      )
    ).payload.error.code,
  ).toBe("PRAYER_PRIVATE_SHARE");
  expect(
    (
      await pastor.user.call(`${staffPath}/preview`, prayerEdit(detail, { content: "Thử sửa" }), {
        version: 1,
      })
    ).payload.error.code,
  ).toBe("PRAYER_PORTAL_IMMUTABLE");
  expect(
    (
      await prayerSave(
        pastor.user,
        c,
        { action: "close", ...prayerCommon, reason: "Lý do nội bộ P65" },
        storedId,
        1,
      )
    ).status,
  ).toBe(200);
  const closed = await a.user.call(path);
  expect(closed.payload.data.items[0].status).toBe("closed");
  expect(JSON.stringify(closed.payload)).not.toContain("Lý do nội bộ P65");
  expect((await prayers.findOne({ _id: stored._id }))?.portalSubmission).toEqual(
    stored.portalSubmission,
  );
  await a.user.call(path, { ...intent, content: "Yêu cầu thứ hai synthetic" });
  const page = await a.user.call(`${path}?limit=1`);
  const next = encodeURIComponent(page.payload.data.nextCursor);
  expect(next).not.toBe("null");
  expect((await b.user.call(`${path}?cursor=${next}`)).payload.error.code).toBe(
    "CURSOR_CONTEXT_MISMATCH",
  );
  expect(
    (await a.user.call(`${path}?cursor=${next}`)).payload.data.items.map(
      (item: Prayer) => item.code,
    ),
  ).toEqual([stored.code]);
  const cancelId = page.payload.data.items[0].id;
  expect(
    (
      await prayerSave(
        pastor.user,
        c,
        { action: "cancel", ...prayerCommon, reason: "Hủy thử" },
        cancelId,
        1,
      )
    ).status,
  ).toBe(200);
  expect(
    (await a.user.call(path)).payload.data.items.map((item: { status: string }) => item.status),
  ).toEqual(["cancelled", "closed"]);

  expect(
    (await bind(a.path, await focus(a.path, third.code), await versionOf(a.path))).status,
  ).toBe(200);
  expect((await a.user.call(path)).status).toBe(401);
  await assertRelogin(c, a);
  expect((await op(path)).payload.error.code).toBe("IDEMPOTENCY_CONFLICT");
  expect((await a.user.call(`${path}?cursor=${next}`)).payload.error.code).toBe(
    "CURSOR_CONTEXT_MISMATCH",
  );
  expect((await a.user.call(path)).payload.data.items).toEqual([]);
  const replacementAccount = await account(c);
  expect(
    (
      await bind(
        replacementAccount.path,
        await focus(replacementAccount.path, first.code),
        await versionOf(replacementAccount.path),
      )
    ).status,
  ).toBe(200);
  await assertRelogin(c, replacementAccount);
  expect((await replacementAccount.user.call(path)).payload.data.items).toEqual([]);
  expect(
    (
      await owner.call(
        `${a.path}/permissions`,
        { role: "secretary", scope: { kind: "church" } },
        { method: "PATCH", version: await versionOf(a.path) },
      )
    ).status,
  ).toBe(200);
  expect((await op(path)).status).toBe(401);
  await assertRelogin(c, a);
  expect((await a.user.call(path)).status).toBe(403);
}, 30_000);

test("P65 audit failure rolls back the send; relink after HTTP auth blocks a later write", async () => {
  const c = await church(),
    a = await account(c),
    [first, second] = c.profiles;
  if (!first || !second) throw Error("Synthetic members missing");
  const path = `${portal(c.id)}/prayers`,
    key = crypto.randomUUID();
  const body = { category: "other", content: "Rollback synthetic", confirmed: true };
  expect(
    (await bind(a.path, await focus(a.path, first.code), await versionOf(a.path))).status,
  ).toBe(200);
  await assertRelogin(c, a);
  const churchId = new ObjectId(c.id);
  const audit = spyOn(Audit.prototype, "organization").mockRejectedValueOnce(
    Error("Synthetic audit write failure"),
  );
  try {
    expect((await a.user.call(path, body, { key })).status).toBe(503);
  } finally {
    audit.mockRestore();
  }
  for (const coll of ["prayer_requests", "prayer_history", "idempotency_operations"])
    expect(
      await db.db.collection(coll).countDocuments({
        churchId,
        ...(coll === "idempotency_operations"
          ? { routeKey: `prayers/${c.id}/portal-submission` }
          : {}),
      }),
    ).toBe(0);
  expect((await a.user.call(path, body, { key })).status).toBe(201);
  let enter = () => {},
    release = () => {};
  const queued = new Promise<void>((resolve) => {
    enter = resolve;
  });
  const go = new Promise<void>((resolve) => {
    release = resolve;
  });
  const original = Prayers.prototype.sendPersonal;
  const block = spyOn(Prayers.prototype, "sendPersonal").mockImplementationOnce(async function (
    this: Prayers,
    ...args: Parameters<Prayers["sendPersonal"]>
  ) {
    enter();
    await go;
    return original.apply(this, args);
  });
  const inFlight = a.user.call(path, { ...body, content: "Phiên bị thu hồi synthetic" });
  try {
    await queued;
    expect(
      (await bind(a.path, await focus(a.path, second.code), await versionOf(a.path))).status,
    ).toBe(200);
  } finally {
    release();
    block.mockRestore();
  }
  expect((await inFlight).status).toBe(401);
  expect(await db.db.collection("prayer_requests").countDocuments({ churchId })).toBe(1);
}, 30_000);
