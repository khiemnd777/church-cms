import { useEffect, useRef, useState } from "react";
import type { AlertCommand, SignalCommand } from "../api/care/validation";
import { ApiError } from "./api";
import {
  careEvents,
  type NeedPreview,
  type NeedRow,
  needKinds,
  needStates,
  type SuggestionDetail,
  type SuggestionHistory,
  type SuggestionPage,
  type SuggestionPreview,
  type SuggestionRow,
  suggestionStates,
} from "./care-api";
import { DecisionForm, NeedForm } from "./care-forms";
import { prayerDate as date } from "./prayers-api";
import {
  authErrorCodes,
  type TenantIntent,
  type TenantRealm,
  tenantRequest,
  useTenantMutation,
} from "./tenant-mutation";
import {
  Badge,
  Button,
  Card,
  Choice,
  DialogActions,
  EmptyState,
  Feedback,
  Field,
  KeyValueList,
  Loading,
  Modal,
  PaginationControl,
  SectionHeader,
  Select,
  TableFrame,
  TextInput,
  Toolbar,
} from "./ui/components";

type Props = {
  realm: TenantRealm;
  churchId: string;
  pending: TenantIntent | null;
  onPending: (p: TenantIntent | null) => void;
  onAuthError: (e: unknown) => void;
  otherDialog: boolean;
  onDialog: (open: boolean) => void;
  onChanged: () => void;
  onOpenCase: (id: string) => void;
};
type Edit =
  | { kind: "signal"; action: SignalCommand["action"]; record: NeedRow | null }
  | { kind: "alert"; action: AlertCommand["action"]; detail: SuggestionDetail };
type Preview =
  | { kind: "signal"; data: NeedPreview; body: SignalCommand }
  | { kind: "alert"; data: SuggestionPreview; body: AlertCommand };
const evidenceText = (rows: SuggestionRow["evidence"]) =>
  rows
    .map(
      (e) =>
        `${e.type === "attendance" ? "Điểm danh CN" : e.type === "belief" ? "Ngày tin Chúa từ hồ sơ" : "Nguồn nhu cầu đã xác nhận"} · ${date(e.day)}${e.summary ? ` · ${e.summary}` : ""}`,
    )
    .join("; ") || "Không có bằng chứng đủ điều kiện";
