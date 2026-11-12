import { useEffect, useRef, useState } from "react";
import { businessDay } from "../api/members/dates";
import { ageBands } from "../api/organization/models";
import type { ChurchRef } from "./access-context";
import { roleLabels } from "./accounts-api";
import { ApiError } from "./api";
import { organizationPath, organizationRequest } from "./organization-api";
import { OrganizationForm, type Person, PersonPicker } from "./organization-forms";
import {
  type OrgHistory,
  type Overview,
  type PolicyMatrix,
  type Roster,
  type RuntimeUnit,
  type Term,
  type Terms,
  termStates,
} from "./organization-runtime-api";
import {
  BoardAppointments,
  type OrganizationDisplay,
  OrganizationUnitsView,
} from "./organization-views";
import {
  authErrorCodes,
  type TenantIntent,
  type TenantRealm,
  tenantRequest,
  useTenantMutation,
} from "./tenant-mutation";
import {
  Button,
  Card,
  DialogActions,
  EmptyState,
  Feedback,
  Field,
  IconButton,
  Loading,
  Modal,
  PaginationControl,
  SectionHeader,
  Select,
  TableFrame,
  TextArea,
  TextInput,
  Toolbar,
} from "./ui/components";
import "./organization-runtime.css";
import "./members-management.css";

type Dialog =
  | { kind: "details"; unit: RuntimeUnit }
  | { kind: "term"; term?: Term; action?: string }
  | { kind: "membership"; unit: RuntimeUnit };
