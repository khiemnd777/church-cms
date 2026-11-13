import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { strFromU8, unzipSync } from "fflate";
import { MongoError, ObjectId } from "mongodb";
import { createApp } from "../../api/app";
import { Audit } from "../../api/audit/service";
import * as Renderer from "../../api/certificates/renderer";
import { Certificates } from "../../api/certificates/service";
import type { CertificateInput, CertificateKind } from "../../api/certificates/validation";
import { config } from "../../api/config";
import { Identity } from "../../api/identity/service";
import { Database, initialize } from "../../api/infrastructure/database";
import { RateLimit } from "../../api/infrastructure/rate-limit";
import { businessDay, shiftDay } from "../../api/members/dates";
import {
  SyntheticClient,
  seedP2,
  syntheticChurch,
  syntheticOwner,
  syntheticUser,
} from "../../scripts/p2-fixtures";
import { certificateFixture, createCertificateRite, riteFixture } from "../../scripts/p35-fixtures";

const conf = {
  ...config(),
  origin: "https://localhost:3469",
  database: `church_cms_test_p35_${crypto.randomUUID().replaceAll("-", "")}`,
  csrfKey: crypto.randomUUID() + crypto.randomUUID(),
};
if (!["127.0.0.1", "localhost"].includes(new URL(conf.mongoUrl).hostname))
  throw Error("Local synthetic only");
const db = new Database(conf),
  rate = new RateLimit(conf.redisUrl, conf.csrfKey),
  logs: object[] = [];
let app: ReturnType<typeof createApp>, owner: SyntheticClient, ownerId: string;
const client = (realm: "owner" | "church" = "owner") => {
  const ip = crypto.randomUUID();
  return new SyntheticClient(realm, conf.origin, (req) => app(req, { ip }));
};
const base = (c: { id: string }, s = owner) =>
  `${s.realm === "owner" ? "owner/" : ""}churches/${c.id}`;
const cp = (c: { id: string }, s = owner) => `${base(c, s)}/certificates`;
async function fixture(kind: CertificateKind = "baptism") {
  const c = await syntheticChurch(owner, `Chứng nhận synthetic ${crypto.randomUUID()}`);
  await seedP2(db, c.id, ownerId, 3);
  const member = await db.db.collection("members").findOne({ churchId: new ObjectId(c.id) });
  if (!member) throw Error();
  const memberId = member._id.toHexString();
  // Explicit partial historical source; do not rely on Mongo's chosen first index.
  await db.db
    .collection("members")
    .updateOne({ _id: member._id, churchId: new ObjectId(c.id) }, { $set: { birthDate: null } });
  const riteId =
    kind === "application" ? null : await createCertificateRite(owner, c.id, memberId, kind);
  return {
    ...c,
    memberId,
    riteId,
    input: certificateFixture(kind, riteId, kind === "application" ? memberId : null),
  };
}
async function draft(c: { id: string }, input: CertificateInput, s = owner) {
  const r = await s.call(`${cp(c, s)}/drafts`, { input, reason: null });
  expect(r.status).toBe(201);
  return r.payload.data.draftId as string;
}
async function get(c: { id: string }, id: string, s = owner) {
  const r = await s.call(`${cp(c, s)}/drafts/${id}`);
  expect(r.status).toBe(200);
  return r.payload.data;
}
async function prepare(c: { id: string }, id: string, s = owner) {
  const d = await get(c, id, s);
  const r = await s.call(`${cp(c, s)}/drafts/${id}/prepare`, {}, { version: d.version });
  expect(r.status).toBe(200);
  return { preview: r.payload.data, draft: d };
}
async function issue(c: { id: string }, id: string, s = owner, reason: string | null = null) {
  const p = await prepare(c, id, s),
    body = {
      previewId: p.preview.id,
      context: p.preview.context,
      confirm: true,
      faithConfirmed: true,
      reason,
    };
  const r = await s.call(`${cp(c, s)}/drafts/${id}/issue`, body, { version: p.draft.version });
  expect(r.status).toBe(200);
  return r.payload.data.editionId as string;
}
async function edition(c: { id: string }, id: string, s = owner) {
  const r = await s.call(`${cp(c, s)}/editions/${id}`);
  expect(r.status).toBe(200);
  return r.payload.data;
}
const raw = async (c: { id: string }, path: string, s = owner) =>
  app(
    new Request(`${conf.origin}/api/v1/${cp(c, s)}/${path}`, { headers: { cookie: s.cookie() } }),
    { ip: "p35-file" },
  );