export function SuggestionFacts({ row }: { row: NeedRow | SuggestionRow }) {
  return (
    <KeyValueList
      items={[
        { label: "Mã", value: row.code },
        {
          label: "Đối tượng đã ghi",
          value: `${row.targetSnapshot.name} · ${row.targetSnapshot.code}`,
        },
        { label: "Loại nhu cầu", value: needKinds[row.kind] },
        {
          label: "Trạng thái",
          value: "evidence" in row ? suggestionStates[row.state] : needStates[row.state],
        },
        ...("evidence" in row
          ? [
              {
                label: "Nguồn đã ghi",
                value: evidenceText(row.evidence),
              },
              {
                label: "Đánh giá lần cuối",
                value: new Date(row.lastEvaluatedAt).toLocaleString("vi-VN", {
                  timeZone: "Asia/Ho_Chi_Minh",
                }),
              },
              { label: "Lý do quyết định", value: row.decisionReason ?? "—" },
            ]
          : [
              { label: "Ngày nguồn", value: date(row.occurredOn) },
              { label: "Ghi chú nguồn", value: row.summary ?? "—" },
            ]),
      ]}
    />
  );
}
export function CareSuggestions(props: Props) {
  const initial = new URLSearchParams(location.search),
    [view, setView] = useState<"alert" | "signal">(
      initial.get("careView") === "signal" ? "signal" : "alert",
    ),
    [id, setId] = useState(initial.get("careSuggestionId") ?? ""),
    [filters, setFilters] = useState({
      kind: initial.get("careKind") ?? "",
      state:
        initial.get("careState") ?? (initial.get("careView") === "signal" ? "open" : "pending"),
      q: "",
    }),
    [applied, setApplied] = useState(filters),
    [cursor, setCursor] = useState<string | null>(null),
    [page, setPage] = useState<SuggestionPage | null>(null),
    [detail, setDetail] = useState<SuggestionDetail | null>(null),
    [history, setHistory] = useState<SuggestionHistory | null>(null),
    [edit, setEdit] = useState<Edit | null>(null),
    [preview, setPreview] = useState<Preview | null>(null),
    [confirmed, setConfirmed] = useState(false),
    [loading, setLoading] = useState(false),
    [detailLoading, setDetailLoading] = useState(false),
    [reload, setReload] = useState(0),
    [scan, setScan] = useState<{
      nextCursor: string | null;
      processed: number;
      complete: boolean;
      coverage: number;
    } | null>(null);
  const epoch = useRef(0),
    prefix = `${props.realm === "owner" ? "owner/" : ""}churches/${props.churchId}/care/suggestions`,
    resource = view === "signal" ? `${prefix}/signals` : prefix,
    ownPending = props.pending?.path === prefix || !!props.pending?.path.startsWith(`${prefix}/`),
    principal = useRef("");
  function purge(discard: boolean) {
    epoch.current++;
    setPage(null);
    setDetail(null);
    setHistory(null);
    setEdit(null);
    setPreview(null);
    setId("");
    setConfirmed(false);
    setScan(null);
    setFilters({ kind: "", state: view === "signal" ? "open" : "pending", q: "" });
    setApplied((old) =>
      old.kind === "" && old.q === "" && old.state === (view === "signal" ? "open" : "pending")
        ? old
        : { kind: "", state: view === "signal" ? "open" : "pending", q: "" },
    );
    props.onDialog(false);
    if (discard && ownPending) props.onPending(null);
  }
  const mutation = useTenantMutation({
    ...props,
    prefix,
    operationPath: `${prefix}/operations`,
    principalKey: page?.principalKey ?? "",
    canWrite: page?.canManage ?? false,
    onAccessLoss: (error) => {
      purge(true);
      if (error.code === "FORBIDDEN") props.onAuthError(error);
    },
    onAuthError: (e) => {
      purge(!(e instanceof ApiError && e.code === "REAUTH_REQUIRED"));
      props.onAuthError(e);
    },
    onSuccess: (data) => {
      const r = data as {
        processed?: number;
        nextCursor?: string | null;
        complete?: boolean;
        coverage?: number;
        signalId?: string;
        alertId?: string;
        caseId?: string | null;
      };
      setEdit(null);
      setPreview(null);
      setHistory(null);
      if (r.processed !== undefined)
        setScan((old) => ({
          processed: (old?.processed ?? 0) + (r.processed ?? 0),
          nextCursor: r.nextCursor ?? null,
          complete: r.complete ?? false,
          coverage: r.coverage ?? 0,
        }));
      else {
        if (r.signalId && view !== "signal") switchView("signal");
        setId(r.signalId ?? r.alertId ?? "");
        props.onChanged();
      }
      setCursor(null);
      setReload((n) => n + 1);
    },
  });
  function fail(e: unknown) {
    if (e instanceof ApiError && authErrorCodes.includes(e.code)) {
      purge(e.code !== "REAUTH_REQUIRED");
      props.onAuthError(e);
    } else mutation.fail(e);
  }
  const busy = loading || detailLoading || mutation.busy || !!props.pending || props.otherDialog;
  useEffect(() => {
    props.onDialog(!!edit || !!preview);
  }, [!!edit, !!preview]);
  useEffect(
    () => () => {
      epoch.current++;
      props.onDialog(false);
    },
    [],
  );
  useEffect(() => {
    const u = new URL(location.href);
    for (const k of ["careSuggestionId", "careView", "careKind", "careState"])
      u.searchParams.delete(k);
    if (id) u.searchParams.set("careSuggestionId", id);
    u.searchParams.set("careView", view);
    if (applied.kind) u.searchParams.set("careKind", applied.kind);
    if (applied.state) u.searchParams.set("careState", applied.state);
    window.history.replaceState(null, "", u);
  }, [id, view, applied]);
  useEffect(() => {
    const a = new AbortController(),
      token = epoch.current;
    setLoading(true);
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(applied)) if (v) q.set(k, v);
    if (cursor) q.set("cursor", cursor);
    void tenantRequest<SuggestionPage>(props.realm, `${resource}?${q}`, { signal: a.signal })
      .then((r) => {
        if (a.signal.aborted || token !== epoch.current) return;
        if (
          (principal.current && principal.current !== r.data.principalKey) ||
          (ownPending && props.pending?.principalKey !== r.data.principalKey)
        ) {
          purge(true);
          mutation.setError(
            "Người thao tác hoặc quyền đã thay đổi. Kiểm tra lại nguồn và kết quả trước khi tiếp tục.",
          );
        }
        principal.current = r.data.principalKey;
        setPage(r.data);
        if (new URLSearchParams(location.search).get("careSection") === "suggestions")
          document.getElementById("care-suggestions")?.scrollIntoView();
      })
      .catch((e) => {
        if (!a.signal.aborted && token === epoch.current) fail(e);
      })
      .finally(() => {
        if (!a.signal.aborted) setLoading(false);
      });
    return () => a.abort();
  }, [resource, applied, cursor, reload]);
  useEffect(() => {
    if (!id || !page) return;
    const a = new AbortController(),
      token = epoch.current;
    setDetailLoading(true);
    void tenantRequest<SuggestionDetail>(props.realm, `${resource}/${id}`, { signal: a.signal })
      .then((r) => {
        if (!a.signal.aborted && token === epoch.current) {
          setDetail(r.data);
          setHistory(null);
        }
      })
      .catch((e) => {
        if (!a.signal.aborted && token === epoch.current) fail(e);
      })
      .finally(() => {
        if (!a.signal.aborted) setDetailLoading(false);
      });
    return () => a.abort();
  }, [id, resource, reload, page?.principalKey]);
  async function prepare(body: SignalCommand | AlertCommand) {
    if (!edit || busy) return;
    const token = epoch.current;
    mutation.setBusy(true);
    mutation.setError("");
    try {
      const r = await tenantRequest<NeedPreview | SuggestionPreview>(
        props.realm,
        `${edit.kind === "signal" ? `${prefix}/signals` : prefix}${edit.kind === "signal" ? (edit.record ? `/${edit.record.id}` : "") : `/${edit.detail.record.id}`}/preview`,
        {
          method: "POST",
          body,
          headers:
            edit.kind === "signal" && !edit.record
              ? {}
              : {
                  "If-Match": `"${edit.kind === "signal" ? edit.record?.version : edit.detail.record.version}"`,
                },
        },
      );
      if (token === epoch.current) {
        setPreview(
          edit.kind === "signal"
            ? { kind: "signal", data: r.data as NeedPreview, body: body as SignalCommand }
            : { kind: "alert", data: r.data as SuggestionPreview, body: body as AlertCommand },
        );
        setConfirmed(false);
      }
    } catch (e) {
      if (token === epoch.current) fail(e);
    } finally {
      mutation.setBusy(false);
    }
  }
  async function showHistory(after: string | null = null) {
    if (!detail || busy) return;
    const token = epoch.current;
    mutation.setBusy(true);
    try {
      const r = await tenantRequest<SuggestionHistory>(
        props.realm,
        `${resource}/${detail.record.id}/history${after ? `?cursor=${encodeURIComponent(after)}` : ""}`,
      );
      if (token === epoch.current)
        setHistory((old) => ({
          ...r.data,
          items: after ? [...(old?.items ?? []), ...r.data.items] : r.data.items,
        }));
    } catch (e) {
      if (token === epoch.current) fail(e);
    } finally {
      mutation.setBusy(false);
    }
  }
  function switchView(next: "alert" | "signal") {
    setView(next);
    setPage(null);
    setId("");
    setDetail(null);
    setHistory(null);
    const f = { kind: "", state: next === "alert" ? "pending" : "open", q: "" };
    setFilters(f);
    setApplied(f);
    setCursor(null);
  }
  function open(next: Edit) {
    if (busy) return;
    mutation.setError("");
    setPreview(null);
    setConfirmed(false);
    setEdit(next);
  }
  const reconcile = ownPending && page && props.pending?.principalKey === page.principalKey && (
    <Feedback tone="warning">
      Thao tác chăm sóc đang chờ đối soát.{" "}
      <Button
        disabled={mutation.busy}
        onClick={() => void mutation.execute(props.pending as TenantIntent, true)}
      >
        Đối soát đề nghị / thử lại cùng yêu cầu
      </Button>
    </Feedback>
  );
  return (
    <section id="care-suggestions" className="care-section" aria-label="Đề nghị chăm sóc">
      <Card>
        <div className="care-section">
          <SectionHeader title="Đề nghị chăm sóc">
            <Button
              variant="primary"
              disabled={busy || !page?.canManage}
              onClick={() => open({ kind: "signal", action: "create", record: null })}
            >
              Ghi nhận nhu cầu
            </Button>
          </SectionHeader>
          {mutation.error && <Feedback tone="error">{mutation.error}</Feedback>}
          {mutation.notice && <Feedback tone="success">{mutation.notice}</Feedback>}
          {reconcile}
          <p>
            Đánh giá lần cuối:{" "}
            {page?.assessment.lastEvaluatedAt
              ? new Date(page.assessment.lastEvaluatedAt).toLocaleString("vi-VN", {
                  timeZone: "Asia/Ho_Chi_Minh",
                })
              : "Chưa đánh giá"}
            {page?.assessment.lastEvaluatedAt && !page.assessment.complete
              ? " · Chưa xong các lô"
              : ""}
            .
          </p>
          <Toolbar>
            <Button
              disabled={busy || !page?.canManage}
              onClick={() => {
                setScan(null);
                mutation.send(`${prefix}/evaluate`, "POST", { cursor: null, limit: 100 });
              }}
            >
              Đánh giá nguồn
            </Button>
            {scan?.nextCursor && (
              <Button
                disabled={busy}
                onClick={() =>
                  mutation.send(`${prefix}/evaluate`, "POST", {
                    cursor: scan.nextCursor,
                    limit: 100,
                  })
                }
              >
                Tiếp tục đánh giá nguồn
              </Button>
            )}
            <Button disabled={busy} onClick={() => switchView("alert")}>
              Xem đề nghị
            </Button>
            <Button disabled={busy} onClick={() => switchView("signal")}>
              Nguồn nhu cầu đã ghi
            </Button>
          </Toolbar>
          {scan && (
            <Feedback tone={scan.coverage === 3 ? "info" : "warning"}>
              Đã đánh giá {scan.processed} lượt nguồn ·{" "}
              {scan.complete ? "Đã xong các lô" : "Còn lô tiếp theo"}. Nguồn vắng3: {scan.coverage}
              /3 CN đã chốt. Thiếu nguồn không được suy thành vắng hoặc hết nhu cầu.
            </Feedback>
          )}
          <Toolbar>
            <Field label="Loại đề nghị">
              <Select
                value={filters.kind}
                disabled={busy}
                onChange={(e) => setFilters({ ...filters, kind: e.target.value })}
              >
                <option value="">Tất cả loại</option>
                {Object.entries(needKinds)
                  .filter(([k]) => view === "alert" || k !== "absence")
                  .map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
              </Select>
            </Field>
            <Field label="Trạng thái đề nghị / nguồn">
              <Select
                disabled={busy}
                value={filters.state}
                onChange={(e) => setFilters({ ...filters, state: e.target.value })}
              >
                <option value="all">Tất cả trạng thái</option>
                {Object.entries(view === "alert" ? suggestionStates : needStates).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Tìm người / gia đình / mã đề nghị">
              <TextInput
                maxLength={100}
                disabled={busy}
                value={filters.q}
                onChange={(e) => setFilters({ ...filters, q: e.target.value })}
              />
            </Field>
            <Button
              variant="primary"
              disabled={busy}
              onClick={() => {
                setApplied(filters);
                setCursor(null);
                setReload((n) => n + 1);
              }}
            >
              Lọc đề nghị
            </Button>
            <Button disabled={busy} onClick={() => setReload((n) => n + 1)}>
              Làm mới đề nghị
            </Button>
          </Toolbar>
          {loading && <Loading />}
          {page && (
            <p>
              Theo bộ lọc: {page.summary.total} {view === "alert" ? "đề nghị" : "nguồn"}.
            </p>
          )}
          <TableFrame
            label={view === "alert" ? "Danh sách đề nghị chăm sóc" : "Danh sách nguồn nhu cầu"}
          >
            <table>
              <thead>
                <tr>
                  {["Người / Gia đình", "Lý do", "Nguồn", "Trạng thái", "Thao tác"].map((x) => (
                    <th key={x}>{x}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {page?.items.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <strong>{r.targetSnapshot.name}</strong>
                      <div>
                        {r.targetSnapshot.code} · {r.code}
                      </div>
                    </td>
                    <td>{needKinds[r.kind]}</td>
                    <td>
                      {"evidence" in r
                        ? r.evidence.map((e) => date(e.day)).join(" · ")
                        : date(r.occurredOn)}
                    </td>
                    <td>
                      <Badge>
                        {"evidence" in r ? suggestionStates[r.state] : needStates[r.state]}
                      </Badge>
                    </td>
                    <td>
                      <Button
                        disabled={busy}
                        onClick={() => {
                          setDetail(null);
                          setId(r.id);
                        }}
                      >
                        Xem đề nghị / nguồn
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableFrame>
          {page && !page.items.length && !loading && (
            <EmptyState message="Chưa có đề nghị hoặc nguồn phù hợp." />
          )}
          {page?.nextCursor && (
            <PaginationControl loading={busy} onMore={() => setCursor(page.nextCursor)} />
          )}
        </div>
      </Card>
      {detailLoading && <Loading />}
      {detail && (
        <Card>
          <div className="care-section">
            <SectionHeader title={`Chi tiết ${detail.record.code}`} />
            <SuggestionFacts row={detail.record} />
            <p>
              Nguồn hiện tại:{" "}
              {!detail.current.available
                ? "Đối tượng không còn hợp lệ"
                : detail.current.qualifies === null
                  ? "Chưa đủ bằng chứng"
                  : detail.current.qualifies
                    ? "Đủ điều kiện"
                    : "Không còn đủ điều kiện"}
              .
            </p>
            {view === "alert" && (
              <KeyValueList
                items={[{ label: "Nguồn hiện hành", value: evidenceText(detail.current.evidence) }]}
              />
            )}
            {detail.current.target &&
              detail.current.target.name !== detail.record.targetSnapshot.name && (
                <Feedback tone="warning">
                  Tên hiện tại: {detail.current.target.name}. Snapshot cũ được giữ.
                </Feedback>
              )}
            <Toolbar>
              {view === "alert" &&
                "episodeActive" in detail.record &&
                detail.record.state === "pending" && (
                  <>
                    <Button
                      variant="primary"
                      disabled={busy || detail.current.qualifies !== true}
                      onClick={() => open({ kind: "alert", action: "convert", detail })}
                    >
                      Chuyển sang thăm viếng
                    </Button>
                    <Button
                      disabled={busy}
                      onClick={() => open({ kind: "alert", action: "dismiss", detail })}
                    >
                      Bỏ qua có lý do
                    </Button>
                  </>
                )}
              {view === "signal" && !("episodeActive" in detail.record) && (
                <>
                  <Button
                    disabled={busy}
                    onClick={() =>
                      open({ kind: "signal", action: "correct", record: detail.record as NeedRow })
                    }
                  >
                    Đính chính nguồn
                  </Button>
                  {detail.record.state === "open" && (
                    <Button
                      disabled={busy}
                      onClick={() =>
                        open({ kind: "signal", action: "end", record: detail.record as NeedRow })
                      }
                    >
                      Kết thúc nguồn
                    </Button>
                  )}
                </>
              )}
              {"caseId" in detail.record && detail.record.caseId && (
                <Button
                  disabled={busy}
                  onClick={() =>
                    props.onOpenCase((detail.record as SuggestionRow).caseId as string)
                  }
                >
                  Mở hồ sơ thăm viếng đã liên kết
                </Button>
              )}
              <Button disabled={busy} onClick={() => void showHistory()}>
                Lịch sử đề nghị / nguồn
              </Button>
              <Button
                disabled={busy}
                onClick={() => {
                  setId("");
                  setDetail(null);
                  setHistory(null);
                }}
              >
                Đóng chi tiết đề nghị
              </Button>
            </Toolbar>
            {history && (
              <>
                <SectionHeader title="Lịch sử đề nghị / nguồn" />
                {history.items.map((h) => (
                  <details key={h.id}>
                    <summary>
                      {new Date(h.occurredAt).toLocaleString("vi-VN", {
                        timeZone: "Asia/Ho_Chi_Minh",
                      })}{" "}
                      · {careEvents[h.event as keyof typeof careEvents] ?? h.event} ·{" "}
                      {h.reason ?? "Đánh giá nguồn"}
                    </summary>
                    <div className="care-section">
                      {h.before && (
                        <>
                          <h4>Trước</h4>
                          <SuggestionFacts row={h.before as NeedRow | SuggestionRow} />
                        </>
                      )}
                      <h4>Sau</h4>
                      <SuggestionFacts row={h.after as NeedRow | SuggestionRow} />
                      <p>
                        {h.actorKind} · {h.actorId}
                      </p>
                    </div>
                  </details>
                ))}
                {history.nextCursor && (
                  <PaginationControl
                    loading={busy}
                    onMore={() => void showHistory(history.nextCursor)}
                  />
                )}
              </>
            )}
          </div>
        </Card>
      )}
      <Modal
        open={!!edit || !!preview}
        title={
          preview
            ? "Xác nhận chăm sóc"
            : edit?.kind === "signal"
              ? "Nguồn nhu cầu chăm sóc"
              : "Quyết định đề nghị chăm sóc"
        }
        locked={mutation.busy || !!props.pending}
        onClose={() => {
          if (!mutation.busy && !props.pending) {
            setEdit(null);
            setPreview(null);
          }
        }}
      >
        {mutation.error && <Feedback tone="error">{mutation.error}</Feedback>}
        {reconcile}
        {edit && (
          <div hidden={!!preview}>
            {edit.kind === "signal" ? (
              <NeedForm
                key={`${edit.action}:${edit.record?.id ?? "new"}`}
                {...props}
                prefix={prefix}
                action={edit.action}
                record={edit.record}
                locked={busy}
                onPreview={(b) => void prepare(b)}
                onCancel={() => setEdit(null)}
                onError={fail}
              />
            ) : (
              <DecisionForm
                key={`${edit.action}:${edit.detail.record.id}`}
                {...props}
                prefix={prefix}
                detail={edit.detail}
                action={edit.action}
                locked={busy}
                onPreview={(b) => void prepare(b)}
                onCancel={() => setEdit(null)}
                onError={fail}
              />
            )}
          </div>
        )}
        {preview && (
          <div className="care-section">
            {preview.kind === "signal" ? (
              <KeyValueList
                items={[
                  {
                    label: "Đối tượng",
                    value: preview.data.target?.name ?? "Nguồn không còn hợp lệ",
                  },
                  { label: "Loại", value: needKinds[preview.data.kind] },
                  { label: "Ngày nguồn", value: date(preview.data.fields.occurredOn) },
                  { label: "Ghi chú", value: preview.data.fields.summary ?? "—" },
                  { label: "Thao tác", value: careEvents[preview.data.action] },
                ]}
              />
            ) : (
              <>
                <SuggestionFacts row={preview.data.before} />
                <KeyValueList
                  items={[
                    {
                      label: "Đối tượng hiện tại",
                      value: preview.data.current.target?.name ?? "Không còn hợp lệ",
                    },
                    {
                      label: "Nguồn tại lần xác nhận",
                      value: evidenceText(preview.data.current.evidence),
                    },
                  ]}
                />
                <KeyValueList
                  items={[
                    {
                      label: "Kết quả sau xác nhận",
                      value:
                        preview.data.action === "dismiss"
                          ? "Bỏ qua đề nghị"
                          : preview.data.existing
                            ? `Liên kết hồ sơ ${preview.data.existing.code}; giữ phân công hiện có`
                            : "Tạo hồ sơ thăm viếng mới",
                    },
                    { label: "Mô tả", value: preview.data.visit?.fields.description ?? "—" },
                    {
                      label: "Người phụ trách",
                      value:
                        preview.data.existing?.assignee?.fullName ??
                        preview.data.visit?.assignee?.fullName ??
                        "Chưa phân công",
                    },
                    {
                      label: "Ngày dự kiến",
                      value: date(
                        preview.data.existing?.plannedOn ??
                          preview.data.visit?.fields.plannedOn ??
                          null,
                      ),
                    },
                  ]}
                />
              </>
            )}
            <p>Lý do: {preview.data.reason ?? "—"}</p>
            {preview.data.before && (
              <details>
                <summary>Trước thay đổi</summary>
                <SuggestionFacts row={preview.data.before} />
              </details>
            )}
            <Choice
              label="Tôi đã kiểm tra nguồn và quyết định chăm sóc."
              checked={confirmed}
              disabled={busy}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            <DialogActions>
              <Button disabled={busy} onClick={() => setPreview(null)}>
                Quay lại sửa
              </Button>
              <Button
                variant="primary"
                disabled={busy || !confirmed}
                onClick={() => {
                  if (!edit) return;
                  const targetId = edit.kind === "signal" ? edit.record?.id : edit.detail.record.id;
                  mutation.send(
                    `${edit.kind === "signal" ? `${prefix}/signals` : prefix}${targetId ? `/${targetId}` : ""}`,
                    targetId ? "PATCH" : "POST",
                    { ...preview.body, preview: preview.data.context, confirmed },
                    edit.kind === "signal" ? edit.record?.version : edit.detail.record.version,
                  );
                }}
              >
                Xác nhận lưu chăm sóc
              </Button>
            </DialogActions>
          </div>
        )}
      </Modal>
    </section>
  );
}
