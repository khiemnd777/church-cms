import type { ClientSession, Document, ObjectId } from "mongodb";
import type { Database } from "../infrastructure/database";
import { decimalString, moneyDecimal } from "./money";
import type { BookSummary } from "./periods-model";
import type { LedgerEntry } from "./transactions-model";

const eq = (a: unknown, b: unknown) => ({ $eq: [a, b] });
const lookup = (from: string, id: unknown, as: string): Document => ({
  $lookup: {
    from,
    let: { id, church: "$churchId" },
    pipeline: [{ $match: { $expr: { $and: [eq("$_id", "$$id"), eq("$churchId", "$$church")] } } }],
    as,
  },
});
const sourceLedger = (field: string): Document => ({
  $lookup: {
    from: "finance_ledger",
    let: { id: "$_id", church: "$churchId" },
    pipeline: [
      { $match: { $expr: { $and: [eq(`$${field}`, "$$id"), eq("$churchId", "$$church")] } } },
    ],
    as: "entries",
  },
});
// Aggregations return only counts and ten safe diagnostic references, never whole books.
export class FinanceReconciliation {
  constructor(private db: Database) {}
  private async issues(
    collection: string,
    scope: Document,
    pipeline: Document[],
    valid: Document,
    tx: ClientSession,
  ) {
    const rows = await this.db.db
      .collection(collection)
      .aggregate<{ totals: { count: number }[]; samples: { id: ObjectId; code?: string }[] }>(
        [
          { $match: scope },
          ...pipeline,
          { $match: { $expr: { $not: [valid] } } },
          {
            $facet: {
              totals: [{ $count: "count" }],
              samples: [
                { $limit: 10 },
                {
                  $project: {
                    id: "$_id",
                    code: { $ifNull: ["$code", { $ifNull: ["$receiptCode", "$paymentCode"] }] },
                    _id: 0,
                  },
                },
              ],
            },
          },
        ],
        { session: tx, maxTimeMS: 3000 },
      )
      .toArray();
    return {
      count: rows[0]?.totals[0]?.count ?? 0,
      samples: (rows[0]?.samples ?? []).map((r) => ({
        id: r.id.toHexString(),
        code: r.code ?? null,
      })),
    };
  }
  async inspect(churchId: ObjectId, month: string, previous: string | null, tx: ClientSession) {
    const from = `${month}-01`,
      next = new Date(`${from}T00:00:00Z`);
    next.setUTCMonth(next.getUTCMonth() + 1);
    const until = next.toISOString().slice(0, 10),
      lower = previous ? `${previous}-31` : "0000-00-00",
      scope = { churchId, businessDate: { $gt: lower, $lt: until } };
    const receiptValid = {
      $and: [
        eq({ $size: "$entries" }, { $cond: [eq("$state", "voided"), 2, 1] }),
        eq(
          { $size: { $filter: { input: "$entries", as: "e", cond: eq("$$e.kind", "receipt") } } },
          1,
        ),
        {
          $allElementsTrue: {
            $map: {
              input: "$entries",
              as: "e",
              in: {
                $and: [
                  eq("$$e.fundId", "$fundId"),
                  eq("$$e.businessDate", "$businessDate"),
                  eq("$$e.period", "$period"),
                  eq("$$e.receiptCode", "$code"),
                  {
                    $or: [
                      { $and: [eq("$$e.kind", "receipt"), eq("$$e.amount", "$total")] },
                      {
                        $and: [
                          eq("$state", "voided"),
                          eq("$$e.kind", "void"),
                          eq("$$e.amount", { $multiply: ["$total", -1] }),
                        ],
                      },
                    ],
                  },
                ],
              },
            },
          },
        },
      ],
    };
    const paidVoid = eq({ $ifNull: ["$state", "posted"] }, "voided"),
      paymentValid = {
        $and: [
          eq({ $size: "$entries" }, { $cond: [paidVoid, 2, 1] }),
          eq(
            { $size: { $filter: { input: "$entries", as: "e", cond: eq("$$e.kind", "payment") } } },
            1,
          ),
          eq({ $size: "$proposals" }, 1),
          {
            $allElementsTrue: {
              $map: {
                input: "$proposals",
                as: "p",
                in: {
                  $and: [
                    eq("$$p.state", { $cond: [paidVoid, "payment_voided", "paid"] }),
                    eq("$$p.payment.id", "$_id"),
                    eq("$$p.payment.code", "$code"),
                    eq("$$p.payment.businessDate", "$businessDate"),
                    eq("$$p.contentHash", "$contentHash"),
                    eq("$$p.amount", "$amount"),
                    eq("$$p.fundId", "$fundId"),
                    eq("$$p.code", "$proposalCode"),
                    eq("$$p.purpose", "$purpose"),
                    eq("$$p.decision.actorId", "$decision.actorId"),
                    eq("$$p.decision.decidedAt", "$decision.decidedAt"),
                    eq("$$p.decision.action", "approved"),
                  ],
                },
              },
            },
          },
          {
            $allElementsTrue: {
              $map: {
                input: "$entries",
                as: "e",
                in: {
                  $and: [
                    eq("$$e.fundId", "$fundId"),
                    eq("$$e.businessDate", "$businessDate"),
                    eq("$$e.period", "$period"),
                    eq("$$e.paymentCode", "$code"),
                    eq("$$e.proposalId", "$proposalId"),
                    eq("$$e.proposalCode", "$proposalCode"),
                    {
                      $or: [
                        {
                          $and: [
                            eq("$$e.kind", "payment"),
                            eq("$$e.amount", { $multiply: ["$amount", -1] }),
                          ],
                        },
                        {
                          $and: [
                            paidVoid,
                            eq("$$e.kind", "payment_void"),
                            eq("$$e.amount", "$amount"),
                          ],
                        },
                      ],
                    },
                  ],
                },
              },
            },
          },
        ],
      };
    const ledgerValid = {
      $and: [
        eq({ $size: "$funds" }, 1),
        eq({ $size: "$periods" }, 1),
        {
          $cond: [
            { $in: ["$kind", ["receipt", "void"]] },
            eq({ $size: "$receipts" }, 1),
            eq({ $size: "$payments" }, 1),
          ],
        },
        {
          $allElementsTrue: {
            $map: {
              input: { $concatArrays: ["$receipts", "$payments"] },
              as: "s",
              in: {
                $and: [
                  eq("$$s.fundId", "$fundId"),
                  eq("$$s.businessDate", "$businessDate"),
                  eq("$$s.period", "$period"),
                ],
              },
            },
          },
        },
      ],
    };
    const receipts = await this.issues(
      "finance_receipts",
      scope,
      [sourceLedger("receiptId")],
      receiptValid,
      tx,
    );
    const payments = await this.issues(
      "finance_payments",
      scope,
      [sourceLedger("paymentId"), lookup("finance_expense_proposals", "$proposalId", "proposals")],
      paymentValid,
      tx,
    );
    const ledger = await this.issues(
      "finance_ledger",
      scope,
      [
        lookup("finance_receipts", "$receiptId", "receipts"),
        lookup("finance_payments", "$paymentId", "payments"),
        lookup("finance_funds", "$fundId", "funds"),
        {
          $lookup: {
            from: "finance_periods",
            let: { period: "$period", church: "$churchId" },
            pipeline: [
              {
                $match: {
                  $expr: { $and: [eq("$churchId", "$$church"), eq("$period", "$$period")] },
                },
              },
            ],
            as: "periods",
          },
        },
      ],
      ledgerValid,
      tx,
    );
    const rows = await this.db.db
      .collection<LedgerEntry>("finance_ledger")
      .aggregate<Record<string, LedgerEntry["amount"] | number | ObjectId>>(
        [
          { $match: { churchId, businessDate: { $lt: until } } },
          {
            $group: {
              _id: null,
              netIncome: {
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
              netExpense: {
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
              rangeNetIncome: {
                $sum: {
                  $cond: [
                    {
                      $and: [
                        { $gt: ["$businessDate", lower] },
                        { $in: ["$kind", ["receipt", "void"]] },
                      ],
                    },
                    "$amount",
                    moneyDecimal(0n),
                  ],
                },
              },
              rangeNetExpense: {
                $sum: {
                  $cond: [
                    {
                      $and: [
                        { $gt: ["$businessDate", lower] },
                        { $in: ["$kind", ["payment", "payment_void"]] },
                      ],
                    },
                    { $multiply: ["$amount", -1] },
                    moneyDecimal(0n),
                  ],
                },
              },
              openingBalance: {
                $sum: { $cond: [{ $lt: ["$businessDate", from] }, "$amount", moneyDecimal(0n)] },
              },
              closingBalance: { $sum: "$amount" },
              ledgerCount: { $sum: 1 },
              rangeLedgerCount: { $sum: { $cond: [{ $gt: ["$businessDate", lower] }, 1, 0] } },
              maxLedgerId: { $max: "$_id" },
            },
          },
        ],
        { session: tx, maxTimeMS: 3000 },
      )
      .toArray();
    const row = rows[0],
      money = (k: string) => (row ? decimalString(row[k] as LedgerEntry["amount"]) : "0");
    const summary: BookSummary = {
      netIncome: money("netIncome"),
      netExpense: money("netExpense"),
      openingBalance: money("openingBalance"),
      closingBalance: money("closingBalance"),
      rangeNetIncome: money("rangeNetIncome"),
      rangeNetExpense: money("rangeNetExpense"),
      ledgerCount: Number(row?.ledgerCount ?? 0),
      rangeLedgerCount: Number(row?.rangeLedgerCount ?? 0),
      maxLedgerId: row ? (row.maxLedgerId as ObjectId).toHexString() : null,
    };
    return {
      summary,
      issues: { receipts, payments, ledger },
      matches: receipts.count + payments.count + ledger.count === 0,
    };
  }
}
