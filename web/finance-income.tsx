import { useEffect, useRef, useState } from "react";
import type { ReceiptInput } from "../api/finance/transactions-validation";
import { ApiError, churchRequest } from "./api";
import type { SettingsContext } from "./church-settings";
import type { FundPage } from "./finance-api";
import {
  type Giving,
  type GivingPage,
  type IncomePage,
  type LedgerRow,
  type MemberSource,
  type Preview,
  type ReceiptDetail,
  type TransactionHistory,
  vnd,
  vnToday,
} from "./finance-income-api";
import { PaymentDetail } from "./finance-payments";
import { PeriodPanel } from "./finance-periods";
import { FinanceSummaryView } from "./finance-summary";
import { authErrorCodes, type TenantIntent, useTenantMutation } from "./tenant-mutation";
import {
  Badge,
  Button,
  Card,
  Choice,
  DialogActions,
  Drawer,
  EmptyState,
  Feedback,
  Field,
  Loading,
  Modal,
  SectionHeader,
  Select,
  Stack,
  TableFrame,
  TextArea,
  TextInput,
  Toolbar,
} from "./ui/components";
import "./finance.css";
interface Common {
  churchId: string;
  pending: TenantIntent | null;
  onPending: (p: TenantIntent | null) => void;
  onAuthError: (e: unknown) => void;
}
type PickerRow = { id: string; label: string };
function Pages({
  stack,
  next,
  locked,
  setStack,
}: {
  stack: (string | null)[];
  next: string | null;
  locked: boolean;
  setStack: (s: (string | null)[]) => void;
}) {
  return (
    <div className="finance-actions">
      <Button disabled={locked || stack.length === 1} onClick={() => setStack(stack.slice(0, -1))}>
        Trước
      </Button>
      <Button disabled={locked || !next} onClick={() => setStack([...stack, next])}>
        Tiếp
      </Button>
    </div>
  );
}
function SourcePicker({
  base,
  kind,
  onPick,
  onClose,
  fail,
}: {
  base: string;
  kind: "funds" | "giving-codes" | "member-options";
  onPick: (r: PickerRow) => void;
  onClose: () => void;
  fail: (e: unknown) => void;
}) {
  const [q, setQ] = useState(""),
    [search, setSearch] = useState(""),
    [stack, setStack] = useState<(string | null)[]>([null]),
    [page, setPage] = useState<{ items: PickerRow[]; nextCursor: string | null } | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    const a = new AbortController(),
      p = new URLSearchParams({ q: search });
    if (kind !== "member-options") p.set("status", "active");
    if (stack.at(-1)) p.set("cursor", stack.at(-1) as string);
    setPage(null);
    setError("");
    void churchRequest<
      FundPage | GivingPage | { items: MemberSource[]; nextCursor: string | null }
    >(`${base}/${kind}?${p}`, { signal: a.signal })
      .then((r) => {
        if (!a.signal.aborted)
          setPage({
            nextCursor: r.data.nextCursor,
            items: r.data.items.map((i) => ({
              id: i.id,
              label:
                "memberName" in i
                  ? `${i.code} · ${i.memberName} · ${i.memberCode}`
                  : "name" in i
                    ? `${"code" in i ? `${i.code} · ` : ""}${i.name}`
                    : "",
            })),
          });
      })
      .catch((e) => {
        if (!a.signal.aborted) {
          setError(e instanceof Error ? e.message : "Không tải được nguồn.");
          fail(e);
        }
      });
    return () => a.abort();
  }, [base, kind, search, stack]);
  return (
    <Modal
      open
      title={
        kind === "funds"
          ? "Chọn quỹ"
          : kind === "giving-codes"
            ? "Chọn mã dâng hiến"
            : "Chọn người hiện hành"
      }
      onClose={onClose}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setSearch(q);
          setStack([null]);
        }}
      >
        <Toolbar>
          <Field label="Tìm nguồn">
            <TextInput value={q} maxLength={100} onChange={(e) => setQ(e.target.value)} />
          </Field>
          <Button type="submit">Tìm</Button>
        </Toolbar>
      </form>
      {error && <Feedback tone="error">{error}</Feedback>}
      {!page && !error ? (
        <Loading />
      ) : page?.items.length === 0 ? (
        <EmptyState message="Không có nguồn phù hợp." />
      ) : (
        page?.items.map((r) => (
          <div className="finance-actions" key={r.id}>
            <Button onClick={() => onPick(r)}>{r.label}</Button>
          </div>
        ))
      )}
      <Pages stack={stack} next={page?.nextCursor ?? null} locked={!page} setStack={setStack} />
    </Modal>
  );
}
function History({
  base,
  path,
  onClose,
  fail,
}: {
  base: string;
  path: string;
  onClose: () => void;
  fail: (e: unknown) => void;
}) {
  const [page, setPage] = useState<TransactionHistory | null>(null),
    [stack, setStack] = useState<(string | null)[]>([null]),
    [error, setError] = useState("");
  useEffect(() => {
    const a = new AbortController(),
      p = new URLSearchParams();
    if (stack.at(-1)) p.set("cursor", stack.at(-1) as string);
    setPage(null);
    void churchRequest<TransactionHistory>(`${base}/${path}/history?${p}`, { signal: a.signal })
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
  }, [base, path, stack]);
  return (
    <Modal open title="Lịch sử tài chính" onClose={onClose}>
      {error && <Feedback tone="error">{error}</Feedback>}
      {!page && !error ? (
        <Loading />
      ) : (
        page?.items.map((h) => (
          <Card spacing="content" key={h.id}>
            <Stack space="compact">
              <p>
                {(
                  {
                    created: "Cấp mã",
                    status_changed: "Đổi trạng thái",
                    posted: "Ghi thu",
                    voided: "Hủy phiếu",
                  } as Record<string, string>
                )[h.event] ?? h.event}{" "}
                · {h.actorName} · {new Date(h.occurredAt).toLocaleString("vi-VN")}
              </p>
              {h.reason && <p>{h.reason}</p>}
            </Stack>
          </Card>
        ))
      )}
      <Pages stack={stack} next={page?.nextCursor ?? null} locked={!page} setStack={setStack} />
    </Modal>
  );
}
export function MemberGiving({
  churchId,
  memberId,
  onAuthError,
}: {
  churchId: string;
  memberId: string;
  onAuthError: (e: unknown) => void;
}) {
  const base = `churches/${churchId}/finance`,
    [codes, setCodes] = useState<GivingPage | null>(null),
    [period, setPeriod] = useState(vnToday().slice(0, 7)),
    [page, setPage] = useState<IncomePage | null>(null),
    [stack, setStack] = useState<(string | null)[]>([null]),
    [error, setError] = useState(""),
    [selected, setSelected] = useState<string | null>(null),
    [history, setHistory] = useState<string | null>(null),
    lost = useRef(false);
  function fail(e: unknown) {
    if (
      e instanceof ApiError &&
      [...authErrorCodes, "FORBIDDEN", "CHURCH_SUSPENDED"].includes(e.code)
    ) {
      lost.current = true;
      setCodes(null);
      setPage(null);
      setSelected(null);

      setHistory(null);
      onAuthError(e);
    }
    setError(e instanceof Error ? e.message : "Không tải được dâng hiến.");
  }
  useEffect(() => {
    const a = new AbortController();
    void churchRequest<GivingPage>(`${base}/giving-codes?status=all&memberId=${memberId}`, {
      signal: a.signal,
    })
      .then((r) => {
        if (!a.signal.aborted && !lost.current) setCodes(r.data);
      })
      .catch((e) => {
        if (!a.signal.aborted) fail(e);
      });
    return () => a.abort();
  }, [base, memberId]);
  const code = codes?.items[0];
  useEffect(() => {
    if (!code) return;
    const a = new AbortController(),
      p = new URLSearchParams({ period, givingId: code.id, state: "all" });
    if (stack.at(-1)) p.set("cursor", stack.at(-1) as string);
    setPage(null);
    void churchRequest<IncomePage>(`${base}/receipts?${p}`, { signal: a.signal })
      .then((r) => {
        if (!a.signal.aborted && !lost.current) setPage(r.data);
      })
      .catch((e) => {
        if (!a.signal.aborted) fail(e);
      });
    return () => a.abort();
  }, [base, code?.id, period, stack]);
  return (
    <div className="finance-layout">
      <SectionHeader title="Dâng hiến" />
      {error && <Feedback tone="error">{error}</Feedback>}
      {codes && !code && <p className="muted">Chưa cấp mã dâng hiến.</p>}
      {code && (
        <>
          <p>
            {code.memberName} · {code.memberCode} · {code.code} ·{" "}
            {code.status === "active" ? "Đang dùng" : "Đã ngừng"}
          </p>
          <Field label="Kỳ dâng hiến">
            <TextInput
              type="month"
              value={period}
              onChange={(e) => {
                setPeriod(e.target.value);
                setStack([null]);
              }}
            />
          </Field>
          {page?.items.length === 0 && <EmptyState message="Chưa có dâng hiến trong kỳ." />}
          {page?.items.map((r) => (
            <Card spacing="content" key={r.id}>
              <Stack space="compact">
                <p>
                  {r.businessDate} · {r.code} · {r.fundName}
                </p>
                <p>
                  {vnd(r.contribution ?? "0")} · {r.state === "posted" ? "Có hiệu lực" : "Đã hủy"}
                </p>
              </Stack>
              <Button onClick={() => setSelected(r.id)}>Xem phiếu {r.code}</Button>
            </Card>
          ))}
          <Pages stack={stack} next={page?.nextCursor ?? null} locked={!page} setStack={setStack} />
          <Button onClick={() => setHistory(`giving-codes/${code.id}`)}>Lịch sử mã</Button>
        </>
      )}
      {selected && (
        <ReceiptView
          base={base}
          id={selected}
          canWrite={false}
          locked={false}
          fail={fail}
          onClose={() => setSelected(null)}
          onVoid={() => {}}
        />
      )}
      {history && (
        <History base={base} path={history} onClose={() => setHistory(null)} fail={fail} />
      )}
    </div>
  );
}
function ReceiptView({
  base,
  id,
  canWrite,
  locked,
  fail,
  onClose,
  onVoid,
}: {
  base: string;
  id: string;
  canWrite: boolean;
  locked: boolean;
  fail: (e: unknown) => void;
  onClose: () => void;
  onVoid: (r: ReceiptDetail) => void;
}) {
  const [r, setR] = useState<ReceiptDetail | null>(null),
    [history, setHistory] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    const a = new AbortController();
    void churchRequest<ReceiptDetail>(`${base}/receipts/${id}`, { signal: a.signal })
      .then((x) => {
        if (!a.signal.aborted) setR(x.data);
      })
      .catch((e) => {
        if (!a.signal.aborted) {
          setError(e instanceof Error ? e.message : "Không tải được phiếu.");
          fail(e);
        }
      });
    return () => a.abort();
  }, [base, id]);
  return (
    <Drawer open title="Chi tiết phiếu thu" onClose={onClose} locked={locked}>
      {error && <Feedback tone="error">{error}</Feedback>}
      {!r && !error && <Loading />}
      {r && (
        <>
          <SectionHeader title={r.code}>
            <Badge tone={r.state === "posted" ? "good" : "bad"}>
              {r.state === "posted" ? "Có hiệu lực" : "Đã hủy"}
            </Badge>
          </SectionHeader>
          <Stack space="compact">
            <p>
              Ngày {r.businessDate} · {r.fundName}
            </p>
            <p>Nguồn: {r.sourceReference}</p>
            <p>{r.purpose}</p>
            <p>
              Tổng thu: <strong>{vnd(r.total)}</strong>
            </p>
          </Stack>
          {r.mode === "aggregate" ? (
            <p>Thu tổng hợp, không gắn cá nhân.</p>
          ) : (
            r.lines.map((l, i) => (
              <p key={`${l.givingId}-${i}`}>
                {l.givingCode} · {l.memberName} · {vnd(l.amount)}
              </p>
            ))
          )}
          {r.voidReason && (
            <Feedback>
              Hủy: {r.voidReason} · {r.voidedAt && new Date(r.voidedAt).toLocaleString("vi-VN")}
            </Feedback>
          )}
          {r.replacesReceiptId && <p>Thay cho phiếu: {r.replacesReceiptId}</p>}
          <div className="finance-actions">
            <Button disabled={locked} onClick={() => setHistory(true)}>
              Lịch sử phiếu
            </Button>
            {canWrite && r.canVoid && (
              <Button variant="danger" disabled={locked} onClick={() => onVoid(r)}>
                Hủy phiếu nhập sai
              </Button>
            )}
          </div>
          {!r.canVoid && canWrite && r.state === "posted" && (
            <Feedback>Kỳ gốc đã đóng; không thể hủy trong P5.2.</Feedback>
          )}
        </>
      )}
      {history && (
        <History
          base={base}
          path={`receipts/${id}`}
          onClose={() => setHistory(false)}
          fail={fail}
        />
      )}
    </Drawer>
  );
}
export function FinanceIncomeView(
  props: Common & { onTitle: (title: string, context?: string) => void; onConfig: () => void },
) {
  const base = `churches/${props.churchId}/finance`,
    [ctx, setCtx] = useState<SettingsContext | null>(null),
    [error, setError] = useState(""),
    [lost, setLost] = useState(false),
    lostRef = useRef(false),
    [refresh, setRefresh] = useState(0),
    [page, setPage] = useState<IncomePage | null>(null),
    [paymentSelected, setPaymentSelected] = useState<string | null>(null),
    [kind, setKind] = useState("all"),
    [ledger, setLedger] = useState<IncomePage<LedgerRow> | null>(null),
    [tab, setTab] = useState("receipts"),
    [period, setPeriod] = useState(vnToday().slice(0, 7)),
    [fund, setFund] = useState<PickerRow | null>(null),
    [state, setState] = useState("posted"),
    [q, setQ] = useState(""),
    [search, setSearch] = useState(""),
    [stack, setStack] = useState<(string | null)[]>([null]),
    [picker, setPicker] = useState<"filter" | "fund" | "giving" | "member" | null>(null),
    [codesOpen, setCodesOpen] = useState(false),
    [codes, setCodes] = useState<GivingPage | null>(null),
    [codeStatus, setCodeStatus] = useState("active"),
    [codeQ, setCodeQ] = useState(""),
    [codeSearch, setCodeSearch] = useState(""),
    [codeStack, setCodeStack] = useState<(string | null)[]>([null]),
    [codeChange, setCodeChange] = useState<Giving | null>(null),
    [reason, setReason] = useState(""),
    [personal, setPersonal] = useState<Giving | null>(null),
    [history, setHistory] = useState<string | null>(null),
    [selected, setSelected] = useState<string | null>(null),
    [voiding, setVoiding] = useState<ReceiptDetail | null>(null),
    [confirmed, setConfirmed] = useState(false),
    [editor, setEditor] = useState(false),
    [preview, setPreview] = useState<Preview | null>(null),
    [previewBusy, setPreviewBusy] = useState(false),
    [editFund, setEditFund] = useState<PickerRow | null>(null),
    [day, setDay] = useState(vnToday()),
    [source, setSource] = useState(""),
    [purpose, setPurpose] = useState(""),
    [replacement, setReplacement] = useState(""),
    [mode, setMode] = useState<"aggregate" | "itemized">("aggregate"),
    [amount, setAmount] = useState(""),
    [lines, setLines] = useState<{ id: string; label: string; amount: string }[]>([]),
    [submission, setSubmission] = useState(""),
    [reconcile, setReconcile] = useState(false);
  const intentBody = useRef<ReceiptInput | null>(null),
    canRead = !!ctx?.capabilities.includes("finance:receipts:read"),
    canWrite = !!ctx?.capabilities.includes("finance:receipts:manage");
  function fail(e: unknown) {
    if (
      e instanceof ApiError &&
      [...authErrorCodes, "FORBIDDEN", "CHURCH_SUSPENDED"].includes(e.code)
    ) {
      lostRef.current = true;
      setLost(true);
      setCtx(null);
      setPage(null);
      setLedger(null);
      setCodes(null);
      setEditor(false);
      setPreview(null);
      setPersonal(null);
      setSelected(null);
      setPaymentSelected(null);
      setHistory(null);
      setPicker(null);
      setVoiding(null);
      setCodeChange(null);
      intentBody.current = null;
      props.onAuthError(e);
    }
    setError(e instanceof Error ? e.message : "Không tải được tài chính.");
  }
  const mutation = useTenantMutation({
    ...props,
    realm: "church",
    principalKey: `church_user:${ctx?.principal.accountId}:${props.churchId}:${ctx?.policyVersion}:${ctx?.principal.version}`,
    canWrite: canWrite && !lost,
    pending: props.pending,
    operationPath: `${base}/operations`,
    prefix: base,
    acceptPath: (p) =>
      p === `${base}/receipts` ||
      p.startsWith(`${base}/receipts/`) ||
      p === `${base}/giving-codes` ||
      p.startsWith(`${base}/giving-codes/`),
    intentResource: { kind: "finance-income" },
    onAuthError: fail,
    onAccessLoss: fail,
    onSuccess: (data) => {
      if (lostRef.current) return;
      const d = data as { receiptId?: string };
      setEditor(false);
      setPreview(null);
      setVoiding(null);
      setCodeChange(null);
      setReason("");
      setConfirmed(false);
      setReconcile(false);
      if (d.receiptId) setSelected(d.receiptId);
      setRefresh((n) => n + 1);
    },
  });
  const locked = mutation.busy || !!props.pending || lost || previewBusy,
    readLocked = mutation.busy || previewBusy || lost || (!!props.pending && !reconcile),
    ownPending = props.pending?.resource?.kind === "finance-income" ? props.pending : null;
  useEffect(() => {
    const a = new AbortController();
    void churchRequest<SettingsContext>(`churches/${props.churchId}/context`, { signal: a.signal })
      .then((r) => {
        if (a.signal.aborted || lostRef.current) return;
        if (
          props.pending?.resource?.kind === "payment-void" &&
          r.data.capabilities.includes("finance:payments:read")
        )
          setPaymentSelected(props.pending.resource.paymentId);
        if (props.pending?.resource?.kind === "finance-periods")
          setPeriod(props.pending.resource.period);
        setCtx(r.data);
        props.onTitle("Dâng hiến & Quỹ", `${r.data.church.name} · ${r.data.church.code}`);
        if (!r.data.capabilities.includes("finance:receipts:read"))
          fail(new ApiError("FORBIDDEN", "Không có quyền xem tài chính."));
      })
      .catch((e) => {
        if (!a.signal.aborted) fail(e);
      });
    return () => a.abort();
  }, [props.churchId]);
  useEffect(() => {
    if (!canRead || !period) return;
    const a = new AbortController(),
      p = new URLSearchParams({ period });
    if (fund) p.set("fundId", fund.id);
    if (tab === "receipts") p.set("state", state);
    else p.set("kind", kind);
    p.set("q", search);
    if (stack.at(-1)) p.set("cursor", stack.at(-1) as string);
    setPage(null);
    setLedger(null);
    setError("");
    void churchRequest<IncomePage & IncomePage<LedgerRow>>(`${base}/${tab}?${p}`, {
      signal: a.signal,
    })
      .then((r) => {
        if (a.signal.aborted || lostRef.current) return;
        if (tab === "ledger") setLedger(r.data);
        else setPage(r.data);
      })
      .catch((e) => {
        if (!a.signal.aborted) fail(e);
      });
    return () => a.abort();
  }, [base, canRead, tab, period, fund, state, search, stack, refresh, kind]);
  useEffect(() => {
    if (!canRead || !codesOpen) return;
    const a = new AbortController(),
      p = new URLSearchParams({ status: codeStatus, q: codeSearch });
    if (codeStack.at(-1)) p.set("cursor", codeStack.at(-1) as string);
    setCodes(null);
    void churchRequest<GivingPage>(`${base}/giving-codes?${p}`, { signal: a.signal })
      .then((r) => {
        if (!a.signal.aborted && !lostRef.current) setCodes(r.data);
      })
      .catch((e) => {
        if (!a.signal.aborted) fail(e);
      });
    return () => a.abort();
  }, [base, canRead, codesOpen, codeStatus, codeSearch, codeStack, refresh]);
  function start() {
    setEditor(true);
    setEditFund(null);
    setDay(vnToday());
    setSource("");
    setPurpose("");
    setReplacement("");
    setMode("aggregate");
    setAmount("");
    setLines([]);
    setSubmission(crypto.randomUUID());
    setPreview(null);
    mutation.setError("");
    setError("");
  }
  async function doPreview() {
    if (locked || !editFund) return;
    setPreviewBusy(true);
    setError("");
    const common = {
        submissionId: submission,
        businessDate: day,
        fundId: editFund.id,
        sourceReference: source,
        purpose,
        replacesReceiptId: replacement || null,
      },
      body: ReceiptInput =
        mode === "aggregate"
          ? { ...common, mode, amount }
          : { ...common, mode, lines: lines.map((l) => ({ givingId: l.id, amount: l.amount })) };
    try {
      const r = await churchRequest<Preview>(`${base}/receipts/preview`, { method: "POST", body });
      if (!lostRef.current) {
        intentBody.current = body;
        setPreview(r.data);
      }
    } catch (e) {
      fail(e);
    } finally {
      setPreviewBusy(false);
    }
  }
  function picked(r: PickerRow) {
    if (picker === "filter") {
      setFund(r);
      setStack([null]);
    }
    if (picker === "fund") setEditFund(r);
    if (picker === "giving") setLines([...lines, { id: r.id, label: r.label, amount: "" }]);
    if (picker === "member") mutation.send(`${base}/giving-codes`, "POST", { memberId: r.id });
    setPicker(null);
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
      {!ctx && !error && <Loading />}
      {canRead && (
        <>
          <div className="finance-actions">
            <Button disabled={locked} onClick={props.onConfig}>
              Quỹ & cấu hình
            </Button>
          </div>
          {!canWrite && <Feedback>Chỉ xem. Thủ quỹ cấp mã, ghi thu và hủy phiếu.</Feedback>}
          {ownPending && (
            <Card spacing="content">
              <Feedback>
                Thao tác chưa rõ kết quả. Giữ nguyên nội dung và đối soát trước khi nhập lại.
              </Feedback>
              <p>
                Nguồn:{" "}
                {String(
                  (ownPending.body as { receipt?: { sourceReference?: string } }).receipt
                    ?.sourceReference ?? "Thao tác mã/phiếu",
                )}
              </p>
              <div className="finance-actions">
                <Button
                  disabled={mutation.busy || !canWrite}
                  onClick={() => void mutation.execute(ownPending, true)}
                >
                  Kiểm tra kết quả / thử lại
                </Button>
                <Button disabled={mutation.busy} onClick={() => setReconcile(true)}>
                  Đối soát danh sách
                </Button>
              </div>
            </Card>
          )}
          {reconcile && (
            <Card spacing="content">
              <Feedback>
                Tìm chính xác nguồn tham chiếu trong đúng kỳ/quỹ, kể cả phiếu đã hủy. Chỉ bỏ thao
                tác đang chờ sau khi đã kiểm tra.
              </Feedback>
              <Button
                onClick={() => {
                  props.onPending(null);
                  setReconcile(false);
                  setEditor(false);
                  setPreview(null);
                }}
              >
                Đã đối soát, bỏ thao tác đang chờ
              </Button>
            </Card>
          )}
          <PeriodPanel
            key={period}
            churchId={props.churchId}
            period={period}
            principalKey={`church_user:${ctx?.principal.accountId}:${props.churchId}:${ctx?.policyVersion}:${ctx?.principal.version}`}
            canClose={!!ctx?.capabilities.includes("finance:periods:close")}
            pending={props.pending}
            onPending={props.onPending}
            fail={fail}
            onChanged={() => setRefresh((n) => n + 1)}
          />
          <Toolbar>
            <Field label="Kỳ">
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
              {fund ? `Quỹ: ${fund.label}` : "Tất cả quỹ"}
            </Button>
            {fund && (
              <Button
                disabled={readLocked}
                onClick={() => {
                  setFund(null);
                  setStack([null]);
                }}
              >
                Bỏ lọc quỹ
              </Button>
            )}
            <Field label="Xem">
              <Select
                value={tab}
                disabled={readLocked}
                onChange={(e) => {
                  setTab(e.target.value);
                  setStack([null]);
                }}
              >
                <option value="receipts">Phiếu thu</option>
                <option value="ledger">Sổ thu chi</option>
              </Select>
            </Field>
            {tab === "receipts" && (
              <Field label="Trạng thái">
                <Select
                  value={state}
                  disabled={readLocked}
                  onChange={(e) => {
                    setState(e.target.value);
                    setStack([null]);
                  }}
                >
                  <option value="posted">Có hiệu lực</option>
                  <option value="voided">Đã hủy</option>
                  <option value="all">Tất cả</option>
                </Select>
              </Field>
            )}
          </Toolbar>
          {
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setSearch(q);
                setStack([null]);
              }}
            >
              <Toolbar>
                <Field label="Tìm phiếu / nguồn">
                  <TextInput
                    maxLength={100}
                    value={q}
                    disabled={readLocked}
                    onChange={(e) => setQ(e.target.value)}
                  />
                </Field>
                <Button type="submit" disabled={readLocked}>
                  Tìm
                </Button>
              </Toolbar>
            </form>
          }
          <Feedback>
            Sau khi tải lại trang hoặc mất kết nối: tìm nguồn tham chiếu trong đúng kỳ/quỹ và chọn
            Tất cả trạng thái để đối soát trước khi lập phiếu mới.
          </Feedback>
          <FinanceSummaryView
            churchId={props.churchId}
            period={period}
            fundId={fund?.id}
            enabled={canRead && !!ctx?.capabilities.includes("finance:summary:read")}
            refresh={refresh}
            fail={fail}
          />
          <p className="muted">
            Số dư sổ hệ thống theo kỳ/quỹ, cộng dồn giao dịch đã ghi; không phải đối soát tiền
            mặt/ngân hàng. Bộ lọc loại/mã/trạng thái chỉ lọc bảng.{" "}
            {tab === "ledger" ? "Số dòng sổ trang này" : "Số phiếu trang này"}:{" "}
            {(page ?? ledger)?.items.length ?? "—"}
          </p>
          {tab === "ledger" && (
            <Field label="Loại giao dịch">
              <Select
                disabled={readLocked}
                value={kind}
                onChange={(e) => {
                  setKind(e.target.value);
                  setStack([null]);
                }}
              >
                <option value="all">Tất cả loại</option>
                <option value="receipt">Thu</option>
                <option value="payment">Chi</option>
                <option value="void">Đối ứng hủy thu</option>
                <option value="payment_void">Đối ứng hủy chi</option>
              </Select>
            </Field>
          )}
          <div className="finance-actions">
            <Button disabled={readLocked} onClick={() => setCodesOpen(true)}>
              Mã dâng hiến
            </Button>
            {canWrite && (
              <Button variant="primary" disabled={locked} onClick={start}>
                ＋ Phiếu thu
              </Button>
            )}
            <Button disabled={readLocked} onClick={() => setRefresh((n) => n + 1)}>
              Tải lại
            </Button>
          </div>
          {!page && !ledger && !error && <Loading />}
          {(page ?? ledger)?.items.length === 0 && (
            <EmptyState message="Chưa có giao dịch trong phạm vi đã chọn." />
          )}
          {(page ?? ledger) && (
            <TableFrame label="Sổ thu chi">
              <table>
                <thead>
                  <tr>
                    <th>Ngày</th>
                    <th>Phiếu</th>
                    <th>Quỹ</th>
                    <th>{tab === "receipts" ? "Diễn giải / Nguồn" : "Đối ứng"}</th>
                    <th>Số tiền</th>
                    <th>Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {tab === "receipts"
                    ? page?.items.map((r) => (
                        <tr key={r.id}>
                          <td>{r.businessDate}</td>
                          <td>
                            {r.code}
                            <br />
                            {r.state === "voided" && <Badge tone="bad">Đã hủy</Badge>}
                          </td>
                          <td>{r.fundName}</td>
                          <td>
                            <p>{r.purpose}</p>
                            <span className="muted">{r.sourceReference}</span>
                          </td>
                          <td>{vnd(r.total)}</td>
                          <td>
                            <Button disabled={readLocked} onClick={() => setSelected(r.id)}>
                              Xem {r.code}
                            </Button>
                          </td>
                        </tr>
                      ))
                    : ledger?.items.map((r) => (
                        <tr key={r.id}>
                          <td>{r.businessDate}</td>
                          <td>{r.code}</td>
                          <td>{r.fundName}</td>
                          <td>
                            {r.kind === "receipt"
                              ? "Ghi thu"
                              : r.kind === "payment" || r.kind === "payment_void"
                                ? `${r.kind === "payment_void" ? "Đối ứng hủy chi" : "Chi đề xuất"} · ${r.proposalCode}`
                                : "Đối ứng hủy thu"}
                          </td>
                          <td>{vnd(r.amount)}</td>
                          <td>
                            <Button
                              disabled={readLocked}
                              onClick={() =>
                                r.paymentId
                                  ? setPaymentSelected(r.paymentId)
                                  : setSelected(r.receiptId)
                              }
                            >
                              Xem {r.code}
                            </Button>
                          </td>
                        </tr>
                      ))}
                </tbody>
              </table>
            </TableFrame>
          )}
          <Pages
            stack={stack}
            next={(page ?? ledger)?.nextCursor ?? null}
            locked={readLocked || !(page ?? ledger)}
            setStack={setStack}
          />
        </>
      )}
      {editor && !lost && (
        <Modal
          open
          title={preview ? "Xác nhận ghi thu" : "Lập phiếu thu"}
          locked={mutation.busy || previewBusy}
          onClose={() => {
            setEditor(false);
            setPreview(null);
          }}
        >
          {error && <Feedback tone="error">{error}</Feedback>}
          {mutation.error && <Feedback tone="error">{mutation.error}</Feedback>}
          {preview ? (
            <>
              <Stack space="compact">
                <p>
                  {preview.businessDate} · {preview.fundName} · Nguồn {source.trim().toUpperCase()}
                </p>
                <p>{purpose}</p>
                <p>
                  Tổng: <strong>{vnd(preview.total)}</strong>
                </p>
              </Stack>
              {preview.lines.map((l, i) => (
                <p key={`${l.givingCode}-${i}`}>
                  {l.givingCode} · {l.memberName} · {vnd(l.amount)}
                </p>
              ))}
              <Feedback>
                Kiểm tra ngày, quỹ, nguồn và số tiền. Ghi thu sẽ tạo phiếu và sổ thu cùng lúc.
              </Feedback>
              <DialogActions>
                <Button disabled={locked} onClick={() => setPreview(null)}>
                  Quay lại
                </Button>
                <Button
                  variant="primary"
                  disabled={locked || !intentBody.current}
                  onClick={() =>
                    mutation.send(`${base}/receipts`, "POST", {
                      receipt: intentBody.current,
                      previewToken: preview.previewToken,
                    })
                  }
                >
                  Xác nhận ghi thu
                </Button>
              </DialogActions>
            </>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void doPreview();
              }}
            >
              <div className="finance-layout">
                <Field label="Ngày thu">
                  <TextInput
                    required
                    type="date"
                    max={vnToday()}
                    value={day}
                    disabled={locked}
                    onChange={(e) => setDay(e.target.value)}
                  />
                </Field>
                <Button disabled={locked} onClick={() => setPicker("fund")}>
                  {editFund ? `Quỹ: ${editFund.label}` : "Chọn quỹ thu"}
                </Button>
                <Field
                  label="Nguồn tham chiếu"
                  hint="Mã nguồn chứng từ duy nhất, kể cả phiếu đã hủy; A–Z, 0–9, . _ / -."
                >
                  <TextInput
                    required
                    maxLength={64}
                    value={source}
                    disabled={locked}
                    onChange={(e) => setSource(e.target.value)}
                  />
                </Field>
                <Field label="Nội dung">
                  <TextArea
                    required
                    maxLength={500}
                    value={purpose}
                    disabled={locked}
                    onChange={(e) => setPurpose(e.target.value)}
                  />
                </Field>
                <Field label="Thay cho phiếu đã hủy (ID)" optional>
                  <TextInput
                    value={replacement}
                    maxLength={24}
                    disabled={locked}
                    onChange={(e) => setReplacement(e.target.value)}
                  />
                </Field>
                <Field label="Cách nhập">
                  <Select
                    value={mode}
                    disabled={locked}
                    onChange={(e) => setMode(e.target.value as typeof mode)}
                  >
                    <option value="aggregate">Thu tổng hợp</option>
                    <option value="itemized">Theo cá nhân</option>
                  </Select>
                </Field>
                {mode === "aggregate" ? (
                  <Field label="Số tiền VND" hint="Nguyên đồng, tối đa 999999999999999999.">
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
                ) : (
                  <>
                    <p>Tối đa 100 dòng; tổng phiếu vẫn trong giới hạn.</p>
                    {lines.map((l, i) => (
                      <Card spacing="content" key={`${l.id}-${i}`}>
                        <p>{l.label}</p>
                        <Field label={`Số tiền dòng ${i + 1}`}>
                          <TextInput
                            required
                            inputMode="numeric"
                            pattern="[1-9][0-9]{0,17}"
                            maxLength={18}
                            value={l.amount}
                            disabled={locked}
                            onChange={(e) =>
                              setLines(
                                lines.map((x, j) =>
                                  j === i ? { ...x, amount: e.target.value } : x,
                                ),
                              )
                            }
                          />
                        </Field>
                        <Button
                          disabled={locked}
                          onClick={() => setLines(lines.filter((_, j) => j !== i))}
                        >
                          Xóa dòng {i + 1}
                        </Button>
                      </Card>
                    ))}
                    <Button
                      disabled={locked || lines.length >= 100}
                      onClick={() => setPicker("giving")}
                    >
                      Thêm dòng dâng hiến
                    </Button>
                  </>
                )}
                <DialogActions>
                  <Button disabled={locked} onClick={() => setEditor(false)}>
                    Hủy
                  </Button>
                  <Button
                    type="submit"
                    variant="primary"
                    disabled={locked || !editFund || (mode === "itemized" && lines.length === 0)}
                  >
                    Xem trước
                  </Button>
                </DialogActions>
              </div>
            </form>
          )}
        </Modal>
      )}
      {codesOpen && !lost && (
        <Modal
          open
          title="Mã dâng hiến"
          locked={mutation.busy || previewBusy}
          onClose={() => setCodesOpen(false)}
        >
          {mutation.error && <Feedback tone="error">{mutation.error}</Feedback>}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setCodeSearch(codeQ);
              setCodeStack([null]);
            }}
          >
            <Toolbar>
              <Field label="Tìm mã dâng hiến">
                <TextInput
                  value={codeQ}
                  maxLength={100}
                  disabled={locked}
                  onChange={(e) => setCodeQ(e.target.value)}
                />
              </Field>
              <Field label="Trạng thái mã">
                <Select
                  value={codeStatus}
                  disabled={locked}
                  onChange={(e) => {
                    setCodeStatus(e.target.value);
                    setCodeStack([null]);
                  }}
                >
                  <option value="active">Đang dùng</option>
                  <option value="inactive">Đã ngừng</option>
                  <option value="all">Tất cả</option>
                </Select>
              </Field>
              <Button type="submit" disabled={locked}>
                Tìm mã
              </Button>
              {canWrite && (
                <Button disabled={locked} onClick={() => setPicker("member")}>
                  Cấp mã
                </Button>
              )}
            </Toolbar>
          </form>
          {!codes && <Loading />}
          {codes?.items.length === 0 && <EmptyState message="Chưa có mã phù hợp." />}
          {codes?.items.map((c) => (
            <Card spacing="content" key={c.id}>
              <p>
                <strong>{c.code}</strong> · {c.memberName} · {c.memberCode} ·{" "}
                {c.status === "active" ? "Đang dùng" : "Đã ngừng"}
              </p>
              <div className="finance-actions">
                <Button disabled={locked} onClick={() => setPersonal(c)}>
                  Dâng hiến cá nhân
                </Button>
                <Button disabled={locked} onClick={() => setHistory(`giving-codes/${c.id}`)}>
                  Lịch sử mã
                </Button>
                {canWrite && (
                  <Button
                    disabled={locked}
                    onClick={() => {
                      setCodeChange(c);
                      setReason("");
                    }}
                  >
                    {c.status === "active" ? "Ngừng mã" : "Khôi phục mã"}
                  </Button>
                )}
              </div>
            </Card>
          ))}
          <Pages
            stack={codeStack}
            next={codes?.nextCursor ?? null}
            locked={locked || !codes}
            setStack={setCodeStack}
          />
        </Modal>
      )}
      {codeChange && (
        <Modal
          open
          title={codeChange.status === "active" ? "Ngừng mã" : "Khôi phục mã"}
          locked={mutation.busy || previewBusy}
          onClose={() => setCodeChange(null)}
        >
          {mutation.error && <Feedback tone="error">{mutation.error}</Feedback>}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              mutation.send(
                `${base}/giving-codes/${codeChange.id}/status`,
                "PATCH",
                { status: codeChange.status === "active" ? "inactive" : "active", reason },
                codeChange.version,
              );
            }}
          >
            <p>
              {codeChange.code} · {codeChange.memberName}
            </p>
            <Field label="Lý do đổi trạng thái">
              <TextArea
                required
                maxLength={500}
                value={reason}
                disabled={locked}
                onChange={(e) => setReason(e.target.value)}
              />
            </Field>
            <DialogActions>
              <Button type="submit" variant="primary" disabled={locked || !reason.trim()}>
                Xác nhận đổi trạng thái
              </Button>
            </DialogActions>
          </form>
        </Modal>
      )}
      {personal && (
        <Drawer
          open
          title="Dâng hiến cá nhân"
          locked={mutation.busy || previewBusy}
          onClose={() => setPersonal(null)}
        >
          <MemberGiving
            key={`${personal.id}:${refresh}`}
            churchId={props.churchId}
            memberId={personal.memberId}
            onAuthError={fail}
          />
        </Drawer>
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
      {selected && (
        <ReceiptView
          key={`${selected}:${refresh}`}
          base={base}
          id={selected}
          canWrite={canWrite}
          locked={mutation.busy || previewBusy}
          fail={fail}
          onClose={() => setSelected(null)}
          onVoid={(r) => {
            setVoiding(r);
            setReason("");
            setConfirmed(false);
          }}
        />
      )}
      {voiding && (
        <Modal
          open
          title="Hủy phiếu nhập sai"
          locked={mutation.busy || previewBusy}
          onClose={() => setVoiding(null)}
        >
          {mutation.error && <Feedback tone="error">{mutation.error}</Feedback>}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              mutation.send(
                `${base}/receipts/${voiding.id}/void`,
                "POST",
                { reason, confirmed },
                voiding.version,
              );
            }}
          >
            <p>
              {voiding.code} · {vnd(voiding.total)} · Ngày gốc {voiding.businessDate}
            </p>
            <Feedback>
              Hủy toàn bộ tạo đối ứng âm ở kỳ/ngày gốc. Phiếu và lịch sử được giữ nguyên.
            </Feedback>
            <Field label="Lý do hủy">
              <TextArea
                required
                maxLength={500}
                value={reason}
                disabled={locked}
                onChange={(e) => setReason(e.target.value)}
              />
            </Field>
            <Choice
              label="Tôi xác nhận hủy toàn bộ phiếu"
              checked={confirmed}
              disabled={locked}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            <DialogActions>
              <Button
                type="submit"
                variant="danger"
                disabled={locked || !confirmed || !reason.trim()}
              >
                Xác nhận hủy phiếu
              </Button>
            </DialogActions>
          </form>
        </Modal>
      )}
      {picker && !lost && (
        <SourcePicker
          base={base}
          kind={
            picker === "filter" || picker === "fund"
              ? "funds"
              : picker === "giving"
                ? "giving-codes"
                : "member-options"
          }
          onPick={picked}
          onClose={() => setPicker(null)}
          fail={fail}
        />
      )}{" "}
      {history && !lost && (
        <History base={base} path={history} onClose={() => setHistory(null)} fail={fail} />
      )}
    </div>
  );
}