export function OrganizationRuntimeView({
  realm,
  churchId,
  pending,
  onPending,
  onAuthError,
  onTitle,
  onChurch,
  onConfig,
  onMember,
  policyOnly = false,
}: {
  realm: TenantRealm;
  churchId: string;
  pending: TenantIntent | null;
  onPending: (intent: TenantIntent | null) => void;
  onAuthError: (e: unknown) => void;
  onTitle: (title: string, context?: string) => void;
  onChurch?: (c: ChurchRef) => void;
  onConfig?: () => void;
  onMember?: (id: string) => void;
  policyOnly?: boolean;
}) {
  const prefix = organizationPath(realm, churchId),
    base = prefix.replace(/\/organization$/, "");
  const [identity, setIdentity] = useState<{ key: string; capabilities: string[] } | null>(null),
    [display, setDisplay] = useState<OrganizationDisplay>("card"),
    [viewPreferenceKey, setViewPreferenceKey] = useState<string | null>(null),
    [groups, setGroups] = useState<Record<string, Overview>>({}),
    [terms, setTerms] = useState<Terms | null>(null),
    [selectedTerm, setSelectedTerm] = useState(""),
    [policy, setPolicy] = useState<PolicyMatrix | null>(null),
    [refresh, setRefresh] = useState(0),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [dialog, setDialog] = useState<Dialog | null>(null),
    [roster, setRoster] = useState<Roster | null>(null),
    [rosterId, setRosterId] = useState<string | null>(null),
    [q, setQ] = useState(""),
    [rosterBusy, setRosterBusy] = useState(false),
    [history, setHistory] = useState<OrgHistory | null>(null),
    [historyId, setHistoryId] = useState<string | null>(null);
  const generation = useRef(0);
  function fail(e: unknown) {
    if (
      e instanceof ApiError &&
      [...authErrorCodes, "FORBIDDEN", "CHURCH_SUSPENDED"].includes(e.code)
    ) {
      setGroups({});
      setRoster(null);
      setTerms(null);
      onAuthError(e);
    } else setError(e instanceof Error ? e.message : "Không tải được dữ liệu.");
  }
  const canManage = !!identity?.capabilities.includes("organization:manage"),
    canMembers = !!identity?.capabilities.includes("members:manage"),
    scoped = !!Object.values(groups)[0]?.scoped;
  const mutation = useTenantMutation({
    realm,
    churchId,
    principalKey: identity?.key ?? "",
    canWrite: canManage || canMembers,
    pending,
    onPending,
    onAuthError,
    operationPath: `${prefix}/operations`,
    prefix,
    onSuccess: (data) => {
      if (
        data &&
        typeof data === "object" &&
        "term" in data &&
        data.term &&
        typeof data.term === "object" &&
        "id" in data.term &&
        typeof data.term.id === "string"
      )
        setSelectedTerm(data.term.id);
      setDialog(null);
      setRefresh((n) => n + 1);
    },
  });
  const locked = mutation.busy || !!pending;
  async function loadGroup(kind: string, cursor?: string, epoch = generation.current) {
    const r = await organizationRequest<Overview>(
      realm,
      `${prefix}/overview?${new URLSearchParams({ kind, ...(cursor ? { cursor } : {}) })}`,
    );
    if (epoch === generation.current)
      setGroups((old) => ({
        ...old,
        [kind]: {
          ...r.data,
          items:
            kind === "age_ministry"
              ? [...r.data.items].sort(
                  (a, b) =>
                    ageBands.findIndex((band) => band.name === a.name) -
                    ageBands.findIndex((band) => band.name === b.name),
                )
              : cursor
                ? [...(old[kind]?.items ?? []), ...r.data.items]
                : r.data.items,
        },
      }));
  }
  async function loadTerms(cursor?: string, epoch = generation.current) {
    const r = await organizationRequest<Terms>(
      realm,
      `${prefix}/board-terms${cursor ? `?${new URLSearchParams({ cursor })}` : ""}`,
    );
    if (epoch === generation.current) {
      setTerms((old) => ({
        ...r.data,
        items: cursor ? [...(old?.items ?? []), ...r.data.items] : r.data.items,
      }));
      setSelectedTerm(
        (old) => old || r.data.items.find((t) => t.current)?.id || r.data.items[0]?.id || "",
      );
    }
  }
  useEffect(() => {
    const epoch = ++generation.current;
    setLoading(true);
    setError("");
    setGroups({});
    setTerms(null);
    setRoster(null);
    setRosterId(null);
    setHistory(null);
    setHistoryId(null);
    setIdentity(null);
    setViewPreferenceKey(null);
    void (async () => {
      const c = await tenantRequest<{
        church: ChurchRef;
        principal: { accountId?: string; employeeId?: string; role?: string; version?: number };
        capabilities: string[];
        policyVersion: number;
      }>(realm, `${base}/context`);
      if (epoch !== generation.current) return;
      setIdentity({
        key: `${c.data.principal.accountId ?? c.data.principal.employeeId}:${churchId}:${c.data.principal.version}:${c.data.policyVersion}`,
        capabilities: c.data.capabilities,
      });
      const principalId = c.data.principal.accountId ?? c.data.principal.employeeId;
      const preferenceKey = principalId
        ? `church-cms:organization-view:${realm}:${principalId}:${churchId}`
        : null;
      setViewPreferenceKey(preferenceKey);
      let savedView: string | null = null;
      try {
        if (preferenceKey) savedView = window.localStorage.getItem(preferenceKey);
      } catch {
        /* Storage is optional; rendering remains usable when it is unavailable. */
      }
      setDisplay(savedView === "table" ? "table" : "card");
      onChurch?.(c.data.church);
      onTitle(
        policyOnly ? "Phân quyền" : "Ban ngành & Khu vực",
        `${c.data.church.name} · ${c.data.church.code}`,
      );
      if (policyOnly) {
        const p = await tenantRequest<PolicyMatrix>(realm, `${base}/authorization/policy`);
        if (epoch === generation.current) setPolicy(p.data);
      } else {
        // These reads share a transactional church fence; issue them in order.
        if (c.data.capabilities.includes("organization:read")) await loadTerms(undefined, epoch);
        for (const kind of ["age_ministry", "service_ministry", "area"]) {
          if (epoch !== generation.current) return;
          await loadGroup(kind, undefined, epoch);
        }
      }
    })()
      .catch((e) => {
        if (epoch === generation.current) fail(e);
      })
      .finally(() => {
        if (epoch === generation.current) setLoading(false);
      });
    return () => {
      generation.current++;
    };
  }, [realm, churchId, policyOnly, refresh]);
  async function loadRoster(id: string, cursor?: string) {
    const epoch = generation.current;
    setRosterBusy(true);
    setError("");
    if (!cursor) setRoster(null);
    setRosterId(id);
    try {
      const r = await organizationRequest<Roster>(
        realm,
        `${prefix}/units/${id}/members?${new URLSearchParams({ q, ...(cursor ? { cursor } : {}) })}`,
      );
      if (epoch === generation.current)
        setRoster((old) => ({
          ...r.data,
          items: cursor ? [...(old?.items ?? []), ...r.data.items] : r.data.items,
        }));
    } catch (e) {
      if (epoch === generation.current) fail(e);
    } finally {
      if (epoch === generation.current) setRosterBusy(false);
    }
  }
  async function loadHistory(id: string, cursor?: string) {
    const epoch = generation.current;
    try {
      const r = await organizationRequest<OrgHistory>(
        realm,
        `${prefix}/units/${id}/history${cursor ? `?${new URLSearchParams({ cursor })}` : ""}`,
      );
      if (epoch === generation.current) {
        setHistoryId(id);
        setHistory((old) => ({
          ...r.data,
          items: cursor ? [...(old?.items ?? []), ...r.data.items] : r.data.items,
        }));
      }
    } catch (e) {
      if (epoch === generation.current) fail(e);
    }
  }
  function open(d: Dialog) {
    mutation.setError("");
    setDialog(d);
  }
  function submit(body: object) {
    if (!dialog) return;
    mutation.send(
      dialog.kind === "details"
        ? `${prefix}/units/${dialog.unit.id}/details`
        : dialog.kind === "membership"
          ? `${prefix}/units/${dialog.unit.id}/memberships`
          : `${prefix}/board-terms${dialog.term ? `/${dialog.term.id}${dialog.action ? `/${dialog.action}` : ""}` : ""}`,
      dialog.kind === "details" || (dialog.kind === "term" && dialog.term && !dialog.action)
        ? "PATCH"
        : "POST",
      body,
      dialog.kind === "term" ? dialog.term?.version : dialog.unit.version,
    );
  }
  const term = terms?.items.find((t) => t.id === selectedTerm);
  function unitActions(u: RuntimeUnit) {
    return (
      <>
        {canManage && (
          <Button
            aria-label={`Sửa ${u.name}`}
            disabled={locked}
            onClick={() => open({ kind: "details", unit: u })}
          >
            {display === "table" ? "Sửa" : `Sửa ${u.name}`}
          </Button>
        )}
        {canMembers && u.kind === "service_ministry" && (
          <Button
            aria-label={`Gán ${u.name}`}
            disabled={locked}
            onClick={() => open({ kind: "membership", unit: u })}
          >
            {display === "table" ? "Gán" : `Gán ${u.name}`}
          </Button>
        )}
        {!scoped && (
          <Button
            aria-label={`Lịch sử ${u.name}`}
            disabled={locked}
            onClick={() => void loadHistory(u.id)}
          >
            {display === "table" ? "Lịch sử" : `Lịch sử ${u.name}`}
          </Button>
        )}
      </>
    );
  }
  function changeDisplay(next: OrganizationDisplay) {
    if (locked || loading || !identity) return;
    setDisplay(next);
    try {
      if (viewPreferenceKey) window.localStorage.setItem(viewPreferenceKey, next);
    } catch {
      /* A blocked preference store must not block switching views. */
    }
  }
  return (
    <div className="organization-runtime">
      {error && <Feedback tone="error">{error}</Feedback>}
      {mutation.notice && <Feedback>{mutation.notice}</Feedback>}
      {loading && <Loading />}
      {pending && !dialog && (
        <Feedback tone="warning">
          <p>Kết quả thao tác đang chờ đối soát.</p>
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
                  "Kết quả chưa được đối soát. Về danh sách để kiểm tra trước khi tạo thao tác mới?",
                )
              ) {
                onPending(null);
                setDialog(null);
                setRefresh((n) => n + 1);
              }
            }}
          >
            Về danh sách để đối soát
          </Button>
          {mutation.error && <p>{mutation.error}</p>}
        </Feedback>
      )}
      {policyOnly && policy && (
        <Card>
          <SectionHeader title="Phân quyền" />
          <TableFrame label="Danh sách tổ chức">
            <table className="organization-runtime-table">
              <thead>
                <tr>
                  {[
                    "Vai trò",
                    "Tổng quan",
                    "Hồ sơ",
                    "Gia đình",
                    "Tổ chức",
                    "Nhập/xuất",
                    "Lễ nghi",
                    "Điểm danh",
                    "Dâng hiến",
                    "Duyệt chi",
                    "Cầu thay",
                  ].map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {policy.rows.map((r) => (
                  <tr key={r.role}>
                    <td>{roleLabels[r.role]}</td>
                    {[
                      r.overview,
                      r.profiles,
                      r.families,
                      r.organization,
                      r.dataExchange,
                      r.rites,
                      r.attendance,
                      r.giving,
                      r.expense,
                      r.prayer,
                    ].map((v, i) => (
                      <td key={`${r.role}-${i}`}>{v}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </TableFrame>
        </Card>
      )}
      {!policyOnly && !loading && (
        <>
          <div className="organization-runtime-actions">
            <section className="organization-runtime-actions" aria-label="Cách hiển thị tổ chức">
              <IconButton
                label="Card"
                icon="grid"
                variant={display === "card" ? "primary" : "secondary"}
                aria-pressed={display === "card"}
                disabled={locked}
                onClick={() => changeDisplay("card")}
              />
              <IconButton
                label="Bảng"
                icon="table"
                variant={display === "table" ? "primary" : "secondary"}
                aria-pressed={display === "table"}
                disabled={locked}
                onClick={() => changeDisplay("table")}
              />
            </section>
            {canManage && onConfig && (
              <IconButton
                label="Cấu hình tổ chức"
                icon="gear"
                disabled={locked}
                onClick={onConfig}
              />
            )}
          </div>
          {terms && (
            <section className="organization-runtime-group" aria-label="Ban Chấp sự">
              <Card>
                <SectionHeader title="Ban Chấp sự">
                  {canManage && (
                    <Button disabled={locked} onClick={() => open({ kind: "term" })}>
                      Thêm nhiệm kỳ
                    </Button>
                  )}
                </SectionHeader>
                <div className="organization-runtime-group">
                  <Field label="Nhiệm kỳ">
                    <Select
                      value={selectedTerm}
                      disabled={locked}
                      onChange={(e) => setSelectedTerm(e.target.value)}
                    >
                      <option value="">Chọn nhiệm kỳ</option>
                      {terms.items.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.label} · {t.current ? "Đang hiệu lực" : termStates[t.state]}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  {term && (
                    <>
                      <p>
                        {term.startOn ?? "Chưa rõ ngày bắt đầu"} →{" "}
                        {term.closedOn ?? term.endOn ?? "Chưa rõ ngày kết thúc"} ·{" "}
                        {termStates[term.state]}
                      </p>
                      <BoardAppointments term={term} display={display} />
                      <div className="organization-runtime-actions">
                        {canManage && (
                          <>
                            {term.state === "draft" && (
                              <>
                                <Button
                                  disabled={locked}
                                  onClick={() => open({ kind: "term", term })}
                                >
                                  Sửa nhiệm kỳ
                                </Button>
                                <Button
                                  disabled={locked}
                                  onClick={() => open({ kind: "term", term, action: "confirm" })}
                                >
                                  Xác nhận nhiệm kỳ
                                </Button>
                              </>
                            )}
                            {term.current && (
                              <Button
                                disabled={locked}
                                onClick={() => open({ kind: "term", term, action: "amend" })}
                              >
                                Đổi nhân sự
                              </Button>
                            )}
                            {term.state === "confirmed" && (
                              <Button
                                disabled={locked}
                                onClick={() =>
                                  open({
                                    kind: "term",
                                    term,
                                    action:
                                      term.startOn && term.startOn > businessDay(new Date())
                                        ? "cancel"
                                        : "close",
                                  })
                                }
                              >
                                {term.startOn && term.startOn > businessDay(new Date())
                                  ? "Hủy nhiệm kỳ"
                                  : "Kết thúc nhiệm kỳ"}
                              </Button>
                            )}
                            {term.state === "draft" && (
                              <Button
                                disabled={locked}
                                onClick={() => open({ kind: "term", term, action: "cancel" })}
                              >
                                Hủy nhiệm kỳ
                              </Button>
                            )}
                          </>
                        )}
                        <Button disabled={locked} onClick={() => void loadHistory(term.id)}>
                          Lịch sử nhiệm kỳ
                        </Button>
                      </div>
                    </>
                  )}
                  {!terms.items.length && <EmptyState message="Chưa có nhiệm kỳ" />}
                  {!!terms.nextCursor && (
                    <PaginationControl
                      loading={false}
                      onMore={() => void loadTerms(terms.nextCursor as string).catch(fail)}
                    />
                  )}
                </div>
              </Card>
            </section>
          )}
          {[
            ["age_ministry", "Ban theo độ tuổi"],
            ["service_ministry", "Ban phục vụ"],
            ["area", groups.area?.unitLabel ?? "Khu vực"],
          ].map(([kind, label]) => (
            <section key={kind} className="organization-runtime-group" aria-label={label}>
              <SectionHeader title={label as string} />
              {!!groups[kind as string]?.items.length && (
                <OrganizationUnitsView
                  units={groups[kind as string]?.items ?? []}
                  display={display}
                  area={kind === "area"}
                  scoped={scoped}
                  locked={locked}
                  label={label as string}
                  onView={(u) => {
                    setQ("");
                    void loadRoster(u.id);
                  }}
                  actions={unitActions}
                />
              )}
              {!groups[kind as string]?.items.length && (
                <EmptyState message="Chưa có đơn vị trong phạm vi" />
              )}
              {!!groups[kind as string]?.nextCursor && (
                <PaginationControl
                  loading={false}
                  onMore={() =>
                    void loadGroup(
                      kind as string,
                      groups[kind as string]?.nextCursor as string,
                    ).catch(fail)
                  }
                />
              )}
            </section>
          ))}
        </>
      )}
      <Modal
        open={!!dialog}
        title={
          dialog?.kind === "details"
            ? "Thông tin đơn vị"
            : dialog?.kind === "membership"
              ? "Gán ban phục vụ"
              : "Nhiệm kỳ Ban Chấp sự"
        }
        locked={locked}
        onClose={() => setDialog(null)}
      >
        {pending && (
          <Feedback tone="warning">
            <p>Kết quả thao tác đang chờ đối soát.</p>
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
                    "Kết quả chưa được đối soát. Về danh sách để kiểm tra trước khi tạo thao tác mới?",
                  )
                ) {
                  onPending(null);
                  setDialog(null);
                  setRefresh((n) => n + 1);
                }
              }}
            >
              Về danh sách để đối soát
            </Button>
            {mutation.error && <p>{mutation.error}</p>}
          </Feedback>
        )}
        {dialog &&
          (dialog.kind === "membership" ? (
            <MembershipForm
              key={dialog.unit.id}
              unit={dialog.unit}
              realm={realm}
              base={base}
              today={businessDay(new Date())}
              locked={locked}
              error={mutation.error}
              onSubmit={submit}
              onClose={() => setDialog(null)}
            />
          ) : (
            <OrganizationForm
              key={`${dialog.kind}:${dialog.kind === "term" ? `${dialog.term?.id}:${dialog.action}` : dialog.unit.id}`}
              kind={dialog.kind}
              unit={dialog.kind === "details" ? dialog.unit : undefined}
              term={dialog.kind === "term" ? dialog.term : undefined}
              action={dialog.kind === "term" ? dialog.action : undefined}
              base={base}
              realm={realm}
              today={businessDay(new Date())}
              locked={locked}
              error={mutation.error}
              onClose={() => setDialog(null)}
              onSubmit={submit}
            />
          ))}
      </Modal>
      <Modal
        open={!!rosterId}
        title={roster?.unit.name ?? "Danh sách đơn vị"}
        locked={locked}
        onClose={() => setRosterId(null)}
      >
        <div className="organization-runtime-group">
          <Toolbar>
            <Field label="Tìm trong đơn vị">
              <TextInput
                maxLength={100}
                value={q}
                disabled={rosterBusy}
                onChange={(e) => setQ(e.target.value)}
              />
            </Field>
            <Button disabled={rosterBusy} onClick={() => rosterId && void loadRoster(rosterId)}>
              Tìm
            </Button>
          </Toolbar>
          {rosterBusy && <Loading />}
          {roster && (
            <>
              <p>{roster.total} người</p>
              <TableFrame label="Danh sách tổ chức">
                <table className="organization-runtime-table">
                  <thead>
                    <tr>
                      <th>Mã</th>
                      <th>Họ tên</th>
                      <th>Tuổi</th>
                      <th>Trạng thái</th>
                      {!scoped && <th>Hồ sơ</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {roster.items.map((m) => (
                      <tr key={m.id}>
                        <td>{m.code}</td>
                        <td>{m.fullName}</td>
                        <td>{m.age ?? "Chưa rõ"}</td>
                        <td>{m.participation === "active" ? "Đang sinh hoạt" : "Vắng lâu"}</td>
                        {!scoped && (
                          <td>
                            <Button onClick={() => onMember?.(m.id)}>Xem hồ sơ</Button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableFrame>
              {!!roster.nextCursor && (
                <PaginationControl
                  loading={rosterBusy}
                  onMore={() => rosterId && void loadRoster(rosterId, roster.nextCursor as string)}
                />
              )}
            </>
          )}
          {error && <Feedback tone="error">{error}</Feedback>}
          <DialogActions>
            <Button onClick={() => setRosterId(null)}>Đóng</Button>
          </DialogActions>
        </div>
      </Modal>
      <Modal open={!!historyId} title="Lịch sử tổ chức" onClose={() => setHistoryId(null)}>
        <div className="organization-runtime-group">
          {history?.items.map((h) => (
            <Card key={h.id}>
              <p>
                {h.event} · {h.effectiveOn}
              </p>
              <p>{h.reason}</p>
              <p>
                {h.actorKind} · {h.actorId}
              </p>
              <details>
                <summary>Thay đổi</summary>
                <pre>{JSON.stringify({ before: h.before, after: h.after }, null, 2)}</pre>
              </details>
            </Card>
          ))}
          {!history?.items.length && <EmptyState message="Chưa có lịch sử" />}
          {!!history?.nextCursor && (
            <PaginationControl
              loading={false}
              onMore={() => historyId && void loadHistory(historyId, history?.nextCursor as string)}
            />
          )}
        </div>
      </Modal>
    </div>
  );
}
function MembershipForm({
  unit,
  realm,
  base,
  today,
  locked,
  error,
  onSubmit,
  onClose,
}: {
  unit: RuntimeUnit;
  realm: TenantRealm;
  base: string;
  today: string;
  locked: boolean;
  error: string;
  onSubmit: (body: object) => void;
  onClose: () => void;
}) {
  const [changes, setChanges] = useState<(Person & { add: boolean })[]>([]),
    [add, setAdd] = useState(true),
    [reason, setReason] = useState(""),
    [day, setDay] = useState(today),
    [preview, setPreview] = useState<object | null>(null),
    [busy, setBusy] = useState(false),
    [localError, setLocalError] = useState("");
  const body = {
    changes: changes.map((p) => ({ id: p.id, version: p.version, add: p.add })),
    reason,
    effectiveOn: day,
  };
  async function prepare() {
    setBusy(true);
    setLocalError("");
    try {
      await tenantRequest(realm, `${base}/organization/units/${unit.id}/membership-preview`, {
        method: "POST",
        body,
        headers: { "If-Match": `"${unit.version}"` },
      });
      setPreview(body);
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : "Không xem trước được.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="organization-runtime-form">
      <p>{unit.name}</p>
      {!preview ? (
        <>
          <Field label="Thao tác">
            <Select
              value={add ? "add" : "remove"}
              disabled={locked || busy}
              onChange={(e) => setAdd(e.target.value === "add")}
            >
              <option value="add">Thêm vào ban</option>
              <option value="remove">Bỏ khỏi ban</option>
            </Select>
          </Field>
          <PersonPicker
            base={base}
            realm={realm}
            locked={locked || busy}
            onPick={(p) =>
              setChanges((old) => [...old.filter((c) => c.id !== p.id), { ...p, add }])
            }
          />
          {changes.map((p) => (
            <div className="organization-runtime-actions" key={p.id}>
              <span>
                {p.fullName} · {p.add ? "Thêm" : "Bỏ"}
              </span>
              <Button
                disabled={locked || busy}
                onClick={() => setChanges((old) => old.filter((c) => c.id !== p.id))}
              >
                Bỏ lựa chọn
              </Button>
            </div>
          ))}
          <Field label="Ngày hiệu lực">
            <TextInput
              required
              type="date"
              max={today}
              value={day}
              disabled={locked || busy}
              onChange={(e) => setDay(e.target.value)}
            />
          </Field>
          <Field label="Lý do">
            <TextArea
              required
              maxLength={500}
              value={reason}
              disabled={locked || busy}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
        </>
      ) : (
        <>
          <p>
            Xem trước · {day} · {reason}
          </p>
          {changes.map((p) => (
            <p key={p.id}>
              {p.fullName}: {p.add ? "thêm" : "bỏ"} {unit.name}
            </p>
          ))}
          <Feedback>Giữ nguyên ban tuổi, chế độ xếp ban và khu vực.</Feedback>
        </>
      )}
      {(error || localError) && <Feedback tone="error">{error || localError}</Feedback>}
      <DialogActions>
        <Button disabled={locked || busy} onClick={onClose}>
          Hủy
        </Button>
        {preview ? (
          <>
            <Button disabled={locked} onClick={() => setPreview(null)}>
              Sửa lại
            </Button>
            <Button variant="primary" disabled={locked} onClick={() => onSubmit(preview)}>
              Xác nhận
            </Button>
          </>
        ) : (
          <Button
            variant="primary"
            disabled={locked || busy || !changes.length || changes.length > 100 || !reason.trim()}
            onClick={() => void prepare()}
          >
            Xem trước
          </Button>
        )}
      </DialogActions>
    </div>
  );
}
