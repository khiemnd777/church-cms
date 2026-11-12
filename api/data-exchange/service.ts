import { type ClientSession, MongoServerError, ObjectId } from "mongodb";
import { z } from "zod";
import type { Audit } from "../audit/service";
import type { TenantGrant } from "../authorization/tenant-grant";
import { AppError, requireCondition } from "../errors";
import { idempotencyKey, objectId, parse, version } from "../http-validation";
import { digest } from "../identity/crypto";
import type { Database } from "../infrastructure/database";
import type { ExchangeMembers } from "../members/exchange";
import { canonical, type Operations } from "../operations/service";
import { TenantQueries } from "../tenant-queries";
import {
  type ExportDto,
  exportColumns,
  type FileFormat,
  type ImportDto,
  type ImportField,
  importFields,
  limits,
  type RowOutcome,
} from "./contracts";
import { fileDigest, makeFile, parseFile, templateRows } from "./files";
import type { ExportJob, ImportJob, SourceLink } from "./models";
import { fieldsFor, reviewRows } from "./review";

const sourceSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[\p{L}\p{N}_. -]+$/u);
const decisionSchema = z.strictObject({
  action: z.enum(["create", "link", "skip"]),
  memberCode: z.string().max(30).optional(),
  reason: z.string().max(500),
});
const patchSchema = z.strictObject({
  selectedSheet: z.string().max(100).optional(),
  mapping: z.record(z.enum(importFields), z.string().max(4096)).optional(),
  decisions: z.record(z.string().regex(/^\d+$/), decisionSchema).optional(),
});
const exportFields = {
  filters: z.record(z.string().max(30), z.string().max(200)),
  columns: z.array(z.enum(exportColumns)).min(1).max(exportColumns.length),
  format: z.enum(["csv", "xlsx"]),
};
const exportSchema = z
  .strictObject(exportFields)
  .refine((r) => new Set(r.columns).size === r.columns.length);
