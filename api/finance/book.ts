import type { ClientSession, ObjectId } from "mongodb";
import { requireCondition } from "../errors";
import type { Database } from "../infrastructure/database";
import type { FinanceGrant, Fund } from "./models";
import { decimalString } from "./money";
import type { BookControl } from "./periods-model";
import type { FinancePeriod, LedgerEntry } from "./transactions-model";

// All money writers contend on the same fund document before reading the book.
// A snapshot-only balance check cannot prevent two different proposals overspending.
export class FinanceBook {
  constructor(private db: Database) {}
  async fundFence(g: FinanceGrant, fundId: ObjectId, tx: ClientSession, active = false) {
    const fund = await this.db.db
      .collection<Fund>("finance_funds")
      .findOneAndUpdate(
        { _id: fundId, churchId: g.churchId, ...(active ? { status: "active" as const } : {}) },
        { $inc: { financeWriteFence: 1 } },
        { session: tx, returnDocument: "after" },
      );
    requireCondition(fund, 409, "FINANCE_SOURCE_UNAVAILABLE");
    return fund;
  }
  async control(g: FinanceGrant, tx: ClientSession) {
    return this.db.db
      .collection<BookControl>("finance_book_controls")
      .findOne({ _id: g.churchId }, { session: tx });
  }
  async status(g: FinanceGrant, month: string, tx: ClientSession) {
    const control = await this.control(g, tx),
      period = await this.db.db
        .collection<FinancePeriod>("finance_periods")
        .findOne({ _id: `${g.churchId}:${month}`, churchId: g.churchId }, { session: tx });
    return {
      control,
      period,
      closed:
        !!(control?.closedThrough && month <= control.closedThrough) || period?.state === "closed",
    };
  }
  async controlFence(g: FinanceGrant, tx: ClientSession, month?: string) {
    const collection = this.db.db.collection<BookControl>("finance_book_controls");
    let c = await this.control(g, tx);
    requireCondition(
      !month || !c?.closedThrough || month > c.closedThrough,
      409,
      "FINANCE_PERIOD_CLOSED",
    );
    if (!c) {
      c = { _id: g.churchId, closedThrough: null, version: 1, writeFence: 0 };
      await collection.insertOne(c, { session: tx });
    }
    const changed = await collection.updateOne(
      { _id: g.churchId, version: c.version },
      { $inc: { writeFence: 1 } },
      { session: tx },
    );
    requireCondition(changed.matchedCount, 409, "FINANCE_PERIOD_CLOSED");
    return c;
  }
  async period(g: FinanceGrant, month: string, tx: ClientSession, write = false) {
    const state = await this.status(g, month, tx);
    requireCondition(!state.closed, 409, "FINANCE_PERIOD_CLOSED");
    const periods = this.db.db.collection<FinancePeriod>("finance_periods"),
      id = `${g.churchId}:${month}`;
    let p = await periods.findOne({ _id: id, churchId: g.churchId }, { session: tx });
    requireCondition(!p || p.state === "open", 409, "FINANCE_PERIOD_CLOSED");
    if (write) {
      if (!p) {
        p = {
          _id: id,
          churchId: g.churchId,
          period: month,
          state: "open",
          version: 1,
          writeFence: 0,
        };
        await periods.insertOne(p, { session: tx });
      }
      const changed = await periods.updateOne(
        { _id: id, churchId: g.churchId, state: "open", version: p.version },
        { $inc: { writeFence: 1 } },
        { session: tx },
      );
      requireCondition(changed.matchedCount, 409, "FINANCE_PERIOD_CLOSED");
    }
    return p;
  }
  async balance(churchId: ObjectId, fundId: ObjectId, tx: ClientSession) {
    const rows = await this.db.db
      .collection<LedgerEntry>("finance_ledger")
      .aggregate<{
        total: LedgerEntry["amount"];
        count: number;
      }>(
        [
          { $match: { churchId, fundId } },
          { $group: { _id: null, total: { $sum: "$amount" }, count: { $sum: 1 } } },
        ],
        { session: tx, maxTimeMS: 3000 },
      )
      .toArray();
    return { amount: rows[0] ? decimalString(rows[0].total) : "0", count: rows[0]?.count ?? 0 };
  }
}
