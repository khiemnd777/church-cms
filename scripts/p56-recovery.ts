import { closeSync, openSync } from "node:fs";
import { join } from "node:path";
import { ObjectId } from "mongodb";
import { createApp } from "../api/app";
import type { Config } from "../api/config";
import { Identity } from "../api/identity/service";
import { Database } from "../api/infrastructure/database";
import { RateLimit } from "../api/infrastructure/rate-limit";
import { businessDay } from "../api/members/dates";
import { canonical } from "../api/operations/service";
import { check, SyntheticClient, syntheticUser } from "./p2-fixtures";
import { p46Fingerprint } from "./p46-recovery";
import { financeChurch, financeRoot } from "./p51-fixtures";

export async function p56Recovery(args: {
  db: Database;
  conf: Config;
  ca: string;
  privateDir: string;
  out: string;
  owner: SyntheticClient;
  client: (realm?: "church" | "owner") => SyntheticClient;
  quiesce: () => Promise<void>;
  resumeSource: () => void;
}) {
  const { db, conf, ca, privateDir, out, owner, client, quiesce, resumeSource } = args;
  check(
    /^church_cms_test_p56q_[a-f0-9]{32}$/.test(db.db.databaseName),
    "Own synthetic recovery source only",
  );
  const c = await financeChurch(owner, "P56 recovery"),
    p = client(),
    t = client();
  await syntheticUser(owner, p, c, "pastor");
  const actor = await syntheticUser(owner, t, c, "treasurer");
  const deniedClient = client(),
    deniedActor = await syntheticUser(owner, deniedClient, c, "secretary");
  const root = financeRoot(c),
    fundId = (await p.call(`${root}/funds`, { name: "Recovery fund" })).payload.data.fundId;
  const receipt = (amount: string) => ({
    submissionId: crypto.randomUUID(),
    fundId,
    businessDate: businessDay(),
    sourceReference: `RECOVERY-${crypto.randomUUID()}`,
    purpose: "Recovery synthetic",
    mode: "aggregate",
    amount,
  });
  const saved = receipt("1000"),
    pre = await t.call(`${root}/receipts/preview`, saved),
    body = { receipt: saved, previewToken: pre.payload.data.previewToken },
    key = crypto.randomUUID(),
    committed = await t.call(`${root}/receipts`, body, { key });
  check(committed.status === 201, "Pre-cut real commit");
  const pending = receipt("50"),
    pendingPreview = await t.call(`${root}/receipts/preview`, pending);
  check(pendingPreview.status === 200, "Uncommitted pre-cut preview");
  const target = new Database({
    ...conf,
    database: `church_cms_test_p56restore_${crypto.randomUUID().replaceAll("-", "")}`,
  });
  let targetRate: RateLimit | undefined, server: ReturnType<typeof Bun.serve> | undefined;
  const checks: string[] = [];
  const assert = (v: unknown, label: string) => {
    check(v, label);
    checks.push(label);
  };
  try {
    await quiesce();
    const before = await p46Fingerprint(db),
      archive = join(privateDir, "p56.archive.gz"),
      fd = openSync(archive, "wx", 0o600);
    try {
      assert(
        Bun.spawnSync(
          [
            "docker",
            "compose",
            "exec",
            "-T",
            "mongo",
            "mongodump",
            "--host",
            "127.0.0.1:27017",
            "--db",
            db.db.databaseName,
            "--archive",
            "--gzip",
          ],
          { stdout: fd, stderr: "ignore", timeout: 60000 },
        ).exitCode === 0,
        "quiesced-source-dump",
      );
    } finally {
      closeSync(fd);
    }
    await target.client.connect();
    assert(!(await target.db.listCollections().hasNext()), "fresh-empty-target-before-restore");
    const input = openSync(archive, "r");
    try {
      assert(
        Bun.spawnSync(
          [
            "docker",
            "compose",
            "exec",
            "-T",
            "mongo",
            "mongorestore",
            "--host",
            "127.0.0.1:27017",
            "--archive",
            "--gzip",
            "--nsInclude",
            `${db.db.databaseName}.*`,
            "--nsFrom",
            `${db.db.databaseName}.*`,
            "--nsTo",
            `${target.db.databaseName}.*`,
          ],
          { stdin: input, stdout: "ignore", stderr: "ignore", timeout: 60000 },
        ).exitCode === 0,
        "restore-without-drop-to-own-new-UUID",
      );
    } finally {
      closeSync(input);
    }
    const restored = await p46Fingerprint(target);
    assert(
      canonical(before) === canonical(restored),
      "all-documents-indexes-validators-exact-before-transforms",
    );
    // A known tail commit exists on source, but cannot be inferred from restored absence.
    resumeSource();
    const tail = receipt("100"),
      tp = await t.call(`${root}/receipts/preview`, tail),
      tailCommit = await t.call(`${root}/receipts`, {
        receipt: tail,
        previewToken: tp.payload.data.previewToken,
      });
    assert(tailCommit.status === 201, "known-post-cut-source-commit");
    await quiesce();
    const revoked = await target.sessions.updateMany(
        { revokedAt: { $exists: false } },
        { $set: { revokedAt: new Date() }, $inc: { writeFence: 1 } },
      ),
      purged = await target.db.collection("certificate_previews").deleteMany({});
    assert(revoked.modifiedCount > 0, "session-revocation-nonvacuous");
    const recovered = {
      ...conf,
      database: target.db.databaseName,
      origin: "https://localhost:3505",
      port: 3505,
      csrfKey: crypto.randomUUID() + crypto.randomUUID(),
    };
    targetRate = new RateLimit(conf.redisUrl, recovered.csrfKey);
    await targetRate.connect();
    const identity = new Identity(target, targetRate, recovered);
    await identity.initialize();
    const app = createApp(identity, recovered, { log: () => {} });
    server = Bun.serve({
      hostname: "127.0.0.1",
      port: recovered.port,
      tls: { cert: Bun.file(recovered.cert), key: Bun.file(recovered.key) },
      fetch: (req) => app(req, { ip: "p56restore" }),
    });
    const fresh = () =>
      new SyntheticClient("church", recovered.origin, (req) => fetch(req, { tls: { ca } }));
    const old = await fetch(`${recovered.origin}/api/v1/auth/me`, {
      headers: { cookie: t.cookie() },
      tls: { ca },
    });
    assert(old.status === 401, "old-sessions-revoked");
    await old.arrayBuffer();
    const who = fresh();
    assert(
      (await who.login(actor.email, actor.password, c.code)).status === 200,
      "fresh-restored-login",
    );
    const denied = fresh();
    assert(
      (await denied.login(deniedActor.email, deniedActor.password, c.code)).status === 200,
      "fresh-denied-role-login",
    );
    assert(
      (await denied.call(`${root}/summary`)).status === 403 &&
        (await denied.call(`${root}/operations/${committed.payload.data.operationId}`)).status ===
          403,
      "restored-fresh-ACL-still-denies-secretary",
    );
    const summary = (await who.call(`${root}/summary`)).payload.data;
    assert(
      summary.totals.netIncome === "1000" && summary.totals.closingBalance === "1000",
      "snapshot-money-restored-exactly-not-source-tail",
    );
    assert(
      (await who.call(`${root}/operations/${committed.payload.data.operationId}`)).status === 200,
      "pre-cut-operation-visible-under-fresh-ACL",
    );
    assert(
      (await who.call(`${root}/operations/${tailCommit.payload.data.operationId}`)).status === 404,
      "post-cut-absence-classified-unknown-not-not-executed",
    );
    const ledgerBefore = await target.db.collection("finance_ledger").countDocuments();
    const stale = await who.call(`${root}/receipts`, {
      receipt: pending,
      previewToken: pendingPreview.payload.data.previewToken,
    });
    assert(stale.status === 409, "old-signed-preview-invalid-after-rotation");
    assert(
      (await target.db.collection("finance_ledger").countDocuments()) === ledgerBefore,
      "no-auto-replay-or-money-from-old-preview",
    );
    // Explicit known-intent reconciliation after operation TTL loss; no unknown tail replay.
    await target.db.collection("idempotency_operations").deleteOne({
      _id: new ObjectId(committed.payload.data.operationId),
    });
    const replay = await who.call(`${root}/receipts`, body, { key });
    assert(
      [200, 201].includes(replay.status),
      "retained-receipt-durable-uniqueness-after-ops-expiry",
    );
    assert(
      (await target.db.collection("finance_ledger").countDocuments()) === ledgerBefore,
      "retained-intent-never-double-posts",
    );
    const next = receipt("10"),
      np = await who.call(`${root}/receipts/preview`, next),
      written = await who.call(`${root}/receipts`, {
        receipt: next,
        previewToken: np.payload.data.previewToken,
      });
    assert(written.status === 201, "explicit-fresh-intent-after-restore-checks");
    const closure = {
        submissionId: crypto.randomUUID(),
        reason: "Manual synthetic recovery qualification",
      },
      month = businessDay().slice(0, 7),
      cp = await who.call(`${root}/periods/${month}/close-preview`, closure),
      closed = await who.call(`${root}/periods/${month}/close`, {
        closure,
        controlVersion: cp.payload.data.controlVersion,
        previewToken: cp.payload.data.previewToken,
        confirmed: true,
      });
    assert(closed.status === 201, "fresh-restored-book-can-close");
    const final = (await who.call(`${root}/summary`)).payload.data;
    assert(
      final.state === "closed" && final.totals.closingBalance === "1010",
      "restored-money-and-cutline-after-explicit-new-intent",
    );
    const otherClosed = await target.db.collection("finance_period_closures").countDocuments();
    assert(otherClosed === 34, "all-prior33-closure-links-retained-plus-new-one");
    const result = {
      status: "PASS",
      checks,
      collections: Object.keys(before).length,
      before,
      restored,
      revokedSessions: revoked.modifiedCount,
      purgedPreviews: purged.deletedCount,
      cutLine: {
        preCutCommit: "retained",
        postCutKnownSourceCommit: "absent-in-target-UNKNOWN-do-not-auto-replay",
        uncommittedPreview: "invalid-signature-after-rotation",
      },
      limits: [
        "Exact comparison precedes session revocation/signing key rotation/new synthetic workflows",
        "New UUID synthetic databases only; no main/realdata/Redis flush/publication",
        "Unknown post-cut history is not recoverable from this snapshot; durable uniqueness only for retained domain state",
        "Controlled quiesced snapshot, not production PITR/RPO/RTO or recovery authorization",
      ],
    };
    await Bun.write(`${out}/restore.json`, JSON.stringify(result, null, 2));
    return result;
  } finally {
    if (server) await server.stop(true);
    if (targetRate?.client.isOpen) targetRate.client.destroy();
    await target.db.dropDatabase();
    const removed = !(await target.db.admin().listDatabases()).databases.some(
      (d) => d.name === target.db.databaseName,
    );
    await target.client.close();
    await Bun.write(
      `${out}/restore-cleanup.json`,
      JSON.stringify({ database: target.db.databaseName, removed }, null, 2),
    );
  }
}
