import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { createHash } from "node:crypto";
import { Decimal128, ObjectId } from "mongodb";
import sharp from "sharp";
import { createApp } from "../../api/app";
import { config } from "../../api/config";
import { AppError } from "../../api/errors";
import { Expenses } from "../../api/finance/expenses";
import type { ExpenseAttachment, ExpenseProposal } from "../../api/finance/expenses-model";
import { Finance } from "../../api/finance/service";
import { Identity } from "../../api/identity/service";
import { Database, initialize } from "../../api/infrastructure/database";
import { RateLimit } from "../../api/infrastructure/rate-limit";
import {
  localOnly,
  SyntheticClient,
  syntheticOwner,
  syntheticUser,
} from "../../scripts/p2-fixtures";
import { financeChurch, financeRoot } from "../../scripts/p51-fixtures";

const conf = {
  ...config(),
  origin: "https://localhost:3497",
  database: `church_cms_test_p53_${crypto.randomUUID().replaceAll("-", "")}`,
  csrfKey: crypto.randomUUID() + crypto.randomUUID(),
};
localOnly(conf);
let offset = 0;
const db = new Database(conf),
  rate = new RateLimit(conf.redisUrl, conf.csrfKey),
  logs: object[] = [];
let app: ReturnType<typeof createApp>,
  owner: SyntheticClient,
  p: SyntheticClient,
  p2: SyntheticClient,
  s: SyntheticClient,
  s2: SyntheticClient,
  t: SyntheticClient,
  t2: SyntheticClient,
  l: SyntheticClient,
  l2: SyntheticClient,
  m: SyntheticClient,
  c: Awaited<ReturnType<typeof financeChurch>>,
  other: Awaited<ReturnType<typeof financeChurch>>,
  fundId: string;
const client = (realm: "owner" | "church" = "church") => {
  const ip = crypto.randomUUID();
  return new SyntheticClient(realm, conf.origin, (req) => app(req, { ip }));
};
const root = () => `${financeRoot(c)}/expense-proposals`,
  draft = (x: object = {}) => ({
    submissionId: crypto.randomUUID(),
    fundId,
    amount: "9007199254740993",
    purpose: "Mục đích chi riêng synthetic",
    ...x,
  });
