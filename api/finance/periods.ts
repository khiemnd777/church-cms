import { type ClientSession, type Document, MongoServerError, ObjectId } from "mongodb";
import { z } from "zod";
import { AppError, requireCondition } from "../errors";
import { objectId, parse } from "../http-validation";
import { digest, equal, sign } from "../identity/crypto";
import type { Database } from "../infrastructure/database";
import { businessDay } from "../members/dates";
import { canonical, type Operation, type Operations } from "../operations/service";
import { resourceCode } from "../resource-code";
import { TenantQueries } from "../tenant-queries";
import { FinanceBook } from "./book";
import type { FinanceGrant, FinanceHistory } from "./models";
import { decimalString, moneyDecimal } from "./money";
import type { BookControl, PeriodClosure } from "./periods-model";
import { FinanceReconciliation } from "./reconciliation";
import type { Finance } from "./service";
import type { LedgerEntry } from "./transactions-model";

const draft = z.strictObject({
  submissionId: z.uuid().transform((s) => s.toLowerCase()),
  reason: z.string().normalize("NFC").trim().min(1).max(500),
});
const commit = z.strictObject({
  closure: draft,
  controlVersion: z.number().int().min(0),
  previewToken: z.string().min(1).max(4096),
  confirmed: z.literal(true),
});
export class FinancePeriods {
  private book: FinanceBook;
  private reconciliation: FinanceReconciliation;
  constructor(
    private db: Database,
    private ops: Operations,
    private finance: Finance,
    private key: string,
    private now: () => Date = () => new Date(),
  ) {
    this.book = new FinanceBook(db);
    this.reconciliation = new FinanceReconciliation(db);
  }
  private get closures() {
    return this.db.db.collection<PeriodClosure>("finance_period_closures");
  }
  private read(g: FinanceGrant) {
    requireCondition(
      g.actorKind === "church_user" && ["pastor", "treasurer"].includes(g.financeRole),
      403,
      "FORBIDDEN",
    );
  }
  private write(g: FinanceGrant) {
    this.read(g);
    requireCondition(g.financeRole === "treasurer" && g.canWrite, 403, "FORBIDDEN");
  }
  private month(s: string) {
    requireCondition(/^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(s), 400, "INVALID_REQUEST");
    return s;
  }
  private advance(month: string, c: BookControl | null) {
    requireCondition(month <= businessDay(this.now()).slice(0, 7), 422, "FINANCE_FUTURE_PERIOD");
    requireCondition(!c?.closedThrough || month > c.closedThrough, 409, "FINANCE_ALREADY_CLOSED");
  }
  private dto(c: PeriodClosure) {
    return {
      id: c._id.toHexString(),
      code: c.code,
      throughPeriod: c.throughPeriod,
      previousClosedThrough: c.previousClosedThrough,
      version: c.version,
      controlVersion: c.controlVersion,
      actorName: c.actorName,
      reason: c.reason,
      occurredAt: c.occurredAt.toISOString(),
      summary: c.summary,
    };
  }
  private async authorize(g: FinanceGrant, op: Operation, tx: ClientSession) {
    this.write(g);
    const ref = op.resourceRefs[0];
    requireCondition(
      ref && op.resourceRefs.length === 1 && ref.type === "finance_closure",
      403,
      "FORBIDDEN",
    );
    requireCondition(
      await this.closures.findOne({ _id: objectId(ref.id), churchId: g.churchId }, { session: tx }),
      404,
      "NOT_FOUND",
    );
  }
  async operation(g: FinanceGrant, id: string) {
    this.write(g);
    return this.ops.getTenant(g, id, "finance-periods", (tx, op) => this.authorize(g, op, tx));
  }
  private fingerprint(
    control: BookControl | null,
    month: string,
    result: Awaited<ReturnType<FinanceReconciliation["inspect"]>>,
  ) {
    return digest(
      canonical({
        version: control?.version ?? 0,
        previous: control?.closedThrough ?? null,
        month,
        ...result,
      }),
    );
  }
  private token(g: FinanceGrant, month: string, b: unknown, fingerprint: string) {
    const data = Buffer.from(
      JSON.stringify({
        actor: g.actorId.toHexString(),
        church: g.churchId.toHexString(),
        context: g.policyContext,
        month,
        body: digest(canonical(b)),
        fingerprint,
        expires: this.now().getTime() + 300000,
      }),
    ).toString("base64url");
    return `${data}.${sign(this.key, `period-preview:${data}`)}`;
  }
  private verify(g: FinanceGrant, month: string, b: unknown, fingerprint: string, token: string) {
    const [data, sig, ...extra] = token.split(".");
    requireCondition(
      data && sig && !extra.length && equal(sig, sign(this.key, `period-preview:${data}`)),
      409,
      "PERIOD_PREVIEW_STALE",
    );
    let d: Record<string, unknown>;
    try {
      d = JSON.parse(Buffer.from(data, "base64url").toString());
    } catch {
      throw new AppError(409, "PERIOD_PREVIEW_STALE");
    }
    requireCondition(
      d &&
        d.actor === g.actorId.toHexString() &&
        d.church === g.churchId.toHexString() &&
        d.context === g.policyContext &&
        d.month === month &&
        d.body === digest(canonical(b)) &&
        d.fingerprint === fingerprint &&
        typeof d.expires === "number" &&
        d.expires > this.now().getTime(),
      409,
      "PERIOD_PREVIEW_STALE",
    );
  }
  async get(g: FinanceGrant, month: string) {
    this.read(g);
    this.month(month);
    return this.db.readSnapshot(g.churchId.toHexString(), async (tx) => {
      await g.fence(tx);
      const s = await this.book.status(g, month, tx),
        closure = s.closed
          ? await this.closures.findOne(
              {
                churchId: g.churchId,
                throughPeriod: { $gte: month },
                $or: [{ previousClosedThrough: null }, { previousClosedThrough: { $lt: month } }],
              },
              { session: tx },
            )
          : null;
      const inspected = await this.reconciliation.inspect(
        g.churchId,
        month,
        s.closed ? (closure?.previousClosedThrough ?? null) : (s.control?.closedThrough ?? null),
        tx,
      );
      return {
        period: month,
        state: s.closed ? "closed" : "open",
        closedThrough: s.control?.closedThrough ?? null,
        controlVersion: s.control?.version ?? 0,
        canClose:
          g.financeRole === "treasurer" &&
          month <= businessDay(this.now()).slice(0, 7) &&
          (!s.control?.closedThrough || month > s.control.closedThrough),
        closure: closure ? this.dto(closure) : null,
        inspection: inspected,
      };
    });
  }
  async preview(g: FinanceGrant, month: string, raw: unknown) {
    this.write(g);
    this.month(month);
    const b = parse(draft, raw);
    return this.db.readSnapshot(g.churchId.toHexString(), async (tx) => {
      await g.fence(tx);
      const c = await this.book.control(g, tx);
      this.advance(month, c);
      const result = await this.reconciliation.inspect(
        g.churchId,
        month,
        c?.closedThrough ?? null,
        tx,
      );
      requireCondition(result.matches, 409, "FINANCE_RECONCILIATION_FAILED");
      return {
        throughPeriod: month,
        previousClosedThrough: c?.closedThrough ?? null,
        controlVersion: c?.version ?? 0,
        summary: result.summary,
        previewToken: this.token(g, month, b, this.fingerprint(c, month, result)),
      };
    });
  }
  async close(g: FinanceGrant, month: string, raw: unknown, key: string | null, requestId: string) {
    this.write(g);
    this.month(month);
    const b = parse(commit, raw),
      payloadHash = digest(
        canonical({ month, closure: b.closure, controlVersion: b.controlVersion }),
      );
    try {
      return await this.ops.executeTenant(
        g,
        "POST",
        `finance-periods/${g.churchId}/${month}/close`,
        key,
        b,
        b.controlVersion,
        async (tx, operationId) => {
          const existing = await this.closures.findOne(
            {
              churchId: g.churchId,
              $or: [{ throughPeriod: month }, { submissionId: b.closure.submissionId }],
            },
            { session: tx },
          );
          if (existing) {
            requireCondition(
              existing.throughPeriod === month &&
                existing.actorId.equals(g.actorId) &&
                existing.submissionId === b.closure.submissionId &&
                existing.payloadHash === payloadHash,
              409,
              "FINANCE_ALREADY_CLOSED",
            );
            return {
              safeResult: {
                closureId: existing._id.toHexString(),
                version: existing.version,
                throughPeriod: existing.throughPeriod,
                reconciled: true,
              },
              resourceRefs: [{ type: "finance_closure", id: existing._id.toHexString() }],
            };
          }
          const before = await this.book.control(g, tx);
          this.advance(month, before);
          requireCondition(b.controlVersion === (before?.version ?? 0), 412, "VERSION_CONFLICT");
          const control = await this.book.controlFence(g, tx);
          const result = await this.reconciliation.inspect(
            g.churchId,
            month,
            before?.closedThrough ?? null,
            tx,
          );
          requireCondition(result.matches, 409, "FINANCE_RECONCILIATION_FAILED");
          this.verify(g, month, b.closure, this.fingerprint(before, month, result), b.previewToken);
          const changed = await this.db.db
            .collection<BookControl>("finance_book_controls")
            .updateOne(
              { _id: g.churchId, version: control.version },
              { $set: { closedThrough: month }, $inc: { version: 1 } },
              { session: tx },
            );
          requireCondition(changed.matchedCount, 412, "VERSION_CONFLICT");
          const c: PeriodClosure = {
            _id: new ObjectId(),
            churchId: g.churchId,
            code: resourceCode("KS"),
            throughPeriod: month,
            previousClosedThrough: before?.closedThrough ?? null,
            version: 1,
            controlVersion: control.version + 1,
            submissionId: b.closure.submissionId,
            payloadHash,
            actorId: g.actorId,
            actorName: g.actorName,
            reason: b.closure.reason,
            occurredAt: this.now(),
            summary: result.summary,
          };
          await this.closures.insertOne(c, { session: tx });
          await this.finance.append(
            g,
            "period_closure",
            c._id,
            "closed",
            null,
            this.dto(c),
            c.reason,
            operationId,
            requestId,
            tx,
          );
          return {
            safeResult: {
              closureId: c._id.toHexString(),
              version: 1,
              throughPeriod: month,
              reconciled: false,
            },
            resourceRefs: [{ type: "finance_closure", id: c._id.toHexString() }],
          };
        },
        201,
        (tx, op) => this.authorize(g, op, tx),
      );
    } catch (e) {
      if (e instanceof MongoServerError && e.code === 11000)
        throw new AppError(409, "OPERATION_IN_PROGRESS");
      throw e;
    }
  }
  async closure(g: FinanceGrant, id: string) {
    this.read(g);
    return this.db.readSnapshot(g.churchId.toHexString(), async (tx) => {
      await g.fence(tx);
      const c = await this.closures.findOne(
        { _id: objectId(id), churchId: g.churchId },
        { session: tx },
      );
      requireCondition(c, 404, "NOT_FOUND");
      return this.dto(c);
    });
  }
  async history(g: FinanceGrant, id: string, q: URLSearchParams) {
    this.read(g);
    const query = new TenantQueries(this.key, this.now, "period-history");
    query.allow(q, ["limit", "cursor"]);
    const limit = query.limit(q),
      context = query.context(g, `closure/${id}`, null),
      after = q.has("cursor") ? query.decode(q.get("cursor") as string, context) : null;
    return this.db.readSnapshot(g.churchId.toHexString(), async (tx) => {
      await g.fence(tx);
      requireCondition(
        await this.closures.findOne({ _id: objectId(id), churchId: g.churchId }, { session: tx }),
        404,
        "NOT_FOUND",
      );
      const rows = await this.db.db
          .collection<FinanceHistory>("finance_history")
          .find(
            {
              churchId: g.churchId,
              targetType: "period_closure",
              targetId: objectId(id),
              ...(after ? { _id: { $lt: objectId(after.id) } } : {}),
            },
            { session: tx, maxTimeMS: 3000 },
          )
          .sort({ _id: -1 })
          .limit(limit + 1)
          .toArray(),
        more = rows.length > limit;
      rows.splice(limit);
      const last = rows.at(-1);
      return {
        items: rows.map((h) => ({
          id: h._id.toHexString(),
          actorName: h.actorName,
          event: h.event,
          occurredAt: h.occurredAt.toISOString(),
          reason: h.reason,
        })),
        nextCursor: more && last ? query.encode(context, "", last._id.toHexString()) : null,
      };
    });
  }
  async funds(g: FinanceGrant, month: string, q: URLSearchParams) {
    this.read(g);
    this.month(month);
    const query = new TenantQueries(this.key, this.now, "period-funds");
    query.allow(q, ["limit", "cursor"]);
    const limit = query.limit(q),
      context = query.context(g, month, null),
      after = q.has("cursor") ? query.decode(q.get("cursor") as string, context) : null,
      from = `${month}-01`,
      next = new Date(`${from}T00:00:00Z`);
    next.setUTCMonth(next.getUTCMonth() + 1);
    const until = next.toISOString().slice(0, 10);
    return this.db.readSnapshot(g.churchId.toHexString(), async (tx) => {
      await g.fence(tx);
      const rows = await this.db.db
          .collection("finance_ledger")
          .aggregate<{
            _id: ObjectId;
            fundName: string;
            income: LedgerEntry["amount"];
            expense: LedgerEntry["amount"];
            opening: LedgerEntry["amount"];
            closing: LedgerEntry["amount"];
          }>(
            [
              {
                $match: {
                  churchId: g.churchId,
                  businessDate: { $lt: until },
                  ...(after ? { fundId: { $gt: objectId(after.id) } } : {}),
                },
              },
              { $sort: { businessDate: -1, _id: -1 } },
              {
                $group: {
                  _id: "$fundId",
                  fundName: { $first: "$fundName" },
                  income: {
                    $sum: {
                      $cond: [
                        {
                          $and: [
                            { $gte: ["$businessDate", from] },
                            { $in: ["$kind", ["receipt", "void"]] },
                          ],
                        },
                        "$amount",
                        moneyDecimal(0n),
                      ],
                    },
                  },
                  expense: {
                    $sum: {
                      $cond: [
                        {
                          $and: [
                            { $gte: ["$businessDate", from] },
                            { $in: ["$kind", ["payment", "payment_void"]] },
                          ],
                        },
                        { $multiply: ["$amount", -1] },
                        moneyDecimal(0n),
                      ],
                    },
                  },
                  opening: {
                    $sum: {
                      $cond: [{ $lt: ["$businessDate", from] }, "$amount", moneyDecimal(0n)],
                    },
                  },
                  closing: { $sum: "$amount" },
                },
              },
              { $sort: { _id: 1 } },
              { $limit: limit + 1 },
            ] as Document[],
            { session: tx, maxTimeMS: 3000 },
          )
          .toArray(),
        more = rows.length > limit;
      rows.splice(limit);
      const last = rows.at(-1);
      return {
        items: rows.map((f) => ({
          id: f._id.toHexString(),
          fundName: f.fundName,
          netIncome: decimalString(f.income),
          netExpense: decimalString(f.expense),
          openingBalance: decimalString(f.opening),
          closingBalance: decimalString(f.closing),
        })),
        nextCursor: more && last ? query.encode(context, "", last._id.toHexString()) : null,
      };
    });
  }
}
