import type { FinanceTransactions } from "../api/finance/transactions";
export type GivingPage = Awaited<ReturnType<FinanceTransactions["codeList"]>>;
export type Giving = GivingPage["items"][number];
export type ReceiptDetail = Awaited<ReturnType<FinanceTransactions["get"]>>;
export type Preview = Awaited<ReturnType<FinanceTransactions["preview"]>>;
export type TransactionHistory = Awaited<ReturnType<FinanceTransactions["history"]>>;
export type MemberSource = Awaited<
  ReturnType<FinanceTransactions["memberOptions"]>
>["items"][number];
export interface IncomeRow {
  id: string;
  code: string;
  businessDate: string;
  fundName: string;
  sourceReference: string;
  purpose: string;
  total: string;
  state: "posted" | "voided";
  contribution?: string;
}
export interface LedgerRow {
  id: string;
  receiptId: string | null;
  paymentId: string | null;
  proposalId: string | null;
  proposalCode: string | null;
  code: string;
  businessDate: string;
  fundName: string;
  kind: "receipt" | "void" | "payment" | "payment_void";
  amount: string;
}
export interface IncomePage<T = IncomeRow> {
  items: T[];
  nextCursor: string | null;
  netIncome: string;
  netExpense: string;
  openingBalance: string;
  closingBalance: string;
}
export function vnd(s: string) {
  try {
    return `${BigInt(s).toLocaleString("vi-VN")} ₫`;
  } catch {
    return "—";
  }
}
export function vnToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
