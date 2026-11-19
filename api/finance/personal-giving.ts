import { type ClientSession, type Decimal128, type Filter, ObjectId } from "mongodb";
import type { Database } from "../infrastructure/database";
import { decimalString } from "./money";
import type { Receipt } from "./transactions-model";

type GivingRow = Pick<Receipt, "_id" | "businessDate" | "fundName" | "state"> & {
  amount: Decimal128;
};

export class FinancePersonalGiving {
  constructor(private db: Database) {}

  // The portal resolves the subject from the freshly fenced account and member.
  async page(
    churchId: ObjectId,
    memberId: ObjectId,
    period: string,
    after: { key: string; id: string } | null,
    limit: number,
    tx: ClientSession,
  ) {
    const scope: Filter<Receipt> = {
      churchId,
      mode: "itemized",
      period,
      "lines.memberId": memberId,
    };
    const position: Filter<Receipt> = after
      ? {
          $or: [
            { businessDate: { $lt: after.key } },
            { businessDate: after.key, _id: { $lt: new ObjectId(after.id) } },
          ],
        }
      : {};
    const ownAmount = {
      $sum: {
        $map: {
          input: {
            $filter: {
              input: "$lines",
              as: "line",
              cond: { $eq: ["$$line.memberId", memberId] },
            },
          },
          as: "own",
          in: "$$own.amount",
        },
      },
    };
    const receipts = this.db.db.collection<Receipt>("finance_receipts");
    const options = { session: tx, maxTimeMS: 3000 };
    const rows = await receipts
      .aggregate<GivingRow>(
        [
          { $match: { ...scope, ...position } },
          { $sort: { businessDate: -1, _id: -1 } },
          { $limit: limit },
          { $project: { businessDate: 1, fundName: 1, state: 1, amount: ownAmount } },
        ],
        options,
      )
      .toArray();
    const totals = await receipts
      .aggregate<{ net: Decimal128 }>(
        [
          { $match: { ...scope, state: "posted" } },
          { $project: { amount: ownAmount } },
          { $group: { _id: null, net: { $sum: "$amount" } } },
        ],
        options,
      )
      .toArray();
    return {
      rows: rows.map((row) => ({
        id: row._id.toHexString(),
        businessDate: row.businessDate,
        fundName: row.fundName,
        amount: decimalString(row.amount),
        state: row.state,
      })),
      net: totals[0] ? decimalString(totals[0].net) : "0",
    };
  }
}