const batchSchema = z.strictObject({
  token: z.string().uuid(),
  nextBatch: z.number().int().min(0),
  consent: z.literal(true),
});
export class DataExchange {
  private queries: TenantQueries;
  constructor(
    private db: Database,
    private ops: Operations,
    private audit: Audit,
    private members: ExchangeMembers,
    key: string,
    private now: () => Date = () => new Date(),
  ) {
    this.queries = new TenantQueries(key, now, "exchange");
  }
  private get imports() {
    return this.db.db.collection<ImportJob>("exchange_imports");
  }
  private get exports() {
    return this.db.db.collection<ExportJob>("exchange_exports");
  }
  private get sources() {
    return this.db.db.collection<SourceLink>("exchange_sources");
  }
  private acl(g: TenantGrant) {
    requireCondition(g.canWrite && !g.unitScope && !g.receiptScope, 403, "FORBIDDEN");
    return { churchId: g.churchId, actorId: g.actorId, actorKind: g.actorKind };
  }
  private async job(g: TenantGrant, id: string, tx: ClientSession) {
    const job = await this.imports.findOne({ ...this.acl(g), _id: objectId(id) }, { session: tx });
    requireCondition(job && job.expiresAt > this.now(), 404, "NOT_FOUND");
    return job;
  }
  private dto(j: ImportJob): ImportDto {
    const sheet = j.sheets.find((s) => s.name === j.selectedSheet);
    return {
      id: j._id.toHexString(),
      source: j.source,
      format: j.format,
      digest: j.digest,
      sheets: j.sheets.map((s) => s.name),
      selectedSheet: j.selectedSheet,
      headers: sheet?.headers ?? [],
      mapping: j.mapping,
      version: j.version,
      state: j.state,
      total: sheet?.rows.length ?? 0,
      processed: j.outcomes.length,
      nextBatch: j.nextBatch,
      decisions: j.decisions,
      counts: j.counts,
      planToken: j.plan?.token ?? null,
      expiresAt: j.expiresAt.toISOString(),
      updatedAt: j.updatedAt.toISOString(),
      lastError: j.lastError,
    };
  }
  private async review(g: TenantGrant, j: ImportJob, tx: ClientSession) {
    requireCondition(j.selectedSheet, 422, "IMPORT_SHEET_REQUIRED");
    const ids = fieldsFor(j).map((r) => r.fields.externalId ?? "");
    const links = await this.sources
      .find({ churchId: g.churchId, source: j.source, externalId: { $in: ids } }, { session: tx })
      .toArray();
    return reviewRows(g, j, this.members, links, tx, this.now());
  }
  private async log(
    g: TenantGrant,
    event: string,
    id: ObjectId,
    op: ObjectId,
    requestId: string,
    tx: ClientSession,
    metadata: Record<string, unknown> = {},
  ) {
    await this.audit.organization(
      `data_exchange.${event}`,
      requestId,
      { id: g.actorId, kind: g.actorKind, churchId: g.actorKind === "owner" ? null : g.churchId },
      g.churchId,
      "data_exchange",
      id,
      ["status", "counts", "digest"],
      op,
      tx,
      JSON.stringify({ event, ...metadata }),
    );
  }
  async stage(
    g: TenantGrant,
    source: string,
    format: FileFormat,
    bytes: Uint8Array,
    key: string | null,
    requestId: string,
  ) {
    this.acl(g);
    idempotencyKey(key);
    source = parse(sourceSchema, source);
    const sheets = await parseFile(bytes, format),
      hash = fileDigest(bytes);
    requireCondition(
      Buffer.byteLength(JSON.stringify(sheets)) <= limits.fileBytes,
      413,
      "FILE_LIMIT",
    );
    return this.ops.executeTenant(
      g,
      "POST",
      `exchange/${g.churchId}/imports`,
      key,
      { source, format, hash },
      null,
      async (tx, op) => {
        const selected = sheets.length === 1 ? (sheets[0]?.name ?? null) : null;
        const headers = sheets[0]?.headers ?? [];
        const mapping: Partial<Record<ImportField, string>> = {};
        for (const field of importFields) {
          const match = headers.find((h) => h.trim().toLowerCase() === field.toLowerCase());
          if (match) mapping[field] = match;
        }
        const now = this.now(),
          job: ImportJob = {
            _id: new ObjectId(),
            ...this.acl(g),
            source,
            format,
            digest: hash,
            sheets,
            selectedSheet: selected,
            mapping: selected ? mapping : {},
            decisions: {},
            state: "review",
            version: 1,
            nextBatch: 0,
            outcomes: [],
            plan: null,
            counts: {},
            lastError: null,
            createdAt: now,
            updatedAt: now,
            expiresAt: new Date(now.getTime() + 24 * 60 * 60_000),
          };
        await this.imports.insertOne(job, { session: tx });
        await this.log(g, "staged", job._id, op, requestId, tx, {
          digest: job.digest,
          format: job.format,
          rows: sheets.reduce((n, s) => n + s.rows.length, 0),
        });
        return {
          safeResult: { importId: job._id.toHexString() },
          resourceRefs: [{ type: "import", id: job._id.toHexString() }],
        };
      },
      201,
    );
  }
  async list(g: TenantGrant, q: URLSearchParams) {
    this.queries.allow(q, ["limit", "cursor"]);
    const context = this.queries.context(g, "imports", null),
      limit = this.queries.limit(q);
    return this.db.readSnapshot(g.churchId.toHexString(), async (tx) => {
      await g.fence(tx);
      const filter = {
        ...this.acl(g),
        expiresAt: { $gt: this.now() },
        ...(q.has("cursor")
          ? { _id: { $lt: objectId(this.queries.decode(q.get("cursor") as string, context).id) } }
          : {}),
      };
      const jobs = await this.imports
          .find(filter, { session: tx, projection: { sheets: 0 } })
          .sort({ _id: -1 })
          .limit(limit + 1)
          .toArray(),
        more = jobs.length > limit;
      if (more) jobs.pop();
      const last = jobs.at(-1);
      return {
        items: jobs.map((j) => ({
          id: j._id.toHexString(),
          source: j.source,
          state: j.state,
          processed: j.outcomes.length,
          createdAt: j.createdAt.toISOString(),
          expiresAt: j.expiresAt.toISOString(),
        })),
        nextCursor: more && last ? this.queries.encode(context, "", last._id.toHexString()) : null,
      };
    });
  }
  async get(g: TenantGrant, id: string) {
    return this.db.readSnapshot(g.churchId.toHexString(), async (tx) => {
      await g.fence(tx);
      return this.dto(await this.job(g, id, tx));
    });
  }
  async rows(g: TenantGrant, id: string, q: URLSearchParams) {
    this.queries.allow(q, ["offset", "limit"]);
    const offset = q.get("offset") ?? "0",
      limit = this.queries.limit(q);
    requireCondition(/^\d+$/.test(offset) && Number(offset) <= limits.rows, 400, "INVALID_REQUEST");
    return this.db.readSnapshot(g.churchId.toHexString(), async (tx) => {
      await g.fence(tx);
      const job = await this.job(g, id, tx),
        review = await this.review(g, job, tx);
      return {
        items: review.rows
          .slice(Number(offset), Number(offset) + limit)
          .map(({ body: _body, familyMeta: _meta, group: _group, ...r }) => ({
            ...r,
            outcome: job.outcomes.find((o) => o.row === r.row) ?? null,
          })),
        total: review.rows.length,
        offset: Number(offset),
        nextOffset: Number(offset) + limit < review.rows.length ? Number(offset) + limit : null,
        counts: review.counts,
      };
    });
  }
  async patch(
    g: TenantGrant,
    id: string,
    raw: unknown,
    key: string | null,
    match: string | null,
    requestId: string,
  ) {
    const body = parse(patchSchema, raw),
      expected = version(match);
    return this.ops.executeTenant(
      g,
      "PATCH",
      `exchange/${g.churchId}/imports/${id.toLowerCase()}`,
      key,
      body,
      expected,
      async (tx, op) => {
        const job = await this.job(g, id, tx);
        requireCondition(
          job.version === expected && job.state !== "completed",
          412,
          "VERSION_CONFLICT",
        );
        if (body.selectedSheet !== undefined || body.mapping !== undefined) {
          requireCondition(!job.outcomes.length, 409, "IMPORT_ALREADY_STARTED");
          const selected = body.selectedSheet ?? job.selectedSheet,
            sheet = job.sheets.find((s) => s.name === selected);
          requireCondition(sheet, 422, "IMPORT_SHEET_REQUIRED");
          const mapping =
            body.mapping ??
            Object.fromEntries(
              importFields.flatMap((f) => {
                const h = sheet.headers.find((h) => h.trim().toLowerCase() === f.toLowerCase());
                return h ? [[f, h]] : [];
              }),
            );
          requireCondition(
            Object.values(mapping).every((h) => sheet.headers.includes(h)) &&
              new Set(Object.values(mapping)).size === Object.values(mapping).length,
            422,
            "FILE_HEADERS",
          );
          job.selectedSheet = selected;
          job.mapping = mapping;
          job.decisions = {};
        }
        if (body.decisions) {
          const sheet = job.sheets.find((s) => s.name === job.selectedSheet);
          for (const [row, d] of Object.entries(body.decisions)) {
            requireCondition(
              sheet &&
                Number(row) >= 2 &&
                Number(row) < sheet.rows.length + 2 &&
                !job.outcomes.some((o) => o.row === Number(row)),
              422,
              "INVALID_REQUEST",
            );
            job.decisions[row] = d;
          }
        }
        job.version++;
        job.updatedAt = this.now();
        job.plan = null;
        job.counts = {};
        job.lastError = null;
        job.state = job.outcomes.length ? "partial" : "review";
        await this.imports.replaceOne({ _id: job._id, version: expected }, job, { session: tx });
        await this.log(g, "review_changed", job._id, op, requestId, tx);
        return {
          safeResult: { importId: id, version: job.version },
          resourceRefs: [{ type: "import", id }],
        };
      },
    );
  }
  async prepare(
    g: TenantGrant,
    id: string,
    key: string | null,
    match: string | null,
    requestId: string,
  ) {
    const expected = version(match);
    return this.ops.executeTenant(
      g,
      "POST",
      `exchange/${g.churchId}/imports/${id.toLowerCase()}/prepare`,
      key,
      {},
      expected,
      async (tx, op) => {
        const job = await this.job(g, id, tx);
        requireCondition(
          job.version === expected && job.state !== "completed",
          412,
          "VERSION_CONFLICT",
        );
        const r = await this.review(g, job, tx),
          done = new Set(job.outcomes.map((o) => o.row)),
          remaining = r.rows.filter((row) => !done.has(row.row));
        requireCondition(
          remaining.length && !r.counts.error && !r.counts.review,
          422,
          "IMPORT_REVIEW_REQUIRED",
        );
        const groups = new Map<string, number[]>();
        for (const row of remaining) {
          const group =
            row.action === "create" && row.group.startsWith("new:") ? row.group : `row:${row.row}`;
          groups.set(group, [...(groups.get(group) ?? []), row.row]);
        }
        const batches: number[][] = [];
        for (const group of groups.values()) {
          requireCondition(group.length <= limits.batch, 413, "FILE_LIMIT");
          const last = batches.at(-1);
          if (last && last.length + group.length <= limits.batch) last.push(...group);
          else batches.push([...group]);
        }
        job.plan = {
          token: crypto.randomUUID(),
          batches,
          fingerprints: Object.fromEntries(
            remaining.map((row) => [String(row.row), row.fingerprint]),
          ),
          context: r.context,
        };
        job.nextBatch = 0;
        job.counts = r.counts;
        job.state = "ready";
        job.lastError = null;
        job.version++;
        job.updatedAt = this.now();
        await this.imports.replaceOne({ _id: job._id, version: expected }, job, { session: tx });
        await this.log(g, "prepared", job._id, op, requestId, tx, {
          counts: job.counts,
          batches: job.plan.batches.length,
          digest: job.digest,
        });
        return {
          safeResult: { importId: id, version: job.version },
          resourceRefs: [{ type: "import", id }],
        };
      },
    );
  }
  async batch(
    g: TenantGrant,
    id: string,
    raw: unknown,
    key: string | null,
    match: string | null,
    requestId: string,
  ) {
    const body = parse(batchSchema, raw),
      expected = version(match);
    try {
      return await this.ops.executeTenant(
        g,
        "POST",
        `exchange/${g.churchId}/imports/${id.toLowerCase()}/batches`,
        key,
        body,
        expected,
        async (tx, op) => {
          const job = await this.job(g, id, tx),
            plan = job.plan;
          requireCondition(
            job.version === expected &&
              plan &&
              ["ready", "partial"].includes(job.state) &&
              plan.token === body.token &&
              job.nextBatch === body.nextBatch,
            412,
            "IMPORT_PREVIEW_STALE",
          );
          const r = await this.review(g, job, tx),
            batch = plan.batches[job.nextBatch];
          requireCondition(batch && plan.context === r.context, 412, "IMPORT_PREVIEW_STALE");
          const rows = batch.map((n) => r.rows.find((row) => row.row === n));
          requireCondition(
            rows.every(
              (row) =>
                row &&
                row.fingerprint === plan.fingerprints[String(row.row)] &&
                ["create", "link", "skip"].includes(row.action),
            ),
            412,
            "IMPORT_PREVIEW_STALE",
          );
          const createdFamilies = new Map<string, string>();
          for (const row of rows) {
            if (!row) throw new AppError(412, "IMPORT_PREVIEW_STALE");
            let memberId = row.target?.id ?? null,
              memberCode = row.target?.code ?? null;
            let action: RowOutcome["action"] = "skipped";
            if (row.action === "create") {
              const linkedFamily = createdFamilies.get(row.group);
              const record = await this.members.create(
                g,
                linkedFamily
                  ? { ...row.body, family: { kind: "existing", id: linkedFamily } }
                  : row.body,
                tx,
                op,
                requestId,
                linkedFamily ? undefined : row.familyMeta,
              );
              memberId = record._id.toHexString();
              memberCode = record.code;
              action = "created";
              if (row.group.startsWith("new:"))
                createdFamilies.set(row.group, record.familyId.toHexString());
            } else if (row.action === "link") {
              requireCondition(row.target, 422, "IMPORT_REVIEW_REQUIRED");
              action = "linked";
            }
            if (action !== "skipped")
              await this.sources.insertOne(
                {
                  _id: new ObjectId(),
                  churchId: g.churchId,
                  source: job.source,
                  externalId: row.externalId,
                  memberId: objectId(memberId as string),
                  createdAt: this.now(),
                  jobId: job._id,
                  actorId: g.actorId,
                  actorKind: g.actorKind,
                  action,
                  reason: job.decisions[String(row.row)]?.reason || null,
                  sourceDigest: job.digest,
                },
                { session: tx },
              );
            job.outcomes.push({ row: row.row, action, memberId, memberCode });
          }
          job.nextBatch++;
          job.version++;
          job.updatedAt = this.now();
          job.lastError = null;
          job.state = job.nextBatch >= plan.batches.length ? "completed" : "partial";
          if (job.state !== "completed") {
            // Advance only the baseline changed by this committed batch, within the same snapshot/fence.
            const updated = await this.review(g, job, tx);
            plan.fingerprints = Object.fromEntries(
              updated.rows
                .filter((row) => !job.outcomes.some((o) => o.row === row.row))
                .map((row) => [String(row.row), row.fingerprint]),
            );
            job.counts = updated.counts;
          } else job.counts = { create: 0, link: 0, skip: 0, review: 0, error: 0 };
          await this.imports.replaceOne({ _id: job._id, version: expected }, job, { session: tx });
          await this.log(g, "batch_completed", job._id, op, requestId, tx, {
            batch: body.nextBatch,
            processed: job.outcomes.length,
            state: job.state,
            digest: job.digest,
          });
          return {
            safeResult: {
              importId: id,
              version: job.version,
              processed: job.outcomes.length,
              state: job.state,
              batch: body.nextBatch,
            },
            resourceRefs: [{ type: "import", id }],
          };
        },
      );
    } catch (error) {
      // A known abort can be marked for review; an unknown commit outcome must remain reconcilable.
      const knownAbort =
        error instanceof AppError &&
        ![
          "OUTCOME_UNKNOWN",
          "OPERATION_IN_PROGRESS",
          "IDEMPOTENCY_CONFLICT",
          "IDEMPOTENCY_EXPIRED",
        ].includes(error.code);
      if (knownAbort || (error instanceof MongoServerError && error.code === 11000)) {
        await this.db.transaction(async (tx) => {
          await g.fence(tx);
          const j = await this.job(g, id, tx);
          if (j.version === expected && j.state !== "completed")
            await this.imports.updateOne(
              { _id: j._id, version: expected },
              {
                $set: {
                  state: j.outcomes.length ? "partial" : "review",
                  lastError: error instanceof AppError ? error.code : "IMPORT_PREVIEW_STALE",
                  plan: null,
                  updatedAt: this.now(),
                },
                $inc: { version: 1 },
              },
              { session: tx },
            );
        });
      }
      if (error instanceof MongoServerError && error.code === 11000)
        throw new AppError(412, "IMPORT_PREVIEW_STALE");
      throw error;
    }
  }
  async reconciliation(g: TenantGrant, id: string, format: FileFormat) {
    const rows = await this.db.readSnapshot(g.churchId.toHexString(), async (tx) => {
      await g.fence(tx);
      const j = await this.job(g, id, tx),
        r = await this.review(g, j, tx);
      return r.rows.map((row) => {
        const done = j.outcomes.find((o) => o.row === row.row);
        return [
          String(row.row),
          row.externalId,
          row.fullName,
          done?.action ?? "not_written",
          done?.memberCode ?? "",
          row.errors.join("; "),
          row.warnings.join("; "),
        ];
      });
    });
    return makeFile(
      ["row", "externalId", "fullName", "result", "memberCode", "errors", "warnings"],
      rows,
      format,
    );
  }
  async template(format: FileFormat) {
    return makeFile(importFields, templateRows(), format);
  }
  async previewExport(g: TenantGrant, raw: unknown) {
    const body = parse(exportSchema, raw);
    return this.db.readSnapshot(g.churchId.toHexString(), async (tx) => {
      await g.fence(tx);
      this.acl(g);
      const rows = await this.members.snapshot(g, body.filters, body.columns, tx);
      return {
        count: rows.length,
        columns: body.columns,
        format: body.format,
        asOf: this.now().toISOString(),
        previewToken: digest(canonical({ ...body, rows, policy: g.policyContext })),
      };
    });
  }
  async createExport(g: TenantGrant, raw: unknown, key: string | null, requestId: string) {
    const schema = z
      .strictObject({ ...exportFields, previewToken: z.string().length(64) })
      .refine((r) => new Set(r.columns).size === r.columns.length);
    const body = parse(schema, raw),
      { previewToken, ...request } = body;
    return this.ops.executeTenant(
      g,
      "POST",
      `exchange/${g.churchId}/exports`,
      key,
      body,
      null,
      async (tx, op) => {
        this.acl(g);
        const rows = await this.members.snapshot(g, request.filters, request.columns, tx);
        requireCondition(
          digest(canonical({ ...request, rows, policy: g.policyContext })) === previewToken,
          412,
          "IMPORT_PREVIEW_STALE",
        );
        requireCondition(
          Buffer.byteLength(JSON.stringify(rows)) <= limits.fileBytes,
          413,
          "FILE_LIMIT",
        );
        const file = await makeFile(request.columns, rows, request.format),
          now = this.now(),
          job: ExportJob = {
            _id: new ObjectId(),
            ...this.acl(g),
            ...request,
            rows,
            count: rows.length,
            bytes: file.bytes,
            digest: fileDigest(file.bytes),
            protectedCells: file.protectedCells,
            createdAt: now,
            expiresAt: new Date(now.getTime() + 60 * 60_000),
          };
        await this.exports.insertOne(job, { session: tx });
        await this.log(g, "export_created", job._id, op, requestId, tx, {
          count: job.count,
          digest: job.digest,
          format: job.format,
          columns: job.columns,
          filterDigest: digest(canonical(job.filters)),
        });
        return {
          safeResult: { export: this.exportDto(job) },
          resourceRefs: [{ type: "export", id: job._id.toHexString() }],
        };
      },
      201,
    );
  }
  private exportDto(job: ExportJob): ExportDto {
    return {
      id: job._id.toHexString(),
      count: job.count,
      digest: job.digest,
      format: job.format,
      columns: job.columns,
      asOf: job.createdAt.toISOString(),
      expiresAt: job.expiresAt.toISOString(),
      protectedCells: job.protectedCells,
    };
  }
  async download(g: TenantGrant, id: string) {
    return this.db.readSnapshot(g.churchId.toHexString(), async (tx) => {
      await g.fence(tx);
      const j = await this.exports.findOne({ ...this.acl(g), _id: objectId(id) }, { session: tx });
      requireCondition(j && j.expiresAt > this.now(), 404, "NOT_FOUND");
      return { bytes: Buffer.from(j.bytes.buffer), format: j.format, meta: this.exportDto(j) };
    });
  }
}
