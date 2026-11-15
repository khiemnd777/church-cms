import { useEffect, useRef, useState } from "react";
import type { VisitCommand } from "../api/visitation/validation";
import type { ChurchRef } from "./access-context";
import { CareSuggestions } from "./care-suggestions";
import { PrayersView } from "./prayers";
import {
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
import {
  type CareCase,
  type CareCaseRow,
  type CareEntries,
  type CareEntry,
  type CareHistory,
  type CarePage,
  type CarePreview,
  careActions,
  careOutcomes,
  careReasons,
  careStates,
} from "./visitation-api";
import { CarePeoplePicker, VisitationForm } from "./visitation-form";
import "./visitation.css";
import "./prayers.css";
type Props = {
  realm: TenantRealm;
  churchId: string;
  pending: TenantIntent | null;
  onPending: (i: TenantIntent | null) => void;
  onAuthError: (e: unknown) => void;
  onTitle: (s: string, c?: string) => void;
  onChurch?: (c: ChurchRef) => void;
};
const date = (d: string | null) =>
  d
    ? new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", dateStyle: "short" }).format(
        new Date(`${d}T00:00:00+07:00`),
      )
    : "—";
function CaseFacts({ record }: { record: CareCaseRow }) {
  return (
    <KeyValueList
      items={[
        { label: "Hồ sơ", value: record.code },
        {
          label: "Đối tượng lúc tạo",
          value: `${record.targetSnapshot.name} · ${record.targetSnapshot.code}`,
        },
        { label: "Nhóm lý do", value: careReasons[record.reasonCode] },
        { label: "Mô tả", value: record.description },
        { label: "Ưu tiên", value: record.priority === "high" ? "Cao" : "Thường" },
        { label: "Ngày dự kiến", value: date(record.plannedOn) },
        { label: "Người phụ trách", value: record.assignee?.fullName ?? "Chưa phân công" },
        { label: "Trạng thái", value: careStates[record.state] },
        { label: "Các lần thăm / đã gặp", value: `${record.entryCount} / ${record.visitedCount}` },
        { label: "Lý do đóng", value: record.closeReason ?? "—" },
      ]}
    />
  );
}
function EntryFacts({ entry }: { entry: CareEntry }) {
  return (
    <KeyValueList
      items={[
        { label: "Ngày thăm", value: date(entry.visitedOn) },
        { label: "Người tham gia", value: entry.participants.map((p) => p.fullName).join(", ") },
        { label: "Kết quả", value: careOutcomes[entry.outcome] },
        { label: "Ghi chú", value: entry.note },
        { label: "Đối tượng lúc ghi", value: entry.targetSnapshot.name },
      ]}
    />
  );
}
export function VisitationView(props: Props) {
  const url = new URLSearchParams(location.search),
    [caseId, setCaseId] = useState(url.get("caseId") ?? ""),
    [filters, setFilters] = useState({
      state: url.get("state") ?? "open",
      reason: url.get("reason") ?? "",
      priority: url.get("priority") ?? "",
      q: url.get("q") ?? "",
      from: url.get("from") ?? "",
      to: url.get("to") ?? "",
      overdue: url.get("overdue") === "true",
      assigneeId: url.get("assigneeId") ?? "",
    }),
    [applied, setApplied] = useState(filters),
    [cursor, setCursor] = useState<string | null>(null),
    [page, setPage] = useState<CarePage | null>(null),
    [record, setRecord] = useState<CareCase | null>(null),
    [entries, setEntries] = useState<CareEntries | null>(null),
    [history, setHistory] = useState<CareHistory | null>(null),
    [loading, setLoading] = useState(false),
    [detailLoading, setDetailLoading] = useState(false),
    [reload, setReload] = useState(0),
    [edit, setEdit] = useState<{
      action: VisitCommand["action"];
      record: CareCase | null;
      entry?: CareEntry;
    } | null>(null),
    [preview, setPreview] = useState<CarePreview | null>(null),
    [intent, setIntent] = useState<VisitCommand | null>(null),
    [confirmed, setConfirmed] = useState(false),
    [assigneeFilter, setAssigneeFilter] = useState<
      { id: string; code: string; fullName: string }[]
    >([]),
    [filterPicker, setFilterPicker] = useState(false),
    [prayerDialog, setPrayerDialog] = useState(false),
    [careDialog, setCareDialog] = useState(false);
  const prefix = `${props.realm === "owner" ? "owner/" : ""}churches/${props.churchId}/care`,
    request = useRef(0),
    mutation = useTenantMutation({
      ...props,
      principalKey: page?.principalKey ?? "",
      canWrite: page?.canManage ?? false,
      operationPath: `${prefix}/operations`,
      prefix,
      acceptPath: (path) => path === `${prefix}/cases` || path.startsWith(`${prefix}/cases/`),
      onSuccess: (data) => {
        const result = data as { caseId: string };
        setEdit(null);
        setPreview(null);
        setIntent(null);
        setCaseId(result.caseId);
        setCursor(null);
        setReload((n) => n + 1);
      },
    }),
    busy =
      loading || detailLoading || mutation.busy || !!props.pending || prayerDialog || careDialog;
  useEffect(() => {
    props.onTitle("Chăm sóc & Cầu thay");
    const a = new AbortController();
    void tenantRequest<{ church: ChurchRef }>(
      props.realm,
      `${props.realm === "owner" ? "owner/" : ""}churches/${props.churchId}/context`,
      { signal: a.signal },
    )
      .then((r) => {
        if (!a.signal.aborted) {
          props.onTitle("Chăm sóc & Cầu thay", `${r.data.church.name} · ${r.data.church.code}`);
          props.onChurch?.(r.data.church);
        }
      })
      .catch((e) => {
        if (!a.signal.aborted) mutation.fail(e);
      });
    return () => a.abort();
  }, [prefix]);
  useEffect(() => {
    const u = new URL(location.href);
    for (const k of [...Object.keys(applied), "caseId"]) u.searchParams.delete(k);
    for (const [k, v] of Object.entries(applied)) {
      if (v) u.searchParams.set(k, String(v));
    }
    if (caseId) u.searchParams.set("caseId", caseId);
    window.history.replaceState(null, "", u);
  }, [caseId, applied]);
  useEffect(() => {
    const a = new AbortController();
    setLoading(true);
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(applied)) if (v) q.set(k, String(v));
    if (cursor) q.set("cursor", cursor);
    void tenantRequest<CarePage>(props.realm, `${prefix}/cases?${q}`, { signal: a.signal })
      .then((r) => {
        if (!a.signal.aborted)
          setPage((old) => ({
            ...r.data,
            items: cursor
              ? [
                  ...new Map(
                    [...(old?.items ?? []), ...r.data.items].map((c) => [c.id, c]),
                  ).values(),
                ]
              : r.data.items,
          }));
      })
      .catch((e) => {
        if (!a.signal.aborted) {
          setPage(null);
          mutation.fail(e);
        }
      })
      .finally(() => {
        if (!a.signal.aborted) setLoading(false);
      });
    return () => a.abort();
  }, [prefix, props.realm, applied, cursor, reload]);
  useEffect(() => {
    const a = new AbortController(),
      seq = ++request.current;
    setRecord(null);
    setEntries(null);
    setHistory(null);
    if (!caseId) return;
    setDetailLoading(true);
    void Promise.all([
      tenantRequest<CareCase>(props.realm, `${prefix}/cases/${caseId}`, { signal: a.signal }),
      tenantRequest<CareEntries>(props.realm, `${prefix}/cases/${caseId}/entries`, {
        signal: a.signal,
      }),
    ])
      .then(([c, e]) => {
        if (!a.signal.aborted && seq === request.current) {
          setRecord(c.data);
          setEntries(e.data);
        }
      })
      .catch((e) => {
        if (!a.signal.aborted) mutation.fail(e);
      })
      .finally(() => {
        if (!a.signal.aborted) setDetailLoading(false);
      });
    return () => a.abort();
  }, [prefix, props.realm, caseId, reload]);
  function open(action: VisitCommand["action"], entry?: CareEntry) {
    if (busy) return;
    mutation.setError("");
    setPreview(null);
    setIntent(null);
    setConfirmed(false);
    setEdit({ action, record: action === "create" ? null : record, ...(entry ? { entry } : {}) });
  }
  async function prepare(b: VisitCommand) {
    if (!edit || busy) return;
    mutation.setBusy(true);
    mutation.setError("");
    try {
      const r = await tenantRequest<CarePreview>(
        props.realm,
        `${prefix}/cases${edit.record ? `/${edit.record.id}` : ""}/preview`,
        {
          method: "POST",
          body: b,
          headers: edit.record ? { "If-Match": `"${edit.record.version}"` } : {},
        },
      );
      setPreview(r.data);
      setIntent(b);
      setConfirmed(false);
    } catch (e) {
      mutation.fail(e);
    } finally {
      mutation.setBusy(false);
    }
  }
  async function moreEntries() {
    if (!entries?.nextCursor || !record) return;
    mutation.setBusy(true);
    try {
      const r = await tenantRequest<CareEntries>(
        props.realm,
        `${prefix}/cases/${record.id}/entries?cursor=${encodeURIComponent(entries.nextCursor)}`,
      );
      setEntries({ ...r.data, items: [...entries.items, ...r.data.items] });
    } catch (e) {
      mutation.fail(e);
    } finally {
      mutation.setBusy(false);
    }
  }
  async function showHistory(cursor: string | null = null) {
    if (!record) return;
    mutation.setBusy(true);
    try {
      const r = await tenantRequest<CareHistory>(
        props.realm,
        `${prefix}/cases/${record.id}/history${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
      );
      setHistory((old) => ({
        ...r.data,
        items: cursor ? [...(old?.items ?? []), ...r.data.items] : r.data.items,
      }));
    } catch (e) {
      mutation.fail(e);
    } finally {
      mutation.setBusy(false);
    }
  }
  const ownPending =
      props.pending?.path === `${prefix}/cases` ||
      props.pending?.path.startsWith(`${prefix}/cases/`),
    reconcile = ownPending && (
      <Feedback tone="warning">
        Thao tác thăm viếng đang chờ đối soát.{" "}
        <Button
          disabled={mutation.busy || !page?.canManage}
          onClick={() => void mutation.execute(props.pending as TenantIntent, true)}
        >
          Đối soát thăm viếng / thử lại cùng yêu cầu
        </Button>
      </Feedback>
    );
  return (
    <section className="care-section">
      <Toolbar>
        <Button
          disabled={busy}
          onClick={() => document.getElementById("care-suggestions")?.scrollIntoView()}
        >
          Đến đề nghị chăm sóc
        </Button>
        <Button
          disabled={busy}
          onClick={() => document.getElementById("visitation")?.scrollIntoView()}
        >
          Đến thăm viếng
        </Button>
        <Button
          disabled={busy}
          onClick={() => document.getElementById("prayers")?.scrollIntoView()}
        >
          Đến lời cầu thay
        </Button>
      </Toolbar>
      <CareSuggestions
        {...props}
        otherDialog={!!edit || !!preview || filterPicker || prayerDialog}
        onDialog={setCareDialog}
        onChanged={() => setReload((n) => n + 1)}
        onOpenCase={(id) => {
          setCaseId(id);
          setReload((n) => n + 1);
          document.getElementById("visitation")?.scrollIntoView();
        }}
      />
      <div id="visitation" />
      <Card>
        <div className="care-section">
          <SectionHeader title="Danh sách thăm viếng">
            <Button
              variant="primary"
              disabled={busy || !page?.canManage}
              onClick={() => open("create")}
            >
              + Tạo hồ sơ
            </Button>
          </SectionHeader>
          <p className="muted">Hồ sơ thăm viếng thủ công</p>
          {mutation.error && <Feedback tone="error">{mutation.error}</Feedback>}
          {mutation.notice && <Feedback tone="success">{mutation.notice}</Feedback>}
          {reconcile}
          <Toolbar>
            <Field label="Trạng thái hồ sơ">
              <Select
                disabled={busy}
                value={filters.state}
                onChange={(e) => setFilters({ ...filters, state: e.target.value })}
              >
                <option value="all">Tất cả</option>
                {Object.entries(careStates).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Lọc nhóm lý do">
              <Select
                disabled={busy}
                value={filters.reason}
                onChange={(e) => setFilters({ ...filters, reason: e.target.value })}
              >
                <option value="">Tất cả lý do</option>
                {Object.entries(careReasons).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Lọc ưu tiên">
              <Select
                disabled={busy}
                value={filters.priority}
                onChange={(e) => setFilters({ ...filters, priority: e.target.value })}
              >
                <option value="">Tất cả</option>
                <option value="normal">Thường</option>
                <option value="high">Cao</option>
              </Select>
            </Field>
            <Field label="Tìm tên / mã hồ sơ">
              <TextInput
                disabled={busy}
                maxLength={100}
                value={filters.q}
                onChange={(e) => setFilters({ ...filters, q: e.target.value })}
              />
            </Field>
          </Toolbar>
          <Toolbar>
            <Field label="Dự kiến từ ngày">
              <TextInput
                disabled={busy}
                type="date"
                value={filters.from}
                onChange={(e) => setFilters({ ...filters, from: e.target.value })}
              />
            </Field>
            <Field label="Dự kiến đến ngày">
              <TextInput
                disabled={busy}
                type="date"
                value={filters.to}
                onChange={(e) => setFilters({ ...filters, to: e.target.value })}
              />
            </Field>
            <Choice
              label="Chỉ hồ sơ quá hạn"
              checked={filters.overdue}
              disabled={busy}
              onChange={(e) => setFilters({ ...filters, overdue: e.target.checked })}
            />
            <Button disabled={busy} onClick={() => setFilterPicker((x) => !x)}>
              Lọc người phụ trách
            </Button>
            <Button
              disabled={busy}
              variant="primary"
              onClick={() => {
                setApplied(filters);
                setCursor(null);
                setReload((n) => n + 1);
              }}
            >
              Lọc
            </Button>
            <Button
              disabled={busy}
              onClick={() => {
                setCursor(null);
                setReload((n) => n + 1);
              }}
            >
              Làm mới
            </Button>
          </Toolbar>
          {filters.assigneeId && (
            <div className="care-actions">
              <span>
                Người phụ trách đang lọc:{" "}
                {assigneeFilter.find((p) => p.id === filters.assigneeId)?.fullName ??
                  page?.items.find((c) => c.assigneeId === filters.assigneeId)?.assignee
                    ?.fullName ??
                  "Đã chọn theo liên kết"}
              </span>
              <Button
                disabled={busy}
                onClick={() => {
                  setFilters({ ...filters, assigneeId: "" });
                  setApplied({ ...applied, assigneeId: "" });
                  setAssigneeFilter([]);
                  setCursor(null);
                }}
              >
                Bỏ lọc người phụ trách
              </Button>
            </div>
          )}
          {filterPicker && (
            <CarePeoplePicker
              realm={props.realm}
              prefix={prefix}
              label="Lọc theo người phụ trách"
              selected={assigneeFilter}
              locked={busy}
              onError={mutation.fail}
              onChange={(p) => {
                setAssigneeFilter(p);
                setFilters({ ...filters, assigneeId: p[0]?.id ?? "" });
              }}
            />
          )}
          {page && (
            <p className="muted">
              Theo bộ lọc: {page.summary.total} hồ sơ · {page.summary.completed} hoàn tất ·{" "}
              {page.summary.cancelled} đã hủy
            </p>
          )}
          {loading && <Loading />}
          {page && !page.items.length && !loading && (
            <EmptyState message="Chưa có hồ sơ phù hợp. Tạo hồ sơ thủ công khi có nhu cầu chăm sóc." />
          )}
          <TableFrame label="Danh sách thăm viếng">
            <table>
              <thead>
                <tr>
                  {[
                    "Người / Gia đình",
                    "Lý do",
                    "Người phụ trách",
                    "Dự kiến",
                    "Trạng thái",
                    "Thao tác",
                  ].map((t) => (
                    <th key={t}>{t}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {page?.items.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <strong>{c.targetSnapshot.name}</strong>
                      <div className="small muted">
                        {c.targetSnapshot.code} · {c.code}
                      </div>
                    </td>
                    <td>
                      {c.priority === "high" && <Badge tone="bad">Ưu tiên</Badge>}{" "}
                      {careReasons[c.reasonCode]}
                      <div className="small care-detail">{c.description}</div>
                    </td>
                    <td>{c.assignee?.fullName ?? "Chưa phân công"}</td>
                    <td>
                      {date(c.plannedOn)}
                      {c.state === "open" && c.plannedOn && page.day > c.plannedOn && (
                        <Badge tone="warn">Quá hạn</Badge>
                      )}
                    </td>
                    <td>
                      <Badge
                        tone={
                          c.state === "completed"
                            ? "good"
                            : c.state === "cancelled"
                              ? "muted"
                              : "warn"
                        }
                      >
                        {c.state === "open"
                          ? !c.assigneeId
                            ? "Chờ phân công"
                            : c.entryCount
                              ? "Đã có lần thăm"
                              : "Chờ thăm"
                          : careStates[c.state]}
                      </Badge>
                    </td>
                    <td>
                      <Button
                        disabled={busy}
                        aria-label={`Chi tiết ${c.code}`}
                        onClick={() => setCaseId(c.id)}
                      >
                        Chi tiết
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableFrame>
          {page?.nextCursor && (
            <PaginationControl loading={busy} onMore={() => setCursor(page.nextCursor)} />
          )}
        </div>
      </Card>
      {detailLoading && <Loading />}
      {record && (
        <Card>
          <div className="care-section">
            <SectionHeader title={`Hồ sơ ${record.code}`} />
            <CaseFacts record={record} />
            {(!record.current.targetAvailable || !record.current.assigneeAvailable) && (
              <Feedback tone="warning">
                Nguồn đối tượng hoặc người phụ trách không còn hợp lệ. Kiểm tra phân công trước khi
                ghi lần thăm mới; hồ sơ và lịch sử vẫn được giữ.
              </Feedback>
            )}
            {record.current.changed && (
              <Feedback tone="warning">
                Nguồn liên hệ / người phụ trách đã thay đổi. Snapshot lúc tạo không bị ghi đè.
              </Feedback>
            )}
            {record.current.target && (
              <details>
                <summary>Thông tin liên hệ hiện tại</summary>
                <KeyValueList
                  items={[
                    { label: "Đối tượng", value: record.current.target.name },
                    { label: "Điện thoại", value: record.current.target.phone ?? "—" },
                    {
                      label: "Gia đình",
                      value:
                        record.current.target.familyName ?? record.current.target.familyCode ?? "—",
                    },
                    { label: "Địa chỉ", value: record.current.target.address ?? "—" },
                  ]}
                />
              </details>
            )}
            <div className="care-actions">
              {record.state === "open" && (
                <>
                  <Button
                    disabled={busy || !record.current.targetAvailable}
                    onClick={() => open("update")}
                  >
                    Sửa phân công / thông tin
                  </Button>
                  <Button
                    variant="primary"
                    disabled={
                      busy || !record.current.targetAvailable || !record.current.assigneeAvailable
                    }
                    onClick={() => open("record")}
                  >
                    Đã thăm
                  </Button>
                  <Button
                    disabled={busy || record.visitedCount < 1}
                    onClick={() => open("complete")}
                  >
                    Hoàn tất
                  </Button>
                  <Button disabled={busy} onClick={() => open("cancel")}>
                    Hủy hồ sơ
                  </Button>
                </>
              )}
              <Button disabled={busy} onClick={() => void showHistory()}>
                Lịch sử thăm viếng
              </Button>
              <Button disabled={busy} onClick={() => setCaseId("")}>
                Đóng chi tiết
              </Button>
            </div>
            <SectionHeader title="Các lần thăm" />
            {entries && !entries.items.length && (
              <EmptyState message="Chưa ghi nhận lần thăm nào." />
            )}
            {entries?.items.map((e) => (
              <details key={e.id}>
                <summary>
                  {date(e.visitedOn)} · {careOutcomes[e.outcome]} ·{" "}
                  {e.participants.map((p) => p.fullName).join(", ")}
                </summary>
                <div className="care-section">
                  <EntryFacts entry={e} />
                  <Button disabled={busy} onClick={() => open("correct", e)}>
                    Đính chính lần thăm
                  </Button>
                </div>
              </details>
            ))}
            {entries?.nextCursor && (
              <PaginationControl loading={busy} onMore={() => void moreEntries()} />
            )}
            {history && (
              <>
                <SectionHeader title="Lịch sử thăm viếng" />
                {history.items.map((h) => {
                  const before = h.before as { case: CareCaseRow; entry: CareEntry | null } | null,
                    after = h.after as { case: CareCaseRow; entry: CareEntry | null };
                  return (
                    <details key={h.id}>
                      <summary>
                        {new Date(h.occurredAt).toLocaleString("vi-VN", {
                          timeZone: "Asia/Ho_Chi_Minh",
                        })}{" "}
                        · {careActions[h.event]} · {h.reason ?? "Ghi nhận"}
                      </summary>
                      <div className="care-section">
                        {before && (
                          <>
                            <h4>Trước</h4>
                            <CaseFacts record={before.case} />
                            {before.entry && <EntryFacts entry={before.entry} />}
                          </>
                        )}
                        <h4>Sau</h4>
                        <CaseFacts record={after.case} />
                        {after.entry && <EntryFacts entry={after.entry} />}
                      </div>
                    </details>
                  );
                })}
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
      <PrayersView
        {...props}
        otherDialog={!!edit || !!preview || filterPicker || careDialog}
        onDialog={setPrayerDialog}
      />
      <Modal
        open={!!edit || !!preview}
        title={
          preview
            ? "Xác nhận thay đổi thăm viếng"
            : edit
              ? careActions[edit.action]
              : "Hồ sơ thăm viếng"
        }
        locked={mutation.busy || !!props.pending}
        onClose={() => {
          if (!mutation.busy && !props.pending) {
            setEdit(null);
            setPreview(null);
            setIntent(null);
          }
        }}
      >
        {mutation.error && <Feedback tone="error">{mutation.error}</Feedback>}
        {reconcile}
        {edit && (
          <div hidden={!!preview}>
            <VisitationForm
              key={`${edit.action}:${edit.record?.id ?? "new"}:${edit.entry?.id ?? ""}`}
              action={edit.action}
              record={edit.record}
              entry={edit.entry}
              realm={props.realm}
              prefix={prefix}
              locked={busy}
              onPreview={(b) => void prepare(b)}
              onCancel={() => setEdit(null)}
              onError={mutation.fail}
            />
          </div>
        )}
        {preview && intent && (
          <div className="care-section">
            <KeyValueList
              items={[
                { label: "Thao tác", value: careActions[preview.action] },
                { label: "Đối tượng", value: preview.target?.name ?? "Không còn trong nguồn" },
                { label: "Nhóm lý do", value: careReasons[preview.fields.reasonCode] },
                { label: "Mô tả", value: preview.fields.description },
                {
                  label: "Người phụ trách hiện tại",
                  value: preview.assignee?.fullName ?? "Chưa phân công / không còn hợp lệ",
                },
                { label: "Ngày dự kiến", value: date(preview.fields.plannedOn) },
                { label: "Trạng thái sau lưu", value: careStates[preview.nextState] },
                { label: "Lý do thao tác", value: preview.reason ?? "—" },
              ]}
            />
            {!preview.targetAvailable && (
              <Feedback tone="warning">
                Nguồn đối tượng không còn hợp lệ. Chỉ đóng/hủy hoặc đính chính lịch sử theo lý do đã
                nhập.
              </Feedback>
            )}
            {preview.before && (
              <details>
                <summary>Hồ sơ trước thay đổi</summary>
                <CaseFacts record={preview.before} />
                {preview.beforeEntry && <EntryFacts entry={preview.beforeEntry} />}
              </details>
            )}
            {preview.entry && (
              <KeyValueList
                items={[
                  { label: "Ngày thăm", value: date(preview.entry.visitedOn) },
                  {
                    label: "Người tham gia",
                    value: preview.entry.participants.map((p) => p.fullName).join(", "),
                  },
                  { label: "Kết quả", value: careOutcomes[preview.entry.outcome] },
                  { label: "Ghi chú", value: preview.entry.note },
                ]}
              />
            )}
            {preview.confirmationRequired && (
              <Choice
                label={`Tôi xác nhận ${preview.action === "complete" ? "hoàn tất" : "hủy"} hồ sơ`}
                checked={confirmed}
                disabled={busy}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
            )}
            <DialogActions>
              <Button disabled={busy} onClick={() => setPreview(null)}>
                Quay lại sửa
              </Button>
              <Button
                variant="primary"
                disabled={busy || (preview.confirmationRequired && !confirmed)}
                onClick={() =>
                  mutation.send(
                    `${prefix}/cases${edit?.record ? `/${edit.record.id}` : ""}`,
                    edit?.record ? "PATCH" : "POST",
                    { ...intent, preview: preview.context, confirmed },
                    edit?.record?.version,
                  )
                }
              >
                Xác nhận lưu thăm viếng
              </Button>
            </DialogActions>
          </div>
        )}
      </Modal>
    </section>
  );
}
