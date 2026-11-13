import { type FormEvent, useEffect, useRef, useState } from "react";
import { businessDay } from "../api/members/dates";
import type { ChurchRef } from "./access-context";
import { ApiError } from "./api";
import {
  attendanceEvents,
  type Candidates,
  type History,
  type Participant,
  presenceStates,
  type Roster,
  type Session,
  type SessionPage,
  sessionStates,
} from "./attendance-api";
import { AttendanceForm } from "./attendance-form";
import type { UnitPage } from "./organization-api";
import { QrAttendance } from "./qr-attendance";
import {
  authErrorCodes,
  type TenantIntent,
  type TenantRealm,
  tenantRequest,
  useTenantMutation,
} from "./tenant-mutation";
import {
  AttendanceItem,
  AttendanceProgress,
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
  TextArea,
  TextInput,
  Toolbar,
} from "./ui/components";
import "./attendance.css";

type Dialog =
  | { kind: "create" | "edit" | "preview" | "add" | "history" | "close" | "reopen" | "reset" }
  | {
      kind: "roster";
      member: { memberId: string; fullName: string; present?: boolean };
      included: boolean;
    };
const dialogNames = {
  create: "Tạo buổi",
  edit: "Sửa buổi",
  preview: "Mở buổi",
  add: "Bổ sung người",
  history: "Lịch sử buổi",
  close: "Chốt buổi",
  reopen: "Mở lại",
  reset: "Làm lại",
  roster: "Đổi danh sách",
};
const dateLabel = (day: string) => day.split("-").reverse().join("/");

