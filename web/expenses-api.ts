import type { Expenses } from "../api/finance/expenses";
export type ExpenseContext = Awaited<ReturnType<Expenses["context"]>>;
export type ExpensePage = Awaited<ReturnType<Expenses["list"]>>;
export type ExpenseDetail = Awaited<ReturnType<Expenses["get"]>>;
export type ExpenseSubmitPreview = Awaited<ReturnType<Expenses["previewSubmit"]>>;
export type ExpenseDecisionPreview = Awaited<ReturnType<Expenses["previewDecision"]>>;
export type ExpenseFundPage = Awaited<ReturnType<Expenses["funds"]>>;
export type ExpenseHistory = Awaited<ReturnType<Expenses["history"]>>;
export const expenseStates = {
  pending: "Chờ duyệt",
  approved: "Đã duyệt, chờ chi",
  rejected: "Từ chối",
  paid: "Đã chi",
  payment_voided: "Phiếu chi đã hủy",
};
