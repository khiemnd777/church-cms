import { useEffect, useState } from "react";
import type { FinanceSummary } from "../api/finance/reporting";
import { ApiError, churchRequest } from "./api";
import type { SettingsContext } from "./church-settings";
import { vnd, vnToday } from "./finance-income-api";
import { authErrorCodes } from "./tenant-mutation";
import {
  Button,
  Card,
  ContentSection,
  Feedback,
  Loading,
  Stack,
  TableFrame,
} from "./ui/components";
import { FinanceChart } from "./ui/components/finance-chart";

const stateLabel = { open: "Đang mở, tạm tính", closed: "Đã khóa", future: "Chưa đến kỳ" };
function useSummary(
  churchId: string,
  period: string,
  fundId: string | undefined,
  enabled: boolean,
  refresh: number,
  fail: (e: unknown) => void,
) {
  const key = `${churchId}:${period}:${fundId ?? "all"}:${enabled}:${refresh}`;
  const [result, setResult] = useState<{ key: string; data: FinanceSummary | null; error: string }>(
    { key: "", data: null, error: "" },
  );
  useEffect(() => {
    const abort = new AbortController();
    setResult({ key, data: null, error: "" });
    if (enabled) {
      const q = new URLSearchParams({ period });
      if (fundId) q.set("fundId", fundId);
      void churchRequest<FinanceSummary>(`churches/${churchId}/finance/summary?${q}`, {
        signal: abort.signal,
      })
        .then((r) => {
          if (!abort.signal.aborted) setResult({ key, data: r.data, error: "" });
        })
        .catch((e) => {
          if (abort.signal.aborted) return;
          setResult({
            key,
            data: null,
            error: e instanceof Error ? e.message : "Không đọc được tổng hợp.",
          });
          if (
            e instanceof ApiError &&
            [...authErrorCodes, "FORBIDDEN", "CHURCH_SUSPENDED"].includes(e.code)
          )
            fail(e);
        });
    }
    return () => abort.abort();
  }, [key]);
  return result.key === key && enabled ? result : { key, data: null, error: "" };
}
export function FinanceSummaryView({
  churchId,
  period,
  fundId,
  enabled,
  refresh,
  fail,
}: {
  churchId: string;
  period: string;
  fundId?: string;
  enabled: boolean;
  refresh: number;
  fail: (e: unknown) => void;
}) {
  const { data, error } = useSummary(churchId, period, fundId, enabled, refresh, fail),
    [details, setDetails] = useState(false);
  return (
    <Stack data-ui="finance-summary">
      {error && <Feedback tone="error">{error}</Feedback>}
      <div className="grid g4">
        {(
          [
            ["Thu ròng kỳ", "netIncome"],
            ["Chi ròng kỳ", "netExpense"],
            ["Số dư đầu kỳ", "openingBalance"],
            ["Số dư cuối kỳ", "closingBalance"],
          ] as const
        ).map(([label, key]) => (
          <Card className="kpi" key={key}>
            <div className="lbl">{label}</div>
            <div className="big num expense-total">
              {data?.totals ? vnd(data.totals[key]) : "—"}
            </div>
          </Card>
        ))}
      </div>
      <Card spacing="content">
        <ContentSection title={`Thu ròng từng tháng — năm ${period.slice(0, 4)}`}>
          <p>
            {data?.fund?.name ?? (fundId ? "Quỹ đang chọn" : "Tất cả quỹ")} ·{" "}
            {data ? stateLabel[data.state] : "Chưa đọc được số liệu"}
          </p>
          {!data && !error && enabled && <Loading />}
          {data && (
            <>
              <FinanceChart months={data.months} year={data.year} />
              <p className="muted small">Màn hình nhỏ: cuộn ngang để xem đủ 12 tháng.</p>
              <p className="muted small">
                Cột đậm: đã khóa · Cột nhạt: đang mở, tạm tính · —: chưa đến kỳ. Số dư sổ không phải
                đối soát tiền mặt/ngân hàng.
              </p>
              <p className="small muted">
                Số liệu lúc{" "}
                {new Date(data.asOf).toLocaleString("vi-VN", { timeZone: data.timezone })}
              </p>
            </>
          )}
          <Button disabled={!data} aria-expanded={details} onClick={() => setDetails(!details)}>
            Chi tiết số liệu
          </Button>
          {details && data && (
            <TableFrame label="Thu ròng từng tháng">
              <table>
                <thead>
                  <tr>
                    <th>Kỳ</th>
                    <th>Thu ròng</th>
                    <th>Trạng thái</th>
                  </tr>
                </thead>
                <tbody>
                  {data.months.map((m) => (
                    <tr key={m.period}>
                      <td>{m.period}</td>
                      <td>{m.netIncome === null ? "—" : vnd(m.netIncome)}</td>
                      <td>{stateLabel[m.state]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableFrame>
          )}
        </ContentSection>
      </Card>
    </Stack>
  );
}
export function FinanceOverview({
  churchId,
  refresh,
  fail,
  onOpen,
}: {
  churchId: string;
  refresh: number;
  fail: (e: unknown) => void;
  onOpen: () => void;
}) {
  const [allowed, setAllowed] = useState<string | null>(null),
    [contextError, setContextError] = useState("");
  useEffect(() => {
    const abort = new AbortController();
    setAllowed(null);
    setContextError("");
    void churchRequest<SettingsContext>(`churches/${churchId}/context`, { signal: abort.signal })
      .then((r) => {
        if (
          !abort.signal.aborted &&
          r.data.capabilities.includes("overview:read") &&
          r.data.capabilities.includes("finance:summary:read")
        )
          setAllowed(churchId);
      })
      .catch((e) => {
        if (!abort.signal.aborted) setContextError("Chưa kiểm tra được quyền tổng hợp tài chính.");
        if (
          !abort.signal.aborted &&
          e instanceof ApiError &&
          [...authErrorCodes, "FORBIDDEN", "CHURCH_SUSPENDED"].includes(e.code)
        )
          fail(e);
      });
    return () => abort.abort();
  }, [churchId, refresh]);
  const enabled = allowed === churchId,
    period = vnToday().slice(0, 7),
    { data, error } = useSummary(churchId, period, undefined, enabled, refresh, fail);
  if (!enabled) return contextError ? <Feedback tone="error">{contextError}</Feedback> : null;
  return (
    <Card spacing="content" data-ui="overview-finance">
      <ContentSection title={`Tài chính kỳ ${period}`}>
        {error && <Feedback tone="error">{error}</Feedback>}
        {!data && !error && <Loading />}
        <Stack space="compact">
          <p>Thu ròng: {data?.totals ? vnd(data.totals.netIncome) : "—"}</p>
          <p>Chi ròng: {data?.totals ? vnd(data.totals.netExpense) : "—"}</p>
          <p>Cuối kỳ: {data?.totals ? vnd(data.totals.closingBalance) : "—"}</p>
        </Stack>
        {data && (
          <p className="small muted">
            {stateLabel[data.state]} · Số liệu lúc{" "}
            {new Date(data.asOf).toLocaleString("vi-VN", { timeZone: data.timezone })}
          </p>
        )}
        <Button onClick={onOpen}>Mở W09 →</Button>
      </ContentSection>
    </Card>
  );
}
