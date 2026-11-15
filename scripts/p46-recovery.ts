import { closeSync, openSync } from "node:fs";
import { join } from "node:path";
import { BSON, ObjectId } from "mongodb";
import { createApp } from "../api/app";
import type { Config } from "../api/config";
import { Identity } from "../api/identity/service";
import type { Database } from "../api/infrastructure/database";
import { RateLimit } from "../api/infrastructure/rate-limit";
import { canonical } from "../api/operations/service";
import { check, SyntheticClient, seedP2, syntheticChurch } from "./p2-fixtures";
import { p36Workflow } from "./p36-workflow";
import { programRoot } from "./p42-fixtures";
import { careRoot as visitRoot } from "./p43-fixtures";
import { prayerRoot } from "./p44-fixtures";
import { careRoot, careScan } from "./p45-fixtures";
import type { P46Assert, p46Workflow } from "./p46-workflow";

export async function p46Fingerprint(database: Database) {
  const result: Record<string, unknown> = {};
  for (const col of (await database.db.listCollections({}, { nameOnly: false }).toArray()).sort(
    (a, b) => a.name.localeCompare(b.name),
  )) {
    const rows = database.db.collection(col.name),
      hash = new Bun.CryptoHasher("sha256");
    let count = 0;
    for await (const row of rows.find().sort({ _id: 1 })) {
      hash.update(`${canonical(JSON.parse(BSON.EJSON.stringify(row, { relaxed: false })))}\n`);
      count++;
    }
    result[col.name] = {
      count,
      sha256: hash.digest("hex"),
      options: col.options ?? {},
      indexes: (await rows.listIndexes().toArray())
        .map((i) => ({ ...i, key: Object.entries(i.key) }))
        .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "")),
    };
  }
  return result;
}