beforeAll(async () => {
  await db.client.connect();
  await initialize(db.db);
  await rate.connect();
  const identity = new Identity(db, rate, conf);
  await identity.initialize();
  app = createApp(identity, conf, { log: (r) => logs.push(r) });
  owner = client();
  ownerId = (await syntheticOwner(db, owner)).id;
});
afterAll(async () => {
  await db.db.dropDatabase();
  expect(
    (await db.client.db("admin").admin().listDatabases()).databases.some(
      (d) => d.name === conf.database,
    ),
  ).toBe(false);
  await db.client.close();
  if (rate.client.isOpen) rate.client.destroy();
});
describe("P3.5 Certificates real Mongo Redis and real DOCX/PDF", () => {
  test("four templates produce true files, embedded Vietnamese fonts and version-bound print, shared snapshot", async () => {
    for (const kind of ["baptism", "dedication", "marriage", "application"] as const) {
      const c = await fixture(kind),
        did = await draft(c, c.input),
        p = await prepare(c, did);
      expect(p.preview.pages.length).toBeGreaterThan(0);
      expect(p.preview.snapshot.missing).toEqual([]);
      expect(p.preview.snapshot.conflicts).toEqual([]);
      const issued = await owner.call(
        `${cp(c)}/drafts/${did}/issue`,
        {
          previewId: p.preview.id,
          context: p.preview.context,
          confirm: true,
          faithConfirmed: true,
          reason: null,
        },
        { version: p.draft.version },
      );
      expect(issued.status).toBe(200);
      const eid = issued.payload.data.editionId,
        e = await edition(c, eid);
      expect(e.snapshot).toEqual(p.preview.snapshot);
      expect(e.pdfHash).toBe(p.preview.pdfHash);
      const pdf = await raw(c, `editions/${eid}/files/pdf?version=1`),
        docx = await raw(c, `editions/${eid}/files/docx?version=1`);
      expect(pdf.status).toBe(200);
      expect(docx.status).toBe(200);
      expect(pdf.headers.get("content-type")).toBe("application/pdf");
      const pb = new Uint8Array(await pdf.arrayBuffer()),
        wb = new Uint8Array(await docx.arrayBuffer());
      expect(Buffer.from(pb).subarray(0, 5).toString()).toBe("%PDF-");
      expect(
        (
          Buffer.from(pb)
            .toString("latin1")
            .match(/\/Type \/Page\b/g) ?? []
        ).length,
      ).toBe(e.pages.length);
      expect(new Bun.CryptoHasher("sha256").update(pb).digest("hex")).toBe(e.pdfHash);
      const files = unzipSync(wb);
      expect(files["word/document.xml"]).toBeTruthy();
      expect(Object.keys(files).some((p) => p.startsWith("word/fonts/"))).toBe(true);
      const xml = strFromU8(files["word/document.xml"] as Uint8Array);
      expect(xml).toContain("MẪU KIỂM THỬ");
      expect(xml).not.toContain("3 Chúa nhật");
      expect(xml).not.toContain("HỘI THÁNH BÌNH AN");
      if (kind === "application") {
        expect(xml).toContain("điền ngoài hệ thống");
        expect(xml).not.toContain("đã học lớp dự bị Báp-têm khóa 2/2026");
      }
      const print = await raw(c, `editions/${eid}/print?version=1`);
      expect(print.status).toBe(200);
      expect(await print.text()).toContain("ui-certificate-page");
      await Bun.write(`output/p3.5/documents/${kind}.pdf`, pb);
      await Bun.write(`output/p3.5/documents/${kind}.docx`, wb);
      await Bun.write(`output/p3.5/documents/${kind}.json`, JSON.stringify(e, null, 2));
    }
  }, 60000);
  test("long Vietnamese source, twenty guardians and long signers paginate without losing text", async () => {
    const c = await fixture("application"),
      body = riteFixture("dedication", c.memberId);
    if (body.record.payload.kind !== "dedication") throw Error();
    body.record.payload.parents = Array.from({ length: 20 }, (_, i) => ({
      role: "guardian" as const,
      person: {
        source: "external" as const,
        fullName: `${i + 1} Nguyễn Thị Hồng Ánh `.repeat(7).slice(0, 195),
        birthDate: null,
      },
    }));
    const p = await owner.call(`${base(c)}/rites/records/preview`, body);
    expect(p.status).toBe(200);
    const r = await owner.call(`${base(c)}/rites/records`, {
      ...body,
      preview: p.payload.data.context,
    });
    expect(r.status).toBe(201);
    const input = certificateFixture("dedication", r.payload.data.riteId);
    input.affiliation = "Địa hạt synthetic Đắk Lắk ".repeat(10).slice(0, 295);
    input.signers.secretary = "Nguyễn Thị Hồng Ánh ".repeat(10).slice(0, 195);
    input.signers.pastor = "Trương Đặng Huỳnh Phước ".repeat(9).slice(0, 195);
    const did = await draft(c, input),
      eid = await issue(c, did),
      e = await edition(c, eid);
    expect(e.pages.length).toBeGreaterThan(1);
    expect(e.pages.length).toBeLessThanOrEqual(10);
    expect(e.pages.slice(0, -1).every((p: { signatures: unknown[] }) => !p.signatures.length)).toBe(
      true,
    );
    expect(e.pages.at(-1).signatures.length).toBe(2);
    for (const format of ["pdf", "docx"]) {
      const response = await raw(c, `editions/${eid}/files/${format}?version=1`);
      expect(response.status).toBe(200);
      const bytes = await response.arrayBuffer();
      if (format === "pdf")
        expect(
          (
            Buffer.from(bytes)
              .toString("latin1")
              .match(/\/Type \/Page\b/g) ?? []
          ).length,
        ).toBe(e.pages.length);
      await Bun.write(`output/p3.5/documents/long-dedication.${format}`, bytes);
    }
    await Bun.write("output/p3.5/documents/long-dedication.json", JSON.stringify(e, null, 2));
    const tooLarge = {
      ...e.snapshot.content,
      paragraphs: [{ style: "body" as const, text: "Nội dung dài ".repeat(15000) }],
    };
    await expect(Renderer.renderCertificate(tooLarge)).rejects.toMatchObject({
      code: "CERT_PAGE_LIMIT",
    });
    const jobs = [
      Renderer.renderCertificate(e.snapshot.content),
      Renderer.renderCertificate(e.snapshot.content),
    ];
    await expect(Renderer.renderCertificate(e.snapshot.content)).rejects.toMatchObject({
      code: "CERT_RENDER_BUSY",
    });
    expect((await Promise.all(jobs)).length).toBe(2);
  }, 60000);
  test("missing fields preview but cannot issue; additions recorded with reason, no source overwrite", async () => {
    const c = await fixture(),
      input = {
        ...c.input,
        supplementReason: null,
        supplements: { ...c.input.supplements, birthDate: null },
      },
      did = await draft(c, input),
      p = await prepare(c, did);
    expect(p.preview.snapshot.missing).toContain("Ngày sinh");
    expect(
      (
        await owner.call(
          `${cp(c)}/drafts/${did}/issue`,
          {
            previewId: p.preview.id,
            context: p.preview.context,
            confirm: true,
            faithConfirmed: true,
            reason: null,
          },
          { version: p.draft.version },
        )
      ).payload.error.code,
    ).toBe("CERT_INCOMPLETE");
    expect(
      (
        await owner.call(
          `${cp(c)}/drafts/${did}`,
          { input: c.input, reason: "Bổ sung đúng" },
          { method: "PATCH", version: 1 },
        )
      ).status,
    ).toBe(200);
    const eid = await issue(c, did),
      e = await edition(c, eid);
    expect(e.snapshot.supplements.birthDate).toBe("1990-01-02");
    expect(
      (await db.db.collection("members").findOne({ _id: new ObjectId(c.memberId) }))?.birthDate,
    ).toBeNull();
    expect(
      (
        await owner.call(`${cp(c)}/drafts`, {
          input: {
            ...c.input,
            supplements: { ...c.input.supplements, place: "Tự đổi nơi đã biết" },
          },
          reason: null,
        })
      ).payload.data,
    ).toBeTruthy();
  }, 30000);
  test("faith assertion is explicit and source changes invalidate prepared artifacts", async () => {
    const c = await fixture(),
      did = await draft(c, c.input),
      p = await prepare(c, did),
      body = {
        previewId: p.preview.id,
        context: p.preview.context,
        confirm: true,
        faithConfirmed: false,
        reason: null,
      };
    expect(
      (await owner.call(`${cp(c)}/drafts/${did}/issue`, body, { version: 1 })).payload.error.code,
    ).toBe("CERT_FAITH_CONFIRMATION");
    const member = (await owner.call(`${base(c)}/members/${c.memberId}`)).payload.data;
    expect(
      (
        await owner.call(
          `${base(c)}/members/${c.memberId}`,
          { fullName: "Tên hiện hành đã đổi synthetic" },
          { method: "PATCH", version: member.version },
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await owner.call(
          `${cp(c)}/drafts/${did}/issue`,
          { ...body, faithConfirmed: true },
          { version: 1 },
        )
      ).payload.error.code,
    ).toBe("CERT_PREVIEW_STALE");
    const fresh = await prepare(c, did);
    expect(fresh.preview.snapshot.differences.length).toBeGreaterThan(0);
    expect(
      fresh.preview.snapshot.content.paragraphs.some(
        (p: { text: string }) => p.text === member.fullName,
      ),
    ).toBe(true);
  }, 30000);
  test("baptism canonical conflict blocks publication; draft/void rite does not become certificate", async () => {
    const c = await fixture(),
      did = await draft(c, c.input),
      m = (await owner.call(`${base(c)}/members/${c.memberId}`)).payload.data;
    await owner.call(
      `${base(c)}/members/${c.memberId}`,
      { baptism: { status: "unknown", date: null, place: null } },
      { method: "PATCH", version: m.version },
    );
    const p = await prepare(c, did);
    expect(p.preview.snapshot.conflicts.join(" ")).toContain("Báp-têm");
    expect(
      (
        await owner.call(
          `${cp(c)}/drafts/${did}/issue`,
          {
            previewId: p.preview.id,
            context: p.preview.context,
            confirm: true,
            faithConfirmed: true,
            reason: null,
          },
          { version: 1 },
        )
      ).status,
    ).toBe(422);
  }, 30000);
  test("revisions preserve old bytes, superseded/revoked downloads denied, stale forks cannot both issue", async () => {
    const c = await fixture("dedication"),
      did = await draft(c, c.input),
      eid = await issue(c, did),
      old = await edition(c, eid),
      clones: string[] = [];
    for (let i = 0; i < 2; i++) {
      const r = await owner.call(
        `${cp(c)}/editions/${eid}/revise`,
        { reason: "Đính chính synthetic" },
        { version: 1 },
      );
      expect(r.status).toBe(201);
      clones.push(r.payload.data.draftId as string);
    }
    const a = await prepare(c, clones[0] as string),
      b = await prepare(c, clones[1] as string);
    const intents = [a, b].map((p, i) =>
      owner.call(
        `${cp(c)}/drafts/${clones[i]}/issue`,
        {
          previewId: p.preview.id,
          context: p.preview.context,
          confirm: true,
          faithConfirmed: false,
          reason: "Thay thế có lý do",
        },
        { version: 1 },
      ),
    );
    const results = await Promise.all(intents);
    expect(results.filter((r) => r.status === 200).length).toBe(1);
    expect(results.filter((r) => [409, 412].includes(r.status)).length).toBe(1);
    const next = results.find((r) => r.status === 200)?.payload.data.editionId as string,
      e = await edition(c, next);
    expect(e.revision).toBe(2);
    const previous = await edition(c, eid);
    expect(previous.state).toBe("superseded");
    expect(previous.pdfHash).toBe(old.pdfHash);
    expect((await raw(c, `editions/${eid}/files/pdf?version=2`)).status).toBe(410);
    expect(
      (
        await owner.call(
          `${cp(c)}/editions/${next}/revoke`,
          { reason: "Thu hồi synthetic" },
          { version: 1 },
        )
      ).status,
    ).toBe(200);
    expect((await raw(c, `editions/${next}/files/docx?version=2`)).status).toBe(410);
    expect((await raw(c, `editions/${next}/print?version=2`)).status).toBe(410);
    expect((await edition(c, next)).pdfHash).toBe(e.pdfHash);
  }, 60000);
  test("unknown committed acknowledgement replays once with same artifacts and safe actor receipt", async () => {
    const c = await fixture("application"),
      did = await draft(c, c.input),
      p = await prepare(c, did),
      body = {
        previewId: p.preview.id,
        context: p.preview.context,
        confirm: true,
        faithConfirmed: false,
        reason: null,
      },
      key = crypto.randomUUID(),
      start = db.client.startSession.bind(db.client),
      spy = spyOn(db.client, "startSession").mockImplementation((...args) => {
        const tx = start(...args),
          commit = tx.commitTransaction.bind(tx);
        tx.commitTransaction = async () => {
          await commit();
          const error = new MongoError("Synthetic ack loss");
          error.addErrorLabel("UnknownTransactionCommitResult");
          throw error;
        };
        return tx;
      });
    let r: Awaited<ReturnType<SyntheticClient["call"]>>;
    try {
      r = await owner.call(`${cp(c)}/drafts/${did}/issue`, body, { key, version: 1 });
    } finally {
      spy.mockRestore();
    }
    expect(r.status).toBe(503);
    expect(r.payload.error.code).toBe("OUTCOME_UNKNOWN");
    const receipt = await owner.call(`${cp(c)}/operations/${r.payload.meta.operationId}`);
    expect(receipt.status).toBe(200);
    expect(JSON.stringify(receipt.payload.data.safeResult)).not.toContain("snapshot");
    const replay = await owner.call(`${cp(c)}/drafts/${did}/issue`, body, { key, version: 1 });
    expect(replay.status).toBe(200);
    expect(replay.payload.meta.replayed).toBe(true);
    expect(
      await db.db
        .collection("certificate_editions")
        .countDocuments({ churchId: new ObjectId(c.id) }),
    ).toBe(1);
    expect((await edition(c, replay.payload.data.editionId)).pdfHash).toBe(p.preview.pdfHash);
  }, 30000);
  test("audit failure rolls back draft promotion, both binaries, history and ledger", async () => {
    const c = await fixture("application"),
      did = await draft(c, c.input),
      p = await prepare(c, did),
      original = Audit.prototype.organization,
      spy = spyOn(Audit.prototype, "organization").mockImplementation(async function (
        this: Audit,
        ...args: Parameters<Audit["organization"]>
      ) {
        if (args[0] === "certificates.issued") throw Error("Synthetic audit failure");
        return original.apply(this, args);
      });
    const key = crypto.randomUUID();
    let r: Awaited<ReturnType<SyntheticClient["call"]>>;
    try {
      r = await owner.call(
        `${cp(c)}/drafts/${did}/issue`,
        {
          previewId: p.preview.id,
          context: p.preview.context,
          confirm: true,
          faithConfirmed: false,
          reason: null,
        },
        { key, version: 1 },
      );
    } finally {
      spy.mockRestore();
    }
    expect(r.status).toBe(503);
    expect((await get(c, did)).state).toBe("draft");
    expect(
      await db.db
        .collection("certificate_editions")
        .countDocuments({ churchId: new ObjectId(c.id) }),
    ).toBe(0);
    expect(
      await db.db
        .collection("certificate_history")
        .countDocuments({ churchId: new ObjectId(c.id), event: "issued" }),
    ).toBe(0);
    expect(
      await db.db
        .collection("idempotency_operations")
        .countDocuments({ churchId: new ObjectId(c.id), routeKey: { $regex: "/issue$" } }),
    ).toBe(0);
    expect(
      await db.db
        .collection("certificate_previews")
        .countDocuments({ _id: new ObjectId(p.preview.id) }),
    ).toBe(1);
  }, 30000);
  test("renderer failure does not create preview/edition or lock a draft", async () => {
    const c = await fixture("application"),
      did = await draft(c, c.input),
      spy = spyOn(Renderer, "renderCertificate").mockRejectedValueOnce(
        Error("Synthetic renderer failure"),
      );
    let r: Awaited<ReturnType<SyntheticClient["call"]>>;
    try {
      r = await owner.call(`${cp(c)}/drafts/${did}/prepare`, {}, { version: 1 });
    } finally {
      spy.mockRestore();
    }
    expect(r.status).toBe(503);
    expect(
      await db.db
        .collection("certificate_previews")
        .countDocuments({ churchId: new ObjectId(c.id) }),
    ).toBe(0);
    expect((await get(c, did)).state).toBe("draft");
  });
  test("fresh checks after rendering reject changed input/source, no staged stale artifacts", async () => {
    const c = await fixture("application"),
      did = await draft(c, c.input);
    let enter!: () => void, release!: () => void;
    const reached = new Promise<void>((r) => {
        enter = r;
      }),
      gate = new Promise<void>((r) => {
        release = r;
      }),
      original = Renderer.renderCertificate,
      spy = spyOn(Renderer, "renderCertificate").mockImplementation(async (content) => {
        enter();
        await gate;
        return original(content);
      });
    const preparing = owner.call(`${cp(c)}/drafts/${did}/prepare`, {}, { version: 1 });
    await reached;
    try {
      const m = (await owner.call(`${base(c)}/members/${c.memberId}`)).payload.data;
      await owner.call(
        `${base(c)}/members/${c.memberId}`,
        { fullName: "Nguồn đổi trong lúc render" },
        { method: "PATCH", version: m.version },
      );
    } finally {
      release();
      spy.mockRestore();
    }
    expect((await preparing).payload.error.code).toBe("CERT_PREVIEW_STALE");
    expect(
      await db.db
        .collection("certificate_previews")
        .countDocuments({ churchId: new ObjectId(c.id) }),
    ).toBe(0);
  }, 30000);
  test("invalid XML text inherited from a source fails closed before rendering or issuing", async () => {
    const c = await fixture("application");
    const member = (await owner.call(`${base(c)}/members/${c.memberId}`)).payload.data;
    const changed = await owner.call(
      `${base(c)}/members/${c.memberId}`,
      { fullName: "Tên nguồn\u0000không hợp lệ" },
      { method: "PATCH", version: member.version },
    );
    expect(changed.status).toBe(200);
    const did = await draft(c, c.input);
    const preview = await owner.call(`${cp(c)}/drafts/${did}/prepare`, {}, { version: 1 });
    expect(preview.status).toBe(422);
    expect(preview.payload.error.code).toBe("CERT_SOURCE_TEXT_INVALID");
    expect(
      await db.db
        .collection("certificate_previews")
        .countDocuments({ churchId: new ObjectId(c.id) }),
    ).toBe(0);
    expect(
      await db.db
        .collection("certificate_editions")
        .countDocuments({ churchId: new ObjectId(c.id) }),
    ).toBe(0);
    expect((await get(c, did)).state).toBe("draft");
  });
  test("preview is actor-bound, expires explicitly and church live previews are capped", async () => {
    const c = await fixture("application"),
      did = await draft(c, c.input),
      p = await prepare(c, did);
    const secretary = client("church");
    await syntheticUser(owner, secretary, c, "secretary");
    const body = {
      previewId: p.preview.id,
      context: p.preview.context,
      confirm: true,
      faithConfirmed: false,
      reason: null,
    };
    expect(
      (await secretary.call(`${cp(c, secretary)}/drafts/${did}/issue`, body, { version: 1 }))
        .payload.error.code,
    ).toBe("CERT_PREVIEW_STALE");
    await db.db
      .collection("certificate_previews")
      .updateOne(
        { _id: new ObjectId(p.preview.id) },
        { $set: { expiresAt: new Date(Date.now() - 1000) } },
      );
    expect(
      (await owner.call(`${cp(c)}/drafts/${did}/issue`, body, { version: 1 })).payload.error.code,
    ).toBe("CERT_PREVIEW_STALE");
    await prepare(c, did);
    for (let i = 1; i < 8; i++) await prepare(c, await draft(c, c.input));
    const ninth = await draft(c, c.input);
    expect(
      (await owner.call(`${cp(c)}/drafts/${ninth}/prepare`, {}, { version: 1 })).payload.error.code,
    ).toBe("CERT_PREVIEW_LIMIT");
    expect(
      await db.db
        .collection("certificate_previews")
        .countDocuments({ churchId: new ObjectId(c.id) }),
    ).toBe(8);
    expect((await get(c, ninth)).state).toBe("draft");
    expect(
      await db.db
        .collection("certificate_editions")
        .countDocuments({ churchId: new ObjectId(c.id) }),
    ).toBe(0);
  }, 30000);
  test("role/tenant/CSRF/download/receipt checks, no privilege from signer names", async () => {
    const c = await fixture("application"),
      other = await fixture("application");
    for (const role of ["secretary", "pastor"]) {
      const s = client("church");
      await syntheticUser(owner, s, c, role);
      const did = await draft(c, c.input, s),
        eid = await issue(c, did, s);
      expect((await s.call(`${cp(other, s)}/editions`)).status).toBe(404);
      expect((await raw(c, `editions/${eid}/files/pdf?version=1`, s)).status).toBe(200);
    }
    const units = await db.db
      .collection("organization_units")
      .find({ churchId: new ObjectId(c.id) })
      .limit(1)
      .toArray();
    for (const role of ["treasurer", "member", "ministry_lead"]) {
      const s = client("church");
      await syntheticUser(
        owner,
        s,
        c,
        role,
        units.map((u) => u._id.toHexString()),
      );
      expect((await s.call(`${cp(c, s)}/drafts`)).status).toBe(403);
      expect((await s.call(`${base(c, s)}/members/${c.memberId}/certificates`)).status).toBe(403);
    }
    expect(
      (
        await owner.call(`${cp(c)}/drafts`, {
          input: { ...c.input, memberId: other.memberId },
          reason: null,
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await owner.call(
          `${cp(c)}/drafts`,
          { input: c.input, reason: null },
          { headers: { origin: "https://wrong.test" } },
        )
      ).status,
    ).toBe(403);
    expect((await owner.call(`${base(c)}/members/${other.memberId}/certificates`)).status).toBe(
      404,
    );
  }, 60000);
  test("in-flight role revoke denies publication and replay through fresh fences", async () => {
    const c = await fixture("application"),
      s = client("church"),
      account = await syntheticUser(owner, s, c),
      did = await draft(c, c.input, s),
      p = await prepare(c, did, s);
    let enter!: () => void, release!: () => void;
    const reached = new Promise<void>((r) => {
        enter = r;
      }),
      gate = new Promise<void>((r) => {
        release = r;
      }),
      original = Certificates.prototype.issue,
      spy = spyOn(Certificates.prototype, "issue").mockImplementation(async function (
        this: Certificates,
        ...args: Parameters<Certificates["issue"]>
      ) {
        enter();
        await gate;
        return original.apply(this, args);
      });
    const running = s.call(
      `${cp(c, s)}/drafts/${did}/issue`,
      {
        previewId: p.preview.id,
        context: p.preview.context,
        confirm: true,
        faithConfirmed: false,
        reason: null,
      },
      { version: 1 },
    );
    await reached;
    try {
      await db.db
        .collection("accounts")
        .updateOne(
          { _id: new ObjectId(account.id) },
          { $set: { role: "member", scope: { kind: "self" } }, $inc: { version: 1 } },
        );
    } finally {
      release();
      spy.mockRestore();
    }
    expect((await running).status).toBe(401);
    expect(
      await db.db
        .collection("certificate_editions")
        .countDocuments({ churchId: new ObjectId(c.id) }),
    ).toBe(0);
  }, 30000);
  test("pagination, caps, strict input, date/control text rejection and privacy", async () => {
    const c = await fixture("application");
    for (let i = 0; i < 3; i++) await draft(c, c.input);
    const first = await owner.call(`${cp(c)}/drafts?limit=1`);
    expect(first.payload.data.nextCursor).toBeTruthy();
    const second = await owner.call(
      `${cp(c)}/drafts?limit=1&cursor=${encodeURIComponent(first.payload.data.nextCursor)}`,
    );
    expect(second.payload.data.items[0].id).not.toBe(first.payload.data.items[0].id);
    expect(
      (
        await owner.call(
          `${cp(c)}/editions?cursor=${encodeURIComponent(first.payload.data.nextCursor)}`,
        )
      ).status,
    ).toBe(400);
    expect((await owner.call(`${cp(c)}/drafts?limit=101`)).status).toBe(400);
    expect(
      (
        await owner.call(`${cp(c)}/drafts`, {
          input: { ...c.input, testimony: "Must not collect" },
          reason: null,
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await owner.call(`${cp(c)}/drafts`, {
          input: { ...c.input, affiliation: "Bad\u0000text" },
          reason: null,
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await owner.call(`${cp(c)}/drafts`, {
          input: { ...c.input, issuedOn: shiftDay(businessDay(), 1) },
          reason: null,
        })
      ).status,
    ).toBe(422);
    expect(JSON.stringify(logs)).not.toContain("Người làm đơn synthetic");
  });
});
