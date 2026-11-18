import { useEffect, useRef, useState } from "react";
import type { FinancePeriods } from "../api/finance/periods";
import { churchRequest } from "./api";
import { vnd } from "./finance-income-api";
import { type TenantIntent, useTenantMutation } from "./tenant-mutation";
import {
  Badge,
  Button,
  Card,
  ContentSection,
  Drawer,
  Feedback,
  Field,
  Loading,
  Stack,
  TableFrame,
  TextArea,
} from "./ui/components";

type Period = Awaited<ReturnType<FinancePeriods["get"]>>;
type Preview = Awaited<ReturnType<FinancePeriods["preview"]>>;
type Funds = Awaited<ReturnType<FinancePeriods["funds"]>>;
type History = Awaited<ReturnType<FinancePeriods["history"]>>;
export function PeriodPanel({
  churchId,
  period,
  principalKey,
  canClose,
  pending,
  onPending,
  fail,
  onChanged,
}: {
  churchId: string;
  period: string;
  principalKey: string;
  canClose: boolean;
  pending: TenantIntent | null;
  onPending: (p: TenantIntent | null) => void;
  fail: (e: unknown) => void;
  onChanged: () => void;
}) {
  const [row, setRow] = useState<Period | null>(null),
    [expanded, setExpanded] = useState(false),
    [closing, setClosing] = useState(false),
    [reason, setReason] = useState(""),
    [submission, setSubmission] = useState(""),
    [preview, setPreview] = useState<Preview | null>(null),
    [busyPreview, setBusyPreview] = useState(false),
    [error, setError] = useState(""),
    [reconciled, setReconciled] = useState(false),
    [refresh, setRefresh] = useState(0),
    [funds, setFunds] = useState<Funds | null>(null),
    [stack, setStack] = useState<(string | null)[]>([null]),
    [history, setHistory] = useState<History | null>(null),
    [historyOpen, setHistoryOpen] = useState(false),
    [historyStack, setHistoryStack] = useState<(string | null)[]>([null]);
  const wantReconcile = useRef(false);
  const mounted = useRef(true),
    confirmation = useRef<HTMLButtonElement>(null),
    base = `churches/${churchId}/finance/periods`,
    ownPending = pending?.resource?.kind === "finance-periods" ? pending : null;
  function failure(e: unknown) {
    setError(e instanceof Error ? e.message : "Không đối chiếu được kỳ.");
    fail(e);
  }
  const mutation = useTenantMutation({
    realm: "church",
    churchId,
    principalKey,
    canWrite: canClose,
    pending,
    onPending,
    onAuthError: failure,
    onAccessLoss: failure,
    operationPath: `${base}/operations`,
    prefix: base,
    acceptPath: (p) => p === `${base}/${period}/close`,
    intentResource: { kind: "finance-periods", period },
    onSuccess: () => {
      if (!mounted.current) return;
      setPreview(null);
      setClosing(false);
      setReason("");
      setRefresh((n) => n + 1);
      onChanged();
    },
  });
  const busy = mutation.busy || busyPreview,
    locked = busy || !!pending;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (preview && !busyPreview) confirmation.current?.focus();
  }, [preview, busyPreview]);
  useEffect(() => {
    const a = new AbortController();
    setRow(null);
    setError("");
    void churchRequest<Period>(`${base}/${period}`, { signal: a.signal })
      .then((r) => {
        if (!a.signal.aborted) {
          setRow(r.data);
          if (wantReconcile.current) {
            setReconciled(true);
            wantReconcile.current = false;
          }
        }
      })
      .catch((e) => {
        if (!a.signal.aborted) failure(e);
      });
    return () => a.abort();
  }, [base, period, refresh]);
  useEffect(() => {
    if (!expanded) return;
    const a = new AbortController(),
      q = new URLSearchParams(),
      cursor = stack.at(-1);
    if (cursor) q.set("cursor", cursor);
    setFunds(null);
    void churchRequest<Funds>(`${base}/${period}/funds?${q}`, { signal: a.signal })
      .then((r) => {
        if (!a.signal.aborted) setFunds(r.data);
      })
      .catch((e) => {
        if (!a.signal.aborted) failure(e);
      });
    return () => a.abort();
  }, [base, period, expanded, stack, refresh]);
  useEffect(() => {
    if (!historyOpen || !row?.closure) return;
    const a = new AbortController(),
      q = new URLSearchParams(),
      cursor = historyStack.at(-1);
    if (cursor) q.set("cursor", cursor);
    void churchRequest<History>(
      `churches/${churchId}/finance/period-closures/${row.closure.id}/history?${q}`,
      { signal: a.signal },
    )
      .then((r) => {
        if (!a.signal.aborted) setHistory(r.data);
      })
      .catch((e) => {
        if (!a.signal.aborted) failure(e);
      });
    return () => a.abort();
  }, [churchId, row?.closure?.id, historyOpen, historyStack]);
  return (
    <Card spacing="section" data-ui="period-panel">
      {error && <Feedback tone="error">{error}</Feedback>}
      {mutation.error && <Feedback tone="error">{mutation.error}</Feedback>}
      {!row && !error && <Loading />}
      {row && (
        <>
          <Stack space="compact" data-ui="period-scope">
            <div className="finance-actions">
              <Badge tone={row.state === "closed" ? "good" : "primary"}>
                {row.state === "closed" ? `Kỳ ${period} đã khóa` : `Kỳ ${period} đang mở`}
              </Badge>
              {row.closedThrough && <span>Đã khóa đến hết {row.closedThrough}</span>}
              <Button
                disabled={busy}
                onClick={() => {
                  setExpanded((v) => !v);
                  setRefresh((n) => n + 1);
                }}
              >
                Đối chiếu kỳ
              </Button>
              {canClose && row.canClose && (
                <Button
                  disabled={locked}
                  onClick={() => {
                    setClosing(true);
                    setExpanded(true);
                    setSubmission(crypto.randomUUID());
                    setPreview(null);
                    setReason("");
                  }}
                >
                  Khóa sổ
                </Button>
              )}
              {row.closure && (
                <Button disabled={busy} onClick={() => setHistoryOpen(true)}>
                  Xem lịch sử khóa sổ
                </Button>
              )}
            </div>
            <p>
              Khóa sổ áp dụng toàn Hội Thánh, tất cả quỹ; bộ lọc Quỹ không giới hạn phạm vi khóa.
            </p>
            {row.closure && (
              <p>
                {row.closure.code} · {row.closure.actorName} ·{" "}
                {new Date(row.closure.occurredAt).toLocaleString("vi-VN", {
                  timeZone: "Asia/Ho_Chi_Minh",
                })}
              </p>
            )}
          </Stack>
          {ownPending && (
            <Card spacing="content">
              <Feedback>
                Chưa rõ kết quả khóa sổ. Kiểm tra mốc khóa và biên bản trước khi tiếp tục.
              </Feedback>
              <Button disabled={busy} onClick={() => void mutation.execute(ownPending, true)}>
                Kiểm tra kết quả khóa / thử lại
              </Button>
              <Button
                disabled={busy}
                onClick={() => {
                  wantReconcile.current = true;
                  setExpanded(true);
                  setRefresh((n) => n + 1);
                }}
              >
                Đối soát mốc khóa
              </Button>
              {reconciled && (
                <Button
                  disabled={busy}
                  onClick={() => {
                    onPending(null);
                    setReconciled(false);
                    setClosing(false);
                    setPreview(null);
                  }}
                >
                  Đã đối soát, bỏ thao tác đang chờ
                </Button>
              )}
            </Card>
          )}
          {expanded && (
            <>
              <ContentSection title={`Đối chiếu đến hết ${period}`}>
                <Feedback tone={row.inspection.matches ? "success" : "error"}>
                  {row.inspection.matches
                    ? "Phiếu và sổ khớp"
                    : "Có sai lệch phiếu–sổ. Chưa thể khóa."}
                </Feedback>
                <Stack space="compact" data-ui="period-summary">
                  {!row.inspection.matches && (
                    <p>
                      Sai lệch: thu {row.inspection.issues.receipts.count} · chi{" "}
                      {row.inspection.issues.payments.count} · sổ{" "}
                      {row.inspection.issues.ledger.count}
                    </p>
                  )}
                  <p>
                    Dải sắp khóa: sau {row.closedThrough ?? "mọi kỳ trước"} đến hết {period}. Dòng
                    sổ trong dải: {row.inspection.summary.rangeLedgerCount}
                  </p>
                  <p>
                    Thu ròng kỳ: {vnd(row.inspection.summary.netIncome)} · Chi ròng kỳ:{" "}
                    {vnd(row.inspection.summary.netExpense)} · Cuối kỳ:{" "}
                    {vnd(row.inspection.summary.closingBalance)}
                  </p>
                </Stack>
              </ContentSection>
              <ContentSection title="Quỹ có giao dịch đến hết kỳ:">
                {!funds ? (
                  <Loading />
                ) : (
                  <>
                    <TableFrame label="Đối chiếu theo quỹ">
                      <table>
                        <thead>
                          <tr>
                            <th>Quỹ</th>
                            <th>Thu ròng</th>
                            <th>Chi ròng</th>
                            <th>Đầu kỳ</th>
                            <th>Cuối kỳ</th>
                          </tr>
                        </thead>
                        <tbody>
                          {funds.items.map((f) => (
                            <tr key={f.id}>
                              <td>{f.fundName}</td>
                              <td>{vnd(f.netIncome)}</td>
                              <td>{vnd(f.netExpense)}</td>
                              <td>{vnd(f.openingBalance)}</td>
                              <td>{vnd(f.closingBalance)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </TableFrame>
                    {funds.items.length === 0 && <p>Chưa có giao dịch đến hết kỳ.</p>}
                    <div className="finance-actions">
                      <Button
                        disabled={busy || stack.length === 1}
                        onClick={() => setStack(stack.slice(0, -1))}
                      >
                        Trước
                      </Button>
                      <Button
                        disabled={busy || !funds.nextCursor}
                        onClick={() => {
                          if (funds.nextCursor) setStack([...stack, funds.nextCursor]);
                        }}
                      >
                        Tiếp
                      </Button>
                    </div>
                  </>
                )}
              </ContentSection>
            </>
          )}
          {closing && canClose && (
            <ContentSection title={`Khóa sổ đến hết ${period}`}>
              <Feedback>
                Bao gồm tháng {period} và mọi tháng trước, tất cả quỹ. Sau khi khóa, không ghi hoặc
                hủy phiếu trong phạm vi này.
              </Feedback>
              {preview ? (
                <>
                  <Stack space="compact">
                    <p>
                      Phạm vi: sau {preview.previousClosedThrough ?? "mọi kỳ trước"} đến hết{" "}
                      {preview.throughPeriod}
                    </p>
                    <p>Lý do: {reason}</p>
                    <p>
                      Thu ròng kỳ: {vnd(preview.summary.netIncome)} · Chi ròng kỳ:{" "}
                      {vnd(preview.summary.netExpense)} · Cuối kỳ:{" "}
                      {vnd(preview.summary.closingBalance)}
                    </p>
                  </Stack>
                  <div className="finance-actions">
                    <Button disabled={locked} onClick={() => setPreview(null)}>
                      Quay lại
                    </Button>
                    <Button
                      disabled={busy}
                      onClick={() => {
                        setClosing(false);
                        setPreview(null);
                      }}
                    >
                      Hủy
                    </Button>
                    <Button
                      ref={confirmation}
                      variant="primary"
                      disabled={locked}
                      onClick={() =>
                        mutation.send(`${base}/${period}/close`, "POST", {
                          closure: { submissionId: submission, reason },
                          controlVersion: preview.controlVersion,
                          previewToken: preview.previewToken,
                          confirmed: true,
                        })
                      }
                    >
                      Xác nhận khóa sổ
                    </Button>
                  </div>
                </>
              ) : (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (locked) return;
                    setBusyPreview(true);
                    setError("");
                    mutation.setError("");
                    void churchRequest<Preview>(`${base}/${period}/close-preview`, {
                      method: "POST",
                      body: { submissionId: submission, reason },
                    })
                      .then((r) => {
                        if (mounted.current) setPreview(r.data);
                      })
                      .catch(failure)
                      .finally(() => setBusyPreview(false));
                  }}
                >
                  <Field label="Lý do khóa sổ">
                    <TextArea
                      required
                      maxLength={500}
                      value={reason}
                      disabled={locked}
                      onChange={(e) => setReason(e.target.value)}
                    />
                  </Field>
                  <div className="finance-actions">
                    <Button disabled={busy} onClick={() => setClosing(false)}>
                      Hủy
                    </Button>
                    <Button
                      type="submit"
                      variant="primary"
                      disabled={locked || !row.inspection.matches}
                    >
                      Đối chiếu & Xem trước
                    </Button>
                  </div>
                </form>
              )}
            </ContentSection>
          )}
        </>
      )}
      {historyOpen && row?.closure && (
        <Drawer open title="Biên bản khóa sổ" onClose={() => setHistoryOpen(false)}>
          <Stack space="compact">
            <p>
              {row.closure.code} · Khóa đến hết {row.closure.throughPeriod}
            </p>
            <p>Lý do: {row.closure.reason}</p>
            <p>Người khóa: {row.closure.actorName}</p>
            <p>Cuối kỳ đã chốt: {vnd(row.closure.summary.closingBalance)}</p>
          </Stack>
          {history?.items.map((h) => (
            <p key={h.id}>
              {h.actorName} ·{" "}
              {new Date(h.occurredAt).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}
            </p>
          ))}
          <div className="finance-actions">
            <Button
              disabled={historyStack.length === 1}
              onClick={() => setHistoryStack(historyStack.slice(0, -1))}
            >
              Trước
            </Button>
            <Button
              disabled={!history?.nextCursor}
              onClick={() => {
                if (history?.nextCursor) setHistoryStack([...historyStack, history.nextCursor]);
              }}
            >
              Tiếp
            </Button>
          </div>
        </Drawer>
      )}
    </Card>
  );
}
