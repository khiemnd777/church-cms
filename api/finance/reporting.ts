import type { ClientSession, ObjectId } from "mongodb";
import { requireCondition } from "../errors";
import { objectId } from "../http-validation";
import type { Database } from "../infrastructure/database";
import { businessDay } from "../members/dates";
import { FinanceBook } from "./book";
import type { FinanceGrant, Fund } from "./models";
import { decimalString, moneyDecimal } from "./money";
import type { FinancePeriod, LedgerEntry } from "./transactions-model";

export const incomeKinds = ["receipt", "void"];
export const expenseKinds = ["payment", "payment_void"];
export const incomeAmount = {
  $cond: [{ $in: ["$kind", incomeKinds] }, "$amount", moneyDecimal(0n)],
};
export const expenseAmount = {
  $cond: [{ $in: ["$kind", expenseKinds] }, { $multiply: ["$amount", -1] }, moneyDecimal(0n)],
};
export interface BookTotals {
  netIncome: string;
  netExpense: string;
  openingBalance: string;
  closingBalance: string;
}
// The same signed amounts serve ledger totals and annual reporting; all sums stay Decimal128.
export async function bookTotals(
  db: Database,
  churchId: ObjectId,
  period: string,
  tx: ClientSession,
  fundId?: ObjectId | null,
): Promise<BookTotals> {
  // Exclusive lexical month bound avoids Date overflow at the supported year limit.
  const from = `${period}-01`,
    rows = await db.db
      .collection<LedgerEntry>("finance_ledger")
      .aggregate<{
        income: LedgerEntry["amount"];
        expense: LedgerEntry["amount"];
        opening: LedgerEntry["amount"];
        closing: LedgerEntry["amount"];
      }>(
        [
          {
            $match: {
              churchId,
              ...(fundId ? { fundId } : {}),
              businessDate: { $lt: `${period}-32` },
            },
          },
          {
            $group: {
              _id: null,
              income: {
                $sum: {
                  $cond: [{ $gte: ["$businessDate", from] }, incomeAmount, moneyDecimal(0n)],
                },
              },
              expense: {
                $sum: {
                  $cond: [{ $gte: ["$businessDate", from] }, expenseAmount, moneyDecimal(0n)],
                },
              },
              opening: {
                $sum: { $cond: [{ $lt: ["$businessDate", from] }, "$amount", moneyDecimal(0n)] },
              },
              closing: { $sum: "$amount" },
            },
          },
        ],
        { session: tx, maxTimeMS: 3000 },
      )
      .toArray();
  const r = rows[0];
  return {
    netIncome: r ? decimalString(r.income) : "0",
    netExpense: r ? decimalString(r.expense) : "0",
    openingBalance: r ? decimalString(r.opening) : "0",
    closingBalance: r ? decimalString(r.closing) : "0",
  };
}
export class FinanceReporting {
  private book: FinanceBook;
  constructor(
    private db: Database,
    private now: () => Date = () => new Date(),
  ) {
    this.book = new FinanceBook(db);
  }
  async summary(g: FinanceGrant, q: URLSearchParams) {
    requireCondition(
      g.actorKind === "church_user" &&
        ["pastor", "treasurer"].includes(g.financeRole) &&
        !g.unitScope &&
        !g.receiptScope,
      403,
      "FORBIDDEN",
    );
    requireCondition(
      [...q.keys()].every((k) => ["period", "fundId"].includes(k)) &&
        [...q.keys()].every((k) => q.getAll(k).length === 1),
      400,
      "INVALID_REQUEST",
    );
    const at = this.now(),
      current = businessDay(at).slice(0, 7),
      period = q.get("period") ?? current;
    requireCondition(/^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(period), 400, "INVALID_REQUEST");
    const fundId = q.has("fundId") ? objectId(q.get("fundId") as string) : null,
      year = period.slice(0, 4),
      months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);
    return this.db.readSnapshot(g.churchId.toHexString(), async (tx) => {
      await g.fence(tx);
      const fund = fundId
        ? await this.db.db
            .collection<Fund>("finance_funds")
            .findOne({ _id: fundId, churchId: g.churchId }, { session: tx })
        : null;
      requireCondition(!fundId || fund, 404, "NOT_FOUND");
      const control = await this.book.control(g, tx),
        periods = await this.db.db
          .collection<FinancePeriod>("finance_periods")
          .find({ churchId: g.churchId, period: { $in: months } }, { session: tx, maxTimeMS: 3000 })
          .limit(12)
          .toArray();
      const status = (m: string): "closed" | "open" | "future" =>
        m > current
          ? "future"
          : (control?.closedThrough && m <= control.closedThrough) ||
              periods.some((p) => p.period === m && p.state === "closed")
            ? "closed"
            : "open";
      const rows =
        year <= current.slice(0, 4)
          ? await this.db.db
              .collection<LedgerEntry>("finance_ledger")
              .aggregate<{ _id: string; income: LedgerEntry["amount"] }>(
                [
                  {
                    $match: {
                      churchId: g.churchId,
                      ...(fundId ? { fundId } : {}),
                      businessDate: { $gte: `${year}-01-01`, $lte: `${year}-12-31` },
                    },
                  },
                  {
                    $group: {
                      _id: { $substrBytes: ["$businessDate", 0, 7] },
                      income: { $sum: incomeAmount },
                    },
                  },
                ],
                { session: tx, maxTimeMS: 3000 },
              )
              .toArray()
          : [];
      return {
        asOf: at.toISOString(),
        timezone: "Asia/Ho_Chi_Minh" as const,
        period,
        year,
        fund: fund ? { id: fund._id.toHexString(), name: fund.name, status: fund.status } : null,
        closedThrough: control?.closedThrough ?? null,
        state: status(period),
        totals:
          status(period) === "future"
            ? null
            : await bookTotals(this.db, g.churchId, period, tx, fundId),
        months: months.map((m) => ({
          period: m,
          state: status(m),
          netIncome:
            status(m) === "future"
              ? null
              : (() => {
                  const r = rows.find((r) => r._id === m);
                  return r ? decimalString(r.income) : "0";
                })(),
        })),
      };
    });
  }
}
export type FinanceSummary = Awaited<ReturnType<FinanceReporting["summary"]>>;