export async function p46Recovery(args: {
  db: Database;
  target: Database;
  conf: Config;
  privateDir: string;
  owner: SyntheticClient;
  actor: { id: string; email: string; password: string };
  flow: Awaited<ReturnType<typeof p46Workflow>>;
  quiesce: () => Promise<{ inFlightAtCut: number; drained: number; probeStatus: number }>;
  assert: P46Assert;
}) {
  const { db, target, conf, privateDir, owner, actor, flow, quiesce, assert } = args;
  const c = await syntheticChurch(owner, "P46 retained P3 artifacts synthetic");
  await seedP2(db, c.id, actor.id, 4);
  const person = await db.db
    .collection("members")
    .findOne({ churchId: new ObjectId(c.id), type: "believer", participation: "active" });
  check(person, "P3 artifact person");
  const p3 = await p36Workflow(owner, c, person._id.toHexString()),
    prefix = `owner/churches/${c.id}`,
    sourceMember = (await owner.call(`${prefix}/members/${p3.memberId}`)).payload.data;
  const staged = await owner.call(`${prefix}/certificates/drafts`, {
    input: (await owner.call(`${prefix}/certificates/editions/${p3.editionId}`)).payload.data
      .snapshot.input,
    reason: null,
  });
  assert(staged.status === 201, "recovery-stage-certificate-draft");
  const stagedId = staged.payload.data.draftId,
    preview = await owner.call(
      `${prefix}/certificates/drafts/${stagedId}/prepare`,
      {},
      { version: 1 },
    );
  assert(preview.status === 200, "recovery-stage-certificate-preview");
  const session = (await owner.call(`${prefix}/attendance/sessions/${p3.sessionId}`)).payload.data;
  assert(
    (
      await owner.call(
        `${prefix}/attendance/sessions/${p3.sessionId}/reopen`,
        { reason: "Proof trước backup synthetic" },
        { version: session.version },
      )
    ).status === 200,
    "recovery-open-qr-source",
  );
  const state = (await owner.call(`${prefix}/attendance/sessions/${p3.sessionId}`)).payload.data,
    proof = await owner.call(`${prefix}/attendance/sessions/${p3.sessionId}/qr-resolutions`, {
      code: p3.cardPayload,
      generation: state.generation,
    });
  assert(proof.status === 200, "recovery-old-qr-proof-captured");
  const careCount = await db.db
      .collection("care_alerts")
      .countDocuments({ churchId: new ObjectId(flow.c.id) }),
    caseCount = await db.db
      .collection("visitation_cases")
      .countDocuments({ churchId: new ObjectId(flow.c.id) });
  // Admission closes and all admitted requests drain BEFORE either fingerprint or dump.
  const cut = await quiesce();
  assert(cut.drained === 0 && cut.probeStatus === 503, "quiesced-and-drained-before-snapshot");
  const before = await p46Fingerprint(db),
    archive = join(privateDir, "p46.archive.gz"),
    fd = openSync(archive, "wx", 0o600);
  try {
    const dumped = Bun.spawnSync(
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
      { stdout: fd, stderr: "ignore", stdin: "ignore", timeout: 60000 },
    );
    assert(dumped.exitCode === 0, "quiesced-mongodump");
  } finally {
    closeSync(fd);
  }
  await target.client.connect();
  assert(!(await target.db.listCollections().hasNext()), "restore-target-empty");
  const input = openSync(archive, "r");
  try {
    const restored = Bun.spawnSync(
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
    );
    assert(restored.exitCode === 0, "restore-new-UUID-without-drop");
  } finally {
    closeSync(input);
  }
  const restored = await p46Fingerprint(target);
  assert(
    canonical(before) === canonical(restored),
    "all-collections-documents-binaries-options-indexes-exact-before-transforms",
  );
  const revoked = await target.sessions.updateMany(
      { revokedAt: { $exists: false } },
      { $set: { revokedAt: new Date() }, $inc: { writeFence: 1 } },
    ),
    purged = await target.db.collection("certificate_previews").deleteMany({});
  const recoveredConf = {
      ...conf,
      database: target.db.databaseName,
      csrfKey: crypto.randomUUID() + crypto.randomUUID(),
    },
    rate = new RateLimit(conf.redisUrl, recoveredConf.csrfKey);
  await rate.connect();
  const statuses: Record<string, number> = {};
  try {
    const identity = new Identity(target, rate, recoveredConf);
    await identity.initialize();
    const app = createApp(identity, recoveredConf, { log: () => {} }),
      client = (realm: "owner" | "church") =>
        new SyntheticClient(realm, conf.origin, (req) => app(req, { ip: crypto.randomUUID() }));
    for (const [who, path] of [
      [owner, "owner/auth/me"],
      [flow.secretary, "auth/me"],
      [flow.pastor, "auth/me"],
    ] as const) {
      const response = await app(
        new Request(`${conf.origin}/api/v1/${path}`, { headers: { cookie: who.cookie() } }),
        { ip: crypto.randomUUID() },
      );
      assert(response.status === 401, "restored-old-session-denied");
    }
    const fresh = client("owner"),
      secretary = client("church"),
      pastor = client("church");
    assert(
      (await fresh.login(actor.email, actor.password)).status === 200,
      "restore-owner-fresh-login",
    );
    assert(
      (
        await secretary.login(
          flow.secretaryAccount.email,
          flow.secretaryAccount.password,
          flow.c.code,
        )
      ).status === 200,
      "restore-secretary-fresh-login",
    );
    assert(
      (await pastor.login(flow.pastorAccount.email, flow.pastorAccount.password, flow.c.code))
        .status === 200,
      "restore-pastor-fresh-login",
    );
    const oldCursor = await secretary.call(
      `${careRoot(flow.c, secretary)}?limit=1&cursor=${encodeURIComponent(flow.cursor)}`,
    );
    statuses.oldCursor = oldCursor.status;
    assert(oldCursor.status === 400, "old-signed-cursor-rejected-after-key-rotation");
    const oldProof = await fresh.call(
      `${prefix}/attendance/sessions/${p3.sessionId}/scans`,
      { resolutionToken: proof.payload.data.resolutionToken, generation: state.generation },
      { version: proof.payload.data.participant.version },
    );
    statuses.oldProof = oldProof.status;
    assert(oldProof.status >= 400, "old-signed-qr-proof-denied");
    assert(
      (
        await fresh.call(`${prefix}/attendance/sessions/${p3.sessionId}/qr-resolutions`, {
          code: p3.cardPayload,
          generation: state.generation,
        })
      ).status === 200,
      "active-card-resolves-with-fresh-proof",
    );
    const oldPreview = await fresh.call(
      `${prefix}/certificates/drafts/${stagedId}/issue`,
      {
        previewId: preview.payload.data.id,
        context: preview.payload.data.context,
        confirm: true,
        faithConfirmed: true,
        reason: null,
      },
      { version: 1 },
    );
    statuses.oldCertificatePreview = oldPreview.status;
    assert(oldPreview.status === 412, "purged-temporary-certificate-preview-denied");
    for (const format of ["pdf", "docx"] as const) {
      const response = await app(
        new Request(
          `${conf.origin}/api/v1/${prefix}/certificates/editions/${p3.editionId}/files/${format}?version=1`,
          { headers: { cookie: fresh.cookie() } },
        ),
        { ip: crypto.randomUUID() },
      );
      assert(
        response.status === 200 &&
          new Bun.CryptoHasher("sha256")
            .update(new Uint8Array(await response.arrayBuffer()))
            .digest("hex") === p3[`${format}Hash`],
        `restored-${format}-binary-hash`,
      );
    }
    assert(
      (await fresh.call(`${prefix}/members/${p3.memberId}`)).payload.data.baptism.status ===
        sourceMember.baptism.status,
      "restored-canonical-baptism",
    );
    const pRoot = programRoot(flow.c, secretary),
      edition = await secretary.call(`${pRoot}/drafts/${flow.program.id}/editions?revision=1`),
      print = await secretary.call(`${pRoot}/drafts/${flow.program.id}/print?version=1&revision=1`);
    // Edition print uses edition version, independent of the subsequently amended draft head.
    assert(
      edition.status === 200 &&
        canonical(edition.payload.data.items[0]) === canonical(flow.program.edition),
      "restored-immutable-program-edition",
    );
    assert(
      print.status === 200 && print.text === flow.program.html,
      "restored-authenticated-program-HTML-hash-equivalent",
    );
    const visit = await secretary.call(`${visitRoot(flow.c, secretary)}/cases/${flow.visit.id}`);
    assert(
      visit.status === 200 &&
        visit.payload.data.state === "completed" &&
        visit.payload.data.visitedCount === 1,
      "restored-completed-visit-and-correction",
    );
    const receipt = await secretary.call(
      `${careRoot(flow.c, secretary)}/operations/${flow.visit.operationId}`,
    );
    assert(receipt.status === 200, "fresh-actor-receipt-before-any-resend");
    const replay = await secretary.call(
      `${careRoot(flow.c, secretary)}/${flow.visit.alertId}`,
      flow.visit.intent,
      { method: "PATCH", key: flow.visit.key, version: flow.visit.alertVersion },
    );
    assert(
      replay.status === 200 && replay.payload.meta.replayed === true,
      "authorized-preserved-ledger-replay-not-new-intent",
    );
    await careScan(secretary, flow.c);
    assert(
      (await target.db
        .collection("visitation_cases")
        .countDocuments({ churchId: new ObjectId(flow.c.id) })) === caseCount &&
        (await target.db
          .collection("care_alerts")
          .countDocuments({ churchId: new ObjectId(flow.c.id) })) === careCount,
      "restored-evaluation-preserves-episodes-no-duplicate-cases",
    );
    const prayerId = flow.privatePrayer.payload.data.prayerId,
      opId = flow.privatePrayer.payload.data.operationId;
    for (const s of [fresh, secretary]) {
      for (const suffix of [`/${prayerId}`, `/${prayerId}/history`, `/operations/${opId}`])
        assert(
          (await s.call(`${prayerRoot(flow.c, s)}${suffix}`)).status === 404,
          "restored-private-read-history-receipt-hidden",
        );
      const list = await s.call(`${prayerRoot(flow.c, s)}?q=Marker`);
      assert(
        list.status === 200 &&
          list.payload.data.items.length === 0 &&
          !canonical(list.payload).includes(prayerId),
        "restored-private-search-count-hidden",
      );
    }
    const audit = await fresh.call(
      `owner/audit-events?churchId=${flow.c.id}&eventType=prayer.create`,
    );
    assert(
      audit.status === 200 && !canonical(audit.payload).includes(prayerId),
      "restored-owner-audit-excludes-pastoral-before-output",
    );
    assert(
      (await pastor.call(`${prayerRoot(flow.c, pastor)}/${prayerId}`)).status === 200,
      "restored-current-pastor-can-read",
    );
    await target.db
      .collection("accounts")
      .updateOne(
        { _id: new ObjectId(flow.pastorAccount.id) },
        { $set: { role: "secretary" }, $inc: { version: 1 } },
      );
    assert(
      (
        await pastor.call(prayerRoot(flow.c, pastor), flow.privatePrayer.intent, {
          key: flow.privatePrayer.key,
        })
      ).status === 404,
      "restored-downgrade-create-replay-denied",
    );
    assert(
      (await pastor.call(`${prayerRoot(flow.c, pastor)}/operations/${opId}`)).status === 404,
      "restored-downgrade-receipt-denied",
    );
    assert(
      (await secretary.call(`${careRoot(flow.other, secretary)}/${flow.visit.alertId}`)).status ===
        404,
      "restored-cross-tenant-denied",
    );
    assert(
      (
        await fresh.call(
          `${prefix}/certificates/editions/${p3.editionId}/revoke`,
          { reason: "Restore synthetic revoke" },
          { version: 1 },
        )
      ).status === 200,
      "restored-certificate-revoke",
    );
    const denied = await app(
      new Request(
        `${conf.origin}/api/v1/${prefix}/certificates/editions/${p3.editionId}/files/pdf?version=2`,
        { headers: { cookie: fresh.cookie() } },
      ),
      { ip: crypto.randomUUID() },
    );
    assert(denied.status === 410, "restored-revoked-binary-download-denied");
  } finally {
    if (rate.client.isOpen) rate.client.destroy();
  }
  return {
    status: "PASS",
    source: db.db.databaseName,
    target: target.db.databaseName,
    quiesce: cut,
    collectionCount: Object.keys(before).length,
    before,
    restored,
    revokedSessions: revoked.modifiedCount,
    purgedTemporaryPreviews: purged.deletedCount,
    statuses,
    limits: [
      "Exact comparison precedes session revocation/preview purge/synthetic key rotation; application workflows after recovery legitimately mutate restored DB",
      "P4 preview digests are not invalidated by key rotation alone; old client pending discarded, authorized receipt before fresh preview/confirm; no recovery epoch",
      "Quiesced local snapshot only, no replay across unknown backup cut line, no Redis snapshot/flush, no production RPO/RTO/PITR",
      "Post-recovery HTTP contract exercised in-process with real Mongo/Redis; source workflow/workload uses loopback HTTPS",
    ],
  };
}