async function setConfig(
  approverRole = "pastor",
  proposerRoles = ["secretary", "treasurer", "ministry_lead"],
) {
  const before = await p.call(`${financeRoot(c)}/settings`);
  const r = await p.call(
    `${financeRoot(c)}/settings`,
    { approverRole, proposerRoles },
    {
      method: before.payload.data.configured ? "PATCH" : "POST",
      version: before.payload.data.settings?.version,
    },
  );
  expect([200, 201]).toContain(r.status);
  return r;
}
async function submit(who = s, x: object = {}) {
  const b = draft(x),
    preview = await who.call(`${root()}/preview`, b);
  expect(preview.status).toBe(200);
  const body = { proposal: b, previewToken: preview.payload.data.previewToken },
    r = await who.call(root(), body);
  expect(r.status).toBe(201);
  return { id: r.payload.data.proposalId as string, b, body, r };
}
async function decide(
  id: string,
  action: "approved" | "rejected" = "approved",
  who = p,
  reason = "Kiểm chứng synthetic",
  version = 1,
) {
  const b = { decision: action, reason },
    preview = await who.call(`${root()}/${id}/preview`, b, { version });
  expect(preview.status).toBe(200);
  const body = { decision: b, previewToken: preview.payload.data.previewToken },
    r = await who.call(`${root()}/${id}/decision`, body, { version });
  return { r, body };
}
beforeAll(async () => {
  await db.client.connect();
  await initialize(db.db);
  await rate.connect();
  const identity = new Identity(db, rate, conf, () => new Date(Date.now() + offset));
  await identity.initialize();
  app = createApp(identity, conf, { log: (r) => logs.push(r) });
  owner = client("owner");
  await syntheticOwner(db, owner);
  c = await financeChurch(owner, "P53 contracts");
  other = await financeChurch(owner, "P53 other");
  [p, p2, s, s2, t, t2, l, l2, m] = [
    client(),
    client(),
    client(),
    client(),
    client(),
    client(),
    client(),
    client(),
    client(),
  ];
  for (const [who, role] of [
    [p, "pastor"],
    [p2, "pastor"],
    [s, "secretary"],
    [s2, "secretary"],
    [t, "treasurer"],
    [t2, "treasurer"],
    [l, "ministry_lead"],
    [l2, "ministry_lead"],
    [m, "member"],
  ] as const)
    await syntheticUser(owner, who, c, role, [c.unitId]);
  const f = await p.call(`${financeRoot(c)}/funds`, { name: "Quỹ P53 synthetic" });
  fundId = f.payload.data.fundId;
});
afterAll(async () => {
  await db.db.dropDatabase();
  expect(
    (await db.db.admin().listDatabases()).databases.some((d) => d.name === conf.database),
  ).toBe(false);
  await db.client.close();
  if (rate.client.isOpen) rate.client.destroy();
});
describe("P53 real financial proposal transactions", () => {
  test("fresh context no config init, no implicit roles, all other financial modules unchanged", async () => {
    for (const who of [p, t]) {
      const r = await who.call(`${root()}/context`);
      expect(r.status).toBe(200);
      expect(r.payload.data.configured).toBe(false);
      expect(r.payload.data.canReadAll).toBe(true);
      expect(r.payload.data.canSubmit).toBe(false);
    }
    for (const who of [s, l]) {
      const r = await who.call(`${root()}/context`);
      expect(r.status).toBe(200);
      expect(r.payload.data.capabilities).toEqual([]);
      expect(r.payload.data.approverRole).toBeNull();
      expect((await who.call(root())).status).toBe(403);
    }
    expect(await db.db.collection("finance_settings").countDocuments()).toBe(0);
    expect((await m.call(`${root()}/context`)).status).toBe(403);
    expect((await owner.call(`owner/${root()}`)).status).toBe(403);
    expect((await s.call(`${financeRoot(c)}/funds`)).status).toBe(403);
    expect((await s.call(`${financeRoot(c)}/ledger`)).status).toBe(403);
    await setConfig();
  });
  test("current context capabilities, minimal fund port and W13 own role reflect config", async () => {
    for (const who of [s, t, l]) {
      const r = await who.call(`churches/${c.id}/context`);
      expect(r.payload.data.expense.canSubmit).toBe(true);
      expect(r.payload.data.capabilities).toContain("expense:submit");
    }
    const source = await l.call(`${root()}/funds`);
    expect(Object.keys(source.payload.data.items[0]).sort()).toEqual(["id", "name"]);
    expect(source.payload.data.items[0].id).toBe(fundId);
    const matrix = await l.call(`churches/${c.id}/authorization/policy`);
    expect(matrix.status).toBe(200);
    expect(
      matrix.payload.data.rows.find((r: { role: string }) => r.role === "ministry_lead").expense,
    ).toContain("Của mình".toLowerCase());
    for (const suffix of ["settings", "receipts", "giving-codes", "ledger"])
      expect((await l.call(`${financeRoot(c)}/${suffix}`)).status).toBe(403);
    expect((await t.call(`churches/${c.id}/members`)).status).toBe(403);
  });
  test("same-role account isolation applies to list, totals, detail, history, cursors and operations", async () => {
    const first = await submit(s),
      second = await submit(s2, { amount: "7" }),
      a = await s.call(root());
    expect(a.payload.data.scope).toBe("mine");
    expect((await s.call(`${root()}/operations/${first.r.payload.data.operationId}`)).status).toBe(
      200,
    );
    expect(a.payload.data.items.map((r: { id: string }) => r.id)).toContain(first.id);
    expect(a.payload.data.items.map((r: { id: string }) => r.id)).not.toContain(second.id);
    expect(a.payload.data.summary.pending.total).toBe("9007199254740993");
    expect((await s2.call(`${root()}/${first.id}`)).status).toBe(404);
    expect((await s2.call(`${root()}/${first.id}/history`)).status).toBe(404);
    expect((await s2.call(`${root()}/operations/${first.r.payload.data.operationId}`)).status).toBe(
      404,
    );
    expect((await s.call(`${root()}?scope=all`)).status).toBe(403);
    const lead = await submit(l, { amount: "9" });
    expect((await l2.call(root())).payload.data.items).toEqual([]);
    expect((await l2.call(`${root()}/${lead.id}`)).status).toBe(404);
    expect((await p.call(root())).payload.data.items.length).toBe(3);
  });
  test("preview no mutation, server identity/snapshots, exact VND, pending only and no ledger side effect", async () => {
    const b = draft(),
      before = await db.db.collection("finance_expense_proposals").countDocuments(),
      preview = await s.call(`${root()}/preview`, b);
    expect(preview.payload.data.amount).toBe("9007199254740993");
    expect(await db.db.collection("finance_expense_proposals").countDocuments()).toBe(before);
    const r = await s.call(root(), {
        proposal: b,
        previewToken: preview.payload.data.previewToken,
      }),
      detail = (await s.call(`${root()}/${r.payload.data.proposalId}`)).payload.data;
    expect(detail.code).toStartWith("DX-");
    expect(detail.amount).toBe(b.amount);
    expect(detail.state).toBe("pending");
    expect(detail.createdBy).toBe((await s.call("auth/me")).payload.data.accountId);
    expect(detail.decision).toBeNull();
    expect(await db.db.collection("finance_ledger").countDocuments()).toBe(0);
    expect(await db.db.collection("finance_periods").countDocuments()).toBe(0);
    expect(await db.db.collection("members").countDocuments()).toBe(0);
  });
  test("strict money/body/confirmation validation and JSON/CSRF/method boundaries", async () => {
    for (const x of [
      { amount: 1 },
      { amount: "0" },
      { amount: "-1" },
      { amount: "01" },
      { amount: "1.1" },
      { amount: "1e3" },
      { amount: "1000000000000000000" },
      { purpose: " " },
      { actorId: new ObjectId().toHexString() },
      { businessDate: "2020-01-01" },
    ])
      expect((await s.call(`${root()}/preview`, draft(x))).status).toBe(422);
    expect((await s.call(`${root()}/preview`, draft({ purpose: "x".repeat(17000) }))).status).toBe(
      413,
    );
    expect(
      (await s.call(`${root()}/preview`, draft(), { headers: { "x-csrf-token": "" } })).status,
    ).toBe(403);
    const a = await submit(s, { amount: "999999999999999999" });
    expect(
      (await p.call(`${root()}/${a.id}`, { purpose: "Edit" }, { method: "PATCH", version: 1 }))
        .status,
    ).toBe(405);
    expect((await p.call(`${root()}/${a.id}`, undefined, { method: "DELETE" })).status).toBe(405);
    expect(
      (
        await p.call(
          `${root()}/${a.id}/preview`,
          { decision: "rejected", reason: " " },
          { version: 1 },
        )
      ).status,
    ).toBe(422);
    expect(
      (await p.call(`${root()}/${a.id}/preview`, { decision: "approved", reason: "" })).status,
    ).toBe(428);
  });
  test("approver implicit proposal right but self approve/reject forbidden, even after authority switches", async () => {
    await setConfig("secretary", []);
    const a = await submit(s, { amount: "17" });
    expect((await s.call(`${root()}/${a.id}`)).payload.data.canDecide).toBe(false);
    for (const decision of ["approved", "rejected"])
      expect(
        (await s.call(`${root()}/${a.id}/preview`, { decision, reason: "Self" }, { version: 1 }))
          .payload.error.code,
      ).toBe("EXPENSE_SELF_DECISION");
    expect(
      (await decide(a.id, "approved", s2, "Different account same approver role")).r.status,
    ).toBe(200);
    expect(
      (
        await p.call(
          `${root()}/${a.id}/preview`,
          { decision: "approved", reason: "" },
          { version: 1 },
        )
      ).status,
    ).toBe(403);
    await setConfig();
    const byTreasurer = await submit(t, { amount: "23" });
    await setConfig("treasurer");
    expect(
      (
        await t.call(
          `${root()}/${byTreasurer.id}/preview`,
          { decision: "approved", reason: "" },
          { version: 1 },
        )
      ).payload.error.code,
    ).toBe("EXPENSE_SELF_DECISION");
    expect((await decide(byTreasurer.id, "rejected", t2, "Không phù hợp")).r.status).toBe(200);
    await setConfig();
    const changed = client(),
      identity = await syntheticUser(owner, changed, c, "secretary"),
      own = await submit(changed, { amount: "19" });
    const account = (await owner.call(`owner/churches/${c.id}/accounts/${identity.id}`)).payload
      .data;
    expect(
      (
        await owner.call(
          `owner/churches/${c.id}/accounts/${identity.id}/permissions`,
          { role: "pastor", scope: { kind: "church" } },
          { method: "PATCH", version: account.version },
        )
      ).status,
    ).toBe(200);
    const roleSession = client();
    expect((await roleSession.login(identity.email, identity.password, c.code)).status).toBe(200);
    expect((await roleSession.call(`${root()}/${own.id}`)).payload.data.creatorRole).toBe(
      "secretary",
    );
    expect(
      (
        await roleSession.call(
          `${root()}/${own.id}/preview`,
          { decision: "approved", reason: "After role change" },
          { version: 1 },
        )
      ).payload.error.code,
    ).toBe("EXPENSE_SELF_DECISION");
  });
  test("preview binds actor/body/source and expires; changed config never silently grants a stale decision", async () => {
    const b = draft({ amount: "12" }),
      preview = await s.call(`${root()}/preview`, b);
    expect(
      (
        await s.call(root(), {
          proposal: { ...b, amount: "13" },
          previewToken: preview.payload.data.previewToken,
        })
      ).payload.error.code,
    ).toBe("EXPENSE_PREVIEW_STALE");
    expect(
      (await s2.call(root(), { proposal: b, previewToken: preview.payload.data.previewToken }))
        .payload.error.code,
    ).toBe("EXPENSE_PREVIEW_STALE");
    const fresh = await s.call(`${root()}/preview`, b);
    offset = 301000;
    expect(
      (await s.call(root(), { proposal: b, previewToken: fresh.payload.data.previewToken })).payload
        .error.code,
    ).toBe("EXPENSE_PREVIEW_STALE");
    offset = 0;
    const unchangedRole = await s.call(`${root()}/preview`, b);
    await setConfig("pastor", ["secretary", "treasurer"]);
    expect(
      (await s.call(root(), { proposal: b, previewToken: unchangedRole.payload.data.previewToken }))
        .payload.error.code,
    ).toBe("EXPENSE_PREVIEW_STALE");
    await setConfig();
    const a = await submit(s),
      decision = { decision: "approved", reason: "Before config change" },
      d = await p.call(`${root()}/${a.id}/preview`, decision, { version: 1 });
    await setConfig("treasurer");
    expect(
      (
        await p.call(
          `${root()}/${a.id}/decision`,
          { decision, previewToken: d.payload.data.previewToken },
          { version: 1 },
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await t.call(
          `${root()}/${a.id}/decision`,
          { decision, previewToken: d.payload.data.previewToken },
          { version: 1 },
        )
      ).payload.error.code,
    ).toBe("EXPENSE_PREVIEW_STALE");
    expect((await decide(a.id, "approved", t)).r.status).toBe(200);
    await setConfig();
  });
  test("fund rename stales submit and decision previews without rewriting submitted snapshots", async () => {
    const a = await submit(s, { amount: "10" }),
      b = draft({ amount: "11" }),
      preview = await s.call(`${root()}/preview`, b),
      decision = { decision: "approved", reason: "" },
      d = await p.call(`${root()}/${a.id}/preview`, decision, { version: 1 }),
      f = await p.call(`${financeRoot(c)}/funds/${fundId}`);
    expect(
      (
        await p.call(
          `${financeRoot(c)}/funds/${fundId}`,
          { name: "Quỹ tên mới" },
          { method: "PATCH", version: f.payload.data.version },
        )
      ).status,
    ).toBe(200);
    expect(
      (await s.call(root(), { proposal: b, previewToken: preview.payload.data.previewToken }))
        .payload.error.code,
    ).toBe("EXPENSE_PREVIEW_STALE");
    expect(
      (
        await p.call(
          `${root()}/${a.id}/decision`,
          { decision, previewToken: d.payload.data.previewToken },
          { version: 1 },
        )
      ).payload.error.code,
    ).toBe("EXPENSE_PREVIEW_STALE");
    const before = (await p.call(`${root()}/${a.id}`)).payload.data;
    expect(before.fundName).toBe("Quỹ P53 synthetic");
    expect((await decide(a.id)).r.status).toBe(200);
    expect((await p.call(`${root()}/${a.id}`)).payload.data.fundName).toBe(before.fundName);
  });
  test("inactive fund blocks submit/approval while reasoned reject remains possible", async () => {
    const a = await submit(s, { amount: "15" }),
      f = (await p.call(`${financeRoot(c)}/funds/${fundId}`)).payload.data;
    expect(
      (
        await p.call(
          `${financeRoot(c)}/funds/${fundId}/status`,
          { status: "inactive", reason: "Tạm ngừng" },
          { method: "PATCH", version: f.version },
        )
      ).status,
    ).toBe(200);
    expect((await s.call(`${root()}/preview`, draft())).payload.error.code).toBe(
      "EXPENSE_FUND_UNAVAILABLE",
    );
    expect(
      (
        await p.call(
          `${root()}/${a.id}/preview`,
          { decision: "approved", reason: "" },
          { version: 1 },
        )
      ).payload.error.code,
    ).toBe("EXPENSE_FUND_UNAVAILABLE");
    expect((await decide(a.id, "rejected", p, "Quỹ ngừng")).r.status).toBe(200);
    expect((await s.call(`${root()}/funds`)).payload.data.items).toEqual([]);
    expect(
      (
        await p.call(
          `${financeRoot(c)}/funds/${fundId}/status`,
          { status: "active", reason: "Khôi phục" },
          { method: "PATCH", version: f.version + 1 },
        )
      ).status,
    ).toBe(200);
  });
  test("exact replay and durable submission dedupe survive Ops removal and do not reopen decided proposal", async () => {
    const a = await submit(s, { amount: "29" }),
      key = crypto.randomUUID(),
      replay = await s.call(root(), a.body, { key });
    expect(replay.status).toBe(200);
    expect((await s.call(root(), a.body, { key })).payload.meta.replayed).toBe(true);
    expect((await decide(a.id, "rejected", p, "Sai nội dung")).r.status).toBe(200);
    await db.db
      .collection("idempotency_operations")
      .deleteMany({ churchId: new ObjectId(c.id), "safeResult.proposalId": a.id });
    const durable = await s.call(root(), a.body);
    expect(durable.status).toBe(200);
    expect(durable.payload.data.version).toBe(2);
    expect((await s.call(`${root()}/${a.id}`)).payload.data.state).toBe("rejected");
    expect(
      (await s.call(root(), { ...a.body, proposal: { ...a.b, amount: "30" } })).payload.error.code,
    ).toBe("EXPENSE_SUBMISSION_CONFLICT");
    expect((await s2.call(root(), a.body)).payload.error.code).toBe("EXPENSE_SUBMISSION_CONFLICT");
    expect(
      await db.db
        .collection("finance_expense_proposals")
        .countDocuments({ submissionId: a.b.submissionId }),
    ).toBe(1);
  });
  test("competing approve/reject exactly one terminal decision/history, no money writes", async () => {
    const a = await submit(s, { amount: "31" }),
      yes = { decision: "approved", reason: "Đồng ý" },
      no = { decision: "rejected", reason: "Không đồng ý" },
      yp = await p.call(`${root()}/${a.id}/preview`, yes, { version: 1 }),
      np = await p2.call(`${root()}/${a.id}/preview`, no, { version: 1 });
    const results = await Promise.all([
      p.call(
        `${root()}/${a.id}/decision`,
        { decision: yes, previewToken: yp.payload.data.previewToken },
        { version: 1 },
      ),
      p2.call(
        `${root()}/${a.id}/decision`,
        { decision: no, previewToken: np.payload.data.previewToken },
        { version: 1 },
      ),
    ]);
    expect(results.filter((r) => r.status === 200).length).toBe(1);
    expect(results.every((r) => [200, 409, 412].includes(r.status))).toBe(true);
    expect((await p.call(`${root()}/${a.id}`)).payload.data.version).toBe(2);
    expect((await s.call(`${root()}/${a.id}/history`)).payload.data.items.length).toBe(2);
    expect(await db.db.collection("finance_ledger").countDocuments()).toBe(0);
  });
  test("history/audit failure rolls back proposal and decision with Ops", async () => {
    const b = draft({ amount: "37" }),
      preview = await s.call(`${root()}/preview`, b),
      before = await db.db.collection("idempotency_operations").countDocuments(),
      spy = spyOn(Finance.prototype, "append").mockRejectedValueOnce(
        new AppError(503, "DEPENDENCY_UNAVAILABLE"),
      );
    const r = await s.call(root(), {
      proposal: b,
      previewToken: preview.payload.data.previewToken,
    });
    spy.mockRestore();
    expect(r.status).toBe(503);
    expect(
      await db.db
        .collection("finance_expense_proposals")
        .countDocuments({ submissionId: b.submissionId }),
    ).toBe(0);
    expect(await db.db.collection("idempotency_operations").countDocuments()).toBe(before);
    const a = await submit(s, { amount: "41" }),
      decision = { decision: "approved", reason: "" },
      d = await p.call(`${root()}/${a.id}/preview`, decision, { version: 1 }),
      fail = spyOn(Finance.prototype, "append").mockRejectedValueOnce(
        new AppError(503, "DEPENDENCY_UNAVAILABLE"),
      );
    expect(
      (
        await p.call(
          `${root()}/${a.id}/decision`,
          { decision, previewToken: d.payload.data.previewToken },
          { version: 1 },
        )
      ).status,
    ).toBe(503);
    fail.mockRestore();
    expect((await p.call(`${root()}/${a.id}`)).payload.data.state).toBe("pending");
    expect((await s.call(`${root()}/${a.id}/history`)).payload.data.items.length).toBe(1);
  });
  test("role revoked after transport auth is fenced before commit; removed proposer loses own read/replay", async () => {
    const who = client(),
      u = await syntheticUser(owner, who, c, "secretary"),
      b = draft({ amount: "43" }),
      preview = await who.call(`${root()}/preview`, b),
      original = Expenses.prototype.submit,
      spy = spyOn(Expenses.prototype, "submit").mockImplementationOnce(async function (
        this: Expenses,
        ...args
      ) {
        await db.db
          .collection("accounts")
          .updateOne(
            { _id: new ObjectId(u.id) },
            { $set: { role: "member", scope: { kind: "self" } }, $inc: { version: 1 } },
          );
        return original.apply(this, args);
      });
    const r = await who.call(root(), {
      proposal: b,
      previewToken: preview.payload.data.previewToken,
    });
    spy.mockRestore();
    expect(r.status).toBe(401);
    expect(
      await db.db
        .collection("finance_expense_proposals")
        .countDocuments({ submissionId: b.submissionId }),
    ).toBe(0);
    const a = await submit(l, { amount: "47" });
    await setConfig("pastor", ["secretary", "treasurer"]);
    expect((await l.call(root())).status).toBe(403);
    expect((await l.call(`${root()}/${a.id}`)).status).toBe(403);
    expect((await l.call(`${root()}/operations/${a.r.payload.data.operationId}`)).status).toBe(403);
    expect((await l.call(`churches/${c.id}/context`)).payload.data.capabilities).not.toContain(
      "expense:submit",
    );
    expect((await p.call(`${root()}/${a.id}`)).payload.data.state).toBe("pending");
    await setConfig();
  });
  test("approved decision snapshot remains immutable across config changes and old decision Ops lose ACL", async () => {
    const a = await submit(s, { amount: "53" }),
      d = await decide(a.id),
      before = (await p.call(`${root()}/${a.id}`)).payload.data;
    expect(d.r.status).toBe(200);
    expect(before.decision.contentHash).toBeString();
    await setConfig("treasurer");
    expect((await p.call(`${root()}/operations/${d.r.payload.data.operationId}`)).status).toBe(403);
    const after = (await t.call(`${root()}/${a.id}`)).payload.data;
    expect(after.decision).toEqual(before.decision);
    expect(after.currentApproverRole).toBe("treasurer");
    expect(after.state).toBe("approved");
    await setConfig();
  });
  test("tenant/realm/owner routes and immutable future stages deny", async () => {
    for (const entry of ["expense", "giving"]) {
      const shell = await app(new Request(`${conf.origin}/${c.code}/${entry}`), {
        ip: "p53-shell",
      });
      expect(shell.status).toBe(200);
      expect(shell.headers.get("content-type")).toContain("text/html");
    }

    const a = await submit(s, { amount: "59" });
    for (const suffix of [
      "",
      `/${a.id}`,
      `/${a.id}/history`,
      `/operations/${a.r.payload.data.operationId}`,
      "/funds",
      "/context",
    ]) {
      expect((await owner.call(`owner/${root()}${suffix}`)).status).toBe(403);
      expect((await m.call(`${root()}${suffix}`)).status).toBe(403);
      expect((await s.call(`${financeRoot(other)}/expense-proposals${suffix}`)).status).toBe(403);
    }
    for (const suffix of ["pay", "withdraw", "reopen"])
      expect((await p.call(`${root()}/${a.id}/${suffix}`, {})).status).toBe(404);
    expect((await p.call(`${financeRoot(c)}/payments`, {})).status).toBe(404);
  });
  test("bounded lists/KPI are scope-safe and cursors bind actor/filter; paid KPI is measured after P54 activation", async () => {
    const a = await s.call(`${root()}?limit=2`);
    expect(a.payload.data.items.length).toBe(2);
    expect(a.payload.data).not.toHaveProperty("totalCount");
    expect(a.payload.data.summary.paid).toEqual({ count: 0, total: "0" });
    const cursor = encodeURIComponent(a.payload.data.nextCursor),
      b = await s.call(`${root()}?limit=2&cursor=${cursor}`);
    expect(b.status).toBe(200);
    expect(
      b.payload.data.items.some((r: { id: string }) =>
        a.payload.data.items.some((i: { id: string }) => i.id === r.id),
      ),
    ).toBe(false);
    expect((await s2.call(`${root()}?limit=2&cursor=${cursor}`)).status).toBe(400);
    expect((await s.call(`${root()}?limit=2&state=pending&cursor=${cursor}`)).status).toBe(400);
    for (const query of [
      "limit=101",
      "period=0000-01",
      "period=2026-13",
      "scope=ban",
      "state=unknown",
      "q=x&q=y",
    ])
      expect((await p.call(`${root()}?${query}`)).status).toBe(400);
    expect((await p.call(`${root()}?state=paid`)).status).toBe(200);
    const actor = (await s.call("auth/me")).payload.data.accountId,
      own = await db.db
        .collection<ExpenseProposal>("finance_expense_proposals")
        .find({ churchId: new ObjectId(c.id), createdBy: new ObjectId(actor) })
        .toArray(),
      actual = own.reduce((n, r) => n + BigInt(r.amount.toString()), 0n),
      sum = Object.values(a.payload.data.summary as Record<string, { total: string }>).reduce(
        (n, s) => n + BigInt(s.total),
        0n,
      );
    expect(sum).toBe(actual);
    await setConfig("secretary");
    expect((await s.call(`${root()}?limit=2&cursor=${cursor}`)).status).toBe(400);
    const all = (await s.call(`${root()}?limit=2`)).payload.data;
    expect(all.scope).toBe("all");
    await setConfig();
    expect(
      (await s.call(`${root()}?limit=2&cursor=${encodeURIComponent(all.nextCursor)}`)).status,
    ).toBe(400);
    expect((await s.call(root())).payload.data.scope).toBe("mine");
  });
  test("Mongo validators reject bypass amounts, self decision and inconsistent status snapshots", async () => {
    const a = await db.db
      .collection<ExpenseProposal>("finance_expense_proposals")
      .findOne({ state: "pending" });
    expect(a).toBeTruthy();
    for (const amount of ["0", "-1", "1.5", "1000000000000000000"])
      await expect(
        db.db
          .collection("finance_expense_proposals")
          .updateOne({ _id: a?._id }, { $set: { amount: Decimal128.fromString(amount) } }),
      ).rejects.toThrow();
    await expect(
      db.db
        .collection("finance_expense_proposals")
        .updateOne({ _id: a?._id }, { $set: { state: "approved", version: 2, decision: null } }),
    ).rejects.toThrow();
    const decided = await db.db
      .collection<ExpenseProposal>("finance_expense_proposals")
      .findOne({ state: "approved" });
    await expect(
      db.db
        .collection("finance_expense_proposals")
        .updateOne({ _id: decided?._id }, { $set: { "decision.actorId": decided?.createdBy } }),
    ).rejects.toThrow();
    await expect(
      db.db.collection("finance_expense_proposals").insertOne({ ...a, _id: new ObjectId() }),
    ).rejects.toThrow();
  });
  test("general provider audit/logs contain no purpose, amount or actor-name snapshots", async () => {
    const audit = await owner.call(
      `owner/audit-events?churchId=${c.id}&eventType=finance.expense_proposal.submitted`,
    );
    expect(audit.status).toBe(200);
    expect(audit.payload.data.items.length).toBeGreaterThan(0);
    for (const secret of [
      "Mục đích chi riêng synthetic",
      "9007199254740993",
      "creatorName",
      "contentHash",
    ]) {
      expect(JSON.stringify(audit.payload)).not.toContain(secret);
      expect(JSON.stringify(logs)).not.toContain(secret);
    }
    expect(await db.db.collection("finance_ledger").countDocuments()).toBe(0);
  });
});

describe("P7.2 expense attachment", () => {
  const imageRows = db.db.collection<ExpenseAttachment>("finance_expense_attachments");
  const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
  const read = (who: SyntheticClient, path: string) =>
    app(
      new Request(`${conf.origin}/api/v1/${path}`, {
        headers: { cookie: who.cookie() },
      }),
      { ip: crypto.randomUUID() },
    );
  const upload = (who: SyntheticClient, bytes: Uint8Array, type: string, headers = {}) =>
    who.call(`${root()}/attachments`, bytes, {
      headers: { "content-type": type, ...headers },
    });
  const image = () =>
    sharp({ create: { width: 128, height: 83, channels: 3, background: "#f4eac8" } })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
  let committed: { id: string; hash: string; attachmentId: ObjectId };
  test("72-01 and 72-02: normalized image, metadata-only list, and fresh owner/tenant/actor ACL", async () => {
    await setConfig();
    const bytes = await image();
    expect((await upload(s, bytes, "image/png")).status).toBe(422);
    expect((await upload(s, bytes.slice(0, 30), "image/jpeg")).status).toBe(422);
    expect((await upload(s, new Uint8Array(5 * 1024 * 1024 + 1), "image/jpeg")).status).toBe(413);
    expect((await upload(s, bytes, "image/svg+xml")).status).toBe(415);
    expect((await upload(s, bytes, "image/jpeg", { "x-csrf-token": "incorrect" })).status).toBe(
      403,
    );
    const before = await submit(s, { amount: "72" });
    expect((await s.call(`${root()}/${before.id}`)).payload.data.hasAttachment).toBe(false);
    expect((await read(s, `${root()}/${before.id}/attachment`)).status).toBe(404);
    const staged = await upload(s, bytes, "image/jpeg");
    expect(staged.status).toBe(201);
    const id = staged.payload.data.id as string;
    expect((await read(s2, `${root()}/attachments/${id}`)).status).toBe(422);
    expect((await s2.call(`${root()}/preview`, draft({ attachmentId: id }))).status).toBe(422);
    const preview = await read(s, `${root()}/attachments/${id}`);
    expect(preview.status).toBe(200);
    const previewBytes = new Uint8Array(await preview.arrayBuffer());
    const metadata = await sharp(previewBytes).metadata();
    expect(metadata.orientation).toBeUndefined();
    expect(metadata.exif).toBeUndefined();
    expect([metadata.width, metadata.height]).toEqual([83, 128]);

    const proposal = await submit(s, { amount: "72", attachmentId: id });
    committed = { id: proposal.id, hash: sha(previewBytes), attachmentId: new ObjectId(id) };
    expect((await s.call(`${root()}/${proposal.id}`)).payload.data.hasAttachment).toBe(true);
    const item = (await s.call(root())).payload.data.items.find(
      (p: { id: string }) => p.id === proposal.id,
    );
    expect(item.hasAttachment).toBe(true);
    expect(item.attachment).toBeUndefined();
    expect((await read(s, `${root()}/attachments/${id}`)).status).toBe(422);
    const path = `${root()}/${proposal.id}/attachment?download=1`;
    const download = await read(p, path);
    expect(download.status).toBe(200);
    expect(download.headers.get("cache-control")).toBe("no-store");
    expect(download.headers.get("content-type")).toBe("image/jpeg");
    expect(download.headers.get("content-disposition")).toBe('attachment; filename="chung-tu.jpg"');
    expect(sha(new Uint8Array(await download.arrayBuffer()))).toBe(committed.hash);
    expect((await read(s2, path)).status).toBe(404);
    expect((await read(owner, `owner/${path}`)).status).toBe(403);
    expect(
      (await read(s, `${financeRoot(other)}/expense-proposals/${proposal.id}/attachment`)).status,
    ).toBe(403);
    await setConfig("pastor", ["treasurer"]);
    expect((await read(s, path)).status).toBe(403);
    await setConfig();
  });

  test("72-03: rollback preserves the staged image, retries attach it once", async () => {
    const png = await sharp(await image())
      .png()
      .toBuffer();
    const staged = await upload(s, png, "image/png");
    expect(staged.status).toBe(201);
    const attachmentId = staged.payload.data.id as string;
    const b = draft({ amount: "72", attachmentId });
    const preview = await s.call(`${root()}/preview`, b);
    expect(preview.status).toBe(200);
    const body = { proposal: b, previewToken: preview.payload.data.previewToken };
    const spy = spyOn(Finance.prototype, "append").mockRejectedValueOnce(
      new AppError(503, "DEPENDENCY_UNAVAILABLE"),
    );
    try {
      expect((await s.call(root(), body)).status).toBe(503);
    } finally {
      spy.mockRestore();
    }
    const imageId = new ObjectId(attachmentId);
    expect((await imageRows.findOne({ _id: imageId }))?.expiresAt).toBeInstanceOf(Date);
    expect((await imageRows.findOne({ _id: imageId }))?.proposalId).toBeUndefined();
    const key = crypto.randomUUID();
    const sent = await s.call(root(), body, { key });
    expect(sent.status).toBe(201);
    const exact = await s.call(root(), body, { key });
    const durable = await s.call(root(), body);
    expect(exact.payload.data.proposalId).toBe(sent.payload.data.proposalId);
    expect(durable.payload.data.proposalId).toBe(sent.payload.data.proposalId);
    expect(
      await db.db
        .collection("finance_expense_proposals")
        .countDocuments({ submissionId: b.submissionId }),
    ).toBe(1);
    expect(
      await imageRows.countDocuments({ proposalId: new ObjectId(sent.payload.data.proposalId) }),
    ).toBe(1);
    expect((await imageRows.findOne({ _id: imageId }))?.expiresAt).toBeUndefined();
    const reused = await s.call(`${root()}/preview`, draft({ attachmentId }));
    expect(reused.status).toBe(422);
    const another = await upload(s, png, "image/png");
    expect(another.status).toBe(201);
    const sharedId = another.payload.data.id as string;
    const commands = await Promise.all(
      ["72", "73"].map(async (amount) => {
        const proposal = draft({ amount, attachmentId: sharedId });
        const stagePreview = await s.call(`${root()}/preview`, proposal);
        expect(stagePreview.status).toBe(200);
        return { proposal, previewToken: stagePreview.payload.data.previewToken };
      }),
    );
    const competing = await Promise.all(commands.map((command) => s.call(root(), command)));
    expect(competing.map(({ status }) => status).sort()).toEqual([201, 422]);
    expect(
      await db.db.collection("finance_expense_proposals").countDocuments({
        submissionId: { $in: commands.map(({ proposal }) => proposal.submissionId) },
      }),
    ).toBe(1);
  });

  const restoreContainer = process.env.CHURCH_P72_MONGO_TOOLS_CONTAINER;
  test.skipIf(!restoreContainer)(
    "72-03: Mongo TTL cleanup and backup/restore preserve the attached file SHA-256",
    async () => {
      expect(committed).toBeTruthy();
      const stage = await upload(s, await image(), "image/jpeg");
      expect(stage.status).toBe(201);
      const expired = new ObjectId(stage.payload.data.id);
      await imageRows.updateOne({ _id: expired }, { $set: { expiresAt: new Date(0) } });
      expect((await read(s, `${root()}/attachments/${expired}`)).status).toBe(422);
      const target = `church_cms_test_p72_restore_${crypto.randomUUID().replaceAll("-", "")}`;
      try {
        const archive = Bun.spawnSync([
          "docker",
          "exec",
          restoreContainer as string,
          "mongodump",
          "--db",
          conf.database,
          "--archive",
          "--gzip",
        ]);
        expect(archive.exitCode).toBe(0);
        const restored = Bun.spawnSync(
          [
            "docker",
            "exec",
            "-i",
            restoreContainer as string,
            "mongorestore",
            "--archive",
            "--gzip",
            "--nsInclude",
            `${conf.database}.*`,
            "--nsFrom",
            `${conf.database}.*`,
            "--nsTo",
            `${target}.*`,
          ],
          { stdin: archive.stdout },
        );
        expect(restored.exitCode).toBe(0);
        const restoredDb = db.client.db(target);
        const a = await restoredDb
          .collection<ExpenseAttachment>("finance_expense_attachments")
          .findOne({ _id: committed.attachmentId });
        const proposal = await restoredDb
          .collection<ExpenseProposal>("finance_expense_proposals")
          .findOne({ _id: new ObjectId(committed.id) });
        expect(a?.proposalId?.toHexString()).toBe(committed.id);
        expect(proposal?.attachment?.id).toEqual(committed.attachmentId);
        expect(proposal?.attachment?.hash).toBe(committed.hash);
        expect(a && sha(a.bytes.value())).toBe(committed.hash);
        expect(a?.expiresAt).toBeUndefined();
        const indexes = await restoredDb
          .collection("finance_expense_attachments")
          .listIndexes()
          .toArray();
        expect(
          indexes.find((i) => i.name === "expense_attachment_expiry")?.expireAfterSeconds,
        ).toBe(0);
        const until = performance.now() + 75_000;
        while (await imageRows.countDocuments({ _id: expired })) {
          if (performance.now() >= until) throw new Error("TTL chưa dọn ảnh tạm trong 75 giây.");
          await Bun.sleep(1000);
        }
        expect(await imageRows.countDocuments({ _id: committed.attachmentId })).toBe(1);
      } finally {
        await db.client.db(target).dropDatabase();
      }
    },
    90_000,
  );
});
