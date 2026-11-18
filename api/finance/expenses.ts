import { type ClientSession, type Filter, MongoServerError, ObjectId } from "mongodb";
import type { policyMatrix } from "../authorization/church-policy";
import { AppError, requireCondition } from "../errors";
import { objectId, parse, version } from "../http-validation";
import { digest, equal, sign } from "../identity/crypto";
import type { Database } from "../infrastructure/database";
import { businessDay } from "../members/dates";
import { escaped } from "../members/queries";
import { canonical, type Operation, type Operations } from "../operations/service";
import { resourceCode } from "../resource-code";
import { TenantQueries } from "../tenant-queries";
import type { ExpenseGrant, ExpenseProposal } from "./expenses-model";
import { expenseDecide, expenseDecision, expenseDraft, expenseSubmit } from "./expenses-validation";
import type { FinanceHistory, FinanceSettings, Fund } from "./models";
import { decimalString, moneyDecimal, moneyValue } from "./money";
import type { Finance } from "./service";

export class Expenses {
  constructor(
    private db: Database,
    private ops: Operations,
    private finance: Finance,
    private key: string,
    private now: () => Date = () => new Date(),
  ) {}
  private get proposals() {
    return this.db.db.collection<ExpenseProposal>("finance_expense_proposals");
  }
  private get settings() {
    return this.db.db.collection<FinanceSettings>("finance_settings");
  }
  private base(g: ExpenseGrant) {
    requireCondition(g.actorKind === "church_user" && g.role !== "member", 403, "FORBIDDEN");
  }
  private async permissions(g: ExpenseGrant, tx: ClientSession) {
    this.base(g);
    const settings = await this.settings.findOne({ _id: g.churchId }, { session: tx }),
      canDecide = settings?.approverRole === g.role,
      canSubmit = !!settings && (canDecide || settings.proposerRoles.some((r) => r === g.role)),
      canReadAll = ["pastor", "treasurer"].includes(g.role) || canDecide;
    return {
      settings,
      configured: !!settings,
      canDecide,
      canSubmit,
      canReadAll,
      canReadOwn: canSubmit,
    };
  }
  private requireRead(
    p: { canReadAll: boolean; canReadOwn: boolean },
    g: ExpenseGrant,
    row?: ExpenseProposal,
  ) {
    requireCondition(p.canReadAll || p.canReadOwn, 403, "FORBIDDEN");
    if (row)
      requireCondition(
        p.canReadAll || (p.canReadOwn && row.createdBy.equals(g.actorId)),
        404,
        "NOT_FOUND",
      );
  }
  private requireDecide(p: { canDecide: boolean }, g: ExpenseGrant, row: ExpenseProposal) {
    requireCondition(p.canDecide, 403, "FORBIDDEN");
    requireCondition(!row.createdBy.equals(g.actorId), 403, "EXPENSE_SELF_DECISION");
  }
  async context(g: ExpenseGrant) {
    this.base(g);
    return this.db.readSnapshot(g.churchId.toHexString(), async (tx) => {
      await g.fence(tx);
      const p = await this.permissions(g, tx);
      return {
        configured: p.configured,
        canReadAll: p.canReadAll,
        canReadOwn: p.canReadOwn,
        canSubmit: p.canSubmit,
        canDecide: p.canDecide,
        canPay: g.role === "treasurer",
        approverRole: p.canReadAll || p.canReadOwn ? (p.settings?.approverRole ?? null) : null,
        capabilities: [
          ...(p.canReadAll || p.canReadOwn ? ["expense:read"] : []),
          ...(p.canSubmit ? ["expense:submit"] : []),
          ...(p.canDecide ? ["expense:decide"] : []),
        ],
      };
    });
  }
  async matrix(g: ExpenseGrant, m: ReturnType<typeof policyMatrix>) {
    return this.db.readSnapshot(g.churchId.toHexString(), async (tx) => {
      await g.fence(tx);
      const p = await this.permissions(g, tx),
        all = ["pastor", "treasurer"].includes(g.role);
      return {
        ...m,
        rows: m.rows.map((r) => {
          if (!all && r.role !== g.role)
            return { ...r, expense: r.role === "member" ? "Không" : "Theo cấu hình Hội Thánh" };
          const submit =
              !!p.settings &&
              (r.role === p.settings.approverRole ||
                p.settings.proposerRoles.some((role) => role === r.role)),
            decide = p.settings?.approverRole === r.role,
            readAll = ["pastor", "treasurer"].includes(r.role) || decide;
          return {
            ...r,
            expense: !p.settings
              ? readAll
                ? "Xem toàn bộ; chưa cấu hình gửi/duyệt"
                : "Chưa được cấp quyền"
              : [
                  readAll ? "Xem toàn bộ" : submit ? "Xem của mình" : "Không xem",
                  submit ? "Gửi" : "Không gửi",
                  decide ? "Duyệt/từ chối người khác; cấm tự quyết định" : "Không duyệt",
                  r.role === "treasurer" ? "Lập phiếu chi" : "Không lập phiếu chi",
                ].join("; "),
          };
        }),
      };
    });
  }
  private dto(r: ExpenseProposal) {
    return {
      id: r._id.toHexString(),
      code: r.code,
      submissionId: r.submissionId,
      version: r.version,
      businessDate: r.businessDate,
      createdBy: r.createdBy.toHexString(),
      creatorName: r.creatorName,
      creatorRole: r.creatorRole,
      fundId: r.fundId.toHexString(),
      fundName: r.fundName,
      amount: decimalString(r.amount),
      purpose: r.purpose,
      state: r.state,
      approverRoleAtSubmission: r.approverRole,
      createdAt: r.createdAt.toISOString(),
      payment: r.payment
        ? {
            id: r.payment.id.toHexString(),
            code: r.payment.code,
            businessDate: r.payment.businessDate,
            voidedAt: r.payment.voidedAt?.toISOString() ?? null,
          }
        : null,
      decision: r.decision
        ? {
            actorId: r.decision.actorId.toHexString(),
            actorName: r.decision.actorName,
            actorRole: r.decision.actorRole,
            action: r.decision.action,
            reason: r.decision.reason,
            decidedAt: r.decision.decidedAt.toISOString(),
            settingsVersion: r.decision.settingsVersion,
            contentHash: r.decision.contentHash,
          }
        : null,
    };
  }
  private async row(g: ExpenseGrant, id: string, tx: ClientSession) {
    const row = await this.proposals.findOne(
      { _id: objectId(id), churchId: g.churchId },
      { session: tx },
    );
    requireCondition(row, 404, "NOT_FOUND");
    return row;
  }
  private async authorize(g: ExpenseGrant, op: Operation, tx: ClientSession) {
    const ref = op.resourceRefs[0];
    requireCondition(
      ref &&
        op.resourceRefs.length === 1 &&
        ["expense_create", "expense_decision"].includes(ref.type),
      403,
      "FORBIDDEN",
    );
    const p = await this.permissions(g, tx),
      row = await this.row(g, ref.id, tx);
    if (ref.type === "expense_create")
      requireCondition(p.canSubmit && row.createdBy.equals(g.actorId), 403, "FORBIDDEN");
    else this.requireDecide(p, g, row);
  }
  async operation(g: ExpenseGrant, id: string) {
    this.base(g);
    return this.ops.getTenant(g, id, "expense-proposals", (tx, op) => this.authorize(g, op, tx));
  }
  private token(g: ExpenseGrant, action: string, body: unknown, sources: unknown) {
    const data = Buffer.from(
      JSON.stringify({
        actor: g.actorId.toHexString(),
        church: g.churchId.toHexString(),
        context: g.policyContext,
        action,
        body: digest(canonical(body)),
        sources: digest(canonical(sources)),
        expires: this.now().getTime() + 300000,
      }),
    ).toString("base64url");
    return `${data}.${sign(this.key, `expense-preview:${data}`)}`;
  }
  private verify(g: ExpenseGrant, action: string, body: unknown, sources: unknown, token: string) {
    const [data, sig, ...extra] = token.split(".");
    requireCondition(
      data && sig && !extra.length && equal(sig, sign(this.key, `expense-preview:${data}`)),
      409,
      "EXPENSE_PREVIEW_STALE",
    );
    let value: unknown;
    try {
      value = JSON.parse(Buffer.from(data, "base64url").toString());
    } catch {
      throw new AppError(409, "EXPENSE_PREVIEW_STALE");
    }
    const d = value as Record<string, unknown>;
    requireCondition(
      d &&
        d.actor === g.actorId.toHexString() &&
        d.church === g.churchId.toHexString() &&
        d.context === g.policyContext &&
        d.action === action &&
        d.body === digest(canonical(body)) &&
        d.sources === digest(canonical(sources)) &&
        typeof d.expires === "number" &&
        d.expires > this.now().getTime(),
      409,
      "EXPENSE_PREVIEW_STALE",
    );
  }
  private async fund(g: ExpenseGrant, id: ObjectId, tx: ClientSession, active = true) {
    const f = await this.db.db
      .collection<Fund>("finance_funds")
      .findOne({ _id: id, churchId: g.churchId }, { session: tx });
    requireCondition(f && (!active || f.status === "active"), 409, "EXPENSE_FUND_UNAVAILABLE");
    return f;
  }
  private async fenceSettings(g: ExpenseGrant, s: FinanceSettings, tx: ClientSession) {
    const r = await this.settings.updateOne(
      { _id: g.churchId, version: s.version },
      { $inc: { expenseWriteFence: 1 } },
      { session: tx },
    );
    requireCondition(r.matchedCount, 409, "EXPENSE_PREVIEW_STALE");
  }
  private async fenceFund(g: ExpenseGrant, f: Fund, tx: ClientSession, active: boolean) {
    const r = await this.db.db.collection<Fund>("finance_funds").updateOne(
      {
        _id: f._id,
        churchId: g.churchId,
        version: f.version,
        ...(active ? { status: "active" as const } : {}),
      },
      { $inc: { financeWriteFence: 1 } },
      { session: tx },
    );
    requireCondition(r.matchedCount, 409, "EXPENSE_PREVIEW_STALE");
  }
  private async historyWrite(
    g: ExpenseGrant,
    r: ExpenseProposal,
    before: ExpenseProposal | null,
    operationId: ObjectId,
    requestId: string,
    tx: ClientSession,
  ) {
    await this.finance.append(
      g,
      "expense_proposal",
      r._id,
      r.state === "pending" ? "submitted" : r.state,
      before ? this.dto(before) : null,
      this.dto(r),
      r.decision?.reason || null,
      operationId,
      requestId,
      tx,
    );
  }
  async funds(g: ExpenseGrant, q: URLSearchParams) {
    this.base(g);
    const query = new TenantQueries(this.key, this.now, "expense-funds");
    query.allow(q, ["q", "cursor", "limit"]);
    const text = (q.get("q") ?? "").normalize("NFC").trim().toLowerCase();
    requireCondition(text.length <= 100, 400, "INVALID_REQUEST");
    const limit = query.limit(q),
      context = query.context(g, "funds", text),
      after = q.has("cursor") ? query.decode(q.get("cursor") as string, context) : null;
    return this.db.readSnapshot(g.churchId.toHexString(), async (tx) => {
      await g.fence(tx);
      this.requireRead(await this.permissions(g, tx), g);
      const filter: Filter<Fund> = {
        churchId: g.churchId,
        status: "active",
        ...(text ? { nameKey: { $regex: `^${escaped(text)}` } } : {}),
        ...(after
          ? {
              $or: [
                { nameKey: { $gt: after.key } },
                { nameKey: after.key, _id: { $gt: objectId(after.id) } },
              ],
            }
          : {}),
      };
      const rows = await this.db.db
          .collection<Fund>("finance_funds")
          .find(filter, { session: tx, maxTimeMS: 3000, projection: { name: 1, nameKey: 1 } })
          .sort({ nameKey: 1, _id: 1 })
          .limit(limit + 1)
          .toArray(),
        more = rows.length > limit;
      rows.splice(limit);
      const last = rows.at(-1);
      return {
        items: rows.map((f) => ({ id: f._id.toHexString(), name: f.name })),
        nextCursor:
          more && last ? query.encode(context, last.nameKey, last._id.toHexString()) : null,
      };
    });
  }
  async previewSubmit(g: ExpenseGrant, raw: unknown) {
    this.base(g);
    const b = parse(expenseDraft, raw);
    return this.db.readSnapshot(g.churchId.toHexString(), async (tx) => {
      await g.fence(tx);
      const p = await this.permissions(g, tx);
      requireCondition(p.canSubmit && p.settings, 403, "FORBIDDEN");
      const f = await this.fund(g, objectId(b.fundId), tx),
        amount = moneyValue(b.amount),
        day = businessDay(this.now()),
        sources = [p.settings.version, f.version, day];
      return {
        previewToken: this.token(g, "submit", b, sources),
        fundName: f.name,
        amount: amount.toString(),
        purpose: b.purpose,
        businessDate: day,
        creatorName: g.actorName,
        approverRole: p.settings.approverRole,
      };
    });
  }
  async submit(g: ExpenseGrant, raw: unknown, key: string | null, requestId: string) {
    this.base(g);
    const command = parse(expenseSubmit, raw),
      b = command.proposal,
      payloadHash = digest(canonical(b));
    try {
      const result = await this.ops.executeTenant(
        g,
        "POST",
        `expense-proposals/${g.churchId}/submit`,
        key,
        command,
        null,
        async (tx, operationId) => {
          const p = await this.permissions(g, tx);
          requireCondition(p.canSubmit && p.settings, 403, "FORBIDDEN");
          const existing = await this.proposals.findOne(
            { churchId: g.churchId, submissionId: b.submissionId },
            { session: tx },
          );
          if (existing) {
            requireCondition(
              existing.createdBy.equals(g.actorId) && existing.payloadHash === payloadHash,
              409,
              "EXPENSE_SUBMISSION_CONFLICT",
            );
            return {
              safeResult: {
                proposalId: existing._id.toHexString(),
                version: existing.version,
                reconciled: true,
              },
              resourceRefs: [{ type: "expense_create", id: existing._id.toHexString() }],
            };
          }
          const f = await this.fund(g, objectId(b.fundId), tx),
            amount = moneyValue(b.amount),
            day = businessDay(this.now());
          this.verify(g, "submit", b, [p.settings.version, f.version, day], command.previewToken);
          await this.fenceSettings(g, p.settings, tx);
          await this.fenceFund(g, f, tx, true);
          const r: ExpenseProposal = {
            _id: new ObjectId(),
            churchId: g.churchId,
            code: resourceCode("DX"),
            submissionId: b.submissionId,
            payloadHash,
            contentHash: digest(
              canonical({
                fundId: b.fundId,
                fundName: f.name,
                amount: amount.toString(),
                purpose: b.purpose,
                businessDate: day,
                createdBy: g.actorId.toHexString(),
              }),
            ),
            createdBy: g.actorId,
            creatorName: g.actorName,
            creatorRole: g.role,
            businessDate: day,
            fundId: f._id,
            fundName: f.name,
            fundVersion: f.version,
            amount: moneyDecimal(amount),
            purpose: b.purpose,
            settingsVersion: p.settings.version,
            approverRole: p.settings.approverRole,
            state: "pending",
            version: 1,
            createdAt: this.now(),
            decision: null,
          };
          await this.proposals.insertOne(r, { session: tx });
          await this.historyWrite(g, r, null, operationId, requestId, tx);
          return {
            safeResult: { proposalId: r._id.toHexString(), version: 1 },
            resourceRefs: [{ type: "expense_create", id: r._id.toHexString() }],
          };
        },
        201,
        (tx, op) => this.authorize(g, op, tx),
      );
      return { ...result, status: result.data.reconciled ? 200 : result.status };
    } catch (e) {
      if (e instanceof MongoServerError && e.code === 11000)
        throw new AppError(409, "OPERATION_IN_PROGRESS");
      throw e;
    }
  }
  async previewDecision(g: ExpenseGrant, id: string, raw: unknown, match: string | null) {
    this.base(g);
    const b = parse(expenseDecision, raw),
      expected = version(match);
    return this.db.readSnapshot(g.churchId.toHexString(), async (tx) => {
      await g.fence(tx);
      const p = await this.permissions(g, tx),
        r = await this.row(g, id, tx);
      this.requireRead(p, g, r);
      this.requireDecide(p, g, r);
      requireCondition(r.state === "pending", 409, "EXPENSE_ALREADY_DECIDED");
      requireCondition(r.version === expected, 412, "VERSION_CONFLICT");
      requireCondition(p.settings, 403, "FORBIDDEN");
      const f = await this.fund(g, r.fundId, tx, b.decision === "approved");
      return {
        previewToken: this.token(g, `decision/${id}`, b, [
          r.version,
          r.contentHash,
          p.settings.version,
          f.version,
        ]),
        proposal: this.dto(r),
        currentFundName: f.name,
        approverRole: p.settings.approverRole,
        decision: b.decision,
        reason: b.reason,
      };
    });
  }
  async decide(
    g: ExpenseGrant,
    id: string,
    raw: unknown,
    key: string | null,
    match: string | null,
    requestId: string,
  ) {
    this.base(g);
    const command = parse(expenseDecide, raw),
      b = command.decision,
      expected = version(match),
      target = objectId(id);
    return this.ops.executeTenant(
      g,
      "POST",
      `expense-proposals/${g.churchId}/${id}/decision`,
      key,
      command,
      expected,
      async (tx, operationId) => {
        const p = await this.permissions(g, tx),
          old = await this.row(g, id, tx);
        this.requireRead(p, g, old);
        this.requireDecide(p, g, old);
        requireCondition(p.settings, 403, "FORBIDDEN");
        requireCondition(old.version === expected, 412, "VERSION_CONFLICT");
        requireCondition(old.state === "pending", 409, "EXPENSE_ALREADY_DECIDED");
        const f = await this.fund(g, old.fundId, tx, b.decision === "approved");
        this.verify(
          g,
          `decision/${id}`,
          b,
          [old.version, old.contentHash, p.settings.version, f.version],
          command.previewToken,
        );
        await this.fenceSettings(g, p.settings, tx);
        await this.fenceFund(g, f, tx, b.decision === "approved");
        const decision = {
          actorId: g.actorId,
          actorName: g.actorName,
          actorRole: g.role,
          action: b.decision,
          reason: b.reason,
          decidedAt: this.now(),
          settingsVersion: p.settings.version,
          fundVersion: f.version,
          contentHash: old.contentHash,
          proposalVersion: old.version,
        };
        const saved = await this.proposals.findOneAndUpdate(
          { _id: target, churchId: g.churchId, state: "pending", version: expected },
          { $set: { state: b.decision, decision }, $inc: { version: 1 } },
          { session: tx, returnDocument: "after" },
        );
        requireCondition(saved, 412, "VERSION_CONFLICT");
        await this.historyWrite(g, saved, old, operationId, requestId, tx);
        return {
          safeResult: { proposalId: id, version: saved.version },
          resourceRefs: [{ type: "expense_decision", id }],
        };
      },
      200,
      (tx, op) => this.authorize(g, op, tx),
    );
  }
  async get(g: ExpenseGrant, id: string) {
    this.base(g);
    return this.db.readSnapshot(g.churchId.toHexString(), async (tx) => {
      await g.fence(tx);
      const p = await this.permissions(g, tx),
        r = await this.row(g, id, tx);
      this.requireRead(p, g, r);
      return {
        ...this.dto(r),
        currentApproverRole: p.settings?.approverRole ?? null,
        canPay: g.role === "treasurer" && r.state === "approved",
        canReadPayment: ["pastor", "treasurer"].includes(g.role),
        canDecide: p.canDecide && !r.createdBy.equals(g.actorId) && r.state === "pending",
      };
    });
  }
  async list(g: ExpenseGrant, q: URLSearchParams) {
    this.base(g);
    const query = new TenantQueries(this.key, this.now, "expense-proposals");
    query.allow(q, ["period", "fundId", "scope", "state", "q", "limit", "cursor"]);
    const period = q.get("period") ?? businessDay(this.now()).slice(0, 7),
      scope = q.get("scope"),
      state = q.get("state") ?? "all",
      text = (q.get("q") ?? "").trim().toUpperCase();
    requireCondition(
      /^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(period) &&
        ["all", "pending", "approved", "paid", "payment_voided", "rejected"].includes(state) &&
        (!scope || ["mine", "all"].includes(scope)) &&
        text.length <= 100,
      400,
      "INVALID_REQUEST",
    );
    const fund = q.has("fundId") ? objectId(q.get("fundId") as string) : null,
      limit = query.limit(q);
    return this.db.readSnapshot(g.churchId.toHexString(), async (tx) => {
      await g.fence(tx);
      const p = await this.permissions(g, tx);
      this.requireRead(p, g);
      const own = scope === "mine" || (!scope && !p.canReadAll);
      requireCondition(own || p.canReadAll, 403, "FORBIDDEN");
      const context = query.context(g, "list", [
          period,
          fund?.toHexString(),
          own ? "mine" : "all",
          state,
          text,
          p.settings?.version ?? null,
        ]),
        after = q.has("cursor") ? query.decode(q.get("cursor") as string, context) : null;
      const next = new Date(`${period}-01T00:00:00Z`);
      next.setUTCMonth(next.getUTCMonth() + 1);
      const base: Filter<ExpenseProposal> = {
        churchId: g.churchId,
        businessDate: { $gte: `${period}-01`, $lt: next.toISOString().slice(0, 10) },
        ...(fund ? { fundId: fund } : {}),
        ...(own ? { createdBy: g.actorId } : {}),
      };
      const sums = await this.proposals
        .aggregate<{
          _id: ExpenseProposal["state"];
          count: number;
          total: ExpenseProposal["amount"];
        }>(
          [
            { $match: base },
            { $group: { _id: "$state", count: { $sum: 1 }, total: { $sum: "$amount" } } },
          ],
          { session: tx, maxTimeMS: 3000 },
        )
        .toArray();
      const summary = Object.fromEntries(
        (["pending", "approved", "paid", "payment_voided", "rejected"] as const).map((state) => {
          const s = sums.find((s) => s._id === state);
          return [state, { count: s?.count ?? 0, total: s ? decimalString(s.total) : "0" }];
        }),
      );
      const filter: Filter<ExpenseProposal> = {
        ...base,
        ...(state !== "all" ? { state: state as ExpenseProposal["state"] } : {}),
        ...(text ? { code: { $regex: `^${escaped(text)}` } } : {}),
        ...(after
          ? {
              $or: [
                { businessDate: { $lt: after.key } },
                { businessDate: after.key, _id: { $lt: objectId(after.id) } },
              ],
            }
          : {}),
      };
      const rows = await this.proposals
          .find(filter, { session: tx, maxTimeMS: 3000 })
          .sort({ businessDate: -1, _id: -1 })
          .limit(limit + 1)
          .toArray(),
        more = rows.length > limit;
      rows.splice(limit);
      const last = rows.at(-1);
      return {
        items: rows.map((r) => this.dto(r)),
        summary,
        scope: own ? "mine" : "all",
        nextCursor:
          more && last ? query.encode(context, last.businessDate, last._id.toHexString()) : null,
      };
    });
  }
  async history(g: ExpenseGrant, id: string, q: URLSearchParams) {
    this.base(g);
    const query = new TenantQueries(this.key, this.now, "expense-history");
    query.allow(q, ["limit", "cursor"]);
    const limit = query.limit(q),
      context = query.context(g, `history/${id}`, null),
      after = q.has("cursor") ? query.decode(q.get("cursor") as string, context) : null;
    return this.db.readSnapshot(g.churchId.toHexString(), async (tx) => {
      await g.fence(tx);
      const p = await this.permissions(g, tx),
        r = await this.row(g, id, tx);
      this.requireRead(p, g, r);
      const rows = await this.db.db
          .collection<FinanceHistory>("finance_history")
          .find(
            {
              churchId: g.churchId,
              targetType: "expense_proposal",
              targetId: r._id,
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
          reason: h.reason,
          occurredAt: h.occurredAt.toISOString(),
          before: h.before,
          after: h.after,
        })),
        nextCursor: more && last ? query.encode(context, "", last._id.toHexString()) : null,
      };
    });
  }
}
