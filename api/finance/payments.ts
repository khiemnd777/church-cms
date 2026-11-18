import { type ClientSession, MongoServerError, ObjectId } from "mongodb";
import { z } from "zod";
import { AppError, requireCondition } from "../errors";
import { objectId, parse, version } from "../http-validation";
import { digest, equal, sign } from "../identity/crypto";
import type { Database } from "../infrastructure/database";
import { businessDay } from "../members/dates";
import { canonical, type Operation, type Operations } from "../operations/service";
import { resourceCode } from "../resource-code";
import { TenantQueries } from "../tenant-queries";
import { FinanceBook } from "./book";
import type { ExpenseProposal } from "./expenses-model";
import type { FinanceGrant, FinanceHistory, Fund } from "./models";
import { decimalString, moneyDecimal } from "./money";
import type { Payment } from "./payments-model";
import type { Finance } from "./service";
import type { LedgerEntry } from "./transactions-model";

const draft = z.strictObject({ submissionId: z.uuid().transform((s) => s.toLowerCase()) });
const voidDraft = z.strictObject({ reason: z.string().normalize("NFC").trim().min(1).max(500) });
const voidConfirm = z.strictObject({
  void: voidDraft,
  previewToken: z.string().min(1).max(4096),
  confirmed: z.literal(true),
});
const confirm = z.strictObject({
  payment: draft,
  previewToken: z.string().min(1).max(4096),
  confirmed: z.literal(true),
});
export class Payments {
  private book: FinanceBook;
  constructor(
    private db: Database,
    private ops: Operations,
    private finance: Finance,
    private key: string,
    private now: () => Date = () => new Date(),
  ) {
    this.book = new FinanceBook(db);
  }
  private get payments() {
    return this.db.db.collection<Payment>("finance_payments");
  }
  private get proposals() {
    return this.db.db.collection<ExpenseProposal>("finance_expense_proposals");
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
  private dto(p: Payment) {
    return {
      state: p.state ?? "posted",
      voidReason: p.voidReason ?? null,
      voidedAt: p.voidedAt?.toISOString() ?? null,
      voidedName: p.voidedName ?? null,
      id: p._id.toHexString(),
      code: p.code,
      version: p.version,
      proposalId: p.proposalId.toHexString(),
      proposalCode: p.proposalCode,
      contentHash: p.contentHash,
      businessDate: p.businessDate,
      period: p.period,
      fundName: p.fundName,
      fundNameAtPayment: p.fundNameAtPayment,
      amount: decimalString(p.amount),
      purpose: p.purpose,
      actorName: p.actorName,
      createdAt: p.createdAt.toISOString(),
      decision: {
        actorName: p.decision.actorName,
        actorRole: p.decision.actorRole,
        decidedAt: p.decision.decidedAt.toISOString(),
        reason: p.decision.reason,
      },
    };
  }
  private async authorize(g: FinanceGrant, op: Operation, tx: ClientSession) {
    this.write(g);
    const ref = op.resourceRefs[0];
    requireCondition(
      ref && op.resourceRefs.length === 1 && ref.type === "finance_payment",
      403,
      "FORBIDDEN",
    );
    requireCondition(
      await this.payments.findOne({ _id: objectId(ref.id), churchId: g.churchId }, { session: tx }),
      404,
      "NOT_FOUND",
    );
  }
  async operation(g: FinanceGrant, id: string) {
    this.write(g);
    return this.ops.getTenant(g, id, "finance-payments", (tx, op) => this.authorize(g, op, tx));
  }
  private async sources(g: FinanceGrant, id: string, expected: number, tx: ClientSession) {
    const proposal = await this.proposals.findOne(
      { _id: objectId(id), churchId: g.churchId },
      { session: tx },
    );
    requireCondition(proposal, 404, "NOT_FOUND");
    requireCondition(proposal.state === "approved", 409, "PAYMENT_NOT_APPROVED");
    requireCondition(proposal.version === expected, 412, "VERSION_CONFLICT");
    requireCondition(
      proposal.decision?.action === "approved" &&
        !proposal.decision.actorId.equals(proposal.createdBy) &&
        proposal.decision.contentHash === proposal.contentHash,
      409,
      "PAYMENT_NOT_APPROVED",
    );
    const fund = await this.db.db
      .collection<Fund>("finance_funds")
      .findOne({ _id: proposal.fundId, churchId: g.churchId, status: "active" }, { session: tx });
    requireCondition(fund, 409, "FINANCE_SOURCE_UNAVAILABLE");
    const day = businessDay(this.now()),
      period = await this.book.period(g, day.slice(0, 7), tx),
      balance = await this.book.balance(g.churchId, fund._id, tx),
      amount = BigInt(decimalString(proposal.amount));
    requireCondition(BigInt(balance.amount) >= amount, 409, "FINANCE_INSUFFICIENT_BALANCE");
    const fingerprint = digest(
      canonical([
        proposal.version,
        proposal.contentHash,
        proposal.decision,
        fund.version,
        fund.financeWriteFence ?? 0,
        day,
        period?.version ?? 1,
        balance,
      ]),
    );
    return { proposal, decision: proposal.decision, fund, day, balance, amount, fingerprint };
  }
  private token(g: FinanceGrant, id: string, body: unknown, fingerprint: string) {
    const data = Buffer.from(
      JSON.stringify({
        actor: g.actorId.toHexString(),
        church: g.churchId.toHexString(),
        context: g.policyContext,
        id,
        body: digest(canonical(body)),
        fingerprint,
        expires: this.now().getTime() + 300000,
      }),
    ).toString("base64url");
    return `${data}.${sign(this.key, `payment-preview:${data}`)}`;
  }
  private verify(g: FinanceGrant, id: string, body: unknown, fingerprint: string, token: string) {
    const [data, sig, ...more] = token.split(".");
    requireCondition(
      data && sig && !more.length && equal(sig, sign(this.key, `payment-preview:${data}`)),
      409,
      "PAYMENT_PREVIEW_STALE",
    );
    let d: Record<string, unknown>;
    try {
      d = JSON.parse(Buffer.from(data, "base64url").toString());
    } catch {
      throw new AppError(409, "PAYMENT_PREVIEW_STALE");
    }
    requireCondition(
      d &&
        d.actor === g.actorId.toHexString() &&
        d.church === g.churchId.toHexString() &&
        d.context === g.policyContext &&
        d.id === id &&
        d.body === digest(canonical(body)) &&
        d.fingerprint === fingerprint &&
        typeof d.expires === "number" &&
        d.expires > this.now().getTime(),
      409,
      "PAYMENT_PREVIEW_STALE",
    );
  }
  async preview(g: FinanceGrant, id: string, raw: unknown, match: string | null) {
    this.write(g);
    const b = parse(draft, raw),
      expected = version(match);
    return this.db.readSnapshot(g.churchId.toHexString(), async (tx) => {
      await g.fence(tx);
      const s = await this.sources(g, id, expected, tx);
      return {
        previewToken: this.token(g, id, b, s.fingerprint),
        proposalId: id,
        proposalCode: s.proposal.code,
        proposalVersion: s.proposal.version,
        fundName: s.proposal.fundName,
        currentFundName: s.fund.name,
        amount: s.amount.toString(),
        purpose: s.proposal.purpose,
        businessDate: s.day,
        balance: s.balance.amount,
        balanceAfter: (BigInt(s.balance.amount) - s.amount).toString(),
        approvedBy: s.proposal.decision?.actorName,
        approvedAt: s.proposal.decision?.decidedAt.toISOString(),
      };
    });
  }
  async post(
    g: FinanceGrant,
    id: string,
    raw: unknown,
    key: string | null,
    match: string | null,
    requestId: string,
  ) {
    this.write(g);
    const b = parse(confirm, raw),
      expected = version(match),
      target = objectId(id),
      payloadHash = digest(canonical({ proposalId: id, payment: b.payment, expected }));
    try {
      return await this.ops.executeTenant(
        g,
        "POST",
        `finance-payments/${g.churchId}/${id}/post`,
        key,
        b,
        expected,
        async (tx, operationId) => {
          const existing = await this.payments.findOne(
            {
              churchId: g.churchId,
              $or: [{ proposalId: target }, { submissionId: b.payment.submissionId }],
            },
            { session: tx },
          );
          if (existing) {
            requireCondition(
              existing.proposalId.equals(target) &&
                existing.actorId.equals(g.actorId) &&
                existing.submissionId === b.payment.submissionId &&
                existing.payloadHash === payloadHash,
              409,
              "PAYMENT_ALREADY_POSTED",
            );
            return {
              safeResult: {
                paymentId: existing._id.toHexString(),
                proposalId: id,
                version: existing.version,
                reconciled: true,
              },
              resourceRefs: [{ type: "finance_payment", id: existing._id.toHexString() }],
            };
          }
          await this.book.controlFence(g, tx, businessDay(this.now()).slice(0, 7));
          const s = await this.sources(g, id, expected, tx);
          this.verify(g, id, b.payment, s.fingerprint, b.previewToken);
          await this.book.fundFence(g, s.fund._id, tx, true);
          await this.book.period(g, s.day.slice(0, 7), tx, true);
          const p: Payment = {
            _id: new ObjectId(),
            churchId: g.churchId,
            code: resourceCode("PC"),
            proposalId: target,
            proposalCode: s.proposal.code,
            proposalVersion: expected,
            contentHash: s.proposal.contentHash,
            submissionId: b.payment.submissionId,
            payloadHash,
            actorId: g.actorId,
            actorName: g.actorName,
            businessDate: s.day,
            period: s.day.slice(0, 7),
            fundId: s.proposal.fundId,
            fundName: s.proposal.fundName,
            fundNameAtPayment: s.fund.name,
            amount: s.proposal.amount,
            purpose: s.proposal.purpose,
            decision: s.decision,
            createdAt: this.now(),
            version: 1,
          };
          await this.payments.insertOne(p, { session: tx });
          await this.db.db.collection<LedgerEntry>("finance_ledger").insertOne(
            {
              _id: new ObjectId(),
              churchId: g.churchId,
              paymentId: p._id,
              paymentCode: p.code,
              proposalId: target,
              proposalCode: p.proposalCode,
              fundId: p.fundId,
              fundName: p.fundName,
              businessDate: p.businessDate,
              period: p.period,
              kind: "payment",
              amount: moneyDecimal(-s.amount),
              occurredAt: this.now(),
            },
            { session: tx },
          );
          const payment = { id: p._id, code: p.code, businessDate: p.businessDate };
          const saved = await this.proposals.findOneAndUpdate(
            { _id: target, churchId: g.churchId, state: "approved", version: expected },
            { $set: { state: "paid", payment }, $inc: { version: 1 } },
            { session: tx, returnDocument: "after" },
          );
          requireCondition(saved, 412, "VERSION_CONFLICT");
          await this.finance.append(
            g,
            "payment",
            p._id,
            "posted",
            null,
            this.dto(p),
            null,
            operationId,
            requestId,
            tx,
          );
          // Expense history retains the minimal payment link; no book balance leaks.
          await this.finance.append(
            g,
            "expense_proposal",
            target,
            "paid",
            { state: "approved", version: expected },
            {
              state: "paid",
              version: saved.version,
              payment: { id: p._id.toHexString(), code: p.code, businessDate: p.businessDate },
            },
            null,
            operationId,
            requestId,
            tx,
          );
          return {
            safeResult: {
              paymentId: p._id.toHexString(),
              proposalId: id,
              version: p.version,
              reconciled: false,
            },
            resourceRefs: [{ type: "finance_payment", id: p._id.toHexString() }],
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
  private async voidSources(g: FinanceGrant, id: string, expected: number, tx: ClientSession) {
    const p = await this.payments.findOne(
      { _id: objectId(id), churchId: g.churchId },
      { session: tx },
    );
    requireCondition(p, 404, "NOT_FOUND");
    requireCondition(p.state !== "voided", 409, "PAYMENT_ALREADY_VOIDED");
    requireCondition(p.version === expected, 412, "VERSION_CONFLICT");
    const period = await this.book.period(g, p.period, tx),
      control = await this.book.control(g, tx),
      fund = await this.db.db
        .collection<Fund>("finance_funds")
        .findOne({ _id: p.fundId, churchId: g.churchId }, { session: tx });
    requireCondition(fund, 409, "FINANCE_SOURCE_UNAVAILABLE");
    const proposal = await this.proposals.findOne(
        { _id: p.proposalId, churchId: g.churchId, state: "paid", version: 3, "payment.id": p._id },
        { session: tx },
      ),
      original = await this.db.db
        .collection<LedgerEntry>("finance_ledger")
        .findOne({ churchId: g.churchId, paymentId: p._id, kind: "payment" }, { session: tx }),
      reversal = await this.db.db
        .collection<LedgerEntry>("finance_ledger")
        .findOne({ churchId: g.churchId, paymentId: p._id, kind: "payment_void" }, { session: tx });
    requireCondition(
      proposal &&
        original &&
        !reversal &&
        proposal.contentHash === p.contentHash &&
        proposal.fundId.equals(p.fundId) &&
        decimalString(proposal.amount) === decimalString(p.amount) &&
        proposal.purpose === p.purpose &&
        proposal.code === p.proposalCode &&
        original.fundId.equals(p.fundId) &&
        original.proposalId?.equals(p.proposalId) &&
        original.proposalCode === p.proposalCode &&
        original.paymentCode === p.code &&
        original.businessDate === p.businessDate &&
        original.period === p.period &&
        BigInt(decimalString(original.amount)) === -BigInt(decimalString(p.amount)),
      409,
      "PAYMENT_PROPOSAL_CONFLICT",
    );
    const balance = await this.book.balance(g.churchId, p.fundId, tx),
      fingerprint = digest(
        canonical([
          p.version,
          p.contentHash,
          p.period,
          period?.version ?? 1,
          control?.version ?? 0,
          fund.version,
          fund.financeWriteFence ?? 0,
          balance,
        ]),
      );
    return { p, balance, fingerprint };
  }
  async previewVoid(g: FinanceGrant, id: string, raw: unknown, match: string | null) {
    this.write(g);
    const b = parse(voidDraft, raw),
      expected = version(match);
    return this.db.readSnapshot(g.churchId.toHexString(), async (tx) => {
      await g.fence(tx);
      const s = await this.voidSources(g, id, expected, tx);
      return {
        payment: this.dto(s.p),
        reason: b.reason,
        balance: s.balance.amount,
        balanceAfter: (BigInt(s.balance.amount) + BigInt(decimalString(s.p.amount))).toString(),
        previewToken: this.token(g, `void/${id}`, b, s.fingerprint),
      };
    });
  }
  async void(
    g: FinanceGrant,
    id: string,
    raw: unknown,
    key: string | null,
    match: string | null,
    requestId: string,
  ) {
    this.write(g);
    const b = parse(voidConfirm, raw),
      expected = version(match),
      target = objectId(id),
      hash = digest(canonical({ id, expected, reason: b.void.reason }));
    return this.ops.executeTenant(
      g,
      "POST",
      `finance-payments/${g.churchId}/${id}/void`,
      key,
      b,
      expected,
      async (tx, operationId) => {
        const existing = await this.payments.findOne(
          { _id: target, churchId: g.churchId },
          { session: tx },
        );
        requireCondition(existing, 404, "NOT_FOUND");
        if (existing.state === "voided") {
          requireCondition(
            existing.voidedBy?.equals(g.actorId) && existing.voidHash === hash,
            409,
            "PAYMENT_ALREADY_VOIDED",
          );
          return {
            safeResult: {
              paymentId: id,
              proposalId: existing.proposalId.toHexString(),
              version: existing.version,
              reconciled: true,
            },
            resourceRefs: [{ type: "finance_payment", id }],
          };
        }
        const s = await this.voidSources(g, id, expected, tx);
        this.verify(g, `void/${id}`, b.void, s.fingerprint, b.previewToken);
        await this.book.controlFence(g, tx, existing.period);
        await this.book.fundFence(g, s.p.fundId, tx);
        await this.book.period(g, s.p.period, tx, true);
        const now = this.now(),
          saved = await this.payments.findOneAndUpdate(
            { _id: target, churchId: g.churchId, version: expected, state: { $ne: "voided" } },
            {
              $set: {
                state: "voided",
                voidReason: b.void.reason,
                voidedAt: now,
                voidedBy: g.actorId,
                voidedName: g.actorName,
                voidHash: hash,
              },
              $inc: { version: 1 },
            },
            { session: tx, returnDocument: "after" },
          );
        requireCondition(saved, 412, "VERSION_CONFLICT");
        await this.db.db.collection<LedgerEntry>("finance_ledger").insertOne(
          {
            _id: new ObjectId(),
            churchId: g.churchId,
            paymentId: target,
            paymentCode: s.p.code,
            proposalId: s.p.proposalId,
            proposalCode: s.p.proposalCode,
            fundId: s.p.fundId,
            fundName: s.p.fundName,
            businessDate: s.p.businessDate,
            period: s.p.period,
            kind: "payment_void",
            amount: s.p.amount,
            occurredAt: now,
          },
          { session: tx },
        );
        const proposal = await this.proposals.findOneAndUpdate(
          {
            _id: s.p.proposalId,
            churchId: g.churchId,
            state: "paid",
            version: 3,
            "payment.id": target,
          },
          { $set: { state: "payment_voided", "payment.voidedAt": now }, $inc: { version: 1 } },
          { session: tx, returnDocument: "after" },
        );
        requireCondition(proposal, 409, "PAYMENT_PROPOSAL_CONFLICT");
        await this.finance.append(
          g,
          "payment",
          target,
          "voided",
          this.dto(s.p),
          this.dto(saved),
          b.void.reason,
          operationId,
          requestId,
          tx,
        );
        await this.finance.append(
          g,
          "expense_proposal",
          s.p.proposalId,
          "payment_voided",
          { state: "paid", version: 3 },
          {
            state: "payment_voided",
            version: 4,
            payment: {
              id,
              code: s.p.code,
              businessDate: s.p.businessDate,
              voidedAt: now.toISOString(),
            },
          },
          null,
          operationId,
          requestId,
          tx,
        );
        return {
          safeResult: {
            paymentId: id,
            proposalId: s.p.proposalId.toHexString(),
            version: saved.version,
            reconciled: false,
          },
          resourceRefs: [{ type: "finance_payment", id }],
        };
      },
      200,
      (tx, op) => this.authorize(g, op, tx),
    );
  }
  async get(g: FinanceGrant, id: string) {
    this.read(g);
    return this.db.readSnapshot(g.churchId.toHexString(), async (tx) => {
      await g.fence(tx);
      const p = await this.payments.findOne(
        { _id: objectId(id), churchId: g.churchId },
        { session: tx },
      );
      requireCondition(p, 404, "NOT_FOUND");
      const status = await this.book.status(g, p.period, tx);
      return {
        ...this.dto(p),
        canVoid: g.financeRole === "treasurer" && p.state !== "voided" && !status.closed,
      };
    });
  }
  async history(g: FinanceGrant, id: string, q: URLSearchParams) {
    this.read(g);
    const query = new TenantQueries(this.key, this.now, "payment-history");
    query.allow(q, ["limit", "cursor"]);
    const limit = query.limit(q),
      context = query.context(g, `history/${id}`, null),
      after = q.has("cursor") ? query.decode(q.get("cursor") as string, context) : null;
    return this.db.readSnapshot(g.churchId.toHexString(), async (tx) => {
      await g.fence(tx);
      requireCondition(
        await this.payments.findOne({ _id: objectId(id), churchId: g.churchId }, { session: tx }),
        404,
        "NOT_FOUND",
      );
      const rows = await this.db.db
          .collection<FinanceHistory>("finance_history")
          .find(
            {
              churchId: g.churchId,
              targetType: "payment",
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
          event: h.event,
          actorName: h.actorName,
          occurredAt: h.occurredAt.toISOString(),
          before: h.before,
          after: h.after,
        })),
        nextCursor: more && last ? query.encode(context, "", last._id.toHexString()) : null,
      };
    });
  }
}
