import { useEffect, useRef, useState } from "react";
import { businessDay, shiftDay, validDay } from "../api/members/dates";
import type { ChurchRef } from "./access-context";
import { ProgramsView } from "./programs";
import {
  type ScheduleCommand,
  type ScheduleHistory,
  type SchedulePage,
  type SchedulePreview,
  type ScheduleRow,
  scheduleDate,
  scheduleStates,
} from "./scheduling-api";
import { newSchedule, ScheduleForm } from "./scheduling-form";
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
  IconButton,
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
import "./scheduling.css";
type Props = {
  realm: TenantRealm;
  churchId: string;
  pending: TenantIntent | null;
  onPending: (i: TenantIntent | null) => void;
  onAuthError: (e: unknown) => void;
  onTitle: (s: string, c?: string) => void;
  onChurch?: (c: ChurchRef) => void;
};
const sunday = (d: string, next = false) => {
  const n = new Date(`${d}T00:00:00Z`).getUTCDay();
  return shiftDay(d, next ? (7 - n) % 7 : -n);
};
export function SchedulingView(props: Props) {
  const params = new URLSearchParams(location.search),
    initial = params.get("from");
  const [from, setFrom] = useState(
      initial && validDay(initial) ? sunday(initial, true) : sunday(businessDay(), true),
    ),
    [week, setWeek] = useState(() => {
      const v = params.get("week");
      return v && validDay(v) ? sunday(v) : sunday(businessDay());
    }),
    [scope, setScope] = useState(params.get("scope") ?? ""),
    [state, setState] = useState(params.get("state") ?? ""),
    [reload, setReload] = useState(0),
    [page, setPage] = useState<SchedulePage | null>(null),
    [weekly, setWeekly] = useState<SchedulePage | null>(null),
    [cursor, setCursor] = useState<string | null>(null),
    [weekCursor, setWeekCursor] = useState<string | null>(null),
    [loading, setLoading] = useState(false),
    [principal, setPrincipal] = useState(""),
    [row, setRow] = useState<ScheduleRow | null>(null),
    [edit, setEdit] = useState<ScheduleCommand | null>(null),
    [preview, setPreview] = useState<SchedulePreview | null>(null),
    [history, setHistory] = useState<ScheduleHistory | null>(null),
    [conflictsConfirmed, setConflicts] = useState(false),
    [exceptionsConfirmed, setExceptions] = useState(false);
  const prefix = `${props.realm === "owner" ? "owner/" : ""}churches/${props.churchId}/scheduling`,
    canWrite = page?.canManage ?? false,
    locked = loading || !!props.pending;
  const mutation = useTenantMutation({
    ...props,
    principalKey: principal,
    canWrite,
    operationPath: `${prefix}/operations`,
    prefix,
    onSuccess: () => {
      setEdit(null);
      setPreview(null);
      setRow(null);
      setHistory(null);
      setCursor(null);
      setWeekCursor(null);
      setReload((n) => n + 1);
    },
  });
  const busy = locked || mutation.busy,
    sequence = useRef(0),
    sixQuery = useRef(""),
    weekQuery = useRef("");
  useEffect(() => {
    const a = new AbortController(),
      seq = ++sequence.current;
    setLoading(true);

    mutation.setError("");
    const q = (start: string, end: string, c: string | null, sundays = false) =>
      new URLSearchParams({
        from: start,
        to: end,
        ...(scope ? { scope } : {}),
        ...(state ? { state } : {}),
        ...(c ? { cursor: c } : {}),
        ...(sundays ? { sundays: "true" } : {}),
      });
    void Promise.all([
      tenantRequest<SchedulePage>(
        props.realm,
        `${prefix}/occurrences?${q(from, shiftDay(from, 35), cursor, true)}`,
        { signal: a.signal },
      ),
      tenantRequest<SchedulePage>(
        props.realm,
        `${prefix}/occurrences?${q(week, shiftDay(week, 6), weekCursor)}`,
        { signal: a.signal },
      ),
      tenantRequest<{
        church: ChurchRef;
        principal: { principalKind: string };
        policyVersion: number;
      }>(
        props.realm,
        `${props.realm === "owner" ? "owner/" : ""}churches/${props.churchId}/context`,
        { signal: a.signal },
      ),
    ])
      .then(([r, w, c]) => {
        if (a.signal.aborted || seq !== sequence.current) return;
        const sixKey = [from, scope, state, reload].join("|"),
          weekKey = [week, scope, state, reload].join("|");
        setPage((old) => {
          const append = !!cursor && sixQuery.current === sixKey;
          sixQuery.current = sixKey;
          return {
            ...r.data,
            items: append
              ? [
                  ...new Map(
                    [...(old?.items ?? []), ...r.data.items].map((row) => [row.id, row]),
                  ).values(),
                ]
              : r.data.items,
          };
        });
        setWeekly((old) => {
          const append = !!weekCursor && weekQuery.current === weekKey;
          weekQuery.current = weekKey;
          return {
            ...w.data,
            items: append
              ? [
                  ...new Map(
                    [...(old?.items ?? []), ...w.data.items].map((row) => [row.id, row]),
                  ).values(),
                ]
              : w.data.items,
          };
        });
        setPrincipal(r.data.principalKey);
        props.onTitle("Thờ phượng & Lịch giảng", `${c.data.church.name} · ${c.data.church.code}`);
        props.onChurch?.(c.data.church);
      })
      .catch((e) => {
        if (!a.signal.aborted) {
          setPage(null);
          setWeekly(null);
          mutation.fail(e);
        }
      })
      .finally(() => {
        if (!a.signal.aborted) setLoading(false);
      });
    return () => a.abort();
  }, [from, week, scope, state, cursor, weekCursor, reload, prefix, props.realm]);
  useEffect(() => {
    const u = new URL(location.href);
    u.searchParams.set("from", from);
    u.searchParams.set("week", week);
    for (const [k, v] of [
      ["scope", scope],
      ["state", state],
    ]) {
      if (v) u.searchParams.set(k as string, v as string);
      else u.searchParams.delete(k as string);
    }
    historyReplace(u);
  }, [from, week, scope, state]);
  async function open(id: string) {
    if (mutation.busy || props.pending) return;
    mutation.setBusy(true);
    try {
      const r = await tenantRequest<ScheduleRow>(props.realm, `${prefix}/occurrences/${id}`);
      setRow(r.data);
      setEdit(null);
      setPreview(null);
      setHistory(null);
      const u = new URL(location.href);
      u.searchParams.set("occurrenceId", id);
      historyReplace(u);
    } catch (e) {
      mutation.fail(e);
    } finally {
      mutation.setBusy(false);
    }
  }
  const opened = useRef(false);
  useEffect(() => {
    const id = new URLSearchParams(location.search).get("occurrenceId");
    if (page && !opened.current && id) {
      opened.current = true;
      void open(id);
    }
  }, [!!page]);
  async function viewHistory(c: string | null = null) {
    if (!row) return;
    try {
      const r = await tenantRequest<ScheduleHistory>(
        props.realm,
        `${prefix}/occurrences/${row.id}/history${c ? `?cursor=${encodeURIComponent(c)}` : ""}`,
      );
      setHistory((old) => ({
        ...r.data,
        items: c ? [...(old?.items ?? []), ...r.data.items] : r.data.items,
      }));
    } catch (e) {
      mutation.fail(e);
    }
  }
  function close() {
    if (busy) return;
    setRow(null);
    setEdit(null);
    setPreview(null);
    setHistory(null);
    const u = new URL(location.href);
    u.searchParams.delete("occurrenceId");
    historyReplace(u);
  }
  async function prepare(b: ScheduleCommand) {
    setEdit(b);
    mutation.setBusy(true);
    mutation.setError("");
    try {
      const r = await tenantRequest<SchedulePreview>(
        props.realm,
        `${prefix}/occurrences${row ? `/${row.id}` : ""}/preview`,
        { method: "POST", body: b, headers: row ? { "If-Match": `"${row.version}"` } : {} },
      );
      setPreview(r.data);
      setConflicts(false);
      setExceptions(false);
    } catch (e) {
      mutation.fail(e);
    } finally {
      mutation.setBusy(false);
    }
  }
  const table = (p: SchedulePage | null, label: string) =>
    p && (
      <>
        <TableFrame label={label}>
          <table>
            <thead>
              <tr>
                <th>Ngày / Giờ</th>
                <th>Tên lịch / Phạm vi</th>
                <th>Người giảng</th>
                <th>Kinh Thánh / Chủ đề</th>
                <th>Hướng dẫn / Ban hát</th>
                <th>Trạng thái</th>
                <th>Chi tiết</th>
              </tr>
            </thead>
            <tbody>
              {p.items.map((r) => (
                <tr key={r.id}>
                  <td className="num">
                    {scheduleDate(r.startAt)}
                    <br />
                    {scheduleDate(r.endAt)}
                  </td>
                  <td className="nm">
                    {r.input.label}
                    <br />
                    {r.unitName ?? "Hội Thánh"}
                  </td>
                  <td>{r.speakerName ?? "Chưa phân công"}</td>
                  <td>
                    {r.input.scripture ?? "—"}
                    <br />
                    {r.input.theme ?? "—"}
                  </td>
                  <td>
                    {r.leaderName ?? "Chưa phân công"}
                    <br />
                    {r.choirName ?? "Chưa phân công"}
                  </td>
                  <td>
                    <Badge
                      tone={
                        r.state === "cancelled" ? "muted" : r.state === "draft" ? "warn" : "good"
                      }
                    >
                      {scheduleStates[r.state]}
                    </Badge>
                    {r.input.communion && <Badge tone="gold">Dự kiến Tiệc Thánh</Badge>}
                  </td>
                  <td>
                    <IconButton
                      icon="search"
                      label={`Chi tiết ${r.input.label}`}
                      disabled={busy}
                      onClick={() => void open(r.id)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableFrame>
        {!p.items.length && <EmptyState message="Chưa có lịch phù hợp trong khoảng đã chọn." />}
      </>
    );
  return (
    <div className="schedule-section">
      <div className="schedule-actions">
        <IconButton
          icon="plus"
          label="Tạo lịch"
          disabled={!canWrite || busy}
          onClick={() => {
            setRow(null);
            setEdit(newSchedule());
            setPreview(null);
          }}
        />
        <Button
          disabled={busy}
          onClick={() => {
            setCursor(null);
            setWeekCursor(null);
            setReload((n) => n + 1);
          }}
        >
          Làm mới
        </Button>
      </div>
      {mutation.error && <Feedback tone="error">{mutation.error}</Feedback>}
      {mutation.notice && <Feedback tone="success">{mutation.notice}</Feedback>}
      {props.pending?.path.startsWith(`${prefix}/`) && (
        <Feedback tone="warning">
          Thao tác đang chờ đối soát.{" "}
          <Button
            disabled={mutation.busy}
            onClick={() => void mutation.execute(props.pending as TenantIntent, true)}
          >
            Đối soát / thử lại cùng yêu cầu
          </Button>
        </Feedback>
      )}
      <Toolbar>
        <Field label="Sáu Chúa nhật từ">
          <TextInput
            type="date"
            value={from}
            disabled={busy}
            onChange={(e) => {
              if (validDay(e.target.value)) {
                setCursor(null);
                setWeekCursor(null);
                setFrom(sunday(e.target.value, true));
              }
            }}
          />
        </Field>
        <Field label="Phạm vi">
          <Select
            value={scope}
            disabled={busy}
            onChange={(e) => {
              setScope(e.target.value);
              setCursor(null);
              setWeekCursor(null);
            }}
          >
            <option value="">Trong quyền hiện tại</option>
            {!page?.scope && <option value="church">Hội Thánh</option>}
            <option value="unit">Đơn vị</option>
          </Select>
        </Field>
        {canWrite && (
          <Field label="Trạng thái">
            <Select
              value={state}
              disabled={busy}
              onChange={(e) => {
                setState(e.target.value);
                setCursor(null);
                setWeekCursor(null);
              }}
            >
              <option value="">Tất cả</option>
              {Object.entries(scheduleStates).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </Toolbar>
      {loading && <Loading />}
      <Card>
        <SectionHeader title="Phân công sáu Chúa nhật" />
        {table(page, "Phân công sáu Chúa nhật")}
        {page?.nextCursor && (
          <PaginationControl loading={busy} onMore={() => setCursor(page.nextCursor)} />
        )}
      </Card>
      <Card>
        <SectionHeader title="Lịch sinh hoạt trong tuần" />
        <div className="schedule-section">
          <div className="schedule-actions">
            <Button
              disabled={busy}
              onClick={() => {
                setWeekCursor(null);
                setWeek(shiftDay(week, -7));
              }}
            >
              Trước
            </Button>
            <Field label="Tuần từ Chúa nhật">
              <TextInput
                type="date"
                value={week}
                disabled={busy}
                onChange={(e) => {
                  if (validDay(e.target.value)) {
                    setWeekCursor(null);
                    setWeek(sunday(e.target.value));
                  }
                }}
              />
            </Field>
            <Button
              disabled={busy}
              onClick={() => {
                setWeekCursor(null);
                setWeek(shiftDay(week, 7));
              }}
            >
              Tiếp
            </Button>
          </div>
          {table(weekly, "Lịch tuần")}
          {weekly?.nextCursor && (
            <PaginationControl loading={busy} onMore={() => setWeekCursor(weekly.nextCursor)} />
          )}
        </div>
      </Card>
      <ProgramsView
        realm={props.realm}
        churchId={props.churchId}
        pending={props.pending}
        onPending={props.onPending}
        onAuthError={props.onAuthError}
        refreshKey={reload}
      />
      <Modal
        open={!!row || !!edit}
        title={
          preview ? "Xác nhận thay đổi" : edit ? (row ? "Sửa lịch" : "Tạo lịch") : "Chi tiết lịch"
        }
        locked={mutation.busy || !!props.pending}
        onClose={close}
      >
        {mutation.error && <Feedback tone="error">{mutation.error}</Feedback>}
        {props.pending?.path.startsWith(`${prefix}/`) && (
          <Feedback tone="warning">
            Thao tác đang chờ đối soát.{" "}
            <Button
              disabled={mutation.busy}
              onClick={() => void mutation.execute(props.pending as TenantIntent, true)}
            >
              Đối soát / thử lại cùng yêu cầu
            </Button>
          </Feedback>
        )}
        {preview && edit ? (
          <div className="schedule-section">
            <KeyValueList
              items={[
                { label: "Tên lịch", value: preview.after.input.label },
                { label: "Trạng thái", value: scheduleStates[preview.after.state] },
                {
                  label: "Phạm vi thay đổi",
                  value: !row
                    ? edit.input.repeat.kind === "once"
                      ? "Tạo lịch một lần"
                      : "Tạo chuỗi lịch"
                    : edit.range === "one"
                      ? "Chỉ lần này"
                      : "Từ lần này trở đi",
                },
                { label: "Hủy", value: String(preview.cancelled.length) },
                { label: "Lưu / tạo", value: String(preview.created.length) },
                { label: "Đã chỉnh riêng", value: String(preview.exceptions) },
              ]}
            />
            {preview.keptPast && <Feedback>Lịch đã bắt đầu được giữ nguyên.</Feedback>}
            <TableFrame label="Các lần diễn ra sau thay đổi">
              <table>
                <thead>
                  <tr>
                    <th>Bắt đầu</th>
                    <th>Kết thúc</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.created.map((s) => (
                    <tr key={s.startAt}>
                      <td>{scheduleDate(s.startAt)}</td>
                      <td>{scheduleDate(s.endAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableFrame>
            {preview.cancelled.length > 0 && (
              <details>
                <summary>Các lần bị hủy</summary>
                <ul>
                  {preview.cancelled.map((r) => (
                    <li key={r.id}>
                      {r.input.label} · {scheduleDate(r.startAt)}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {preview.exceptionsItems.length > 0 && (
              <details>
                <summary>Các lần đã chỉnh riêng</summary>
                <ul>
                  {preview.exceptionsItems.map((r) => (
                    <li key={r.id}>
                      {r.input.label} · {scheduleDate(r.startAt)} · {scheduleStates[r.state]}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {preview.conflicts.length > 0 && (
              <>
                <Feedback tone="warning">
                  Có phân công trùng giờ. Tên khách và địa điểm nhập tay chưa đủ để kiểm tra mọi
                  xung đột.
                </Feedback>
                <ul>
                  {preview.conflicts.map((c, n) => (
                    <li key={`${c.occurrenceId}:${n}`}>
                      {c.label} · {scheduleDate(c.startAt)} ↔ {scheduleDate(c.candidate)}
                    </li>
                  ))}
                </ul>
                <Choice
                  label="Tôi xác nhận tiếp tục với các xung đột đã hiển thị"
                  disabled={busy}
                  checked={conflictsConfirmed}
                  onChange={(e) => setConflicts(e.target.checked)}
                />
                {!edit.reason && (
                  <Feedback tone="warning">Quay lại và nhập lý do để tiếp tục.</Feedback>
                )}
              </>
            )}
            {preview.exceptions > 0 && edit.range === "future" && (
              <Choice
                label="Tôi xác nhận thay thế các lần đã chỉnh riêng"
                disabled={busy}
                checked={exceptionsConfirmed}
                onChange={(e) => setExceptions(e.target.checked)}
              />
            )}
            <DialogActions>
              <Button disabled={busy} onClick={() => setPreview(null)}>
                Quay lại
              </Button>
              <Button
                variant="primary"
                disabled={
                  busy ||
                  (preview.conflicts.length > 0 && (!conflictsConfirmed || !edit.reason)) ||
                  (preview.exceptions > 0 && edit.range === "future" && !exceptionsConfirmed)
                }
                onClick={() =>
                  mutation.send(
                    `${prefix}/occurrences${row ? `/${row.id}` : ""}`,
                    row ? "PATCH" : "POST",
                    { ...edit, preview: preview.context, conflictsConfirmed, exceptionsConfirmed },
                    row?.version,
                  )
                }
              >
                Xác nhận lưu
              </Button>
            </DialogActions>
          </div>
        ) : edit ? (
          <ScheduleForm
            key={row?.id ?? "new"}
            initial={edit}
            row={row}
            locked={busy}
            realm={props.realm}
            prefix={prefix}
            onFail={mutation.fail}
            onPreview={(b) => void prepare(b)}
          />
        ) : row ? (
          <div className="schedule-section">
            <KeyValueList
              items={[
                { label: "Tên lịch", value: row.input.label },
                { label: "Phạm vi", value: row.unitName ?? "Hội Thánh" },
                { label: "Bắt đầu", value: scheduleDate(row.startAt) },
                { label: "Kết thúc", value: scheduleDate(row.endAt) },
                { label: "Địa điểm", value: row.input.location ?? "—" },
                { label: "Kinh Thánh", value: row.input.scripture ?? "—" },
                { label: "Chủ đề", value: row.input.theme ?? "—" },
                { label: "Người giảng", value: row.speakerName ?? "Chưa phân công" },
                { label: "Hướng dẫn", value: row.leaderName ?? "Chưa phân công" },
                { label: "Ban hát", value: row.choirName ?? "Chưa phân công" },
                { label: "Trạng thái", value: scheduleStates[row.state] },
                { label: "Lần đã chỉnh riêng", value: row.exception ? "Có" : "Không" },
              ]}
            />
            {row.input.communion && <Badge tone="gold">Dự kiến Tiệc Thánh</Badge>}
            <Feedback>
              Phân công giữ tên tại thời điểm lưu. Lịch dự kiến không xác nhận buổi nhóm hoặc lễ đã
              diễn ra.
            </Feedback>
            {canWrite && (
              <DialogActions>
                <Button
                  disabled={busy || row.state === "cancelled"}
                  onClick={() => {
                    setHistory(null);
                    setEdit({
                      input: row.input,
                      state: row.state,
                      range: "one",
                      reason: null,
                      preview: null,
                      conflictsConfirmed: false,
                      exceptionsConfirmed: false,
                    });
                  }}
                >
                  Sửa lịch
                </Button>
                <Button disabled={busy} onClick={() => void viewHistory()}>
                  Lịch sử
                </Button>
              </DialogActions>
            )}
            {history && (
              <>
                <ul>
                  {history.items.map((h) => (
                    <li key={h.id}>
                      {scheduleDate(h.occurredAt)} ·{" "}
                      {{
                        created: "Tạo lịch",
                        corrected: "Đính chính",
                        cancelled: "Hủy lịch",
                        superseded: "Thay thế phần tương lai",
                      }[h.event] ?? h.event}{" "}
                      · {h.reason ?? "Tạo lịch"}
                      <details>
                        <summary>Trước / Sau</summary>
                        <div className="schedule-grid">
                          <section>
                            <h4>Trước</h4>
                            <HistorySnapshot value={h.before} />
                          </section>
                          <section>
                            <h4>Sau</h4>
                            <HistorySnapshot value={h.after} />
                          </section>
                        </div>
                      </details>
                    </li>
                  ))}
                </ul>
                {history.nextCursor && (
                  <PaginationControl
                    loading={busy}
                    onMore={() => void viewHistory(history.nextCursor)}
                  />
                )}
              </>
            )}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
function historyReplace(u: URL) {
  window.history.replaceState(null, "", u);
}

function HistorySnapshot({ value }: { value: object | null }) {
  const r = value as ScheduleRow | null;
  if (!r) return <span>Chưa có</span>;
  return (
    <KeyValueList
      items={[
        { label: "Tên lịch", value: r.input.label },
        { label: "Bắt đầu", value: scheduleDate(r.startAt) },
        { label: "Kết thúc", value: scheduleDate(r.endAt) },
        { label: "Phạm vi", value: r.unitName ?? "Hội Thánh" },
        { label: "Người giảng", value: r.speakerName ?? "Chưa phân công" },
        { label: "Hướng dẫn", value: r.leaderName ?? "Chưa phân công" },
        { label: "Ban hát", value: r.choirName ?? "Chưa phân công" },
        { label: "Kinh Thánh", value: r.input.scripture ?? "—" },
        { label: "Chủ đề", value: r.input.theme ?? "—" },
        { label: "Trạng thái", value: scheduleStates[r.state] },
      ]}
    />
  );
}
