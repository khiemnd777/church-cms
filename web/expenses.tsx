import { useEffect, useRef, useState } from "react";
import type { ExpenseDraft } from "../api/finance/expenses-validation";
import { roleLabels } from "./accounts-api";
import { ApiError, churchRequest } from "./api";
import type { SettingsContext } from "./church-settings";
import {
  type ExpenseContext,
  type ExpenseDecisionPreview,
  type ExpenseDetail,
  type ExpenseFundPage,
  type ExpenseHistory,
  type ExpensePage,
  type ExpenseSubmitPreview,
  expenseStates,
} from "./expenses-api";
import { vnd, vnToday } from "./finance-income-api";
import { PaymentDetail, type PaymentPreview } from "./finance-payments";
import { authErrorCodes, type TenantIntent, useTenantMutation } from "./tenant-mutation";
import {
  Badge,
  Button,
  Card,
  DialogActions,
  Drawer,
  EmptyState,
  Feedback,
  Field,
  IconButton,
  Loading,
  Modal,
  Select,
  Stack,
  TableFrame,
  TextArea,
  TextInput,
  Toolbar,
} from "./ui/components";
import "./finance.css";
type Fund = { id: string; name: string };
interface Props {
  churchId: string;
  pending: TenantIntent | null;
  onPending: (p: TenantIntent | null) => void;
  onAuthError: (e: unknown) => void;
  onTitle: (title: string, context?: string) => void;
}
function Pager({
  stack,
  next,
  disabled,
  onChange,
}: {
  stack: (string | null)[];
  next: string | null;
  disabled: boolean;
  onChange: (s: (string | null)[]) => void;
}) {
  return (
    <div className="finance-actions">
      <Button
        disabled={disabled || stack.length === 1}
        onClick={() => onChange(stack.slice(0, -1))}
      >
        Trước
      </Button>
      <Button disabled={disabled || !next} onClick={() => onChange([...stack, next])}>
        Tiếp
      </Button>
    </div>
  );
}
function FundPicker({
  base,
  onClose,
  onSelect,
  fail,
}: {
  base: string;
  onClose: () => void;
  onSelect: (f: Fund) => void;
  fail: (e: unknown) => void;
}) {
  const [q, setQ] = useState(""),
    [search, setSearch] = useState(""),
    [stack, setStack] = useState<(string | null)[]>([null]),
    [page, setPage] = useState<ExpenseFundPage | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    const a = new AbortController(),
      p = new URLSearchParams({ q: search });
    if (stack.at(-1)) p.set("cursor", stack.at(-1) as string);
    setPage(null);
    setError("");
    void churchRequest<ExpenseFundPage>(`${base}/funds?${p}`, { signal: a.signal })
      .then((r) => {
        if (!a.signal.aborted) setPage(r.data);
      })
      .catch((e) => {
        if (!a.signal.aborted) {
          setError(e instanceof Error ? e.message : "Không tải được quỹ.");
          fail(e);
        }
      });
    return () => a.abort();
  }, [base, search, stack]);
  return (
    <Modal open title="Chọn quỹ đề xuất" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setSearch(q);
          setStack([null]);
        }}
      >
        <Toolbar>
          <Field label="Tìm quỹ">
            <TextInput value={q} maxLength={100} onChange={(e) => setQ(e.target.value)} />
          </Field>
          <Button type="submit">Tìm</Button>
        </Toolbar>
      </form>
      {error && <Feedback tone="error">{error}</Feedback>}
      {!page && !error && <Loading />}
      {page?.items.length === 0 && <EmptyState message="Không có quỹ đang dùng phù hợp." />}
      {page?.items.map((f) => (
        <div className="finance-actions" key={f.id}>
          <Button onClick={() => onSelect(f)}>{f.name}</Button>
        </div>
      ))}
      <Pager stack={stack} next={page?.nextCursor ?? null} disabled={!page} onChange={setStack} />
    </Modal>
  );
}
function ProposalHistory({
  base,
  id,
  onClose,
  fail,
}: {
  base: string;
  id: string;
  onClose: () => void;
  fail: (e: unknown) => void;
}) {
  const [stack, setStack] = useState<(string | null)[]>([null]),
    [page, setPage] = useState<ExpenseHistory | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    const a = new AbortController(),
      p = new URLSearchParams();
    if (stack.at(-1)) p.set("cursor", stack.at(-1) as string);
    setPage(null);
    void churchRequest<ExpenseHistory>(`${base}/${id}/history?${p}`, { signal: a.signal })
      .then((r) => {
        if (!a.signal.aborted) setPage(r.data);
      })
      .catch((e) => {
        if (!a.signal.aborted) {
          setError(e instanceof Error ? e.message : "Không tải được lịch sử.");
          fail(e);
        }
      });
    return () => a.abort();
  }, [base, id, stack]);
  return (
    <Modal open title="Lịch sử đề xuất" onClose={onClose}>
      {error && <Feedback tone="error">{error}</Feedback>}
      {!page && !error && <Loading />}
      {page?.items.map((h) => (
        <Card spacing="content" key={h.id}>
          <Stack space="compact">
            <p>
              {(
                {
                  submitted: "Gửi đề xuất",
                  approved: "Duyệt",
                  rejected: "Từ chối",
                  paid: "Lập phiếu chi",
                  payment_voided: "Hủy phiếu chi",
                } as Record<string, string>
              )[h.event] ?? h.event}{" "}
              · {h.actorName} ·{" "}
              {new Date(h.occurredAt).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}
            </p>
            {h.reason && <p>{h.reason}</p>}
          </Stack>
        </Card>
      ))}
      <Pager stack={stack} next={page?.nextCursor ?? null} disabled={!page} onChange={setStack} />
    </Modal>
  );
}
function ProposalDrawer({
  base,
  id,
  onClose,
  onDecision,
  onPay,
  onViewPayment,
  fail,
  busy,
  locked,
}: {
  base: string;
  id: string;
  onClose: () => void;
  onDecision: (r: ExpenseDetail, decision: "approved" | "rejected") => void;
  onPay: (r: ExpenseDetail) => void;
  onViewPayment: (id: string) => void;
  fail: (e: unknown) => void;
  busy: boolean;
  locked: boolean;
}) {
  const [r, setR] = useState<ExpenseDetail | null>(null),
    [history, setHistory] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    const a = new AbortController();
    void churchRequest<ExpenseDetail>(`${base}/${id}`, { signal: a.signal })
      .then((r) => {
        if (!a.signal.aborted) setR(r.data);
      })
      .catch((e) => {
        if (!a.signal.aborted) {
          setError(e instanceof Error ? e.message : "Không tải được đề xuất.");
          fail(e);
        }
      });
    return () => a.abort();
  }, [base, id]);
  return (
    <Drawer open title="Chi tiết đề xuất chi" locked={busy} onClose={onClose}>
      {error && <Feedback tone="error">{error}</Feedback>}
      {!r && !error && <Loading />}
      {r && (
        <div className="finance-layout">
          <div className="finance-actions">
            <strong>{r.code}</strong>
            <Badge
              tone={
                r.state === "pending"
                  ? "warn"
                  : r.state === "approved" || r.state === "paid"
                    ? "good"
                    : "bad"
              }
            >
              {expenseStates[r.state]}
            </Badge>
          </div>
          <Stack space="compact">
            <p>Ngày gửi: {r.businessDate}</p>
            <p>
              Người gửi: {r.creatorName} · {roleLabels[r.creatorRole]}
            </p>
            <p>Quỹ: {r.fundName}</p>
            <p>Nội dung: {r.purpose}</p>
            <p>
              Số tiền: <strong>{vnd(r.amount)}</strong>
            </p>
            <p>
              Vai trò duyệt hiện tại:{" "}
              {r.currentApproverRole ? roleLabels[r.currentApproverRole] : "Chưa cấu hình"}
            </p>
          </Stack>
          {r.decision && (
            <Card spacing="content">
              <Stack space="compact">
                <p>
                  {r.decision.action === "approved" ? "Duyệt" : "Từ chối"}: {r.decision.actorName} ·{" "}
                  {roleLabels[r.decision.actorRole]}
                </p>
                <p>
                  {new Date(r.decision.decidedAt).toLocaleString("vi-VN", {
                    timeZone: "Asia/Ho_Chi_Minh",
                  })}
                </p>
                {r.decision.reason && <p>{r.decision.reason}</p>}
              </Stack>
            </Card>
          )}
          {r.state === "approved" && (
            <Feedback>Đã duyệt, đang chờ Thủ quỹ lập phiếu chi. Chưa giữ tiền.</Feedback>
          )}
          {r.payment && (
            <Card spacing="content">
              <p>
                {r.payment.code} · Ngày chi {r.payment.businessDate} ·{" "}
                {r.state === "payment_voided" ? "Phiếu chi đã hủy" : "Đã vào sổ"}
              </p>
              {r.canReadPayment && (
                <Button onClick={() => onViewPayment(r.payment?.id ?? "")}>
                  Xem {r.payment.code}
                </Button>
              )}
            </Card>
          )}
          {r.canPay && (
            <Button variant="primary" disabled={locked} onClick={() => onPay(r)}>
              Lập phiếu chi
            </Button>
          )}
          {r.state === "pending" && !r.canDecide && (
            <Feedback>Đang chờ người có quyền duyệt khác account người gửi.</Feedback>
          )}
          <div className="finance-actions">
            {r.canDecide && (
              <>
                <Button
                  variant="primary"
                  disabled={locked}
                  onClick={() => onDecision(r, "approved")}
                >
                  Duyệt
                </Button>
                <Button disabled={locked} onClick={() => onDecision(r, "rejected")}>
                  Từ chối
                </Button>
              </>
            )}
            <Button disabled={locked} onClick={() => setHistory(true)}>
              Lịch sử đề xuất
            </Button>
          </div>
        </div>
      )}
      {history && (
        <ProposalHistory base={base} id={id} onClose={() => setHistory(false)} fail={fail} />
      )}
    </Drawer>
  );
}
export function ExpensesView(props: Props) {
  const base = `churches/${props.churchId}/finance/expense-proposals`,
    [ctx, setCtx] = useState<(SettingsContext & { expense?: ExpenseContext }) | null>(null),
    [page, setPage] = useState<ExpensePage | null>(null),
    [error, setError] = useState(""),
    [lost, setLost] = useState(false),
    lostRef = useRef(false),
    [refresh, setRefresh] = useState(0),
    [contextRevision, setContextRevision] = useState(-1),
    [period, setPeriod] = useState(vnToday().slice(0, 7)),
    [state, setState] = useState("all"),
    [scope, setScope] = useState(""),
    [filterFund, setFilterFund] = useState<Fund | null>(null),
    [q, setQ] = useState(""),
    [search, setSearch] = useState(""),
    [stack, setStack] = useState<(string | null)[]>([null]),
    [picker, setPicker] = useState<"filter" | "create" | null>(null),
    [editor, setEditor] = useState(false),
    [fund, setFund] = useState<Fund | null>(null),
    [amount, setAmount] = useState(""),
    [purpose, setPurpose] = useState(""),
    [submission, setSubmission] = useState(""),
    [selected, setSelected] = useState<string | null>(null),
    [paying, setPaying] = useState<ExpenseDetail | null>(null),
    [paymentSelected, setPaymentSelected] = useState<string | null>(null),
    [paymentSubmission, setPaymentSubmission] = useState(""),
    [paymentPreview, setPaymentPreview] = useState<PaymentPreview | null>(null),
    [decision, setDecision] = useState<{
      proposal: ExpenseDetail;
      action: "approved" | "rejected";
    } | null>(null),
    [reason, setReason] = useState(""),
    [preview, setPreview] = useState<
      | { kind: "submit"; data: ExpenseSubmitPreview }
      | { kind: "decision"; data: ExpenseDecisionPreview }
      | null
    >(null),
    [previewBusy, setPreviewBusy] = useState(false),
    [reconcile, setReconcile] = useState(false);
  const paymentConfirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (paymentPreview && !previewBusy) paymentConfirmRef.current?.focus();
  }, [paymentPreview, previewBusy]);
  const draft = useRef<ExpenseDraft | null>(null),
    decisionBody = useRef<{ decision: "approved" | "rejected"; reason: string } | null>(null),
    access = ctx?.expense,
    canRead = !!access && (access.canReadAll || access.canReadOwn),
    ownPending = props.pending?.resource?.kind === "expense" ? props.pending : null;
  function fail(e: unknown) {
    if (
      e instanceof ApiError &&
      [...authErrorCodes, "FORBIDDEN", "CHURCH_SUSPENDED", "NOT_FOUND"].includes(e.code)
    ) {
      lostRef.current = true;
      setLost(true);
      setCtx(null);
      setPage(null);
      setSelected(null);
      setPaying(null);
      setPaymentSelected(null);
      setPaymentPreview(null);
      setEditor(false);
      setDecision(null);
      setPreview(null);
      setPicker(null);
      draft.current = null;
      decisionBody.current = null;
      if (["FORBIDDEN", "NOT_FOUND"].includes(e.code)) props.onPending(null);
      props.onAuthError(e);
    }
    setError(e instanceof Error ? e.message : "Không tải được đề xuất chi.");
  }
  const mutation = useTenantMutation({
    ...props,
    realm: "church",
    principalKey: `church_user:${ctx?.principal.accountId}:${props.churchId}:${ctx?.policyVersion}:${ctx?.principal.version}`,
    canWrite: !!access && (access.canSubmit || access.canDecide || access.canPay) && !lost,
    pending: props.pending,
    operationPath:
      ownPending?.resource?.kind === "expense" && ownPending.resource.action === "payment"
        ? `churches/${props.churchId}/finance/payments/operations`
        : `${base}/operations`,
    prefix: base,
    acceptPath: (p) =>
      p === base || new RegExp(`^${base}/[a-f0-9]{24}/(?:decision|payment)$`).test(p),
    intentResource: {
      kind: "expense",
      action: paying ? "payment" : decision ? "decision" : "submit",
    },
    onAuthError: fail,
    onAccessLoss: fail,
    onSuccess: (data) => {
      if (lostRef.current) return;
      const d = data as { proposalId: string };
      setSelected(d.proposalId);
      setEditor(false);
      setDecision(null);
      setPaying(null);
      setPaymentPreview(null);
      setPreview(null);
      setReconcile(false);
      setError("");
      setRefresh((n) => n + 1);
    },
  });
  const busy = mutation.busy || previewBusy,
    locked = busy || !!props.pending || lost,
    readLocked = busy || lost || (!!props.pending && !reconcile);
  useEffect(() => {
    const a = new AbortController();
    setPage(null);
    void churchRequest<SettingsContext & { expense?: ExpenseContext }>(
      `churches/${props.churchId}/context`,
      { signal: a.signal },
    )
      .then((r) => {
        if (a.signal.aborted || lostRef.current) return;
        if (!r.data.expense) {
          if (
            props.pending?.resource?.kind === "payment-void" &&
            r.data.capabilities.includes("finance:payments:read")
          )
            setPaymentSelected(props.pending.resource.paymentId);
          setCtx(r.data);
          setPage(null);
          setSelected(null);
          setPaying(null);
          setPaymentSelected(null);
          setPaymentPreview(null);
          setEditor(false);
          setDecision(null);
          setPreview(null);
          setContextRevision(refresh);
          props.onTitle("Đề xuất chi & Duyệt", `${r.data.church.name} · ${r.data.church.code}`);
          return;
        }
        if (
          ctx?.expense &&
          ((ctx.expense.canReadAll && !r.data.expense.canReadAll) ||
            (ctx.expense.canDecide && !r.data.expense.canDecide) ||
            (ctx.expense.canSubmit && !r.data.expense.canSubmit) ||
            (ctx.expense.canPay && !r.data.expense.canPay))
        ) {
          setSelected(null);
          setPaying(null);
          setPaymentSelected(null);
          setPaymentPreview(null);
          setEditor(false);
          setDecision(null);
          setPreview(null);
          draft.current = null;
          decisionBody.current = null;
        }
        setPage(null);
        setStack([null]);
        if (!r.data.expense.canReadAll) setScope("");
        if (
          props.pending?.resource?.kind === "payment-void" &&
          r.data.capabilities.includes("finance:payments:read")
        )
          setPaymentSelected(props.pending.resource.paymentId);
        setCtx(r.data);
        setContextRevision(refresh);
        props.onTitle("Đề xuất chi & Duyệt", `${r.data.church.name} · ${r.data.church.code}`);
        const p = props.pending;
        if (
          p?.resource?.kind === "expense" &&
          !(p.resource.action === "payment"
            ? r.data.expense.canPay
            : p.resource.action === "submit"
              ? r.data.expense.canSubmit
              : r.data.expense.canDecide)
        ) {
          props.onPending(null);
          setError(
            "Quyền thao tác đã thay đổi. Người có quyền cần đối soát kết quả trước khi tiếp tục.",
          );
        }
      })
      .catch((e) => {
        if (!a.signal.aborted) fail(e);
      });
    return () => a.abort();
  }, [props.churchId, refresh]);
  useEffect(() => {
    if (!canRead || !period || contextRevision !== refresh) return;
    const a = new AbortController(),
      p = new URLSearchParams({ period, state, q: search });
    if (scope) p.set("scope", scope);
    if (filterFund) p.set("fundId", filterFund.id);
    if (stack.at(-1)) p.set("cursor", stack.at(-1) as string);
    setPage(null);
    setError("");
    void churchRequest<ExpensePage>(`${base}?${p}`, { signal: a.signal })
      .then((r) => {
        if (!a.signal.aborted && !lostRef.current) setPage(r.data);
      })
      .catch((e) => {
        if (!a.signal.aborted) fail(e);
      });
    return () => a.abort();
  }, [base, canRead, period, state, search, scope, filterFund, stack, refresh, contextRevision]);
  function start() {
    setEditor(true);
    setFund(null);
    setAmount("");
    setPurpose("");
    setSubmission(crypto.randomUUID());
    setPreview(null);
    setError("");
    mutation.setError("");
  }
  async function previewSubmit() {
    if (locked || !fund) return;
    setPreviewBusy(true);
    setError("");
    const b = { submissionId: submission, fundId: fund.id, amount, purpose };
    try {
      const r = await churchRequest<ExpenseSubmitPreview>(`${base}/preview`, {
        method: "POST",
        body: b,
      });
      if (!lostRef.current) {
        draft.current = b;
        setPreview({ kind: "submit", data: r.data });
      }
    } catch (e) {
      fail(e);
    } finally {
      setPreviewBusy(false);
    }
  }
  async function previewDecision() {
    if (locked || !decision) return;
    setPreviewBusy(true);
    setError("");
    const b = { decision: decision.action, reason };
    try {
      const r = await churchRequest<ExpenseDecisionPreview>(
        `${base}/${decision.proposal.id}/preview`,
        { method: "POST", body: b, headers: { "If-Match": `"${decision.proposal.version}"` } },
      );
      if (!lostRef.current) {
        decisionBody.current = b;
        setPreview({ kind: "decision", data: r.data });
      }
    } catch (e) {
      fail(e);
    } finally {
      setPreviewBusy(false);
    }
  }
  return (
    <div className="finance-layout">
      {props.pending?.resource?.kind === "payment-void" &&
        !lost &&
        ctx?.capabilities.includes("finance:payments:read") && (
          <Button
            onClick={() => {
              const p = props.pending;
              if (p?.resource?.kind === "payment-void") setPaymentSelected(p.resource.paymentId);
            }}
          >
            Đối soát hủy phiếu chi
          </Button>
        )}
      {error && <Feedback tone="error">{error}</Feedback>}
      {mutation.error && <Feedback tone="error">{mutation.error}</Feedback>}
      {mutation.notice && <Feedback tone="success">{mutation.notice}</Feedback>}
      {!ctx && !error && !lost && <Loading />}
      {lost && <Button onClick={() => location.reload()}>Tải lại trang để kiểm tra quyền</Button>}
      {ctx && !canRead && (
        <Feedback>Vai trò hiện tại chưa được cấp quyền đề xuất hoặc duyệt chi.</Feedback>
      )}
      {canRead && (
        <>
          <Card spacing="content">
            <Stack space="compact">
              <p>Đề xuất → Duyệt → Phiếu chi → Vào sổ</p>
              <p>
                Vai trò duyệt hiện tại:{" "}
                {access?.approverRole ? roleLabels[access.approverRole] : "Chưa cấu hình"}
              </p>
            </Stack>
          </Card>
          {!access?.configured && (
            <Feedback>
              Chưa cấu hình vai trò gửi/duyệt. Mục sư thiết lập tại Cấu hình Hội Thánh.
            </Feedback>
          )}
          {ownPending && (
            <Card spacing="content">
              <Feedback>
                Thao tác chưa rõ kết quả. Đối soát trước khi gửi lại hoặc lập đề xuất mới.
              </Feedback>
              <div className="finance-actions">
                <Button disabled={busy} onClick={() => void mutation.execute(ownPending, true)}>
                  Kiểm tra kết quả / thử lại
                </Button>
                <Button disabled={busy} onClick={() => setReconcile(true)}>
                  Đối soát danh sách
                </Button>
              </div>
            </Card>
          )}
          {reconcile && (
            <Card spacing="content">
              <Feedback>
                Kiểm tra mã DX, ngày, quỹ, người gửi và nội dung trong Tất cả trạng thái. Chỉ bỏ
                intent sau khi đã đối soát.
              </Feedback>
              <Button
                disabled={busy}
                onClick={() => {
                  props.onPending(null);
                  setReconcile(false);
                  setEditor(false);
                  setDecision(null);
                  setPreview(null);
                }}
              >
                Đã đối soát, bỏ thao tác đang chờ
              </Button>
            </Card>
          )}
          <Toolbar>
            <Field label="Kỳ gửi">
              <TextInput
                type="month"
                value={period}
                disabled={readLocked}
                onChange={(e) => {
                  setPeriod(e.target.value);
                  setStack([null]);
                }}
              />
            </Field>
            <Button disabled={readLocked} onClick={() => setPicker("filter")}>
              {filterFund ? `Quỹ: ${filterFund.name}` : "Tất cả quỹ"}
            </Button>
            {filterFund && (
              <Button
                disabled={readLocked}
                onClick={() => {
                  setFilterFund(null);
                  setStack([null]);
                }}
              >
                Bỏ lọc quỹ
              </Button>
            )}
            <Field label="Trạng thái">
              <Select
                value={state}
                disabled={readLocked}
                onChange={(e) => {
                  setState(e.target.value);
                  setStack([null]);
                }}
              >
                <option value="all">Tất cả</option>
                <option value="pending">Chờ duyệt</option>
                <option value="approved">Đã duyệt, chờ chi</option>
                <option value="paid">Đã chi</option>
                <option value="payment_voided">Phiếu chi đã hủy</option>
                <option value="rejected">Từ chối</option>
              </Select>
            </Field>
            {access?.canReadAll ? (
              <Field label="Phạm vi">
                <Select
                  value={scope || "all"}
                  disabled={readLocked}
                  onChange={(e) => {
                    setScope(e.target.value);
                    setStack([null]);
                  }}
                >
                  <option value="all">Toàn bộ đề xuất</option>
                  <option value="mine">Của mình</option>
                </Select>
              </Field>
            ) : (
              <Badge>Của mình</Badge>
            )}
          </Toolbar>
          <div className="grid g4">
            {(["pending", "approved", "paid", "rejected"] as const).map((s) => (
              <Card
                key={s}
                className="kpi"
                aria-label={`${expenseStates[s]}: ${page?.summary[s]?.count ?? "Chưa có số liệu"}`}
              >
                <div className="lbl">{expenseStates[s]}</div>
                <div className="big num">{page?.summary[s]?.count ?? "—"}</div>
                <div className="foot num">
                  <span className="expense-total">
                    Tổng <b>{page ? vnd(page.summary[s]?.total ?? "0") : "—"}</b>
                  </span>
                </div>
                {s === "paid" && (
                  <p className="small muted">
                    Phiếu đã hủy: {page?.summary.payment_voided?.count ?? "—"} ·{" "}
                    {page ? vnd(page.summary.payment_voided?.total ?? "0") : "—"}
                  </p>
                )}
              </Card>
            ))}
          </div>
          <p className="muted">
            KPI theo kỳ/quỹ/phạm vi xem. Trạng thái và mã DX chỉ lọc bảng; duyệt chưa ghi sổ hoặc
            giữ tiền.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setSearch(q);
              setStack([null]);
            }}
          >
            <Toolbar>
              <Field label="Mã DX">
                <TextInput
                  value={q}
                  maxLength={100}
                  disabled={readLocked}
                  onChange={(e) => setQ(e.target.value)}
                />
              </Field>
              <Button type="submit" disabled={readLocked}>
                Tìm
              </Button>
              <Button disabled={readLocked} onClick={() => setRefresh((n) => n + 1)}>
                Tải lại
              </Button>
              {access?.canSubmit && (
                <IconButton icon="plus" label="Tạo đề xuất chi" disabled={locked} onClick={start} />
              )}
            </Toolbar>
          </form>
          <Feedback>
            Sau hard reload, tìm đề xuất đã gửi trong đúng kỳ/phạm vi trước khi tạo ý định mới.
          </Feedback>
          {!page && !error && <Loading />}
          {page?.items.length === 0 && (
            <EmptyState message="Chưa có đề xuất trong phạm vi đã chọn." />
          )}
          {page && (
            <>
              <TableFrame label="Đề xuất chi">
                <table>
                  <thead>
                    <tr>
                      <th>Mã DX</th>
                      <th>Ngày</th>
                      <th>Người gửi</th>
                      <th>Quỹ</th>
                      <th>Nội dung</th>
                      <th>Số tiền</th>
                      <th>Trạng thái</th>
                      <th>Thao tác</th>
                    </tr>
                  </thead>
                  <tbody>
                    {page.items.map((r) => (
                      <tr key={r.id}>
                        <td>{r.code}</td>
                        <td>{r.businessDate}</td>
                        <td>
                          {r.creatorName}
                          <br />
                          {roleLabels[r.creatorRole]}
                        </td>
                        <td>{r.fundName}</td>
                        <td>{r.purpose}</td>
                        <td>{vnd(r.amount)}</td>
                        <td>
                          <Badge
                            tone={
                              r.state === "pending"
                                ? "warn"
                                : r.state === "approved" || r.state === "paid"
                                  ? "good"
                                  : "bad"
                            }
                          >
                            {expenseStates[r.state]}
                          </Badge>
                        </td>
                        <td>
                          <Button disabled={readLocked} onClick={() => setSelected(r.id)}>
                            Xem {r.code}
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableFrame>
              <Pager
                stack={stack}
                next={page.nextCursor}
                disabled={readLocked}
                onChange={setStack}
              />
            </>
          )}
        </>
      )}
      {editor && !lost && (
        <Modal
          open
          title={preview?.kind === "submit" ? "Xác nhận gửi đề xuất" : "Tạo đề xuất chi"}
          locked={busy}
          onClose={() => {
            setEditor(false);
            setPreview(null);
          }}
        >
          {error && <Feedback tone="error">{error}</Feedback>}
          {mutation.error && <Feedback tone="error">{mutation.error}</Feedback>}
          {preview?.kind === "submit" ? (
            <>
              <Stack space="compact">
                <p>
                  Ngày gửi: {preview.data.businessDate} · {preview.data.creatorName}
                </p>
                <p>Quỹ: {preview.data.fundName}</p>
                <p>Nội dung: {preview.data.purpose}</p>
                <p>
                  Số tiền: <strong>{vnd(preview.data.amount)}</strong>
                </p>
                <p>Vai trò duyệt: {roleLabels[preview.data.approverRole]}</p>
              </Stack>
              <Feedback>
                Đề xuất sẽ ở trạng thái Chờ duyệt. Không tự duyệt kể cả account này có role duyệt.
              </Feedback>
              <DialogActions>
                <Button disabled={locked} onClick={() => setPreview(null)}>
                  Quay lại
                </Button>
                <Button
                  variant="primary"
                  disabled={locked}
                  onClick={() =>
                    mutation.send(base, "POST", {
                      proposal: draft.current,
                      previewToken: preview.data.previewToken,
                    })
                  }
                >
                  Xác nhận gửi
                </Button>
              </DialogActions>
            </>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void previewSubmit();
              }}
            >
              <div className="finance-layout">
                <Button disabled={locked} onClick={() => setPicker("create")}>
                  {fund ? `Chi từ quỹ: ${fund.name}` : "Chọn quỹ chi"}
                </Button>
                <Field label="Số tiền VND">
                  <TextInput
                    required
                    inputMode="numeric"
                    pattern="[1-9][0-9]{0,17}"
                    maxLength={18}
                    value={amount}
                    disabled={locked}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                </Field>
                <Field label="Nội dung chi">
                  <TextArea
                    required
                    maxLength={500}
                    value={purpose}
                    disabled={locked}
                    onChange={(e) => setPurpose(e.target.value)}
                  />
                </Field>
                <p>
                  Người gửi: account hiện tại · Vai trò duyệt:{" "}
                  {access?.approverRole ? roleLabels[access.approverRole] : "Chưa cấu hình"}
                </p>
                <DialogActions>
                  <Button disabled={locked} onClick={() => setEditor(false)}>
                    Hủy
                  </Button>
                  <Button type="submit" variant="primary" disabled={locked || !fund}>
                    Xem trước
                  </Button>
                </DialogActions>
              </div>
            </form>
          )}
        </Modal>
      )}
      {selected && !lost && (
        <ProposalDrawer
          key={`${selected}:${refresh}`}
          base={base}
          id={selected}
          onPay={(r) => {
            setSelected(null);
            setPaying(r);
            setPaymentSubmission(crypto.randomUUID());
            setPaymentPreview(null);
            setError("");
          }}
          onViewPayment={(id) => {
            setSelected(null);
            setPaymentSelected(id);
          }}
          onClose={() => setSelected(null)}
          fail={fail}
          busy={busy}
          locked={locked}
          onDecision={(proposal, action) => {
            setDecision({ proposal, action });
            setReason("");
            setPreview(null);
            setError("");
            mutation.setError("");
          }}
        />
      )}
      {decision && !lost && (
        <Modal
          open
          title={
            preview?.kind === "decision"
              ? "Xác nhận quyết định"
              : decision.action === "approved"
                ? "Duyệt đề xuất"
                : "Từ chối đề xuất"
          }
          locked={busy}
          onClose={() => {
            setDecision(null);
            setPreview(null);
          }}
        >
          {error && <Feedback tone="error">{error}</Feedback>}
          {mutation.error && <Feedback tone="error">{mutation.error}</Feedback>}
          {preview?.kind === "decision" ? (
            <>
              <Stack space="compact">
                <p>
                  {preview.data.proposal.code} · {preview.data.proposal.creatorName}
                </p>
                <p>Quỹ theo đề xuất: {preview.data.proposal.fundName}</p>
              </Stack>
              {preview.data.currentFundName !== preview.data.proposal.fundName && (
                <Feedback>
                  Tên quỹ hiện tại: {preview.data.currentFundName}. Snapshot đề xuất được giữ
                  nguyên.
                </Feedback>
              )}
              <Stack space="compact">
                <p>
                  {preview.data.proposal.purpose} ·{" "}
                  <strong>{vnd(preview.data.proposal.amount)}</strong>
                </p>
                <p>Quyết định: {preview.data.decision === "approved" ? "Duyệt" : "Từ chối"}</p>
                {preview.data.reason && <p>{preview.data.reason}</p>}
              </Stack>
              <Feedback>
                Quyết định được giữ lịch sử. Duyệt chỉ chuyển sang chờ chi, chưa tạo phiếu hoặc ghi
                sổ.
              </Feedback>
              <DialogActions>
                <Button disabled={locked} onClick={() => setPreview(null)}>
                  Quay lại
                </Button>
                <Button
                  variant="primary"
                  disabled={locked}
                  onClick={() =>
                    mutation.send(
                      `${base}/${decision.proposal.id}/decision`,
                      "POST",
                      { decision: decisionBody.current, previewToken: preview.data.previewToken },
                      decision.proposal.version,
                    )
                  }
                >
                  Xác nhận quyết định
                </Button>
              </DialogActions>
            </>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void previewDecision();
              }}
            >
              <p>
                {decision.proposal.code} · {vnd(decision.proposal.amount)}
              </p>
              <Field
                label={decision.action === "rejected" ? "Lý do từ chối" : "Ghi chú duyệt"}
                optional={decision.action === "approved"}
              >
                <TextArea
                  required={decision.action === "rejected"}
                  maxLength={500}
                  value={reason}
                  disabled={locked}
                  onChange={(e) => setReason(e.target.value)}
                />
              </Field>
              <DialogActions>
                <Button type="submit" variant="primary" disabled={locked}>
                  Xem trước
                </Button>
              </DialogActions>
            </form>
          )}
        </Modal>
      )}
      {paymentSelected && !lost && (
        <PaymentDetail
          churchId={props.churchId}
          id={paymentSelected}
          pending={props.pending}
          onPending={props.onPending}
          onChanged={() => setRefresh((n) => n + 1)}
          onClose={() => setPaymentSelected(null)}
          fail={fail}
        />
      )}
      {paying && !lost && (
        <Modal
          open
          title="Lập phiếu chi"
          locked={busy}
          onClose={() => {
            setPaying(null);
            setPaymentPreview(null);
          }}
        >
          {error && <Feedback tone="error">{error}</Feedback>}
          {mutation.error && <Feedback tone="error">{mutation.error}</Feedback>}
          <p>
            Đề xuất {paying.code} · Người duyệt {paying.decision?.actorName}
          </p>
          {paying.decision && (
            <p>
              Thời điểm duyệt:{" "}
              {new Date(paying.decision.decidedAt).toLocaleString("vi-VN", {
                timeZone: "Asia/Ho_Chi_Minh",
              })}
            </p>
          )}
          <Stack space="compact">
            <p>Quỹ: {paymentPreview?.currentFundName ?? paying.fundName}</p>
            <p>Nội dung: {paying.purpose}</p>
            <p>
              Số tiền: <strong>{vnd(paying.amount)}</strong>
            </p>
            <p>Ngày chi: {paymentPreview?.businessDate ?? vnToday()} (Việt Nam)</p>
          </Stack>
          {paymentPreview ? (
            <>
              <p>
                Số dư sổ hiện tại: {vnd(paymentPreview.balance)} → Sau chi:{" "}
                {vnd(paymentPreview.balanceAfter)}
              </p>
              <Feedback>Xác nhận ghi một phiếu chi và vào sổ. Đây là số dư sổ hệ thống.</Feedback>
              <DialogActions>
                <Button disabled={locked} onClick={() => setPaymentPreview(null)}>
                  Quay lại
                </Button>
                <Button
                  ref={paymentConfirmRef}
                  variant="primary"
                  disabled={locked}
                  onClick={() =>
                    mutation.send(
                      `${base}/${paying.id}/payment`,
                      "POST",
                      {
                        payment: { submissionId: paymentSubmission },
                        previewToken: paymentPreview.previewToken,
                        confirmed: true,
                      },
                      paying.version,
                    )
                  }
                >
                  Xác nhận lập phiếu chi
                </Button>
              </DialogActions>
            </>
          ) : (
            <DialogActions>
              <Button
                disabled={busy}
                onClick={() => {
                  setPaying(null);
                  setPaymentPreview(null);
                }}
              >
                Hủy
              </Button>
              <Button
                disabled={locked}
                onClick={() => {
                  setPreviewBusy(true);
                  setError("");
                  mutation.setError("");
                  void churchRequest<PaymentPreview>(`${base}/${paying.id}/payment-preview`, {
                    method: "POST",
                    body: { submissionId: paymentSubmission },
                    headers: { "If-Match": `"${paying.version}"` },
                  })
                    .then((r) => {
                      if (!lostRef.current) setPaymentPreview(r.data);
                    })
                    .catch(fail)
                    .finally(() => setPreviewBusy(false));
                }}
              >
                Xem trước
              </Button>
            </DialogActions>
          )}
        </Modal>
      )}
      {picker && !lost && (
        <FundPicker
          base={base}
          onClose={() => setPicker(null)}
          fail={fail}
          onSelect={(f) => {
            if (picker === "filter") {
              setFilterFund(f);
              setStack([null]);
            } else setFund(f);
            setPicker(null);
          }}
        />
      )}
    </div>
  );
}
