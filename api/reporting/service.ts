import { createHash } from "node:crypto";
import { Binary, type ClientSession, MongoServerError, ObjectId } from "mongodb";
import type { Audit } from "../audit/service";
import type { TenantGrant } from "../authorization/tenant-grant";
import { AppError, requireCondition } from "../errors";
import { objectId, parse } from "../http-validation";
import { digest } from "../identity/crypto";
import type { Database } from "../infrastructure/database";
import { businessDay } from "../members/dates";
import { canonical, type Operations } from "../operations/service";
import { TenantQueries } from "../tenant-queries";
import {
  activeInput,
  issueInput,
  type Layout,
  previewInput,
  type ReportDocument,
  reportLimits,
} from "./contracts";
import { reportProcess } from "./processor";
import type { ReportSource } from "./source";

export interface ReportGrant extends TenantGrant {
  canUpload: boolean;
  canActivate: boolean;
}
interface Template {
  _id: ObjectId;
  churchId: ObjectId;
  version: number;
  state: "checked" | "retired";
  layout: Layout;
  actorId: ObjectId;
  createdAt: Date;
}
interface Selection {
  _id: ObjectId;
  activeId: ObjectId | null;
  version: number;
  writeFence: number;
}
interface Preview {
  _id: ObjectId;
  churchId: ObjectId;
  actorId: ObjectId;
  actorKind: string;
  context: string;
  templateId: ObjectId;
  selectionVersion: number;
  previousId: ObjectId | null;
  reason: string | null;
  document: ReportDocument;
  pdf: Binary;
  xlsx: Binary;
  expiresAt: Date;
}
interface Edition {
  _id: ObjectId;
  churchId: ObjectId;
  actorId: ObjectId;
  actorKind: string;
  previewId: ObjectId;
  templateId: ObjectId;
  document: ReportDocument;
  pdf: Binary;
  xlsx: Binary;
  pdfHash: string;
  xlsxHash: string;
  previousId: ObjectId | null;
  reason: string | null;
  lineageId: ObjectId;
  revision: number;
  supersededBy: ObjectId | null;
  issuedAt: Date;
}
const hashBytes = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const files = { pdf: 0, xlsx: 0 } as const;
const toId = (id?: ObjectId | null) => id?.toHexString() ?? null;

