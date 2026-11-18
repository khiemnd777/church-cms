import { type ClientSession, type Filter, MongoServerError, ObjectId } from "mongodb";
import { AppError, requireCondition } from "../errors";
import { objectId, parse, version } from "../http-validation";
import { digest, equal, sign } from "../identity/crypto";
import type { Database } from "../infrastructure/database";
import { businessDay } from "../members/dates";
import type { FinanceMembers } from "../members/finance";
import { escaped } from "../members/queries";
import { canonical, type Operation, type Operations } from "../operations/service";
import { resourceCode } from "../resource-code";
import { TenantQueries } from "../tenant-queries";
import { FinanceBook } from "./book";
import type { FinanceGrant, FinanceHistory, Fund } from "./models";
import { decimalString, MAX_AMOUNT, moneyDecimal, moneyValue } from "./money";
import { bookTotals } from "./reporting";
import type { Finance } from "./service";
import type { GivingCode, LedgerEntry, Receipt, ReceiptLine } from "./transactions-model";
import {
  givingInput,
  givingStatusInput,
  postInput,
  type ReceiptInput,
  receiptInput,
  voidInput,
} from "./transactions-validation";

export class FinanceTransactions {
  private book: FinanceBook;
  constructor(
    private db: Database,
    private ops: Operations,
    private finance: Finance,
    private members: FinanceMembers,
    private key: string,
    private now: () => Date = () => new Date(),
  ) {
    this.book = new FinanceBook(db);
  }
  private get codes() {
    return this.db.db.collection<GivingCode>("finance_giving_codes");
  }
  private get receipts() {
    return this.db.db.collection<Receipt>("finance_receipts");
  }
  private get ledger() {
    return this.db.db.collection<LedgerEntry>("finance_ledger");
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
  private codeDto(c: GivingCode) {
    return {
      id: c._id.toHexString(),
      memberId: c.memberId.toHexString(),
      code: c.code,
      memberCode: c.memberCode,
      memberName: c.memberName,
      status: c.status,
      version: c.version,
    };
  }
  private receiptDto(r: Receipt) {
    return {
      id: r._id.toHexString(),
      code: r.code,
      version: r.version,
      submissionId: r.submissionId,
      businessDate: r.businessDate,
      period: r.period,
      fundId: r.fundId.toHexString(),
      fundName: r.fundName,
      sourceReference: r.sourceReference,
      purpose: r.purpose,
      mode: r.mode,
      total: decimalString(r.total),
      state: r.state,
      lines: r.lines.map((l) => ({
        ...l,
        givingId: l.givingId.toHexString(),
        memberId: l.memberId.toHexString(),
        amount: decimalString(l.amount),
      })),
      replacesReceiptId: r.replacesReceiptId?.toHexString() ?? null,
      voidReason: r.voidReason,
      voidedAt: r.voidedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    };
  }
  private async authorize(g: FinanceGrant, op: Operation, tx: ClientSession) {
    const ref = op.resourceRefs[0];
    requireCondition(ref && op.resourceRefs.length === 1, 403, "FORBIDDEN");
    if (ref.type === "finance_receipt" || ref.type === "finance_giving_code") {
      this.write(g);
      const row =
        ref.type === "finance_receipt"
          ? await this.receipts.findOne(
              { _id: objectId(ref.id), churchId: g.churchId },
              { session: tx },
            )
          : await this.codes.findOne(
              { _id: objectId(ref.id), churchId: g.churchId },
              { session: tx },
            );
      requireCondition(row, 404, "NOT_FOUND");
    } else await this.finance.receiptAccess(g, op, tx);
  }
  async operation(g: FinanceGrant, id: string) {
    this.read(g);
    return this.ops.getTenant(g, id, "finance", (tx, op) => this.authorize(g, op, tx));
  }
  async memberOptions(g: FinanceGrant, q: URLSearchParams) {
    this.read(g);
    const query = new TenantQueries(this.key, this.now, "finance-members");
    query.allow(q, ["q", "limit", "cursor"]);
    const text = (q.get("q") ?? "").normalize("NFC").trim();
    requireCondition(text.length <= 100, 400, "INVALID_REQUEST");
    const limit = query.limit(q),
      context = query.context(g, "member-options", text),
      after = q.has("cursor") ? query.decode(q.get("cursor") as string, context) : null;
    return this.db.readSnapshot(g.churchId.toHexString(), async (tx) => {
      await g.fence(tx);
      const rows = await this.members.page(g.churchId, text, after, limit + 1, tx),
        more = rows.length > limit;
      rows.splice(limit);
      const last = rows.at(-1);
      return {
        items: rows.map(({ key, ...r }) => r),
        nextCursor: more && last ? query.encode(context, last.key, last.id) : null,
      };
    });
  }
  async codeList(g: FinanceGrant, q: URLSearchParams) {
    this.read(g);
    const query = new TenantQueries(this.key, this.now, "finance-giving");
    query.allow(q, ["q", "status", "memberId", "limit", "cursor"]);
    const text = (q.get("q") ?? "").trim().toUpperCase(),
      status = q.get("status") ?? "active";
    requireCondition(
      text.length <= 100 && ["active", "inactive", "all"].includes(status),
      400,
      "INVALID_REQUEST",
    );
    const member = q.has("memberId") ? objectId(q.get("memberId") as string) : null,
      limit = query.limit(q),
      context = query.context(g, "giving", [text, status, member?.toHexString()]),
      after = q.has("cursor") ? query.decode(q.get("cursor") as string, context) : null;
    return this.db.readSnapshot(g.churchId.toHexString(), async (tx) => {
      await g.fence(tx);
      const filter: Filter<GivingCode> = {
        churchId: g.churchId,
        ...(status !== "all" ? { status: status as GivingCode["status"] } : {}),
        ...(text ? { code: { $regex: `^${escaped(text)}` } } : {}),
        ...(member ? { memberId: member } : {}),
        ...(after
          ? {
              $or: [
                { code: { $gt: after.key } },
                { code: after.key, _id: { $gt: objectId(after.id) } },
              ],
            }
          : {}),
      };
      const rows = await this.codes
          .find(filter, { session: tx, maxTimeMS: 3000 })
          .sort({ code: 1, _id: 1 })
          .limit(limit + 1)
          .toArray(),
        more = rows.length > limit;
      rows.splice(limit);
      const last = rows.at(-1),
        people = await this.members.identities(
          g.churchId,
          rows.map((c) => c.memberId),
          tx,
        );
      return {
        items: rows.map((c) => {
          const p = people.find((p) => p.id === c.memberId.toHexString());
          return {
            ...this.codeDto(c),
            memberName: p?.name ?? c.memberName,
            memberCode: p?.code ?? c.memberCode,
          };
        }),
        nextCursor: more && last ? query.encode(context, last.code, last._id.toHexString()) : null,
      };
    });
  }
  async codeWrite(
    g: FinanceGrant,
    id: string | null,
    raw: unknown,
    key: string | null,
    match: string | null,
    requestId: string,
  ) {
    this.write(g);
    const body = id ? parse(givingStatusInput, raw) : parse(givingInput, raw),
      target = id ? objectId(id) : new ObjectId(),
      expected = id ? version(match) : null;
    try {
      return await this.ops.executeTenant(
        g,
        id ? "PATCH" : "POST",
        `finance/${g.churchId}/giving-codes${id ? `/${target}/status` : ""}`,
        key,
        body,
        expected,
        async (tx, operationId) => {
          let old: GivingCode | null = null,
            saved: GivingCode;
          if ("memberId" in body) {
            const person = (
              await this.members.identities(g.churchId, [objectId(body.memberId)], tx)
            )[0];
            requireCondition(person?.current, 422, "FINANCE_MEMBER_UNAVAILABLE");
            await this.members.fence(g.churchId, objectId(person.id), person.version, tx);
            saved = {
              _id: target,
              churchId: g.churchId,
              memberId: objectId(person.id),
              memberCode: person.code,
              memberName: person.name,
              code: resourceCode("DH"),
              status: "active",
              version: 1,
              writeFence: 0,
              createdAt: this.now(),
              updatedAt: this.now(),
            };
            await this.codes.insertOne(saved, { session: tx });
          } else {
            old = await this.codes.findOne({ _id: target, churchId: g.churchId }, { session: tx });
            requireCondition(old, 404, "NOT_FOUND");
            requireCondition(old.status !== body.status, 409, "FINANCE_STATUS_UNCHANGED");
            const row = await this.codes.findOneAndUpdate(
              { _id: target, churchId: g.churchId, version: expected as number },
              {
                $set: { status: body.status, updatedAt: this.now() },
                $inc: { version: 1, writeFence: 1 },
              },
              { session: tx, returnDocument: "after" },
            );
            requireCondition(row, 412, "VERSION_CONFLICT");
            saved = row;
          }
          await this.finance.append(
            g,
            "giving_code",
            target,
            id ? "status_changed" : "created",
            old ? this.codeDto(old) : null,
            this.codeDto(saved),
            "reason" in body ? body.reason : null,
            operationId,
            requestId,
            tx,
          );
          return {
            safeResult: { givingId: target.toHexString(), version: saved.version },
            resourceRefs: [{ type: "finance_giving_code", id: target.toHexString() }],
          };
        },
        id ? 200 : 201,
        (tx, op) => this.authorize(g, op, tx),
      );
    } catch (e) {
      if (e instanceof MongoServerError && e.code === 11000)
        throw new AppError(409, "FINANCE_GIVING_EXISTS");
      throw e;
    }
  }
  private async sources(g: FinanceGrant, b: ReceiptInput, tx: ClientSession) {
    requireCondition(b.businessDate <= businessDay(this.now()), 422, "FINANCE_FUTURE_DAY");
    const fund = await this.db.db
      .collection<Fund>("finance_funds")
      .findOne(
        { _id: objectId(b.fundId), churchId: g.churchId, status: "active" },
        { session: tx },
      );
    requireCondition(fund, 409, "FINANCE_SOURCE_UNAVAILABLE");
    const month = b.businessDate.slice(0, 7),
      period = await this.book.period(g, month, tx);
    const ids =
        b.mode === "itemized" ? [...new Set(b.lines.map((l) => l.givingId))].map(objectId) : [],
      codes = await this.codes
        .find({ churchId: g.churchId, _id: { $in: ids }, status: "active" }, { session: tx })
        .toArray();
    requireCondition(codes.length === ids.length, 409, "FINANCE_SOURCE_UNAVAILABLE");
    const people = await this.members.identities(
      g.churchId,
      codes.map((c) => c.memberId),
      tx,
    );
    requireCondition(
      codes.every((c) => people.some((p) => p.id === c.memberId.toHexString())),
      409,
      "FINANCE_SOURCE_UNAVAILABLE",
    );
    let lines: ReceiptLine[] = [];
    if (b.mode === "itemized")
      lines = b.lines.map((l) => {
        const code = codes.find((c) => c._id.toHexString() === l.givingId);
        requireCondition(code, 409, "FINANCE_SOURCE_UNAVAILABLE");
        const person = people.find((p) => p.id === code.memberId.toHexString());
        requireCondition(person, 409, "FINANCE_SOURCE_UNAVAILABLE");
        return {
          givingId: code._id,
          givingCode: code.code,
          memberId: code.memberId,
          memberCode: person.code,
          memberName: person.name,
          amount: moneyDecimal(moneyValue(l.amount)),
        };
      });
    const total =
      b.mode === "aggregate"
        ? moneyValue(b.amount)
        : b.lines.reduce((sum, l) => sum + moneyValue(l.amount), 0n);
    requireCondition(total > 0n && total <= MAX_AMOUNT, 422, "FINANCE_AMOUNT_INVALID");
    const fingerprint = digest(
      canonical({
        fund: [fund._id.toHexString(), fund.version],
        codes: codes.map((c) => [c._id.toHexString(), c.version]).sort(),
        people: people.map((p) => [p.id, p.version]).sort(),
        period: [month, period?.version ?? 1, "open"],
      }),
    );
    return { fund, period, month, codes, people, lines, total, fingerprint };
  }
  async preview(g: FinanceGrant, raw: unknown) {
    this.write(g);
    const b = parse(receiptInput, raw);
    return this.db.readSnapshot(g.churchId.toHexString(), async (tx) => {
      await g.fence(tx);
      const s = await this.sources(g, b, tx),
        payload = Buffer.from(
          JSON.stringify({
            actor: g.actorId.toHexString(),
            church: g.churchId.toHexString(),
            context: g.policyContext,
            body: digest(canonical(b)),
            sources: s.fingerprint,
            expires: this.now().getTime() + 300000,
          }),
        ).toString("base64url");
      return {
        previewToken: `${payload}.${sign(this.key, `finance-preview:${payload}`)}`,
        fundName: s.fund.name,
        total: s.total.toString(),
        businessDate: b.businessDate,
        mode: b.mode,
        lines: s.lines.map((l) => ({
          givingCode: l.givingCode,
          memberName: l.memberName,
          amount: decimalString(l.amount),
        })),
      };
    });
  }
  private verify(g: FinanceGrant, b: ReceiptInput, token: string, fingerprint: string) {
    const [payload, signature, ...extra] = token.split(".");
    requireCondition(
      payload &&
        signature &&
        !extra.length &&
        equal(signature, sign(this.key, `finance-preview:${payload}`)),
      409,
      "FINANCE_PREVIEW_STALE",
    );
    let data: unknown;
    try {
      data = JSON.parse(Buffer.from(payload, "base64url").toString());
    } catch {
      throw new AppError(409, "FINANCE_PREVIEW_STALE");
    }
    const d = data as Record<string, unknown>;
    requireCondition(
      d &&
        d.actor === g.actorId.toHexString() &&
        d.church === g.churchId.toHexString() &&
        d.context === g.policyContext &&
        d.body === digest(canonical(b)) &&
        d.sources === fingerprint &&
        typeof d.expires === "number" &&
        d.expires > this.now().getTime(),
      409,
      "FINANCE_PREVIEW_STALE",
    );
  }
  private async periodFence(g: FinanceGrant, month: string, tx: ClientSession) {
    await this.book.period(g, month, tx, true);
  }
  async post(g: FinanceGrant, raw: unknown, key: string | null, requestId: string) {
    this.write(g);
    const command = parse(postInput, raw),
      b = command.receipt,
      payloadHash = digest(canonical(b));
    try {
      const result = await this.ops.executeTenant(
        g,
        "POST",
        `finance/${g.churchId}/receipts`,
        key,
        command,
        null,
        async (tx, operationId) => {
          const existing = await this.receipts.findOne(
            { churchId: g.churchId, submissionId: b.submissionId },
            { session: tx },
          );
          if (existing) {
            requireCondition(
              existing.actorId.equals(g.actorId) && existing.payloadHash === payloadHash,
              409,
              "FINANCE_SUBMISSION_CONFLICT",
            );
            return {
              safeResult: {
                receiptId: existing._id.toHexString(),
                version: existing.version,
                reconciled: true,
              },
              resourceRefs: [{ type: "finance_receipt", id: existing._id.toHexString() }],
            };
          }
          await this.book.controlFence(g, tx, b.businessDate.slice(0, 7));
          const s = await this.sources(g, b, tx);
          this.verify(g, b, command.previewToken, s.fingerprint);
          if (b.replacesReceiptId) {
            const old = await this.receipts.findOne(
              { _id: objectId(b.replacesReceiptId), churchId: g.churchId, state: "voided" },
              { session: tx },
            );
            requireCondition(old, 409, "FINANCE_REPLACEMENT_INVALID");
          }
          const f = await this.db.db
            .collection<Fund>("finance_funds")
            .updateOne(
              { _id: s.fund._id, churchId: g.churchId, status: "active", version: s.fund.version },
              { $inc: { financeWriteFence: 1 } },
              { session: tx },
            );
          requireCondition(f.matchedCount, 412, "FINANCE_SOURCE_STALE");
          await this.periodFence(g, s.month, tx);
          for (const code of s.codes) {
            const r = await this.codes.updateOne(
              { _id: code._id, churchId: g.churchId, status: "active", version: code.version },
              { $inc: { writeFence: 1 } },
              { session: tx },
            );
            requireCondition(r.matchedCount, 412, "FINANCE_SOURCE_STALE");
          }
          for (const p of s.people)
            await this.members.fence(g.churchId, objectId(p.id), p.version, tx);
          const r: Receipt = {
            _id: new ObjectId(),
            churchId: g.churchId,
            code: resourceCode("PT"),
            submissionId: b.submissionId,
            actorId: g.actorId,
            payloadHash,
            businessDate: b.businessDate,
            period: s.month,
            fundId: s.fund._id,
            fundName: s.fund.name,
            sourceReference: b.sourceReference,
            purpose: b.purpose,
            mode: b.mode,
            total: moneyDecimal(s.total),
            lines: s.lines,
            state: "posted",
            version: 1,
            replacesReceiptId: b.replacesReceiptId ? objectId(b.replacesReceiptId) : null,
            voidReason: null,
            voidedAt: null,
            createdAt: this.now(),
          };
          await this.receipts.insertOne(r, { session: tx });
          await this.ledger.insertOne(
            {
              _id: new ObjectId(),
              churchId: g.churchId,
              receiptId: r._id,
              receiptCode: r.code,
              fundId: r.fundId,
              fundName: r.fundName,
              businessDate: r.businessDate,
              period: r.period,
              kind: "receipt",
              amount: r.total,
              occurredAt: this.now(),
            },
            { session: tx },
          );
          await this.finance.append(
            g,
            "receipt",
            r._id,
            "posted",
            null,
            this.receiptDto(r),
            null,
            operationId,
            requestId,
            tx,
          );
          return {
            safeResult: { receiptId: r._id.toHexString(), version: r.version },
            resourceRefs: [{ type: "finance_receipt", id: r._id.toHexString() }],
          };
        },
        201,
        (tx, op) => this.authorize(g, op, tx),
      );
      return { ...result, status: result.data.reconciled ? 200 : result.status };
    } catch (e) {
      if (e instanceof MongoServerError && e.code === 11000)
        throw new AppError(
          409,
          e.keyPattern?.sourceReference
            ? "FINANCE_SOURCE_EXISTS"
            : e.keyPattern?.replacesReceiptId
              ? "FINANCE_REPLACEMENT_EXISTS"
              : "OPERATION_IN_PROGRESS",
        );
      throw e;
    }
  }
  async get(g: FinanceGrant, id: string) {
    this.read(g);
    const target = objectId(id);
    return this.db.readSnapshot(g.churchId.toHexString(), async (tx) => {
      await g.fence(tx);
      const r = await this.receipts.findOne({ _id: target, churchId: g.churchId }, { session: tx });
      requireCondition(r, 404, "NOT_FOUND");
      const periodState = await this.book.status(g, r.period, tx);
      return {
        ...this.receiptDto(r),
        canVoid: g.financeRole === "treasurer" && r.state === "posted" && !periodState.closed,
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
    const b = parse(voidInput, raw),
      target = objectId(id),
      expected = version(match);
    return this.ops.executeTenant(
      g,
      "POST",
      `finance/${g.churchId}/receipts/${target}/void`,
      key,
      b,
      expected,
      async (tx, operationId) => {
        const old = await this.receipts.findOne(
          { _id: target, churchId: g.churchId },
          { session: tx },
        );
        requireCondition(old, 404, "NOT_FOUND");
        requireCondition(old.version === expected, 412, "VERSION_CONFLICT");
        requireCondition(old.state === "posted", 409, "FINANCE_ALREADY_VOIDED");
        await this.book.controlFence(g, tx, old.period);
        await this.book.fundFence(g, old.fundId, tx);
        const balance = await this.book.balance(g.churchId, old.fundId, tx);
        requireCondition(
          BigInt(balance.amount) >= BigInt(decimalString(old.total)),
          409,
          "FINANCE_INSUFFICIENT_BALANCE",
        );
        await this.periodFence(g, old.period, tx);
        const saved = await this.receipts.findOneAndUpdate(
          { _id: target, churchId: g.churchId, state: "posted", version: expected },
          {
            $set: { state: "voided", voidReason: b.reason, voidedAt: this.now() },
            $inc: { version: 1 },
          },
          { session: tx, returnDocument: "after" },
        );
        requireCondition(saved, 412, "VERSION_CONFLICT");
        await this.ledger.insertOne(
          {
            _id: new ObjectId(),
            churchId: g.churchId,
            receiptId: target,
            receiptCode: old.code,
            fundId: old.fundId,
            fundName: old.fundName,
            businessDate: old.businessDate,
            period: old.period,
            kind: "void",
            amount: moneyDecimal(-BigInt(decimalString(old.total))),
            occurredAt: this.now(),
          },
          { session: tx },
        );
        await this.finance.append(
          g,
          "receipt",
          target,
          "voided",
          this.receiptDto(old),
          this.receiptDto(saved),
          b.reason,
          operationId,
          requestId,
          tx,
        );
        return {
          safeResult: { receiptId: target.toHexString(), version: saved.version },
          resourceRefs: [{ type: "finance_receipt", id: target.toHexString() }],
        };
      },
      200,
      (tx, op) => this.authorize(g, op, tx),
    );
  }
  private filters(q: URLSearchParams, ledger = false) {
    const query = new TenantQueries(this.key, this.now, "finance-transactions");
    query.allow(
      q,
      ledger
        ? ["period", "fundId", "kind", "q", "limit", "cursor"]
        : ["period", "fundId", "state", "q", "givingId", "limit", "cursor"],
    );
    const period = q.get("period") ?? businessDay(this.now()).slice(0, 7);
    requireCondition(/^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(period), 400, "INVALID_REQUEST");
    const state = q.get("state") ?? "all",
      text = (q.get("q") ?? "").trim().toUpperCase();
    requireCondition(
      ["all", "posted", "voided"].includes(state) && text.length <= 100,
      400,
      "INVALID_REQUEST",
    );
    return {
      query,
      period,
      state,
      text,
      fund: q.has("fundId") ? objectId(q.get("fundId") as string) : null,
      giving: q.has("givingId") ? objectId(q.get("givingId") as string) : null,
    };
  }
  async list(g: FinanceGrant, q: URLSearchParams, ledger = false) {
    this.read(g);
    const kind = q.get("kind") ?? "all";
    requireCondition(
      ["all", "receipt", "void", "payment", "payment_void"].includes(kind),
      400,
      "INVALID_REQUEST",
    );
    const f = this.filters(q, ledger),
      limit = f.query.limit(q),
      context = f.query.context(g, ledger ? "ledger" : "receipts", [
        f.period,
        f.state,
        f.text,
        f.fund?.toHexString(),
        f.giving?.toHexString(),
        kind,
      ]),
      after = q.has("cursor") ? f.query.decode(q.get("cursor") as string, context) : null;
    return this.db.readSnapshot(g.churchId.toHexString(), async (tx) => {
      await g.fence(tx);
      const from = `${f.period}-01`,
        nextDate = new Date(`${from}T00:00:00Z`);
      nextDate.setUTCMonth(nextDate.getUTCMonth() + 1);
      const until = nextDate.toISOString().slice(0, 10);
      const scope = {
        churchId: g.churchId,
        businessDate: { $gte: from, $lt: until },
        ...(f.fund ? { fundId: f.fund } : {}),
      };
      const filter: Filter<Receipt> = {
        ...scope,
        ...(f.state !== "all" ? { state: f.state as Receipt["state"] } : {}),
        ...(f.giving ? { "lines.givingId": f.giving } : {}),
        ...(f.text
          ? {
              $or: [
                { code: { $regex: `^${escaped(f.text)}` } },
                { sourceReference: { $regex: `^${escaped(f.text)}` } },
              ],
            }
          : {}),
      };
      const bookFilter: Filter<LedgerEntry> = {
        ...scope,
        ...(kind !== "all" ? { kind: kind as LedgerEntry["kind"] } : {}),
        ...(f.text
          ? {
              $or: ["receiptCode", "paymentCode", "proposalCode"].map((k) => ({
                [k]: { $regex: `^${escaped(f.text)}` },
              })),
            }
          : {}),
      };
      const pageScope = after
        ? {
            $and: [
              ledger ? bookFilter : filter,
              {
                $or: [
                  { businessDate: { $lt: after.key } },
                  { businessDate: after.key, _id: { $lt: objectId(after.id) } },
                ],
              },
            ],
          }
        : ledger
          ? bookFilter
          : filter;
      const totals = await bookTotals(this.db, g.churchId, f.period, tx, f.fund);
      if (ledger) {
        const rows = await this.ledger
            .find(pageScope as Filter<LedgerEntry>, { session: tx, maxTimeMS: 3000 })
            .sort({ businessDate: -1, _id: -1 })
            .limit(limit + 1)
            .toArray(),
          more = rows.length > limit;
        rows.splice(limit);
        const last = rows.at(-1);
        return {
          items: rows.map((l) => {
            const code = l.receiptCode ?? l.paymentCode;
            requireCondition(code, 503, "DEPENDENCY_UNAVAILABLE");
            return {
              id: l._id.toHexString(),
              receiptId: l.receiptId?.toHexString() ?? null,
              paymentId: l.paymentId?.toHexString() ?? null,
              proposalId: l.proposalId?.toHexString() ?? null,
              proposalCode: l.proposalCode ?? null,
              code,
              businessDate: l.businessDate,
              fundName: l.fundName,
              kind: l.kind,
              amount: decimalString(l.amount),
            };
          }),
          nextCursor:
            more && last
              ? f.query.encode(context, last.businessDate, last._id.toHexString())
              : null,
          ...totals,
        };
      }
      const rows = await this.receipts
          .find(pageScope as Filter<Receipt>, { session: tx, maxTimeMS: 3000 })
          .sort({ businessDate: -1, _id: -1 })
          .limit(limit + 1)
          .toArray(),
        more = rows.length > limit;
      rows.splice(limit);
      const last = rows.at(-1);
      return {
        items: rows.map((r) => ({
          id: r._id.toHexString(),
          code: r.code,
          businessDate: r.businessDate,
          fundName: r.fundName,
          sourceReference: r.sourceReference,
          purpose: r.purpose,
          total: decimalString(r.total),
          state: r.state,
          ...(f.giving
            ? {
                contribution: r.lines
                  .filter((l) => l.givingId.equals(f.giving as ObjectId))
                  .reduce((s, l) => s + BigInt(decimalString(l.amount)), 0n)
                  .toString(),
              }
            : {}),
        })),
        nextCursor:
          more && last ? f.query.encode(context, last.businessDate, last._id.toHexString()) : null,
        ...totals,
      };
    });
  }
  async history(g: FinanceGrant, kind: "receipt" | "giving_code", id: string, q: URLSearchParams) {
    this.read(g);
    const target = objectId(id),
      query = new TenantQueries(this.key, this.now, "finance-transaction-history");
    query.allow(q, ["limit", "cursor"]);
    const limit = query.limit(q),
      context = query.context(g, `history/${kind}/${id}`, null),
      after = q.has("cursor") ? query.decode(q.get("cursor") as string, context) : null;
    return this.db.readSnapshot(g.churchId.toHexString(), async (tx) => {
      await g.fence(tx);
      const row =
        kind === "receipt"
          ? await this.receipts.findOne({ _id: target, churchId: g.churchId }, { session: tx })
          : await this.codes.findOne({ _id: target, churchId: g.churchId }, { session: tx });
      requireCondition(row, 404, "NOT_FOUND");
      const rows = await this.db.db
          .collection<FinanceHistory>("finance_history")
          .find(
            {
              churchId: g.churchId,
              targetType: kind,
              targetId: target,
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
          reason: h.reason,
          before: h.before,
          after: h.after,
        })),
        nextCursor: more && last ? query.encode(context, "", last._id.toHexString()) : null,
      };
    });
  }
}
