import { useEffect, useRef, useState } from "react";
import type { ChurchRef } from "./access-context";
import { ApiError } from "./api";
import { DataExchangePanel } from "./data-exchange";
import { MemberForm } from "./member-form";
import {
  baptismLabels,
  dayLabel,
  genderLabels,
  type HistoryPage,
  householdLabels,
  type MemberDto,
  type MemberMutation,
  type MemberOptions,
  type MemberPage,
  membershipLabels,
  memberTypeLabels,
  participationLabels,
  stageLabels,
} from "./members-api";
import type { UnitDto } from "./organization-api";
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
  DialogActions,
  Drawer,
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
  Tabs,
  TextArea,
  TextInput,
  Toolbar,
} from "./ui/components";
import "./members-management.css";
interface Context {
  church: ChurchRef;
  capabilities: string[];
  principal: { principalKind: string; employeeId?: string; accountId?: string };
}
interface Props {
  realm: TenantRealm;
  churchId: string;
  pending: TenantIntent | null;
  onPending: (value: TenantIntent | null) => void;
  onAuthError: (error: unknown) => void;
  onTitle: (title: string, context?: string) => void;
  onChurch?: (church: ChurchRef) => void;
  onBack?: () => void;
  onFamily?: (id: string) => void;
  initialMemberId?: string | null;
  initialFilters?: Record<string, string>;
  initialCreate?: boolean;
}
const blankFilters = {
  q: "",
  type: "",
  participation: "current",
  membership: "",
  areaId: "",
  unitId: "",
  baptism: "",
  birthday: "",
  familyId: "",
  firstVisit: "",
  visitorStage: "",
};
export function MembersManagement({
  realm,
  churchId,
  pending,
  onPending,
  onAuthError,
  onTitle,
  onChurch,
  onBack,
  onFamily,
  initialMemberId,
  initialFilters,
  initialCreate,
}: Props) {
  const base = `${realm === "owner" ? "owner/" : ""}churches/${churchId}`;
  const [ctx, setCtx] = useState<Context | null>(null),
    [options, setOptions] = useState<MemberOptions | null>(null),
    [units, setUnits] = useState<UnitDto[]>([]),
    [unitCursor, setUnitCursor] = useState<string | null>(null),
    [unitBusy, setUnitBusy] = useState(false),
    [page, setPage] = useState<MemberPage | null>(null),
    [counts, setCounts] = useState<{ all: number; believer: number; visitor: number } | null>(null),
    [filters, setFilters] = useState(
      () =>
        Object.fromEntries(
          Object.entries(blankFilters).map(([k, v]) => [
            k,
            initialFilters?.[k] ?? new URLSearchParams(location.search).get(k) ?? v,
          ]),
        ) as typeof blankFilters,
    ),
    [search, setSearch] = useState(""),
    [loading, setLoading] = useState(false),
    [more, setMore] = useState(false),
    [refresh, setRefresh] = useState(0),
    [selected, setSelected] = useState<MemberDto | null>(null),
    [profile, setProfile] = useState<"create" | "edit" | null>(null),
    [change, setChange] = useState<"stage" | "conversion" | "participation" | null>(null),
    [changeValue, setChangeValue] = useState(""),
    [effective, setEffective] = useState(""),
    [eventDate, setEventDate] = useState(""),
    [believed, setBelieved] = useState(""),
    [reason, setReason] = useState(""),
    [history, setHistory] = useState<HistoryPage | null>(null),
    [historyBusy, setHistoryBusy] = useState(false),
    [reconcile, setReconcile] = useState(false),
    [formSeed, setFormSeed] = useState(0),
    [familyScope, setFamilyScope] = useState("");
  const generation = useRef(0),
    moreGuard = useRef(false),
    detailGeneration = useRef(0),
    selectedId = useRef<string | null>(null);
  const canWrite = !!ctx?.capabilities.includes("members:manage"),
    principalKey = ctx
      ? `${ctx.principal.principalKind}:${ctx.principal.employeeId ?? ctx.principal.accountId}`
      : "";
  const mutation = useTenantMutation({
    realm,
    churchId,
    principalKey,
    canWrite,
    pending,
    onPending,
    onAuthError,
    operationPath: `${base}/members/operations`,
    prefix: `${base}/members`,
    onSuccess: (data) => {
      const result = data as MemberMutation;
      if (!result?.member?.id)
        throw new ApiError(
          "NETWORK_ERROR",
          "Chưa đọc được mã hồ sơ đã lưu. Kiểm tra kết quả trước khi thử lại.",
        );
      setProfile(null);
      setChange(null);
      setReconcile(false);
      setRefresh((v) => v + 1);
      void open(result.member.id);
    },
  });
  const { busy, error, fields, notice, fail, setError, setFields, setNotice } = mutation,
    locked = busy || !!pending,
    currentPending =
      pending?.realm === realm &&
      pending.churchId === churchId &&
      pending.path.startsWith(`${base}/members`)
        ? pending
        : null;
  const unitLabel =
    options?.settings?.unitType === "custom"
      ? (options.settings.customUnitLabel ?? "Đơn vị")
      : options?.settings?.unitType === "branch"
        ? "Chi phái"
        : options?.settings?.unitType === "cell_group"
          ? "Nhóm tế bào"
          : "Khu vực";
  function exportFilterSummary() {
    const labels: Record<string, string> = {
      q: "Tìm kiếm",
      type: "Loại",
      participation: "Sinh hoạt",
      membership: "Tư cách",
      areaId: unitLabel,
      unitId: "Ban ngành",
      baptism: "Báp-têm",
      birthday: "Sinh nhật",
      familyId: "Gia đình",
      firstVisit: "Đến lần đầu",
      visitorStage: "Giai đoạn thân hữu",
    };
    const values: Record<string, Record<string, string>> = {
      type: memberTypeLabels,
      participation: {
        current: "Đang sinh hoạt / vắng lâu",
        all: "Tất cả",
        ...participationLabels,
      },
      membership: membershipLabels,
      baptism: baptismLabels,
      firstVisit: { last30: "30 ngày gần nhất" },
      visitorStage: stageLabels,
    };
    return Object.entries(filters)
      .filter(([, v]) => v)
      .map(([k, v]) => {
        const text =
          k === "areaId" || k === "unitId"
            ? (units.find((u) => u.id === v)?.name ?? "Đã chọn")
            : k === "birthday"
              ? v === "week"
                ? "Tuần này"
                : `Tháng ${v.split(":")[1]}`
              : (values[k]?.[v] ?? v);
        return `${labels[k] ?? k}: ${text}`;
      })
      .join(" · ");
  }
  function query(cursor?: string, summary = false) {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) if (v && !(summary && k === "type")) q.set(k, v);
    if (cursor) q.set("cursor", cursor);
    return q;
  }
  useEffect(() => {
    const abort = new AbortController();
    setCtx(null);
    setOptions(null);
    setSelected(null);
    setPage(null);
    setCounts(null);
    setError("");
    async function load() {
      try {
        const r = await tenantRequest<Context>(realm, `${base}/context`, { signal: abort.signal });
        if (abort.signal.aborted) return;
        onTitle("Thuộc viên", `${r.data.church.name} · ${r.data.church.code}`);
        onChurch?.(r.data.church);
        if (!r.data.capabilities.includes("members:read"))
          throw new ApiError("FORBIDDEN", "Bạn không có quyền xem hồ sơ Hội Thánh.");
        const o = await tenantRequest<MemberOptions>(realm, `${base}/members/options?limit=100`, {
          signal: abort.signal,
        });
        if (abort.signal.aborted) return;
        setCtx(r.data);
        setOptions(o.data);
        setUnits(o.data.units.items);
        setUnitCursor(o.data.units.nextCursor);
      } catch (e) {
        if (!abort.signal.aborted) fail(e);
      }
    }
    void load();
    return () => abort.abort();
  }, [realm, churchId]);
  const createOpened = useRef(false);
  useEffect(() => {
    if (
      ctx &&
      initialCreate &&
      !createOpened.current &&
      canWrite &&
      options?.configured &&
      !pending
    ) {
      createOpened.current = true;
      setProfile("create");
    }
  }, [ctx, initialCreate, options, pending]);
  useEffect(() => {
    if (ctx && initialMemberId) void open(initialMemberId);
  }, [ctx, initialMemberId]);
  useEffect(() => {
    if (!ctx) return;
    const abort = new AbortController();
    generation.current++;
    const current = generation.current;
    setLoading(true);
    setPage(null);
    setCounts(null);
    setError("");
    Promise.all([
      tenantRequest<MemberPage>(realm, `${base}/members?${query()}`, { signal: abort.signal }),
      tenantRequest<{ all: number; believer: number; visitor: number }>(
        realm,
        `${base}/members/summary?${query(undefined, true)}`,
        { signal: abort.signal },
      ),
    ])
      .then(([p, c]) => {
        if (!abort.signal.aborted && current === generation.current) {
          setPage(p.data);
          setCounts(c.data);
        }
      })
      .catch((e) => {
        if (!abort.signal.aborted) fail(e);
      })
      .finally(() => {
        if (!abort.signal.aborted && current === generation.current) setLoading(false);
      });
    return () => {
      generation.current++;
      abort.abort();
    };
  }, [ctx, JSON.stringify(filters), refresh]);
  async function optionsMore() {
    if (unitBusy || !unitCursor || locked) return;
    setUnitBusy(true);
    try {
      const r = await tenantRequest<MemberOptions>(
        realm,
        `${base}/members/options?${new URLSearchParams({ limit: "100", cursor: unitCursor })}`,
      );
      if (r.data.settings?.version !== options?.settings?.version)
        throw new ApiError(
          "ASSIGNMENT_CONTEXT_CHANGED",
          "Cấu hình đã thay đổi. Tải lại danh mục trước khi nhập.",
        );
      setUnits((old) => [
        ...old,
        ...r.data.units.items.filter((u) => !old.some((o) => o.id === u.id)),
      ]);
      setUnitCursor(r.data.units.nextCursor);
    } catch (e) {
      fail(e);
    } finally {
      setUnitBusy(false);
    }
  }
  async function loadMore() {
    if (moreGuard.current || !page?.nextCursor || locked) return;
    moreGuard.current = true;
    setMore(true);
    const current = generation.current;
    try {
      const r = await tenantRequest<MemberPage>(realm, `${base}/members?${query(page.nextCursor)}`);
      if (current === generation.current)
        setPage((old) => ({
          ...r.data,
          items: [
            ...(old?.items ?? []),
            ...r.data.items.filter((m) => !old?.items.some((o) => o.id === m.id)),
          ],
        }));
    } catch (e) {
      if (current === generation.current) fail(e);
    } finally {
      moreGuard.current = false;
      setMore(false);
    }
  }
  async function open(id: string) {
    const request = ++detailGeneration.current;
    selectedId.current = id;
    setError("");
    setFields({});
    setHistory(null);
    try {
      const r = await tenantRequest<MemberDto>(realm, `${base}/members/${id}`);
      if (request === detailGeneration.current) setSelected(r.data);
    } catch (e) {
      if (request === detailGeneration.current) fail(e);
    }
  }
  async function loadHistory(cursor?: string) {
    if (!selected || historyBusy) return;
    const id = selected.id;
    setHistoryBusy(true);
    try {
      const r = await tenantRequest<HistoryPage>(
        realm,
        `${base}/members/${selected.id}/history${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
      );
      if (selectedId.current === id)
        setHistory((old) => ({
          ...r.data,
          items: cursor ? [...(old?.items ?? []), ...r.data.items] : r.data.items,
        }));
    } catch (e) {
      fail(e);
    } finally {
      setHistoryBusy(false);
    }
  }
  async function reloadForm() {
    if (locked) return;
    setError("");
    setFields({});
    try {
      const o = await tenantRequest<MemberOptions>(realm, `${base}/members/options?limit=100`);
      setOptions(o.data);
      setUnits(o.data.units.items);
      setUnitCursor(o.data.units.nextCursor);
      if (profile === "edit" && selected) await open(selected.id);
      setFormSeed((v) => v + 1);
    } catch (e) {
      fail(e);
    }
  }
  function startChange(kind: typeof change) {
    if (!selected || !kind || locked) return;
    setFields({});
    setError("");
    setChange(kind);
    setChangeValue(kind === "stage" ? (selected.visitor?.stage ?? "new") : selected.participation);
    setEffective(options?.asOfDate ?? "");
    setEventDate("");
    setBelieved(selected.visitor?.believedOn ?? "");
    setReason("");
  }
  function sendChange() {
    if (!selected || !change) return;
    const path = `${base}/members/${selected.id}/${change === "stage" ? "visitor-stage" : change}`;
    mutation.send(
      path,
      change === "conversion" ? "POST" : "PATCH",
      change === "stage"
        ? { stage: changeValue, believedOn: believed || null, reason }
        : change === "conversion"
          ? { effectiveOn: effective, believedOn: believed || null, reason }
          : { status: changeValue, effectiveOn: effective, eventDate: eventDate || null, reason },
      selected.version,
    );
  }
  const changeTitle =
    change === "stage"
      ? "Cập nhật giai đoạn"
      : change === "conversion"
        ? "Chuyển thành tín hữu"
        : "Thay đổi sinh hoạt";
  return (
    <>
      {onBack && (
        <Button variant="link" disabled={locked} onClick={onBack}>
          ← Chi tiết Hội Thánh
        </Button>
      )}
      {error && <Feedback tone="error">{error}</Feedback>}
      {notice && <Feedback>{notice}</Feedback>}
      {currentPending && (
        <Card>
          <SectionHeader title="Thao tác chưa được đối soát" />
          <p>Giữ nguyên thao tác. Kiểm tra kết quả trước khi thử hoặc rời trang.</p>
          {currentPending.principalKey !== principalKey && ctx && (
            <Feedback tone="warning">Phiên hiện tại không khớp người đã tạo thao tác.</Feedback>
          )}
          <DialogActions>
            <Button
              disabled={busy || !ctx || !canWrite || currentPending.principalKey !== principalKey}
              onClick={() => void mutation.execute(currentPending, true)}
            >
              Kiểm tra kết quả
            </Button>
            <Button disabled={busy} onClick={() => setReconcile(true)}>
              Quay về đối soát
            </Button>
          </DialogActions>
        </Card>
      )}
      {!ctx && !error && <Loading />}
      {ctx && (
        <>
          {!options?.configured && (
            <Feedback tone="warning">
              Cần owner hoặc Mục sư thiết lập Cấu hình Hội Thánh trước khi thêm hồ sơ.
            </Feedback>
          )}
          <DataExchangePanel
            key={`${realm}:${churchId}:${principalKey}`}
            realm={realm}
            churchId={churchId}
            principalKey={principalKey}
            capabilities={ctx.capabilities}
            filters={Object.fromEntries(query())}
            filterSummary={exportFilterSummary()}
            pending={pending}
            onPending={onPending}
            onAuthError={onAuthError}
            onChanged={() => setRefresh((v) => v + 1)}
          />
          <Card>
            <SectionHeader title="Thuộc viên Hội Thánh">
              {canWrite && (
                <IconButton
                  icon="plus"
                  label="Thêm thuộc viên"
                  disabled={locked || !options?.configured}
                  onClick={() => {
                    setProfile("create");
                    setFormSeed((v) => v + 1);
                    setFields({});
                    setError("");
                    setNotice("");
                  }}
                />
              )}
            </SectionHeader>
            <div className="members-section">
              <Tabs
                id="members-type"
                value={filters.type || "all"}
                items={[
                  { id: "all", label: `Tất cả ${counts?.all ?? "—"}` },
                  { id: "believer", label: `Tín hữu ${counts?.believer ?? "—"}` },
                  { id: "visitor", label: `Thân hữu ${counts?.visitor ?? "—"}` },
                ]}
                onChange={(id) => {
                  if (!locked)
                    setFilters((old) => ({
                      ...old,
                      type: id === "all" ? "" : id,
                      ...(id === "believer" ? { firstVisit: "", visitorStage: "" } : {}),
                    }));
                }}
              />
              <Toolbar>
                <form
                  className="members-search"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!locked) setFilters((old) => ({ ...old, q: search }));
                  }}
                >
                  <Field label="Tìm mã, tên, điện thoại">
                    <TextInput
                      maxLength={100}
                      value={search}
                      disabled={locked}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </Field>
                  <Button type="submit" disabled={locked}>
                    Tìm
                  </Button>
                </form>
                <Field label={unitLabel}>
                  <Select
                    disabled={locked}
                    value={filters.areaId}
                    onChange={(e) => setFilters((old) => ({ ...old, areaId: e.target.value }))}
                  >
                    <option value="">Tất cả {unitLabel.toLowerCase()}</option>
                    {units
                      .filter((u) => u.kind === "area")
                      .map((u) => (
                        <option value={u.id} key={u.id}>
                          {u.name}
                        </option>
                      ))}
                  </Select>
                </Field>
                <Field label="Sinh hoạt">
                  <Select
                    disabled={locked}
                    value={filters.participation}
                    onChange={(e) =>
                      setFilters((old) => ({ ...old, participation: e.target.value }))
                    }
                  >
                    <option value="current">Đang sinh hoạt / vắng lâu</option>
                    {Object.entries(participationLabels).map(([id, label]) => (
                      <option key={id} value={id}>
                        {label}
                      </option>
                    ))}
                    <option value="all">Tất cả, gồm hồ sơ lịch sử</option>
                  </Select>
                </Field>
                <Field label="Tình trạng tín hữu">
                  <Select
                    disabled={locked}
                    value={filters.membership}
                    onChange={(e) => setFilters((old) => ({ ...old, membership: e.target.value }))}
                  >
                    <option value="">Tất cả tình trạng</option>
                    {Object.entries(membershipLabels).map(([id, label]) => (
                      <option key={id} value={id}>
                        {label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Lọc Báp-têm">
                  <Select
                    disabled={locked}
                    value={filters.baptism}
                    onChange={(e) => setFilters((old) => ({ ...old, baptism: e.target.value }))}
                  >
                    <option value="">Báp-têm: tất cả</option>
                    {Object.entries(baptismLabels).map(([id, label]) => (
                      <option value={id} key={id}>
                        {label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Thân hữu mới">
                  <Select
                    disabled={locked}
                    value={filters.firstVisit}
                    onChange={(e) =>
                      setFilters((old) => ({
                        ...old,
                        firstVisit: e.target.value,
                        type: e.target.value ? "visitor" : old.type,
                      }))
                    }
                  >
                    <option value="">Mọi ngày đến</option>
                    <option value="last30">30 ngày gần nhất</option>
                  </Select>
                </Field>
                <Field label="Giai đoạn thân hữu">
                  <Select
                    disabled={locked}
                    value={filters.visitorStage}
                    onChange={(e) =>
                      setFilters((old) => ({
                        ...old,
                        visitorStage: e.target.value,
                        type: e.target.value ? "visitor" : old.type,
                      }))
                    }
                  >
                    <option value="">Mọi giai đoạn</option>
                    {Object.entries(stageLabels).map(([key, label]) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Sinh nhật">
                  <Select
                    disabled={locked}
                    value={filters.birthday}
                    onChange={(e) => setFilters((old) => ({ ...old, birthday: e.target.value }))}
                  >
                    <option value="">Mọi tháng</option>
                    <option value="week">Tuần này</option>
                    {/^month:\d{4}-/.test(filters.birthday) && (
                      <option value={filters.birthday}>
                        Tháng {filters.birthday.slice(11)}/{filters.birthday.slice(6, 10)}
                      </option>
                    )}
                    {Array.from({ length: 12 }, (_, i) => (
                      <option key={`month:${i + 1}`} value={`month:${i + 1}`}>
                        Tháng {i + 1}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Ban ngành">
                  <Select
                    disabled={locked}
                    value={filters.unitId}
                    onChange={(e) => setFilters((old) => ({ ...old, unitId: e.target.value }))}
                  >
                    <option value="">Mọi ban ngành</option>
                    {units
                      .filter((u) => u.kind !== "area" && u.kind !== "board")
                      .map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name}
                        </option>
                      ))}
                  </Select>
                </Field>
              </Toolbar>
              {unitCursor && (
                <Button disabled={locked || unitBusy} onClick={() => void optionsMore()}>
                  Tải thêm danh mục
                </Button>
              )}
              {(filters.familyId ||
                Object.entries(filters).some(([k, v]) => v && k !== "participation") ||
                filters.participation !== "current") && (
                <div className="members-actions">
                  {filters.familyId && <Badge>Gia đình {familyScope}</Badge>}
                  <Button
                    disabled={locked}
                    onClick={() => {
                      setFilters(blankFilters);
                      setSearch("");
                      setFamilyScope("");
                    }}
                  >
                    Xóa bộ lọc
                  </Button>
                </div>
              )}
              {loading && <Loading />}
              {page?.items.length === 0 && (
                <EmptyState
                  message={
                    Object.values(filters).some((v) => v && v !== "current")
                      ? "Không có thuộc viên khớp bộ lọc."
                      : "Chưa có hồ sơ thuộc viên trong Hội Thánh này."
                  }
                />
              )}
              {!!page?.items.length && (
                <TableFrame label="Danh sách thuộc viên">
                  <table className="members-table">
                    <thead>
                      <tr>
                        {[
                          "Mã",
                          "Họ tên",
                          "Loại",
                          "Sinh nhật",
                          "Báp-têm",
                          unitLabel,
                          "Tình trạng",
                          "Hiện diện 12 CN",
                          "Ban ngành",
                        ].map((title) => (
                          <th key={title}>{title}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {page.items.map((m) => (
                        <tr key={m.id}>
                          <td className="num">{m.code}</td>
                          <td>
                            <Button
                              variant="link"
                              className="member-name"
                              disabled={locked}
                              onClick={() => void open(m.id)}
                            >
                              {m.fullName}
                            </Button>
                            {m.phone && <div className="small muted">{m.phone}</div>}
                          </td>
                          <td>
                            <Badge>{memberTypeLabels[m.type]}</Badge>
                          </td>
                          <td>
                            {dayLabel(m.birthDate)}
                            <div className="small muted">
                              {m.age === null ? "Chưa rõ tuổi" : `${m.age} tuổi`}
                            </div>
                          </td>
                          <td>
                            {baptismLabels[m.baptism.status]}
                            {m.baptism.date && (
                              <div className="small muted">{dayLabel(m.baptism.date)}</div>
                            )}
                          </td>
                          <td>{m.family.areaName ?? "—"}</td>
                          <td>
                            {m.type === "visitor" && m.visitor
                              ? stageLabels[m.visitor.stage]
                              : m.membership
                                ? membershipLabels[m.membership]
                                : "—"}
                            <div className="small muted">
                              {participationLabels[m.participation]}
                            </div>
                          </td>
                          <td>—</td>
                          <td>
                            {m.units
                              .slice(0, 2)
                              .map((u) => u.name)
                              .join(", ") || "—"}
                            {m.assignment.unitIds.length > 2 &&
                              ` +${m.assignment.unitIds.length - 2}`}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableFrame>
              )}
              {page?.nextCursor && (
                <PaginationControl loading={more || locked} onMore={() => void loadMore()} />
              )}
              {error && !loading && (
                <Button disabled={locked} onClick={() => setRefresh((v) => v + 1)}>
                  Tải lại danh sách
                </Button>
              )}
            </div>
          </Card>
        </>
      )}
      <Drawer
        open={!!selected}
        title={selected ? `${selected.fullName} · ${selected.code}` : "Hồ sơ"}
        locked={locked}
        onClose={() => {
          detailGeneration.current++;
          selectedId.current = null;
          setSelected(null);
          setHistory(null);
        }}
      >
        {selected && (
          <div className="member-drawer-content">
            <div className="members-actions">
              <Badge>{memberTypeLabels[selected.type]}</Badge>
              <Badge tone={selected.participation === "active" ? "good" : "warn"}>
                {participationLabels[selected.participation]}
              </Badge>
              {canWrite && (
                <Button
                  disabled={locked}
                  onClick={() => {
                    setProfile("edit");
                    setFormSeed((v) => v + 1);
                    setError("");
                    setFields({});
                  }}
                >
                  Sửa hồ sơ
                </Button>
              )}
            </div>
            <SectionHeader title="Thông tin cá nhân" />
            <KeyValueList
              items={[
                { label: "Ngày sinh", value: dayLabel(selected.birthDate) },
                { label: "Tuổi", value: selected.age ?? "Chưa rõ" },
                { label: "Giới tính", value: genderLabels[selected.gender] },
                { label: "Điện thoại", value: selected.phone ?? "—" },
                { label: unitLabel, value: selected.family.areaName ?? "Chưa phân khu vực" },
                {
                  label: "Tình trạng",
                  value: selected.membership ? membershipLabels[selected.membership] : "Thân hữu",
                },
                {
                  label: "Ban ngành",
                  value:
                    selected.units
                      .map((u) => `${u.name}${u.status === "inactive" ? " (đã ngừng)" : ""}`)
                      .join(", ") || "—",
                },
              ]}
            />
            <SectionHeader title="Lễ nghi · thông tin hồ sơ" />
            <KeyValueList
              items={[
                { label: "Báp-têm", value: baptismLabels[selected.baptism.status] },
                { label: "Ngày", value: dayLabel(selected.baptism.date) },
                { label: "Nơi", value: selected.baptism.place ?? "—" },
                ...(selected.convertedOn
                  ? [{ label: "Từ thân hữu", value: dayLabel(selected.convertedOn) }]
                  : []),
              ]}
            />
            {selected.visitor && (
              <>
                <SectionHeader
                  title={selected.type === "visitor" ? "Theo dõi thân hữu" : "Nguồn thân hữu"}
                />
                <KeyValueList
                  items={[
                    { label: "Giai đoạn", value: stageLabels[selected.visitor.stage] },
                    { label: "Đến lần đầu", value: dayLabel(selected.visitor.firstVisit) },
                    { label: "Tin Chúa", value: dayLabel(selected.visitor.believedOn) },
                    { label: "Giới thiệu", value: selected.visitor.referrer ?? "—" },
                    { label: "Chăm sóc", value: selected.caregiverName ?? "Chưa giao" },
                  ]}
                />
                {selected.type === "visitor" && canWrite && (
                  <div className="members-actions">
                    <Button disabled={locked} onClick={() => startChange("stage")}>
                      Cập nhật giai đoạn
                    </Button>
                    <Button
                      disabled={
                        locked || !["active", "long_absent"].includes(selected.participation)
                      }
                      onClick={() => startChange("conversion")}
                    >
                      Chuyển thành tín hữu
                    </Button>
                  </div>
                )}
              </>
            )}
            <SectionHeader title="Hiện diện" />
            <p className="muted">Chưa khả dụng.</p>
            <SectionHeader title="Gia đình" />
            {onFamily && (
              <Button variant="link" disabled={locked} onClick={() => onFamily(selected.familyId)}>
                Xem gia đình {selected.family.code}
              </Button>
            )}
            <p>
              {selected.family.code} · {householdLabels[selected.householdRole]}
            </p>
            {selected.familyMembers.items.map((m) => (
              <div key={m.id}>
                <Button variant="link" disabled={locked} onClick={() => void open(m.id)}>
                  {m.fullName}
                </Button>{" "}
                · {householdLabels[m.householdRole]} · {participationLabels[m.participation]}
              </div>
            ))}
            {selected.familyMembers.items.length === 0 && (
              <p className="muted">Chưa có thành viên khác trong hộ.</p>
            )}
            {selected.familyMembers.hasMore && (
              <Button
                disabled={locked}
                onClick={() => {
                  setFilters({
                    ...blankFilters,
                    participation: "all",
                    familyId: selected.familyId,
                  });
                  setFamilyScope(selected.family.code ?? "");
                  setSelected(null);
                }}
              >
                Xem thành viên cùng hộ
              </Button>
            )}
            <SectionHeader title="Dâng hiến" />
            <p className="muted">Chưa khả dụng.</p>
            <SectionHeader title="QR / Thẻ tín hữu" />
            <p className="muted">Chưa khả dụng.</p>
            <div className="members-actions">
              {canWrite && (
                <Button disabled={locked} onClick={() => startChange("participation")}>
                  Thay đổi sinh hoạt
                </Button>
              )}
              <Button disabled={locked || historyBusy} onClick={() => void loadHistory()}>
                Lịch sử hồ sơ
              </Button>
            </div>
            {historyBusy && <Loading />}
            {history && (
              <div className="member-history">
                {history.items.map((h) => (
                  <div key={h.id}>
                    <strong>{historyLabel(h.event)}</strong>
                    <div className="small muted">
                      {new Date(h.occurredAt).toLocaleString("vi-VN", {
                        timeZone: "Asia/Ho_Chi_Minh",
                      })}{" "}
                      · {h.actorKind === "owner" ? "Nhà cung cấp" : "Người dùng Hội Thánh"}
                    </div>
                    <p>
                      Hiệu lực: {dayLabel(h.effectiveOn)}
                      {h.eventDate ? ` · Ngày sự kiện: ${dayLabel(h.eventDate)}` : ""}
                    </p>
                    {h.reason && <p>{h.reason}</p>}
                    {onFamily &&
                      typeof h.before?.familyId === "string" &&
                      typeof h.after.familyId === "string" &&
                      h.before.familyId !== h.after.familyId && (
                        <div className="members-actions">
                          <Button
                            variant="link"
                            disabled={locked}
                            onClick={() => onFamily(h.before?.familyId as string)}
                          >
                            Xem hộ trước
                          </Button>
                          <Button
                            variant="link"
                            disabled={locked}
                            onClick={() => onFamily(h.after.familyId as string)}
                          >
                            Xem hộ sau
                          </Button>
                        </div>
                      )}
                    {historyChanges(h).map((line) => (
                      <p key={line} className="small">
                        {line}
                      </p>
                    ))}
                  </div>
                ))}
                {history.nextCursor && (
                  <PaginationControl
                    loading={historyBusy || locked}
                    onMore={() => void loadHistory(history.nextCursor as string)}
                  />
                )}
              </div>
            )}
          </div>
        )}
      </Drawer>
      <Modal
        open={!!profile}
        title={profile === "edit" ? "Sửa hồ sơ" : "Thêm thuộc viên"}
        locked={locked}
        onClose={() => setProfile(null)}
      >
        {profile && options && (
          <MemberForm
            key={`${profile}:${selected?.id ?? "new"}:${selected?.version ?? 0}:${formSeed}`}
            original={profile === "edit" ? selected : null}
            options={options}
            units={units}
            realm={realm}
            base={base}
            locked={locked}
            error={error}
            fields={fields}
            onClose={() => setProfile(null)}
            onReload={() => void reloadForm()}
            onSubmit={(body) =>
              mutation.send(
                `${base}/members${profile === "edit" && selected ? `/${selected.id}` : ""}`,
                profile === "edit" ? "PATCH" : "POST",
                body,
                profile === "edit" ? selected?.version : undefined,
              )
            }
          />
        )}
        {currentPending && (
          <div className="member-pending">
            <Feedback tone="warning">Thao tác chưa được đối soát.</Feedback>
            <DialogActions>
              <Button
                disabled={busy || !canWrite || currentPending.principalKey !== principalKey}
                onClick={() => void mutation.execute(currentPending, true)}
              >
                Kiểm tra kết quả
              </Button>
              <Button disabled={busy} onClick={() => setReconcile(true)}>
                Quay về đối soát
              </Button>
            </DialogActions>
          </div>
        )}
      </Modal>
      <Modal open={!!change} title={changeTitle} locked={locked} onClose={() => setChange(null)}>
        <form
          className="member-form"
          onSubmit={(e) => {
            e.preventDefault();
            sendChange();
          }}
        >
          <p>
            Hội Thánh: {ctx?.church.name} · {ctx?.church.code}
          </p>
          <p>
            Hồ sơ: <strong>{selected?.fullName}</strong> · {selected?.code}
          </p>
          {change === "stage" ? (
            <Field label="Giai đoạn">
              <Select
                value={changeValue}
                disabled={locked}
                onChange={(e) => setChangeValue(e.target.value)}
              >
                {Object.entries(stageLabels).map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>
          ) : change === "participation" ? (
            <Field label="Sinh hoạt mới">
              <Select
                value={changeValue}
                disabled={locked}
                onChange={(e) => setChangeValue(e.target.value)}
              >
                {Object.entries(participationLabels).map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>
          ) : (
            <Feedback>
              Chuyển sang tín hữu · Dự bị. Giữ mã hồ sơ và lịch sử; chưa ghi danh lớp Báp-têm.
            </Feedback>
          )}
          {change !== "stage" && (
            <Field label="Ngày hiệu lực">
              <TextInput
                required
                type="date"
                max={options?.asOfDate}
                value={effective}
                disabled={locked}
                onChange={(e) => setEffective(e.target.value)}
              />
            </Field>
          )}
          {change === "participation" ? (
            <Field label="Ngày sự kiện thực tế" optional hint="Chưa rõ ngày thì để trống.">
              <TextInput
                type="date"
                max={options?.asOfDate}
                value={eventDate}
                disabled={locked}
                onChange={(e) => setEventDate(e.target.value)}
              />
            </Field>
          ) : (
            <Field label="Ngày tin Chúa" optional>
              <TextInput
                type="date"
                max={options?.asOfDate}
                value={believed}
                disabled={locked}
                onChange={(e) => setBelieved(e.target.value)}
              />
            </Field>
          )}
          <Field label="Lý do" error={fields.reason}>
            <TextArea
              required
              maxLength={500}
              value={reason}
              disabled={locked}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
          {error && <Feedback tone="error">{error}</Feedback>}
          {currentPending && <Feedback tone="warning">Thao tác chưa được đối soát.</Feedback>}
          <DialogActions>
            {currentPending ? (
              <>
                <Button
                  disabled={busy || !canWrite || currentPending.principalKey !== principalKey}
                  onClick={() => void mutation.execute(currentPending, true)}
                >
                  Kiểm tra kết quả
                </Button>
                <Button disabled={busy} onClick={() => setReconcile(true)}>
                  Quay về đối soát
                </Button>
              </>
            ) : (
              <>
                <Button disabled={locked} onClick={() => setChange(null)}>
                  Hủy
                </Button>
                {error && selected && (
                  <Button disabled={locked} onClick={() => void open(selected.id)}>
                    Tải bản mới
                  </Button>
                )}
                <Button variant="primary" type="submit" disabled={locked}>
                  Xác nhận
                </Button>
              </>
            )}
          </DialogActions>
        </form>
      </Modal>
      <Modal
        open={reconcile}
        title="Đối soát trước thao tác mới"
        locked={busy}
        onClose={() => setReconcile(false)}
      >
        <p>
          Kết quả thao tác trước vẫn chưa được xác định. Kiểm tra danh sách và hồ sơ, kể cả hồ sơ
          chuyển đi hoặc qua đời, trước khi tạo thao tác mới.
        </p>
        <DialogActions>
          <Button onClick={() => setReconcile(false)}>Quay lại</Button>
          <Button
            onClick={() => {
              onPending(null);
              setProfile(null);
              setChange(null);
              setSelected(null);
              setReconcile(false);
              setFilters({ ...blankFilters, participation: "all" });
              setRefresh((v) => v + 1);
              setNotice("Đối soát dữ liệu hiện tại trước thao tác mới.");
            }}
          >
            Về danh sách để đối soát
          </Button>
        </DialogActions>
      </Modal>
    </>
  );
}
function historyLabel(event: string) {
  return (
    (
      {
        created: "Tạo hồ sơ",
        family_changed: "Chuyển gia đình",
        household_role_changed: "Đổi vai trò trong hộ",
        profile_updated: "Sửa hồ sơ",
        visitor_stage_changed: "Cập nhật thân hữu",
        conversion_changed: "Chuyển thành tín hữu",
        participation_changed: "Thay đổi sinh hoạt",
      } as Record<string, string>
    )[event] ?? "Thay đổi hồ sơ"
  );
}
function historyChanges(h: HistoryPage["items"][number]) {
  const labels: Record<string, string> = {
    fullName: "Họ tên",
    birthDate: "Ngày sinh",
    phone: "Điện thoại",
    type: "Loại",
    membership: "Tình trạng tín hữu",
    participation: "Sinh hoạt",
    gender: "Giới tính",
    householdRole: "Vai trò trong hộ",
    convertedOn: "Ngày chuyển tín hữu",
    "baptism.status": "Báp-têm",
    "baptism.date": "Ngày Báp-têm",
    "baptism.place": "Nơi Báp-têm",
    "visitor.stage": "Giai đoạn thân hữu",
    "visitor.firstVisit": "Đến lần đầu",
    "visitor.believedOn": "Ngày tin Chúa",
    "visitor.referrer": "Người giới thiệu",
    "assignment.mode": "Cách xếp ban",
    "assignment.asOfDate": "Ngày xếp ban",
  };
  const values: Record<string, string> = {
    ...memberTypeLabels,
    ...membershipLabels,
    ...participationLabels,
    ...genderLabels,
    ...householdLabels,
    ...baptismLabels,
    ...stageLabels,
    auto: "Tự động theo độ tuổi",
    manual: "Thủ công",
  };
  const value = (source: Record<string, unknown> | null, key: string): unknown =>
    key
      .split(".")
      .reduce<unknown>(
        (v, part) =>
          v && typeof v === "object" ? (v as Record<string, unknown>)[part] : undefined,
        source,
      );
  const lines = Object.entries(labels).flatMap(([key, label]) => {
    const before = value(h.before, key),
      after = value(h.after, key);
    if (before === after || after === undefined) return [];
    const show = (v: unknown) =>
      typeof v === "string"
        ? /^\d{4}-\d{2}-\d{2}$/.test(v)
          ? dayLabel(v)
          : (values[v] ?? v)
        : "—";
    return [`${label}: ${show(before)} → ${show(after)}`];
  });
  for (const [key, label] of [
    ["assignment.unitIds", "Danh sách ban"],
    ["visitor.caregiverId", "Người chăm sóc"],
  ]) {
    if (key && JSON.stringify(value(h.before, key)) !== JSON.stringify(value(h.after, key)))
      lines.push(`${label}: đã cập nhật`);
  }
  return lines;
}
