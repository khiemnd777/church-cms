import { useEffect, useRef, useState } from "react";
import type { Payments } from "../api/finance/payments";
import { ApiError, churchRequest } from "./api";
import type { SettingsContext } from "./church-settings";
import { vnd } from "./finance-income-api";
import { authErrorCodes, type TenantIntent, useTenantMutation } from "./tenant-mutation";
import {
  Button,
  Card,
  DialogActions,
  Drawer,
  Feedback,
  Field,
  Loading,
  Modal,
  Stack,
  TextArea,
} from "./ui/components";
export type PaymentPreview = Awaited<ReturnType<Payments["preview"]>>;
type Detail = Awaited<ReturnType<Payments["get"]>>;
type History = Awaited<ReturnType<Payments["history"]>>;
type VoidPreview = Awaited<ReturnType<Payments["previewVoid"]>>;
export function PaymentDetail({
  churchId,
  id,
  onClose,
  fail,
  pending,
  onPending,
  onChanged,
}: {
  churchId: string;
  id: string;
  onClose: () => void;
  fail: (e: unknown) => void;
  pending: TenantIntent | null;
  onPending: (p: TenantIntent | null) => void;
  onChanged: () => void;
}) {
  const [row, setRow] = useState<Detail | null>(null),
    [history, setHistory] = useState<History | null>(null),
    [ctx, setCtx] = useState<SettingsContext | null>(null),
    [error, setError] = useState(""),
    [reconciled, setReconciled] = useState(false),
    [stack, setStack] = useState<(string | null)[]>([null]),
    [refresh, setRefresh] = useState(0),
    [editor, setEditor] = useState(false),
    [reason, setReason] = useState(""),
    [preview, setPreview] = useState<VoidPreview | null>(null),
    [previewBusy, setPreviewBusy] = useState(false),
    [lost, setLost] = useState(false);
  const wantReconcile = useRef(false);
  const base = `churches/${churchId}/finance/payments/${id}`,
    confirmation = useRef<HTMLButtonElement>(null),
    lostRef = useRef(false),
    ownPending =
      pending?.resource?.kind === "payment-void" && pending.resource.paymentId === id
        ? pending
        : null;
  function failure(e: unknown) {
    if (
      e instanceof ApiError &&
      [...authErrorCodes, "FORBIDDEN", "NOT_FOUND", "CHURCH_SUSPENDED"].includes(e.code)
    ) {
      lostRef.current = true;
      setLost(true);
      setRow(null);
      setHistory(null);
      setCtx(null);
      setEditor(false);
      setPreview(null);
      if (["FORBIDDEN", "NOT_FOUND"].includes(e.code)) onPending(null);
      fail(e);
    }
    setError(e instanceof Error ? e.message : "Không tải được phiếu chi.");
  }
  const mutation = useTenantMutation({
    realm: "church",
    churchId,
    principalKey: `church_user:${ctx?.principal.accountId}:${churchId}:${ctx?.policyVersion}:${ctx?.principal.version}`,
    canWrite: !!ctx?.capabilities.includes("finance:payments:void") && !lost,
    pending,
    onPending,
    onAuthError: failure,
    onAccessLoss: failure,
    operationPath: `churches/${churchId}/finance/payments/operations`,
    prefix: base,
    acceptPath: (p) => p === `${base}/void`,
    intentResource: { kind: "payment-void", paymentId: id },
    onSuccess: () => {
      if (lostRef.current) return;
      setEditor(false);
      setPreview(null);
      setReason("");
      setRefresh((n) => n + 1);
      onChanged();
    },
  });
  const busy = mutation.busy || previewBusy,
    locked = busy || !!pending || lost;
  useEffect(() => {
    if (preview && !previewBusy) confirmation.current?.focus();
  }, [preview, previewBusy]);
  useEffect(() => {
    const a = new AbortController();
    void churchRequest<SettingsContext>(`churches/${churchId}/context`, { signal: a.signal })
      .then((r) => {
        if (!a.signal.aborted && !lostRef.current) setCtx(r.data);
      })
      .catch((e) => {
        if (!a.signal.aborted) failure(e);
      });
    return () => a.abort();
  }, [churchId]);
  useEffect(() => {
    const a = new AbortController();
    setRow(null);
    void churchRequest<Detail>(base, { signal: a.signal })
      .then((r) => {
        if (!a.signal.aborted && !lostRef.current) {
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
  }, [base, refresh]);
  useEffect(() => {
    const a = new AbortController(),
      q = new URLSearchParams(),
      cursor = stack.at(-1);
    if (cursor) q.set("cursor", cursor);
    void churchRequest<History>(`${base}/history?${q}`, { signal: a.signal })
      .then((r) => {
        if (!a.signal.aborted && !lostRef.current) setHistory(r.data);
      })
      .catch((e) => {
        if (!a.signal.aborted) failure(e);
      });
    return () => a.abort();
  }, [base, stack, refresh]);
  const feedback = (
    <>
      {error && <Feedback tone="error">{error}</Feedback>}
      {mutation.error && <Feedback tone="error">{mutation.error}</Feedback>}
      {ownPending && (
        <Card spacing="content">
          <Feedback>
            Thao tác chưa rõ kết quả. Đối soát phiếu và đối ứng trước khi tiếp tục.
          </Feedback>
          <Button disabled={busy} onClick={() => void mutation.execute(ownPending, true)}>
            Kiểm tra kết quả / thử lại
          </Button>
          <Button
            disabled={busy}
            onClick={() => {
              wantReconcile.current = true;
              setEditor(false);
              setPreview(null);
              setRefresh((n) => n + 1);
            }}
          >
            Đối soát phiếu
          </Button>
          {reconciled && (
            <Button
              disabled={busy}
              onClick={() => {
                onPending(null);
                setReconciled(false);
                setEditor(false);
                setPreview(null);
              }}
            >
              Đã đối soát, bỏ thao tác đang chờ
            </Button>
          )}
        </Card>
      )}
    </>
  );
  if (editor && !lost && row)
    return (
      <Modal
        open
        title="Hủy phiếu chi"
        locked={busy}
        onClose={() => {
          setEditor(false);
          setPreview(null);
        }}
      >
        {feedback}
        <Stack space="compact">
          <p>
            {row.code} · {row.proposalCode} · Quỹ {row.fundName}
          </p>
          <p>Toàn bộ số tiền: {vnd(row.amount)}</p>
          <p>
            Ngày/kỳ đối ứng: {row.businessDate} · {row.period} (gốc)
          </p>
        </Stack>
        {preview ? (
          <>
            <Stack space="compact">
              <p>Lý do: {preview.reason}</p>
              <p>
                Số dư sổ: {vnd(preview.balance)} → {vnd(preview.balanceAfter)}
              </p>
            </Stack>
            <Feedback>
              Ghi đối ứng hủy toàn phiếu. Không tự hoàn tiền hoặc cho lập PC thứ hai từ đề xuất này.
            </Feedback>
            <DialogActions>
              <Button disabled={locked} onClick={() => setPreview(null)}>
                Quay lại
              </Button>
              <Button
                ref={confirmation}
                variant="primary"
                disabled={locked}
                onClick={() =>
                  mutation.send(
                    `${base}/void`,
                    "POST",
                    {
                      void: { reason: preview.reason },
                      previewToken: preview.previewToken,
                      confirmed: true,
                    },
                    row.version,
                  )
                }
              >
                Xác nhận hủy phiếu
              </Button>
            </DialogActions>
          </>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (locked) return;
              setPreviewBusy(true);
              setError("");
              mutation.setError("");
              void churchRequest<VoidPreview>(`${base}/void-preview`, {
                method: "POST",
                body: { reason },
                headers: { "If-Match": `"${row.version}"` },
              })
                .then((r) => {
                  if (!lostRef.current) setPreview(r.data);
                })
                .catch(failure)
                .finally(() => setPreviewBusy(false));
            }}
          >
            <Field label="Lý do hủy phiếu chi">
              <TextArea
                required
                maxLength={500}
                disabled={locked}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </Field>
            <DialogActions>
              <Button disabled={busy} onClick={() => setEditor(false)}>
                Đóng
              </Button>
              <Button type="submit" variant="primary" disabled={locked}>
                Xem trước
              </Button>
            </DialogActions>
          </form>
        )}
      </Modal>
    );
  return (
    <Drawer open title="Chi tiết phiếu chi" locked={busy} onClose={onClose}>
      {feedback}
      {!row && !error && !lost && <Loading />}
      {row && !lost && (
        <div className="finance-layout">
          <strong>
            {row.code} · {row.state === "voided" ? "Đã hủy" : "Đã vào sổ"}
          </strong>
          <Stack space="compact">
            <p>Đề xuất: {row.proposalCode}</p>
            <p>Ngày chi: {row.businessDate}</p>
            <p>Quỹ: {row.fundName}</p>
          </Stack>
          {row.fundNameAtPayment !== row.fundName && (
            <p>Tên quỹ lúc chi: {row.fundNameAtPayment}</p>
          )}
          <Stack space="compact">
            <p>Nội dung: {row.purpose}</p>
            <p>
              Số tiền: <strong>{vnd(row.amount)}</strong>
            </p>
            <p>Người lập: {row.actorName}</p>
            <p>
              Người duyệt: {row.decision.actorName} ·{" "}
              {new Date(row.decision.decidedAt).toLocaleString("vi-VN", {
                timeZone: "Asia/Ho_Chi_Minh",
              })}
            </p>
          </Stack>
          {row.state === "voided" ? (
            <Feedback>
              Đã hủy bởi {row.voidedName} ·{" "}
              {row.voidedAt &&
                new Date(row.voidedAt).toLocaleString("vi-VN", {
                  timeZone: "Asia/Ho_Chi_Minh",
                })}{" "}
              · {row.voidReason}. Đối ứng giữ ngày/kỳ gốc.
            </Feedback>
          ) : (
            <Feedback>
              Phiếu chi đã ghi sổ. Hủy toàn phiếu chỉ được thực hiện trong kỳ gốc còn mở.
            </Feedback>
          )}
          {row.canVoid && (
            <Button
              variant="primary"
              disabled={locked}
              onClick={() => {
                setEditor(true);
                setReason("");
                setPreview(null);
              }}
            >
              Hủy phiếu chi
            </Button>
          )}
          <Card spacing="content">
            <strong>Lịch sử phiếu chi</strong>
            <Stack space="compact">
              {history?.items.map((h) => (
                <p key={h.id}>
                  {h.event === "posted"
                    ? "Ghi chi"
                    : h.event === "voided"
                      ? "Hủy phiếu chi"
                      : h.event}{" "}
                  · {h.actorName} ·{" "}
                  {new Date(h.occurredAt).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}
                </p>
              ))}
            </Stack>
            <div className="finance-actions">
              <Button
                disabled={stack.length === 1 || busy}
                onClick={() => setStack(stack.slice(0, -1))}
              >
                Trước
              </Button>
              <Button
                disabled={!history?.nextCursor || busy}
                onClick={() => {
                  if (history?.nextCursor) setStack([...stack, history.nextCursor]);
                }}
              >
                Tiếp
              </Button>
            </div>
          </Card>
        </div>
      )}
    </Drawer>
  );
}