function CandidatePanel({
  realm,
  path,
  mode,
  session,
  locked,
  onPick,
  onOpen,
  onFail,
}: {
  realm: TenantRealm;
  path: string;
  mode: "preview" | "add";
  session: Session;
  locked: boolean;
  onPick: (person: Candidates["items"][number]) => void;
  onOpen: (token: string) => void;
  onFail: (e: unknown) => void;
}) {
  const [page, setPage] = useState<Candidates | null>(null),
    [q, setQ] = useState(""),
    [cursors, setCursors] = useState<string[]>([]),
    [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  const cursor = cursors.at(-1);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setPage(null);
    setError("");
    void tenantRequest<Candidates>(
      realm,
      `${path}/candidates?${new URLSearchParams({ q, ...(cursor ? { cursor } : {}) })}`,
      { signal: controller.signal },
    )
      .then((r) => {
        if (!controller.signal.aborted) setPage(r.data);
      })
      .catch((e) => {
        if (!controller.signal.aborted) {
          setError(e.message);
          onFail(e);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [realm, path, q, cursor]);
  return (
    <div className="attendance-dialog-content">
      {mode === "preview" && (
        <Feedback>
          Danh sách được lấy tại thời điểm xem trước; thay đổi về sau không tự sửa lịch sử buổi.
        </Feedback>
      )}
      {session.heldOn < businessDay() && (
        <Feedback tone="warning">
          Buổi lùi ngày dùng danh sách nguồn hiện tại, không tái dựng danh sách quá khứ.
        </Feedback>
      )}
      <Field label="Tìm người">
        <TextInput
          value={q}
          maxLength={100}
          disabled={locked}
          onChange={(e) => {
            setQ(e.target.value);
            setCursors([]);
          }}
        />
      </Field>
      {loading && <Loading />}
      {error && <Feedback tone="error">{error}</Feedback>}
      {page && (
        <>
          <p>
            {page.total} người trong danh sách nguồn ·{" "}
            {new Date(page.sourceAsOf).toLocaleString("vi-VN")}
          </p>
          {!page.items.length && <EmptyState message="Không có người phù hợp." />}
          {page.items.map((p) => (
            <div className="li" key={p.memberId}>
              <div className="t">
                <b>{p.fullName}</b>
                <span>
                  {p.code} · {p.areaName ?? "Chưa có khu vực"}
                </span>
              </div>
              {mode === "add" && (
                <Button
                  disabled={locked}
                  aria-label={`Bổ sung ${p.fullName}`}
                  onClick={() => onPick(p)}
                >
                  Bổ sung
                </Button>
              )}
            </div>
          ))}
          <div className="attendance-pagination">
            <Button
              disabled={locked || !cursors.length}
              onClick={() => setCursors((old) => old.slice(0, -1))}
            >
              Trước
            </Button>
            <Button
              disabled={locked || !page.nextCursor}
              onClick={() => {
                if (page.nextCursor) setCursors((old) => [...old, page.nextCursor as string]);
              }}
            >
              Tiếp
            </Button>
          </div>
          {mode === "preview" && (
            <DialogActions>
              <Button
                variant="primary"
                disabled={locked || session.heldOn > businessDay()}
                onClick={() => onOpen(page.previewToken)}
              >
                Xác nhận mở
              </Button>
            </DialogActions>
          )}
        </>
      )}
    </div>
  );
}

export function AttendanceView({
  realm,
  churchId,
  pending,
  onPending,
  onAuthError,
  onTitle,
  onChurch,
}: {
  realm: TenantRealm;
  churchId: string;
  pending: TenantIntent | null;
  onPending: (v: TenantIntent | null) => void;
  onAuthError: (e: unknown) => void;
  onTitle: (title: string, context?: string) => void;
  onChurch?: (c: ChurchRef) => void;
}) {
  const base = `${realm === "owner" ? "owner/" : ""}churches/${churchId}`,
    prefix = `${base}/attendance`;
  const [identity, setIdentity] = useState<{ key: string; capabilities: string[] } | null>(null),
    [sessions, setSessions] = useState<SessionPage | null>(null),
    [selected, setSelected] = useState(new URLSearchParams(location.search).get("sessionId") ?? ""),
    [roster, setRoster] = useState<Roster | null>(null),
    [refresh, setRefresh] = useState(0),
    [q, setQ] = useState(""),
    [showExcluded, setShowExcluded] = useState(false),
    [cursors, setCursors] = useState<string[]>([]),
    [listCursors, setListCursors] = useState<string[]>([]),
    [stateFilter, setStateFilter] = useState(""),
    [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [unitFilter, setUnitFilter] = useState(""),
    [units, setUnits] = useState<UnitPage | null>(null),
    [scannerSession, setScannerSession] = useState<Session | null>(null),
    [dialog, setDialog] = useState<Dialog | null>(null),
    [reason, setReason] = useState(""),
    [history, setHistory] = useState<History | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const generation = useRef(0);
  const cursor = cursors.at(-1),
    listCursor = listCursors.at(-1),
    session = roster?.session;
  const canManage = !!identity?.capabilities.includes("attendance:manage"),
    canMark = !!identity?.capabilities.includes("attendance:mark"),
    canScan = !!identity?.capabilities.includes("attendance:scan");
  function fail(e: unknown) {
    if (
      e instanceof ApiError &&
      [...authErrorCodes, "FORBIDDEN", "CHURCH_SUSPENDED", "SESSION_REVOKED"].includes(e.code)
    ) {
      setRoster(null);
      setSessions(null);
      setHistory(null);
      setUnits(null);
      setIdentity(null);
      setDialog(null);
      setScannerSession(null);
      onAuthError(e);
    } else setError(e instanceof Error ? e.message : "Không tải được dữ liệu.");
  }
  const mutation = useTenantMutation({
    realm,
    churchId,
    principalKey: identity?.key ?? "",
    canWrite: canMark || canManage,
    pending,
    onPending,
    onAuthError,
    operationPath: `${prefix}/operations`,
    prefix,
    onSuccess: (data) => {
      if (
        data &&
        typeof data === "object" &&
        "sessionId" in data &&
        typeof data.sessionId === "string"
      ) {
        setSelected(data.sessionId);
        const url = new URL(location.href);
        url.searchParams.set("sessionId", data.sessionId);
        window.history.replaceState(null, "", url);
      }
      setDialog(null);
      setCursors([]);
      setHistory(null);
      setRefresh((n) => n + 1);
    },
  });
  const locked = mutation.busy || !!pending || !!scannerSession;
  useEffect(() => {
    const epoch = ++generation.current,
      controller = new AbortController();
    setLoading(true);
    setError("");
    setRoster(null);
    setSessions(null);
    setHistory(null);
    void (async () => {
      const c = await tenantRequest<{
        church: ChurchRef;
        principal: { accountId?: string; employeeId?: string; version?: number };
        capabilities: string[];
        policyVersion: number;
      }>(realm, `${base}/context`, { signal: controller.signal });
      if (epoch !== generation.current) return;
      setIdentity({
        key: `${c.data.principal.accountId ?? c.data.principal.employeeId}:${churchId}:${c.data.principal.version}:${c.data.policyVersion}`,
        capabilities: c.data.capabilities,
      });
      onChurch?.(c.data.church);
      onTitle("Điểm danh", `${c.data.church.name} · ${c.data.church.code}`);
      const params = new URLSearchParams({
        ...(from ? { from } : {}),
        ...(to ? { to } : {}),
        ...(stateFilter ? { state: stateFilter } : {}),
        ...(unitFilter ? { unitId: unitFilter } : {}),
        ...(listCursor ? { cursor: listCursor } : {}),
      });
      const list = await tenantRequest<SessionPage>(realm, `${prefix}/sessions?${params}`, {
        signal: controller.signal,
      });
      if (epoch !== generation.current) return;
      setSessions(list.data);
      if (!selected && list.data.items[0]) {
        setSelected(list.data.items[0].id);
        return;
      }
      if (selected) {
        const r = await tenantRequest<Roster>(
          realm,
          `${prefix}/sessions/${selected}/participants?${new URLSearchParams({
            q,
            ...(showExcluded && c.data.capabilities.includes("attendance:manage")
              ? { included: "all" }
              : {}),
            ...(cursor ? { cursor } : {}),
          })}`,
          { signal: controller.signal },
        );
        if (epoch === generation.current) setRoster(r.data);
      }
    })()
      .catch((e) => {
        if (epoch === generation.current && !controller.signal.aborted) fail(e);
      })
      .finally(() => {
        if (epoch === generation.current) setLoading(false);
      });
    return () => {
      controller.abort();
      generation.current++;
    };
  }, [
    realm,
    churchId,
    refresh,
    selected,
    q,
    showExcluded,
    cursor,
    listCursor,
    stateFilter,
    from,
    to,
    unitFilter,
  ]);
  async function loadUnits(more = false) {
    const epoch = generation.current;
    try {
      const r = await tenantRequest<UnitPage>(
        realm,
        `${base}/organization/units?${new URLSearchParams({ status: "active", limit: "100", ...(more && units?.nextCursor ? { cursor: units.nextCursor } : {}) })}`,
      );
      if (epoch === generation.current)
        setUnits((old) => ({
          ...r.data,
          items: more ? [...(old?.items ?? []), ...r.data.items] : r.data.items,
        }));
    } catch (e) {
      if (epoch === generation.current) fail(e);
    }
  }
  async function showHistory(more = false) {
    if (!session) return;
    const epoch = generation.current;
    setDialog({ kind: "history" });
    try {
      const r = await tenantRequest<History>(
        realm,
        `${prefix}/sessions/${session.id}/history${more && history?.nextCursor ? `?${new URLSearchParams({ cursor: history.nextCursor })}` : ""}`,
      );
      if (epoch === generation.current)
        setHistory((old) => ({
          ...r.data,
          items: more ? [...(old?.items ?? []), ...r.data.items] : r.data.items,
        }));
    } catch (e) {
      if (epoch === generation.current) fail(e);
    }
  }
  function open(d: Dialog) {
    mutation.setError("");
    setReason("");
    setDialog(d);
    if (d.kind === "create" || d.kind === "edit") void loadUnits();
  }
  function select(id: string) {
    if (locked) return;
    setSelected(id);
    setCursors([]);
    setQ("");
    setShowExcluded(false);
    setDialog(null);
    const url = new URL(location.href);
    url.searchParams.set("sessionId", id);
    window.history.replaceState(null, "", url);
  }
  function formSubmit(body: object) {
    mutation.send(
      `${prefix}/sessions${dialog?.kind === "edit" && session ? `/${session.id}` : ""}`,
      dialog?.kind === "edit" ? "PATCH" : "POST",
      body,
      dialog?.kind === "edit" ? session?.version : undefined,
    );
  }
  function confirm(e: FormEvent) {
    e.preventDefault();
    if (!session || !dialog) return;
    const rosterChange = dialog.kind === "roster";
    mutation.send(
      `${prefix}/sessions/${session.id}/${rosterChange ? "roster-changes" : dialog.kind}`,
      "POST",
      rosterChange
        ? { memberId: dialog.member.memberId, included: dialog.included, reason }
        : dialog.kind === "close"
          ? {}
          : { reason },
      session.version,
    );
  }
  function mark(p: Participant) {
    if (!session) return;
    mutation.send(
      `${prefix}/sessions/${session.id}/participants/${p.memberId}`,
      "PATCH",
      { present: !p.present, generation: session.generation },
      p.version,
    );
  }
  const feedback = (
    <>
      {mutation.error && <Feedback tone="error">{mutation.error}</Feedback>}
      {pending && (
        <Feedback tone="warning">
          <p>Kết quả thao tác đang chờ đối soát. Chưa tạo thao tác mới.</p>
          <Button
            disabled={mutation.busy || !identity}
            onClick={() => void mutation.execute(pending, true)}
          >
            Kiểm tra kết quả
          </Button>
          <Button
            disabled={mutation.busy}
            onClick={() => {
              if (
                window.confirm(
                  "Kết quả chưa được đối soát. Đọc lại dữ liệu trước khi tạo thao tác mới?",
                )
              ) {
                onPending(null);
                setDialog(null);
                setCursors([]);
                setRefresh((n) => n + 1);
              }
            }}
          >
            Về danh sách để đối soát
          </Button>
        </Feedback>
      )}
    </>
  );
  return (
    <div className="attendance-section">
      <SectionHeader title="Điểm danh">
        {canManage && (
          <IconButton
            icon="plus"
            label="Tạo buổi"
            disabled={locked || loading}
            onClick={() => open({ kind: "create" })}
          />
        )}
      </SectionHeader>
      {error && (
        <Feedback tone="error">
          {error}
          <Button
            disabled={locked}
            onClick={() => {
              setCursors([]);
              setListCursors([]);
              setRefresh((n) => n + 1);
            }}
          >
            Tải lại
          </Button>
        </Feedback>
      )}
      {mutation.notice && <Feedback>{mutation.notice}</Feedback>}
      {!dialog && feedback}
      <Toolbar>
        <Field label="Từ ngày">
          <TextInput
            type="date"
            value={from}
            disabled={locked}
            onChange={(e) => {
              setFrom(e.target.value);
              setListCursors([]);
            }}
          />
        </Field>
        <Field label="Đến ngày">
          <TextInput
            type="date"
            value={to}
            disabled={locked}
            onChange={(e) => {
              setTo(e.target.value);
              setListCursors([]);
            }}
          />
        </Field>
        <Field label="Trạng thái">
          <Select
            value={stateFilter}
            disabled={locked}
            onChange={(e) => {
              setStateFilter(e.target.value);
              setListCursors([]);
            }}
          >
            <option value="">Tất cả</option>
            {Object.entries(sessionStates).map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </Select>
        </Field>
        {canManage && (
          <Field label="Lọc đơn vị">
            <Select
              value={unitFilter}
              disabled={locked}
              onFocus={() => {
                if (!units) void loadUnits();
              }}
              onChange={(e) => {
                setUnitFilter(e.target.value);
                setListCursors([]);
              }}
            >
              <option value="">Tất cả đơn vị / Hội Thánh</option>
              {units?.items
                .filter((u) => u.kind !== "board")
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
            </Select>
          </Field>
        )}
        {canManage && units?.nextCursor && (
          <Button disabled={locked} onClick={() => void loadUnits(true)}>
            Thêm đơn vị lọc
          </Button>
        )}
        <Button
          disabled={locked}
          onClick={() => {
            setCursors([]);
            setListCursors([]);
            setRefresh((n) => n + 1);
          }}
        >
          Tải lại
        </Button>
      </Toolbar>
      {loading && <Loading />}
      {sessions && (
        <>
          <Field label="Buổi nhóm">
            <Select
              value={selected}
              disabled={locked || loading}
              onChange={(e) => select(e.target.value)}
            >
              <option value="">Chọn buổi</option>
              {session && !sessions.items.some((s) => s.id === session.id) && (
                <option value={session.id}>
                  {session.label} · {dateLabel(session.heldOn)}
                </option>
              )}
              {sessions.items.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label} · {dateLabel(s.heldOn)} · {sessionStates[s.state]}
                </option>
              ))}
            </Select>
          </Field>
          {!sessions.items.length && <EmptyState message="Chưa có buổi phù hợp bộ lọc." />}
          {(listCursor || sessions.nextCursor) && (
            <div className="attendance-pagination">
              <Button
                disabled={locked || !listCursors.length}
                onClick={() => setListCursors((old) => old.slice(0, -1))}
              >
                Các buổi trước
              </Button>
              <Button
                disabled={locked || !sessions.nextCursor}
                onClick={() => {
                  if (sessions.nextCursor)
                    setListCursors((old) => [...old, sessions.nextCursor as string]);
                }}
              >
                Các buổi tiếp
              </Button>
            </div>
          )}
        </>
      )}
      {session && (
        <>
          <Card>
            <div className="att-head">
              <div>
                <strong>{session.label}</strong>
                <p className="small muted">
                  {dateLabel(session.heldOn)} ·{" "}
                  {session.prepClass ? "Lớp dự bị" : (session.unitName ?? "Toàn Hội Thánh")}
                  {session.location ? ` · ${session.location}` : ""}
                </p>
                <Badge>{sessionStates[session.state]}</Badge>
                {session.prepClass && (
                  <Badge>
                    Lớp dự bị · {session.prepClass.kind === "makeup" ? "Học bù" : "Buổi chính"}
                  </Badge>
                )}
              </div>
              <div aria-live="polite">
                <span className="att-count num">{session.presentCount}</span>
                <span className="muted"> / {session.includedCount} có mặt</span>
              </div>
              <IconButton
                label="Quét QR"
                icon="scan"
                disabled={locked || !canScan || session.state !== "open"}
                onClick={() => setScannerSession(session)}
              />
            </div>
            <AttendanceProgress present={session.presentCount} total={session.includedCount} />
            <div className="attendance-card-actions">
              <Toolbar>
                {canManage && (
                  <>
                    <Button disabled={locked} onClick={() => open({ kind: "edit" })}>
                      Sửa buổi
                    </Button>
                    <Button disabled={locked} onClick={() => void showHistory()}>
                      Lịch sử
                    </Button>
                    {session.state === "draft" ? (
                      <Button
                        variant="primary"
                        disabled={locked}
                        onClick={() => open({ kind: "preview" })}
                      >
                        Xem trước danh sách
                      </Button>
                    ) : session.state === "closed" ? (
                      <Button disabled={locked} onClick={() => open({ kind: "reopen" })}>
                        Mở lại
                      </Button>
                    ) : (
                      <>
                        <Button disabled={locked} onClick={() => open({ kind: "add" })}>
                          Bổ sung người
                        </Button>
                        <Button disabled={locked} onClick={() => open({ kind: "reset" })}>
                          Làm lại
                        </Button>
                        <Button
                          variant="primary"
                          disabled={locked}
                          onClick={() => open({ kind: "close" })}
                        >
                          Chốt buổi
                        </Button>
                      </>
                    )}
                  </>
                )}
              </Toolbar>
              {session.state === "open" && (
                <p className="small muted">
                  {session.unrecordedCount} chưa ghi nhận. Khi chốt, người chưa được ghi hiện diện
                  được tính vắng.
                </p>
              )}
              {session.state === "closed" && (
                <p className="small muted">
                  {session.absentCount} vắng · Muốn sửa phải mở lại buổi.
                </p>
              )}
            </div>
          </Card>
          {session.state !== "draft" && (
            <>
              <Field label="Tìm tên hoặc mã">
                <TextInput
                  value={q}
                  maxLength={100}
                  disabled={locked}
                  onChange={(e) => {
                    setQ(e.target.value);
                    setCursors([]);
                  }}
                />
              </Field>
              {canManage && (
                <Choice
                  label="Hiện cả người đã loại"
                  checked={showExcluded}
                  disabled={locked}
                  onChange={(e) => {
                    setShowExcluded(e.target.checked);
                    setCursors([]);
                  }}
                />
              )}
              {!roster.items.length && <EmptyState message="Không có người phù hợp." />}
              <div className="att-list">
                {roster.items.map((p) => (
                  <div className="attendance-row" key={p.memberId}>
                    <div className="attendance-person">
                      <AttendanceItem
                        name={p.fullName}
                        detail={`${p.code} · ${p.type === "visitor" ? "Thân hữu · " : ""}${p.areaName ?? "Chưa có khu vực"}`}
                        present={p.present}
                        status={presenceStates[p.status as keyof typeof presenceStates]}
                        disabled={locked || !canMark || session.state !== "open" || !p.included}
                        onClick={() => mark(p)}
                      />
                    </div>
                    {canManage && session.state === "open" && (
                      <IconButton
                        label={`${p.included ? "Loại" : "Đưa lại"} ${p.fullName}`}
                        icon={p.included ? "x" : "plus"}
                        disabled={locked}
                        onClick={() => open({ kind: "roster", member: p, included: !p.included })}
                      />
                    )}
                  </div>
                ))}
              </div>
              <div className="attendance-pagination">
                <Button
                  disabled={locked || !cursors.length}
                  onClick={() => setCursors((old) => old.slice(0, -1))}
                >
                  Trước
                </Button>
                <Button
                  disabled={locked || !roster.nextCursor}
                  onClick={() => {
                    if (roster.nextCursor)
                      setCursors((old) => [...old, roster.nextCursor as string]);
                  }}
                >
                  Tiếp
                </Button>
              </div>
            </>
          )}
        </>
      )}
      {scannerSession && identity && (
        <QrAttendance
          realm={realm}
          churchId={churchId}
          session={scannerSession}
          principalKey={identity.key}
          pending={pending}
          onPending={onPending}
          onAuthError={fail}
          onChanged={() => setRefresh((n) => n + 1)}
          onClose={() => setScannerSession(null)}
        />
      )}
      <Modal
        open={!!dialog}
        title={dialog ? dialogNames[dialog.kind] : "Điểm danh"}
        locked={locked}
        onClose={() => setDialog(null)}
      >
        {feedback}
        {(dialog?.kind === "create" || dialog?.kind === "edit") && (
          <AttendanceForm
            key={`${dialog.kind}:${session?.id}`}
            value={dialog.kind === "edit" ? session : undefined}
            units={units}
            busy={locked}
            onMoreUnits={() => void loadUnits(true)}
            onCancel={() => setDialog(null)}
            onSubmit={formSubmit}
          />
        )}
        {(dialog?.kind === "preview" || dialog?.kind === "add") && session && (
          <CandidatePanel
            key={`${dialog.kind}:${session.id}`}
            realm={realm}
            path={`${prefix}/sessions/${session.id}`}
            mode={dialog.kind}
            session={session}
            locked={locked}
            onFail={(e) => {
              if (
                e instanceof ApiError &&
                [...authErrorCodes, "FORBIDDEN", "CHURCH_SUSPENDED"].includes(e.code)
              )
                fail(e);
            }}
            onPick={(p) => open({ kind: "roster", member: p, included: true })}
            onOpen={(previewToken) =>
              mutation.send(
                `${prefix}/sessions/${session.id}/open`,
                "POST",
                { previewToken },
                session.version,
              )
            }
          />
        )}
        {dialog?.kind === "history" && (
          <div className="attendance-dialog-content">
            {!history && !error && <Loading />}
            {history?.items.map((h) => (
              <details key={h.id}>
                <summary>
                  {attendanceEvents[h.event] ?? h.event} ·{" "}
                  {new Date(h.occurredAt).toLocaleString("vi-VN")}
                </summary>
                <KeyValueList
                  items={[
                    { label: "Lý do", value: h.reason ?? "—" },
                    {
                      label: "Người thực hiện",
                      value: `${h.actorKind === "owner" ? "Nhà cung cấp" : "Tài khoản Hội Thánh"} · ${h.actorId}`,
                    },
                    ...["before", "after"].map((key) => ({
                      label: key === "before" ? "Trước" : "Sau",
                      value: historyDescription(h[key as "before" | "after"]),
                    })),
                  ]}
                />
              </details>
            ))}
            {history?.nextCursor && (
              <PaginationControl loading={false} onMore={() => void showHistory(true)} />
            )}
          </div>
        )}
        {dialog && ["close", "reopen", "reset", "roster"].includes(dialog.kind) && session && (
          <form className="attendance-form" onSubmit={confirm}>
            <p>
              <strong>{session.label}</strong> · {dateLabel(session.heldOn)}
            </p>
            {dialog.kind === "close" && (
              <p>
                Chốt {session.presentCount} có mặt / {session.includedCount} người. Người chưa được
                ghi hiện diện được tính vắng. Muốn sửa phải mở lại.
              </p>
            )}
            {dialog.kind === "reset" && (
              <Feedback tone="warning">
                Bỏ ghi nhận hiện diện của {session.presentCount} người. Giữ danh sách và lịch sử.
              </Feedback>
            )}
            {dialog.kind === "reopen" && (
              <p>Mở lại để sửa; giữ kết quả hiện có và chốt lại sau khi hoàn tất.</p>
            )}
            {dialog.kind === "roster" && (
              <p>
                {dialog.included ? "Đưa vào" : "Loại khỏi"} danh sách:{" "}
                <strong>{dialog.member.fullName}</strong>.{" "}
                {!dialog.included && dialog.member.present
                  ? "Ghi nhận hiện diện cũng được bỏ; lịch sử được giữ."
                  : ""}
              </p>
            )}
            {dialog.kind !== "close" && (
              <Field label="Lý do">
                <TextArea
                  required
                  maxLength={500}
                  value={reason}
                  disabled={locked}
                  onChange={(e) => setReason(e.target.value)}
                />
              </Field>
            )}
            <DialogActions>
              <Button disabled={locked} onClick={() => setDialog(null)}>
                Hủy
              </Button>
              <Button type="submit" variant="primary" disabled={locked}>
                Xác nhận
                {dialog.kind === "reset" ? " làm lại" : dialog.kind === "close" ? " chốt buổi" : ""}
              </Button>
            </DialogActions>
          </form>
        )}
      </Modal>
    </div>
  );
}
function historyDescription(value: Record<string, unknown> | null) {
  if (!value) return "—";
  const parts: string[] = [];
  if (typeof value.label === "string") parts.push(value.label);
  if (typeof value.state === "string")
    parts.push(sessionStates[value.state as keyof typeof sessionStates] ?? value.state);
  if (typeof value.memberId === "string") parts.push(`Hồ sơ ${value.memberId}`);
  if (typeof value.present === "boolean") parts.push(value.present ? "Có mặt" : "Chưa ghi nhận");
  if (typeof value.included === "boolean")
    parts.push(value.included ? "Trong danh sách" : "Đã loại");
  if (typeof value.presentCount === "number")
    parts.push(`${value.presentCount} có mặt / ${value.includedCount} người`);
  if (typeof value.location === "string") parts.push(value.location);
  if (typeof value.heldOn === "string") parts.push(dateLabel(value.heldOn));
  return parts.join(" · ") || "Đã ghi nhận thay đổi";
}