export class Reports {
  private query: TenantQueries;
  constructor(
    private db: Database,
    private source: ReportSource,
    private ops: Operations,
    private audit: Audit,
    key: string,
    private now: () => Date,
  ) {
    this.query = new TenantQueries(key, now, "church-report");
  }
  private get templates() {
    return this.db.db.collection<Template>("report_templates");
  }
  private get selections() {
    return this.db.db.collection<Selection>("report_template_selection");
  }
  private get previews() {
    return this.db.db.collection<Preview>("report_previews");
  }
  private get editions() {
    return this.db.db.collection<Edition>("report_editions");
  }
  private selection(g: ReportGrant, tx: ClientSession) {
    return this.selections.findOne({ _id: g.churchId }, { session: tx });
  }
  private async template(g: ReportGrant, id: string, tx: ClientSession) {
    const t = await this.templates.findOne(
      { _id: objectId(id), churchId: g.churchId },
      { session: tx },
    );
    requireCondition(t, 404, "NOT_FOUND");
    return t;
  }
  private async edition(g: ReportGrant, id: string, tx: ClientSession, withFiles = false) {
    const e = await this.editions.findOne(
      { _id: objectId(id), churchId: g.churchId },
      { session: tx, ...(withFiles ? {} : { projection: files }) },
    );
    requireCondition(e, 404, "NOT_FOUND");
    return e;
  }
  private auditEvent(
    g: ReportGrant,
    tx: ClientSession,
    requestId: string,
    operationId: ObjectId,
    kind: string,
    target: ObjectId,
    fields: string[],
  ) {
    return this.audit.organization(
      `reports.${kind}`,
      requestId,
      { id: g.actorId, kind: g.actorKind, churchId: g.actorKind === "owner" ? null : g.churchId },
      g.churchId,
      "church_report",
      target,
      fields,
      operationId,
      tx,
    );
  }
  async list(g: ReportGrant, q: URLSearchParams) {
    this.query.allow(q, ["kind", "cursor", "limit"]);
    const kind = q.get("kind") ?? "templates",
      limit = this.query.limit(q);
    requireCondition(kind === "templates" || kind === "editions", 400, "INVALID_REQUEST");
    const context = this.query.context(g, kind, null);
    const cursor = q.get("cursor");
    const filter = {
      churchId: g.churchId,
      ...(cursor ? { _id: { $lt: objectId(this.query.decode(cursor, context).id) } } : {}),
    };
    return this.db.readSnapshot(g.churchId.toHexString(), async (tx) => {
      await g.fence(tx);
      const selected = await this.selection(g, tx);
      const activeId = toId(selected?.activeId);
      if (kind === "templates") {
        const rows = await this.templates
          .find(filter, {
            session: tx,
            projection: {
              _id: 1,
              version: 1,
              state: 1,
              "layout.name": 1,
              createdAt: 1,
            },
          })
          .sort({ _id: -1 })
          .limit(limit + 1)
          .toArray();
        const more = rows.length > limit;
        const items = rows.slice(0, limit).map((t) => ({
          id: t._id.toHexString(),
          name: t.layout.name,
          state: t._id.toHexString() === activeId ? ("active" as const) : t.state,
          version: t.version,
          uploadedAt: t.createdAt.toISOString(),
        }));
        const active = activeId ? await this.template(g, activeId, tx) : null;
        return {
          kind: "templates" as const,
          activeId,
          activeName: active?.layout.name ?? null,
          selectionVersion: selected?.version ?? 0,
          day: businessDay(this.now()),
          items,
          nextCursor:
            more && items.length
              ? this.query.encode(context, "", items[items.length - 1]?.id ?? "")
              : null,
        };
      }
      const rows = await this.editions
        .find(filter, {
          session: tx,
          projection: {
            _id: 1,
            "document.template": 1,
            "document.from": 1,
            "document.to": 1,
            issuedAt: 1,
            revision: 1,
            supersededBy: 1,
            lineageId: 1,
            previousId: 1,
            reason: 1,
          },
        })
        .sort({ _id: -1 })
        .limit(limit + 1)
        .toArray();
      const more = rows.length > limit;
      const items = rows.slice(0, limit).map((e) => ({
        id: e._id.toHexString(),
        name: e.document.template,
        from: e.document.from,
        to: e.document.to,
        revision: e.revision,
        issuedAt: e.issuedAt.toISOString(),
        supersededBy: toId(e.supersededBy),
        lineageId: e.lineageId.toHexString(),
        previousId: toId(e.previousId),
        reason: e.reason,
      }));
      return {
        kind: "editions" as const,
        items,
        nextCursor:
          more && items.length
            ? this.query.encode(context, "", items[items.length - 1]?.id ?? "")
            : null,
      };
    });
  }
  async viewTemplate(g: ReportGrant, id: string) {
    return this.db.readSnapshot(g.churchId.toHexString(), async (tx) => {
      await g.fence(tx);
      const row = await this.template(g, id, tx);
      return { id, layout: row.layout };
    });
  }
  async starter(g: ReportGrant) {
    await this.db.readSnapshot(g.churchId.toHexString(), (tx) => g.fence(tx));
    const { xlsx } = await reportProcess({ starter: true });
    requireCondition(xlsx, 503, "REPORT_PROCESS_FAILED");
    return Buffer.from(xlsx, "base64");
  }
  async upload(g: ReportGrant, bytes: Uint8Array, key: string | null, requestId: string) {
    requireCondition(g.canUpload, 403, "FORBIDDEN");
    requireCondition(bytes.length > 0 && bytes.length <= reportLimits.upload, 413, "FILE_LIMIT");
    await this.db.readSnapshot(g.churchId.toHexString(), (tx) => g.fence(tx));
    const { layout } = await reportProcess({ upload: Buffer.from(bytes).toString("base64") });
    requireCondition(layout, 503, "REPORT_PROCESS_FAILED");
    return this.ops.executeTenant(
      g,
      "POST",
      `church-reports/${g.churchId}/templates`,
      key,
      { hash: hashBytes(bytes) },
      null,
      async (tx, operationId) => {
        const id = new ObjectId();
        await this.templates.insertOne(
          {
            _id: id,
            actorId: g.actorId,
            churchId: g.churchId,
            version: 1,
            state: "checked",
            layout,
            createdAt: this.now(),
          },
          { session: tx },
        );
        await this.auditEvent(g, tx, requestId, operationId, "template_uploaded", id, ["layout"]);
        return {
          safeResult: { id: id.toHexString() },
          resourceRefs: [{ type: "report_template", id: id.toHexString() }],
        };
      },
      201,
    );
  }
  async activate(
    g: ReportGrant,
    id: string,
    raw: unknown,
    key: string | null,
    requestId: string,
    retire: boolean,
  ) {
    requireCondition(g.canActivate, 403, "FORBIDDEN");
    const body = parse(activeInput, raw);
    try {
      return await this.ops.executeTenant(
        g,
        "POST",
        `church-reports/${g.churchId}/templates/${id}/${retire ? "retire" : "activate"}`,
        key,
        body,
        body.version,
        async (tx, operationId) => {
          const template = await this.template(g, id, tx);
          const selected = await this.selection(g, tx);
          requireCondition(
            toId(selected?.activeId) === body.activeId &&
              (selected?.version ?? 0) === body.selectionVersion &&
              template.version === body.version,
            409,
            "REPORT_SELECTION_CHANGED",
          );
          requireCondition(
            retire ? body.activeId === id : template.state === "checked" && body.activeId !== id,
            409,
            "REPORT_SELECTION_CHANGED",
          );
          const activeId = retire ? null : template._id;
          if (selected) {
            const result = await this.selections.updateOne(
              { _id: g.churchId, version: selected.version },
              { $set: { activeId }, $inc: { version: 1 } },
              { session: tx },
            );
            requireCondition(result.matchedCount, 409, "REPORT_SELECTION_CHANGED");
          } else {
            await this.selections.insertOne(
              { _id: g.churchId, activeId, version: 1, writeFence: 0 },
              { session: tx },
            );
          }
          const markRetired = retire ? template._id : selected?.activeId;
          if (markRetired) {
            await this.templates.updateOne(
              { _id: markRetired, churchId: g.churchId },
              { $set: { state: "retired" }, $inc: { version: 1 } },
              { session: tx },
            );
          }
          await this.auditEvent(
            g,
            tx,
            requestId,
            operationId,
            retire ? "template_retired" : "template_activated",
            template._id,
            ["activeId"],
          );
          return { safeResult: { id }, resourceRefs: [{ type: "report_template", id }] };
        },
      );
    } catch (error) {
      if (error instanceof MongoServerError && error.code === 11000)
        throw new AppError(409, "REPORT_SELECTION_CHANGED");
      throw error;
    }
  }
  private async capture(
    g: ReportGrant,
    tx: ClientSession,
    body: {
      templateId: string;
      from: string;
      to: string;
      previousId?: string | null;
      reason?: string | null;
    },
  ) {
    const now = businessDay(this.now());
    requireCondition(
      body.from <= body.to && body.to <= now && body.from >= "1900-01-01",
      422,
      "REPORT_PERIOD",
    );
    requireCondition(
      Boolean(body.previousId) === Boolean(body.reason),
      422,
      "REPORT_REPLACE_REASON",
    );
    const selection = await this.selection(g, tx);
    requireCondition(
      selection && toId(selection.activeId) === body.templateId,
      409,
      "REPORT_SELECTION_CHANGED",
    );
    const template = await this.template(g, body.templateId, tx);
    const previous = body.previousId ? await this.edition(g, body.previousId, tx) : null;
    if (previous)
      requireCondition(
        !previous.supersededBy &&
          previous.document.from === body.from &&
          previous.document.to === body.to,
        409,
        "REPORT_REPLACE_CHANGED",
      );
    const document = await this.source.capture(g, tx, template.layout, body.from, body.to);
    return {
      selection,
      template,
      previous,
      document,
      context: digest(
        canonical({
          document: { ...document, capturedAt: undefined },
          templateId: body.templateId,
          selectionVersion: selection.version,
          policy: g.policyContext,
          previousId: body.previousId ?? null,
          reason: body.reason ?? null,
        }),
      ),
    };
  }
  async prepare(g: ReportGrant, raw: unknown) {
    const body = parse(previewInput, raw);
    const captured = await this.db.readSnapshot(g.churchId.toHexString(), async (tx) => {
      await g.fence(tx);
      return this.capture(g, tx, body);
    });
    const { pdf, xlsx } = await reportProcess({ document: captured.document });
    requireCondition(pdf && xlsx, 503, "REPORT_PROCESS_FAILED");
    return this.db.readSnapshot(g.churchId.toHexString(), async (tx) => {
      await g.fence(tx);
      const current = await this.capture(g, tx, body);
      requireCondition(current.context === captured.context, 409, "REPORT_PREVIEW_STALE");
      const now = this.now();
      const outstanding = await this.previews.countDocuments(
        { churchId: g.churchId, expiresAt: { $gt: now } },
        { session: tx, limit: 12, maxTimeMS: 3000 },
      );
      requireCondition(outstanding < 12, 429, "REPORT_PREVIEW_LIMIT");
      const row: Preview = {
        _id: new ObjectId(),
        churchId: g.churchId,
        actorId: g.actorId,
        actorKind: g.actorKind,
        context: current.context,
        templateId: current.template._id,
        selectionVersion: current.selection.version,
        previousId: current.previous?._id ?? null,
        reason: body.reason ?? null,
        document: captured.document,
        pdf: new Binary(Buffer.from(pdf, "base64")),
        xlsx: new Binary(Buffer.from(xlsx, "base64")),
        expiresAt: new Date(now.valueOf() + 15 * 60 * 1000),
      };
      await this.previews.insertOne(row, { session: tx });
      return {
        id: row._id.toHexString(),
        document: row.document,
        expiresAt: row.expiresAt.toISOString(),
      };
    });
  }
  async issue(g: ReportGrant, raw: unknown, key: string | null, requestId: string) {
    const body = parse(issueInput, raw);
    return this.ops.executeTenant(
      g,
      "POST",
      `church-reports/${g.churchId}/issue`,
      key,
      body,
      null,
      async (tx, operationId) => {
        const p = await this.previews.findOne(
          {
            _id: objectId(body.previewId),
            churchId: g.churchId,
            actorId: g.actorId,
            actorKind: g.actorKind,
            expiresAt: { $gt: this.now() },
          },
          { session: tx },
        );
        requireCondition(p, 409, "REPORT_PREVIEW_STALE");
        const { selection, previous, context } = await this.capture(g, tx, {
          templateId: p.templateId.toHexString(),
          from: p.document.from,
          to: p.document.to,
          previousId: toId(p.previousId),
          reason: p.reason,
        });
        requireCondition(
          context === p.context && selection.version === p.selectionVersion,
          409,
          "REPORT_PREVIEW_STALE",
        );
        // A Mongo write fence serializes activation/retirement with issue without changing the selection version.
        const fence = await this.selections.updateOne(
          { _id: g.churchId, version: p.selectionVersion },
          { $inc: { writeFence: 1 } },
          { session: tx },
        );
        requireCondition(fence.matchedCount, 409, "REPORT_PREVIEW_STALE");
        const id = new ObjectId();
        if (previous) {
          const result = await this.editions.updateOne(
            { _id: previous._id, churchId: g.churchId, supersededBy: null },
            { $set: { supersededBy: id } },
            { session: tx },
          );
          requireCondition(result.matchedCount, 409, "REPORT_REPLACE_CHANGED");
        }
        await this.editions.insertOne(
          {
            _id: id,
            churchId: g.churchId,
            previewId: p._id,
            actorId: g.actorId,
            actorKind: g.actorKind,
            document: p.document,
            templateId: p.templateId,
            pdf: p.pdf,
            xlsx: p.xlsx,
            pdfHash: hashBytes(p.pdf.buffer),
            xlsxHash: hashBytes(p.xlsx.buffer),
            previousId: p.previousId,
            reason: p.reason,
            lineageId: previous?.lineageId ?? id,
            revision: (previous?.revision ?? 0) + 1,
            supersededBy: null,
            issuedAt: this.now(),
          },
          { session: tx },
        );
        await this.previews.deleteOne({ _id: p._id, churchId: g.churchId }, { session: tx });
        await this.auditEvent(g, tx, requestId, operationId, "issued", id, [
          "edition",
          "templateId",
        ]);
        return {
          safeResult: { id: id.toHexString(), edition: true },
          resourceRefs: [{ type: "report_edition", id: id.toHexString() }],
        };
      },
      201,
    );
  }
  operation(g: ReportGrant, id: string) {
    return this.ops.getTenant(g, id, "church-reports", async (tx, operation) => {
      if (operation.routeKey.includes("/templates/"))
        requireCondition(g.canActivate, 403, "FORBIDDEN");
      else if (operation.routeKey.endsWith("/templates"))
        requireCondition(g.canUpload, 403, "FORBIDDEN");
      for (const ref of operation.resourceRefs) {
        if (ref.type === "report_template") await this.template(g, ref.id, tx);
        if (ref.type === "report_edition") await this.edition(g, ref.id, tx);
      }
    });
  }
  async viewEdition(g: ReportGrant, id: string) {
    return this.db.readSnapshot(g.churchId.toHexString(), async (tx) => {
      await g.fence(tx);
      const e = await this.edition(g, id, tx);
      return {
        id,
        document: e.document,
        revision: e.revision,
        templateId: e.templateId.toHexString(),
        supersededBy: toId(e.supersededBy),
        previousId: toId(e.previousId),
        reason: e.reason,
        issuedAt: e.issuedAt.toISOString(),
      };
    });
  }
  async file(g: ReportGrant, id: string, format: "xlsx" | "pdf", requestId: string) {
    return this.db.readSnapshot(g.churchId.toHexString(), async (tx) => {
      await g.fence(tx);
      const e = await this.edition(g, id, tx, true);
      await this.auditEvent(g, tx, requestId, new ObjectId(), "downloaded", e._id, [format]);
      return {
        bytes: Buffer.from(e[format].buffer),
        digest: format === "pdf" ? e.pdfHash : e.xlsxHash,
      };
    });
  }
}
