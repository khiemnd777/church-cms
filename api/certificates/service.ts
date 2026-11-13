import { Binary, type ClientSession, type Filter, ObjectId } from "mongodb";
import type { Audit } from "../audit/service";
import { requireCondition } from "../errors";
import { objectId, parse, version } from "../http-validation";
import { digest } from "../identity/crypto";
import type { Database } from "../infrastructure/database";
import { canonical, type Operations } from "../operations/service";
import { TenantQueries } from "../tenant-queries";
import {
  type CertificateGrant,
  type CertificateHistory,
  type Draft,
  draftDto,
  type Edition,
  editionDto,
  editionListDto,
  type Preview,
  previewDto,
} from "./models";
import { renderCertificate, renderFingerprint } from "./renderer";
import type { CertificateSources } from "./source";
import { draftInput, issueInput, reasonInput } from "./validation";
export class Certificates {
  private query: TenantQueries;
  constructor(
    private db: Database,
    private sources: CertificateSources,
    private ops: Operations,
    private audit: Audit,
    key: string,
    private now: () => Date,
  ) {
    this.query = new TenantQueries(key, now, "certificates");
  }
  private get drafts() {
    return this.db.db.collection<Draft>("certificate_drafts");
  }
  private get editions() {
    return this.db.db.collection<Edition>("certificate_editions");
  }
  private get previews() {
    return this.db.db.collection<Preview>("certificate_previews");
  }
  private get histories() {
    return this.db.db.collection<CertificateHistory>("certificate_history");
  }
  private staff(g: CertificateGrant, write = false) {
    requireCondition(
      !g.unitScope && !g.receiptScope && (!write || g.canManageCertificates),
      403,
      "FORBIDDEN",
    );
  }
  private async draft(g: CertificateGrant, id: string, tx: ClientSession) {
    const d = await this.drafts.findOne(
      { _id: objectId(id), churchId: g.churchId },
      { session: tx },
    );
    requireCondition(d, 404, "NOT_FOUND");
    return d;
  }
  private async edition(g: CertificateGrant, id: string, tx: ClientSession, bytes = false) {
    const d = await this.editions.findOne(
      { _id: objectId(id), churchId: g.churchId },
      { session: tx, ...(!bytes ? { projection: { pdf: 0, docx: 0 } } : {}) },
    );
    requireCondition(d, 404, "NOT_FOUND");
    return d;
  }
  private async previous(g: CertificateGrant, d: Draft, tx: ClientSession) {
    if (!d.previousEditionId) return null;
    const p = await this.edition(g, d.previousEditionId.toHexString(), tx);
    const head = await this.editions.findOne(
      { churchId: g.churchId, lineageId: p.lineageId },
      { session: tx, sort: { revision: -1 }, projection: { _id: 1 } },
    );
    requireCondition(
      head?._id.equals(p._id) && p.state !== "superseded",
      412,
      "CERT_VERSION_STALE",
    );
    return p;
  }
  private async capture(g: CertificateGrant, d: Draft, tx: ClientSession, fence = false) {
    const p = await this.previous(g, d, tx),
      source = await this.sources.capture(g, d.input, tx, fence);
    source.snapshot.templateFingerprint = renderFingerprint();
    source.snapshot.content.reference = `NB-${(p?.lineageId ?? d._id).toHexString()}/${(p?.revision ?? 0) + 1}`;
    const context = digest(
      canonical({
        snapshot: source.snapshot,
        draftVersion: d.version,
        previous: p ? { id: p._id.toHexString(), version: p.version, state: p.state } : null,
        actor: g.actorId.toHexString(),
        kind: g.actorKind,
        policy: g.policyContext,
      }),
    );
    return { ...source, context, previous: p };
  }
  private async history(
    g: CertificateGrant,
    d: Draft,
    edition: ObjectId | null,
    event: string,
    before: Record<string, unknown> | null,
    after: Record<string, unknown>,
    reason: string | null,
    tx: ClientSession,
    op: ObjectId,
    requestId: string,
  ) {
    await this.histories.insertOne(
      {
        _id: new ObjectId(),
        churchId: g.churchId,
        draftId: d._id,
        editionId: edition,
        event,
        before,
        after,
        reason,
        actorId: g.actorId,
        actorKind: g.actorKind,
        operationId: op,
        occurredAt: this.now(),
      },
      { session: tx },
    );
    await this.audit.organization(
      `certificates.${event}`,
      requestId,
      { kind: g.actorKind, id: g.actorId, churchId: g.actorKind === "owner" ? null : g.churchId },
      g.churchId,
      "certificate",
      edition ?? d._id,
      [event],
      op,
      tx,
    );
  }
  private editionGuard(g: CertificateGrant, id: string) {
    return {
      ...g,
      fence: async (tx: ClientSession) => {
        this.staff(g, true);
        await g.fence(tx);
        await this.edition(g, id, tx);
      },
    };
  }
  private command(
    g: CertificateGrant,
    id: string | null,
    suffix: string,
    method: string,
    key: string | null,
    body: unknown,
    expected: number | null,
    mutate: (
      tx: ClientSession,
      op: ObjectId,
    ) => Promise<{ draftId: string; editionId?: string; version: number }>,
    status = 200,
  ) {
    this.staff(g, true);
    const guarded = {
      ...g,
      fence: async (tx: ClientSession) => {
        this.staff(g, true);
        await g.fence(tx);
        if (id) await this.draft(g, id, tx);
      },
    };
    return this.ops.executeTenant(
      guarded,
      method,
      `certificates/${g.churchId}/drafts${id ? `/${objectId(id)}` : ""}${suffix}`,
      key,
      body,
      expected,
      async (tx, op) => {
        const data = await mutate(tx, op);
        return {
          safeResult: data,
          resourceRefs: [{ type: "certificate_draft", id: data.draftId }],
        };
      },
      status,
    );
  }
  async saveDraft(
    g: CertificateGrant,
    id: string | null,
    raw: unknown,
    key: string | null,
    match: string | null,
    requestId: string,
  ) {
    const b = parse(draftInput, raw),
      expected = id ? version(match) : null;
    return this.command(
      g,
      id,
      "",
      id ? "PATCH" : "POST",
      key,
      b,
      expected,
      async (tx, op) => {
        const old = id ? await this.draft(g, id, tx) : null;
        requireCondition(
          !old || (old.version === expected && old.state === "draft"),
          412,
          "VERSION_CONFLICT",
        );
        requireCondition(!old || old.input.kind === b.input.kind, 422, "CERT_KIND_IMMUTABLE");
        if (old?.previousEditionId)
          requireCondition(
            canonical([
              old.input.kind,
              old.input.memberId,
              old.input.riteId,
              old.input.courseId,
            ]) === canonical([b.input.kind, b.input.memberId, b.input.riteId, b.input.courseId]),
            422,
            "CERT_SOURCE_LOCKED",
          );
        const now = this.now(),
          d: Draft = {
            _id: old ? old._id : new ObjectId(),
            churchId: g.churchId,
            input: b.input,
            reason: b.reason,
            previousEditionId: old?.previousEditionId ?? null,
            version: (old?.version ?? 0) + 1,
            state: "draft",
            editionId: null,
            createdAt: old?.createdAt ?? now,
            updatedAt: now,
          };
        await this.capture(g, d, tx, true);
        if (old) {
          const r = await this.drafts.replaceOne(
            { _id: d._id, churchId: g.churchId, version: expected as number },
            d,
            { session: tx },
          );
          requireCondition(r.matchedCount, 412, "VERSION_CONFLICT");
        } else await this.drafts.insertOne(d, { session: tx });
        await this.history(
          g,
          d,
          null,
          old ? "draft_updated" : "draft_created",
          old ? draftDto(old) : null,
          draftDto(d),
          b.reason,
          tx,
          op,
          requestId,
        );
        return { draftId: d._id.toHexString(), version: d.version };
      },
      id ? 200 : 201,
    );
  }
  async getDraft(g: CertificateGrant, id: string) {
    this.staff(g);
    return this.db.readSnapshot(g.churchId.toHexString(), async (tx) => {
      await g.fence(tx);
      const d = await this.draft(g, id, tx);
      if (d.state === "issued") return { ...draftDto(d), snapshot: null };
      const c = await this.capture(g, d, tx);
      return { ...draftDto(d), snapshot: c.snapshot };
    });
  }
  async prepare(g: CertificateGrant, id: string, match: string | null) {
    this.staff(g, true);
    const expected = version(match);
    const captured = await this.db.readSnapshot(g.churchId.toHexString(), async (tx) => {
      await g.fence(tx);
      const d = await this.draft(g, id, tx);
      requireCondition(d.version === expected && d.state === "draft", 412, "VERSION_CONFLICT");
      return { d, ...(await this.capture(g, d, tx)) };
    });
    const artifacts = await renderCertificate(captured.snapshot.content);
    return this.db.readSnapshot(g.churchId.toHexString(), async (tx) => {
      await g.fence(tx);
      const d = await this.draft(g, id, tx);
      requireCondition(d.version === expected && d.state === "draft", 412, "VERSION_CONFLICT");
      const current = await this.capture(g, d, tx);
      requireCondition(current.context === captured.context, 412, "CERT_PREVIEW_STALE");
      await this.previews.deleteMany(
        { churchId: g.churchId, actorId: g.actorId, actorKind: g.actorKind, draftId: d._id },
        { session: tx },
      );
      const count = await this.previews.countDocuments(
        { churchId: g.churchId, expiresAt: { $gt: this.now() } },
        { session: tx },
      );
      requireCondition(count < 8, 429, "CERT_PREVIEW_LIMIT");
      const p: Preview = {
        _id: new ObjectId(),
        churchId: g.churchId,
        draftId: d._id,
        draftVersion: d.version,
        actorId: g.actorId,
        actorKind: g.actorKind,
        context: current.context,
        snapshot: current.snapshot,
        pages: artifacts.pages,
        pdf: new Binary(artifacts.pdf),
        docx: new Binary(artifacts.docx),
        pdfHash: artifacts.pdfHash,
        docxHash: artifacts.docxHash,
        createdAt: this.now(),
        expiresAt: new Date(this.now().getTime() + 15 * 60_000),
      };
      await this.previews.insertOne(p, { session: tx });
      return previewDto(p);
    });
  }
  async issue(
    g: CertificateGrant,
    id: string,
    raw: unknown,
    key: string | null,
    match: string | null,
    requestId: string,
  ) {
    const b = parse(issueInput, raw),
      expected = version(match);
    return this.command(g, id, "/issue", "POST", key, b, expected, async (tx, op) => {
      const d = await this.draft(g, id, tx);
      requireCondition(d.version === expected && d.state === "draft", 412, "VERSION_CONFLICT");
      const p = await this.previews.findOne(
        {
          _id: objectId(b.previewId),
          churchId: g.churchId,
          draftId: d._id,
          draftVersion: d.version,
          actorId: g.actorId,
          actorKind: g.actorKind,
          expiresAt: { $gt: this.now() },
        },
        { session: tx },
      );
      requireCondition(p, 412, "CERT_PREVIEW_STALE");
      const current = await this.capture(g, d, tx, true);
      requireCondition(
        b.context === p.context && p.context === current.context,
        412,
        "CERT_PREVIEW_STALE",
      );
      requireCondition(
        !p.snapshot.missing.length && !p.snapshot.conflicts.length,
        422,
        "CERT_INCOMPLETE",
      );
      requireCondition(
        d.input.kind !== "baptism" || b.faithConfirmed,
        422,
        "CERT_FAITH_CONFIRMATION",
      );
      const previous = current.previous;
      if (previous) requireCondition(b.reason, 422, "CERT_REASON_REQUIRED");
      const now = this.now(),
        e: Edition = {
          _id: new ObjectId(),
          churchId: g.churchId,
          draftId: d._id,
          lineageId: previous?.lineageId ?? d._id,
          revision: (previous?.revision ?? 0) + 1,
          version: 1,
          state: "issued",
          snapshot: p.snapshot,
          pages: p.pages,
          memberIds: current.memberIds.map((id) => objectId(id)),
          pdf: p.pdf,
          docx: p.docx,
          pdfHash: p.pdfHash,
          docxHash: p.docxHash,
          issuedAt: now,
          actorId: g.actorId,
          actorKind: g.actorKind,
          faithConfirmed: b.faithConfirmed,
        };
      if (previous && previous.state === "issued") {
        const updated = await this.editions.updateOne(
          { _id: previous._id, churchId: g.churchId, version: previous.version, state: "issued" },
          { $set: { state: "superseded" }, $inc: { version: 1 } },
          { session: tx },
        );
        requireCondition(updated.matchedCount, 412, "VERSION_CONFLICT");
        const priorDraft = await this.draft(g, previous.draftId.toHexString(), tx);
        await this.history(
          g,
          priorDraft,
          previous._id,
          "superseded",
          { state: previous.state, version: previous.version },
          { state: "superseded", replacedBy: e._id.toHexString() },
          b.reason,
          tx,
          op,
          requestId,
        );
      }
      await this.editions.insertOne(e, { session: tx });
      const saved = await this.drafts.updateOne(
        { _id: d._id, churchId: g.churchId, version: expected, state: "draft" },
        { $set: { state: "issued", editionId: e._id, updatedAt: now }, $inc: { version: 1 } },
        { session: tx },
      );
      requireCondition(saved.matchedCount, 412, "VERSION_CONFLICT");
      await this.history(
        g,
        d,
        e._id,
        "issued",
        draftDto(d),
        {
          editionId: e._id.toHexString(),
          revision: e.revision,
          pdfHash: e.pdfHash,
          docxHash: e.docxHash,
          faithConfirmed: b.faithConfirmed,
        },
        b.reason,
        tx,
        op,
        requestId,
      );
      await this.previews.deleteMany({ churchId: g.churchId, draftId: d._id }, { session: tx });
      return { draftId: id, editionId: e._id.toHexString(), version: d.version + 1 };
    });
  }
  async getEdition(g: CertificateGrant, id: string) {
    this.staff(g);
    return this.db.readSnapshot(g.churchId.toHexString(), async (tx) => {
      await g.fence(tx);
      return editionDto(await this.edition(g, id, tx));
    });
  }
  async revise(
    g: CertificateGrant,
    id: string,
    raw: unknown,
    key: string | null,
    match: string | null,
    requestId: string,
  ) {
    this.staff(g, true);
    const b = parse(reasonInput, raw),
      expected = version(match);
    return this.ops.executeTenant(
      this.editionGuard(g, id),
      "POST",
      `certificates/${g.churchId}/editions/${objectId(id)}/revise`,
      key,
      b,
      expected,
      async (tx, op) => {
        const e = await this.edition(g, id, tx);
        requireCondition(
          e.version === expected && e.state !== "superseded",
          412,
          "CERT_VERSION_STALE",
        );
        const now = this.now(),
          d: Draft = {
            _id: new ObjectId(),
            churchId: g.churchId,
            input: e.snapshot.input,
            reason: b.reason,
            previousEditionId: e._id,
            version: 1,
            state: "draft",
            editionId: null,
            createdAt: now,
            updatedAt: now,
          };
        await this.capture(g, d, tx, true);
        await this.drafts.insertOne(d, { session: tx });
        await this.history(
          g,
          d,
          e._id,
          "revision_draft_created",
          { editionId: id, revision: e.revision },
          draftDto(d),
          b.reason,
          tx,
          op,
          requestId,
        );
        return {
          safeResult: { draftId: d._id.toHexString(), version: 1 },
          resourceRefs: [{ type: "certificate_draft", id: d._id.toHexString() }],
        };
      },
      201,
    );
  }
  async revoke(
    g: CertificateGrant,
    id: string,
    raw: unknown,
    key: string | null,
    match: string | null,
    requestId: string,
  ) {
    this.staff(g, true);
    const b = parse(reasonInput, raw),
      expected = version(match);
    return this.ops.executeTenant(
      this.editionGuard(g, id),
      "POST",
      `certificates/${g.churchId}/editions/${objectId(id)}/revoke`,
      key,
      b,
      expected,
      async (tx, op) => {
        const e = await this.edition(g, id, tx);
        requireCondition(e.version === expected && e.state === "issued", 412, "VERSION_CONFLICT");
        const result = await this.editions.updateOne(
          { _id: e._id, churchId: g.churchId, version: expected, state: "issued" },
          { $set: { state: "revoked" }, $inc: { version: 1 } },
          { session: tx },
        );
        requireCondition(result.matchedCount, 412, "VERSION_CONFLICT");
        const d = await this.draft(g, e.draftId.toHexString(), tx);
        await this.history(
          g,
          d,
          e._id,
          "revoked",
          { state: e.state, version: e.version },
          { state: "revoked", version: e.version + 1 },
          b.reason,
          tx,
          op,
          requestId,
        );
        return {
          safeResult: { draftId: d._id.toHexString(), editionId: id, version: e.version + 1 },
          resourceRefs: [{ type: "certificate_draft", id: d._id.toHexString() }],
        };
      },
    );
  }
  async printable(g: CertificateGrant, id: string, expected: number) {
    this.staff(g);
    return this.db.readSnapshot(g.churchId.toHexString(), async (tx) => {
      await g.fence(tx);
      const e = await this.edition(g, id, tx);
      requireCondition(e.version === expected, 412, "VERSION_CONFLICT");
      requireCondition(e.state === "issued", 410, "CERT_NOT_CURRENT");
      return editionDto(e);
    });
  }
  async file(
    g: CertificateGrant,
    id: string,
    format: "pdf" | "docx",
    expected: number,
    requestId: string,
  ) {
    this.staff(g);
    return this.db.readSnapshot(g.churchId.toHexString(), async (tx) => {
      await g.fence(tx);
      const e = await this.edition(g, id, tx, true);
      requireCondition(e.version === expected, 412, "VERSION_CONFLICT");
      requireCondition(e.state === "issued", 410, "CERT_NOT_CURRENT");
      await this.audit.organization(
        "certificates.downloaded",
        requestId,
        { kind: g.actorKind, id: g.actorId, churchId: g.actorKind === "owner" ? null : g.churchId },
        g.churchId,
        "certificate",
        e._id,
        [format],
        new ObjectId(),
        tx,
      );
      return {
        bytes: Buffer.from(e[format].buffer),
        hash: format === "pdf" ? e.pdfHash : e.docxHash,
        filename: `certificate-${e._id}-${e.revision}.${format}`,
      };
    });
  }
  async list(g: CertificateGrant, q: URLSearchParams, memberId?: string) {
    this.staff(g);
    this.query.allow(q, ["limit", "cursor", "kind", "state"]);
    const limit = this.query.limit(q),
      kind = q.get("kind"),
      state = q.get("state");
    requireCondition(
      !kind || ["baptism", "dedication", "marriage", "application"].includes(kind),
      400,
      "INVALID_REQUEST",
    );
    requireCondition(
      !state || ["issued", "superseded", "revoked"].includes(state),
      400,
      "INVALID_REQUEST",
    );
    const context = this.query.context(g, "editions", [kind, state, memberId ?? null]);
    return this.db.readSnapshot(g.churchId.toHexString(), async (tx) => {
      await g.fence(tx);
      if (memberId) await this.sources.memberIdentity(g, memberId, tx);
      const f: Filter<Edition> = {
        churchId: g.churchId,
        ...(memberId ? { memberIds: objectId(memberId) } : {}),
        ...(kind ? { "snapshot.input.kind": kind } : {}),
        ...(state ? { state: state as Edition["state"] } : {}),
      };
      if (q.has("cursor")) {
        const c = this.query.decode(q.get("cursor") as string, context),
          date = new Date(c.key);
        requireCondition(Number.isFinite(date.getTime()), 400, "INVALID_CURSOR");
        f.$or = [{ issuedAt: { $lt: date } }, { issuedAt: date, _id: { $lt: objectId(c.id) } }];
      }
      const rows = await this.editions
          .find(f, { session: tx, projection: { pdf: 0, docx: 0 } })
          .sort({ issuedAt: -1, _id: -1 })
          .limit(limit + 1)
          .toArray(),
        more = rows.length > limit;
      if (more) rows.pop();
      const last = rows.at(-1);
      return {
        items: rows.map(editionListDto),
        nextCursor:
          more && last
            ? this.query.encode(context, last.issuedAt.toISOString(), last._id.toHexString())
            : null,
      };
    });
  }
  async draftList(g: CertificateGrant, q: URLSearchParams) {
    this.staff(g);
    this.query.allow(q, ["limit", "cursor"]);
    const limit = this.query.limit(q),
      context = this.query.context(g, "drafts", null);
    return this.db.readSnapshot(g.churchId.toHexString(), async (tx) => {
      await g.fence(tx);
      const filter: Filter<Draft> = { churchId: g.churchId, state: "draft" };
      if (q.has("cursor")) {
        const c = this.query.decode(q.get("cursor") as string, context),
          date = new Date(c.key);
        requireCondition(Number.isFinite(date.getTime()), 400, "INVALID_CURSOR");
        filter.$or = [
          { createdAt: { $lt: date } },
          { createdAt: date, _id: { $lt: objectId(c.id) } },
        ];
      }
      const rows = await this.drafts
          .find(filter, { session: tx })
          .sort({ createdAt: -1, _id: -1 })
          .limit(limit + 1)
          .toArray(),
        more = rows.length > limit;
      if (more) rows.pop();
      const last = rows.at(-1);
      return {
        items: rows.map(draftDto),
        nextCursor:
          more && last
            ? this.query.encode(context, last.createdAt.toISOString(), last._id.toHexString())
            : null,
      };
    });
  }
  async historyPage(g: CertificateGrant, id: string, q: URLSearchParams) {
    this.staff(g);
    this.query.allow(q, ["limit", "cursor"]);
    const limit = this.query.limit(q),
      context = this.query.context(g, "history", id.toLowerCase());
    return this.db.readSnapshot(g.churchId.toHexString(), async (tx) => {
      await g.fence(tx);
      await this.draft(g, id, tx);
      const filter: Filter<CertificateHistory> = { churchId: g.churchId, draftId: objectId(id) };
      if (q.has("cursor")) {
        const c = this.query.decode(q.get("cursor") as string, context),
          date = new Date(c.key);
        requireCondition(Number.isFinite(date.getTime()), 400, "INVALID_CURSOR");
        filter.$or = [
          { occurredAt: { $lt: date } },
          { occurredAt: date, _id: { $lt: objectId(c.id) } },
        ];
      }
      const rows = await this.histories
          .find(filter, { session: tx })
          .sort({ occurredAt: -1, _id: -1 })
          .limit(limit + 1)
          .toArray(),
        more = rows.length > limit;
      if (more) rows.pop();
      const last = rows.at(-1);
      return {
        items: rows.map((h) => ({
          id: h._id.toHexString(),
          event: h.event,
          reason: h.reason,
          actorId: h.actorId.toHexString(),
          actorKind: h.actorKind,
          occurredAt: h.occurredAt.toISOString(),
          before: h.before,
          after: h.after,
        })),
        nextCursor:
          more && last
            ? this.query.encode(context, last.occurredAt.toISOString(), last._id.toHexString())
            : null,
      };
    });
  }
  async operation(g: CertificateGrant, id: string) {
    this.staff(g, true);
    return this.ops.getTenant(g, id, "certificates", async (tx, op) => {
      const ref = op.resourceRefs.find((r) => r.type === "certificate_draft");
      requireCondition(ref, 404, "NOT_FOUND");
      await this.draft(g, ref.id, tx);
    });
  }
}
