import { useEffect, useRef, useState } from "react";
import type { ChurchRef } from "./access-context";
import { ApiError } from "./api";
import {
  type FamilyCards,
  type FamilyCommand,
  type FamilyDto,
  type FamilyHistory,
  type FamilyInput,
  type FamilyPeople,
  type FamilyPreview,
  familyEventLabels,
} from "./families-api";
import { type FamilyAction, FamilyCommandForm, familyActionLabels } from "./family-command";
import { FamilyForm } from "./family-form";
import { dayLabel, householdLabels, type MemberOptions, participationLabels } from "./members-api";
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
  TextInput,
  Toolbar,
} from "./ui/components";
import "./families-management.css";
interface Context {
  church: ChurchRef;
  capabilities: string[];
  principal: { principalKind: string; employeeId?: string; accountId?: string };
}
interface Props {
  realm: TenantRealm;
  churchId: string;
  pending: TenantIntent | null;
  onPending: (v: TenantIntent | null) => void;
  onAuthError: (e: unknown) => void;
  onTitle: (title: string, context?: string) => void;
  onChurch?: (c: ChurchRef) => void;
  onBack?: () => void;
  onMember: (id: string) => void;
  initialFamilyId?: string | null;
}
interface PreviewDraft {
  data: FamilyPreview;
  body: object;
  path: string;
  method: "POST" | "PATCH";
  version: number;
}
export function FamiliesManagement({
  realm,
  churchId,
  pending,
  onPending,
  onAuthError,
  onTitle,
  onChurch,
  onBack,
  onMember,
  initialFamilyId,
}: Props) {
  const base = `${realm === "owner" ? "owner/" : ""}churches/${churchId}`;
  const [ctx, setCtx] = useState<Context | null>(null),
    [options, setOptions] = useState<MemberOptions | null>(null),
    [units, setUnits] = useState<UnitDto[]>([]),
    [unitCursor, setUnitCursor] = useState<string | null>(null),
    [page, setPage] = useState<FamilyCards | null>(null),
    [search, setSearch] = useState(""),
    [query, setQuery] = useState(""),
    [area, setArea] = useState(""),
    [status, setStatus] = useState("active"),
    [refresh, setRefresh] = useState(0),
    [loading, setLoading] = useState(false),
    [more, setMore] = useState(false),
    [selected, setSelected] = useState<FamilyDto | null>(null),
    [people, setPeople] = useState<FamilyPeople | null>(null),
    [history, setHistory] = useState<FamilyHistory | null>(null),
    [detailBusy, setDetailBusy] = useState(false),
    [form, setForm] = useState<"new" | "edit" | null>(null),
    [action, setAction] = useState<FamilyAction | null>(null),
    [preview, setPreview] = useState<PreviewDraft | null>(null),
    [previewBusy, setPreviewBusy] = useState(false),
    [seed, setSeed] = useState(0),
    [reconcile, setReconcile] = useState(false),
    [expanded, setExpanded] = useState<string[]>([]);
  const listGeneration = useRef(0),
    detailGeneration = useRef(0),
    currentId = useRef<string | null>(null),
    moreGuard = useRef(false),
    previewGuard = useRef(false);
  const canWrite = !!ctx?.capabilities.includes("families:manage"),
    principalKey = ctx
      ? `${ctx.principal.principalKind}:${ctx.principal.employeeId ?? ctx.principal.accountId}`
      : "";
  const mutation = useTenantMutation({
    realm,
    churchId,
    canWrite,
    principalKey,
    pending,
    onPending,
    onAuthError,
    prefix: `${base}/families`,
    operationPath: `${base}/families/operations`,
    onSuccess: (data) => {
      const r = data as { family?: { id?: string } };
      if (!r?.family?.id)
        throw new ApiError("NETWORK_ERROR", "Chưa đọc được mã gia đình đã lưu. Kiểm tra kết quả.");
      setForm(null);
      setAction(null);
      setPreview(null);
      setReconcile(false);
      setRefresh((v) => v + 1);
      void open(r.family.id);
    },
  });
  const { busy, error, notice, fail, setError, setNotice } = mutation,
    locked = busy || previewBusy || !!pending;
  const unitLabel =
    options?.settings?.unitType === "custom"
      ? (options.settings.customUnitLabel ?? "Đơn vị")
      : options?.settings?.unitType === "branch"
        ? "Chi phái"
        : options?.settings?.unitType === "cell_group"
          ? "Nhóm tế bào"
          : "Khu vực";
  function listQuery(cursor?: string) {
    return new URLSearchParams({
      view: "cards",
      status,
      ...(query ? { q: query } : {}),
      ...(area ? { areaId: area } : {}),
      ...(cursor ? { cursor } : {}),
    });
  }
  useEffect(() => {
    const abort = new AbortController();
    setCtx(null);
    setSelected(null);
    setError("");
    async function load() {
      try {
        const r = await tenantRequest<Context>(realm, `${base}/context`, { signal: abort.signal });
        if (abort.signal.aborted) return;
        onTitle("Gia đình", `${r.data.church.name} · ${r.data.church.code}`);
        onChurch?.(r.data.church);
        if (!r.data.capabilities.includes("families:read"))
          throw new ApiError("FORBIDDEN", "Bạn không có quyền xem gia đình Hội Thánh.");
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
    return () => {
      abort.abort();
      detailGeneration.current++;
    };
  }, [realm, churchId]);
  useEffect(() => {
    if (ctx && initialFamilyId) void open(initialFamilyId);
  }, [ctx, initialFamilyId]);
  useEffect(() => {
    if (!ctx) return;
    const abort = new AbortController(),
      generation = ++listGeneration.current;
    setLoading(true);
    setPage(null);
    tenantRequest<FamilyCards>(realm, `${base}/families?${listQuery()}`, { signal: abort.signal })
      .then((r) => {
        if (!abort.signal.aborted && generation === listGeneration.current) setPage(r.data);
      })
      .catch((e) => {
        if (!abort.signal.aborted) fail(e);
      })
      .finally(() => {
        if (!abort.signal.aborted && generation === listGeneration.current) setLoading(false);
      });
    return () => {
      listGeneration.current++;
      abort.abort();
    };
  }, [ctx, query, status, area, refresh]);
  async function moreCards() {
    if (moreGuard.current || !page?.nextCursor || locked) return;
    moreGuard.current = true;
    setMore(true);
    const gen = listGeneration.current;
    try {
      const r = await tenantRequest<FamilyCards>(
        realm,
        `${base}/families?${listQuery(page.nextCursor)}`,
      );
      if (gen === listGeneration.current)
        setPage((old) => ({
          ...r.data,
          items: [
            ...(old?.items ?? []),
            ...r.data.items.filter((f) => !old?.items.some((o) => o.id === f.id)),
          ],
        }));
    } catch (e) {
      fail(e);
    } finally {
      moreGuard.current = false;
      setMore(false);
    }
  }
  async function moreUnits() {
    if (locked || !unitCursor || moreGuard.current) return;
    moreGuard.current = true;
    setMore(true);
    try {
      const r = await tenantRequest<MemberOptions>(
        realm,
        `${base}/members/options?${new URLSearchParams({ limit: "100", cursor: unitCursor })}`,
      );
      setUnits((old) => [
        ...old,
        ...r.data.units.items.filter((u) => !old.some((o) => o.id === u.id)),
      ]);
      setUnitCursor(r.data.units.nextCursor);
    } catch (e) {
      fail(e);
    } finally {
      moreGuard.current = false;
      setMore(false);
    }
  }
  async function open(id: string) {
    const gen = ++detailGeneration.current;
    currentId.current = id;
    setDetailBusy(true);
    setHistory(null);
    setPeople(null);
    setError("");
    try {
      const [f, p] = await Promise.all([
        tenantRequest<FamilyDto>(realm, `${base}/families/${id}`),
        tenantRequest<FamilyPeople>(realm, `${base}/families/${id}/members`),
      ]);
      if (gen === detailGeneration.current) {
        setSelected(f.data);
        setPeople(p.data);
      }
    } catch (e) {
      if (gen === detailGeneration.current) fail(e);
    } finally {
      if (gen === detailGeneration.current) setDetailBusy(false);
    }
  }
  async function morePeople() {
    if (!selected || !people?.nextCursor || detailBusy || locked) return;
    const id = selected.id;
    setDetailBusy(true);
    try {
      const p = await tenantRequest<FamilyPeople>(
        realm,
        `${base}/families/${id}/members?cursor=${encodeURIComponent(people.nextCursor)}`,
      );
      if (id === currentId.current)
        setPeople((old) => ({ ...p.data, items: [...(old?.items ?? []), ...p.data.items] }));
    } catch (e) {
      fail(e);
    } finally {
      setDetailBusy(false);
    }
  }
  async function loadHistory(cursor?: string) {
    if (!selected || detailBusy || locked) return;
    const id = selected.id;
    setDetailBusy(true);
    try {
      const r = await tenantRequest<FamilyHistory>(
        realm,
        `${base}/families/${id}/history${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
      );
      if (id === currentId.current)
        setHistory((old) => ({
          ...r.data,
          items: cursor ? [...(old?.items ?? []), ...r.data.items] : r.data.items,
        }));
    } catch (e) {
      fail(e);
    } finally {
      setDetailBusy(false);
    }
  }
  async function reloadForm() {
    if (locked || !selected) return;
    setError("");
    await open(selected.id);
    setSeed((v) => v + 1);
  }
  async function showPreview(
    command: FamilyCommand,
    write?: { body: object; path: string; method: "POST" | "PATCH" },
  ) {
    if (previewGuard.current || !selected || locked) return;
    previewGuard.current = true;
    setPreviewBusy(true);
    setError("");
    try {
      const r = await tenantRequest<FamilyPreview>(
        realm,
        `${base}/families/${selected.id}/preview`,
        { method: "POST", body: command, headers: { "If-Match": `"${selected.version}"` } },
      );
      const path =
        command.kind === "area"
          ? `${base}/families/${selected.id}`
          : `${base}/families/${selected.id}/${{ roles: "roles", transfer: "transfers", split: "splits", merge: "merges" }[command.kind]}`;
      setPreview({
        data: r.data,
        body: write?.body ?? r.data.command,
        path: write?.path ?? path,
        method:
          write?.method ?? (command.kind === "roles" || command.kind === "area" ? "PATCH" : "POST"),
        version: selected.version,
      });
    } catch (e) {
      fail(e);
    } finally {
      previewGuard.current = false;
      setPreviewBusy(false);
    }
  }
  function submitMeta(body: FamilyInput, reason: string, day: string) {
    if (form === "edit" && selected) {
      if (body.areaId !== selected.areaId)
        void showPreview(
          { kind: "area", areaId: body.areaId, reason, effectiveOn: day },
          {
            body: { ...body, reason, effectiveOn: day },
            path: `${base}/families/${selected.id}`,
            method: "PATCH",
          },
        );
      else mutation.send(`${base}/families/${selected.id}`, "PATCH", body, selected.version);
    } else mutation.send(`${base}/families`, "POST", body);
  }
  const pendingControls = pending && (
    <div className="family-section">
      <Feedback tone="warning">
        Thao tác chưa được đối soát. Giữ nguyên và kiểm tra kết quả trước thao tác mới.
      </Feedback>
      <DialogActions>
        <Button
          disabled={busy || !canWrite || pending.principalKey !== principalKey}
          onClick={() => void mutation.execute(pending, true)}
        >
          Kiểm tra kết quả
        </Button>
        <Button disabled={busy} onClick={() => setReconcile(true)}>
          Quay về đối soát
        </Button>
      </DialogActions>
    </div>
  );
  return (
    <>
      {onBack && (
        <Button variant="link" disabled={locked} onClick={onBack}>
          ← Chi tiết Hội Thánh
        </Button>
      )}
      {error && <Feedback tone="error">{error}</Feedback>}
      {notice && <Feedback>{notice}</Feedback>}
      {pending && !form && !action && !preview && <Card>{pendingControls}</Card>}
      {!ctx && !error && <Loading />}
      {ctx && (
        <div className="family-section">
          <Card>
            <SectionHeader title="Gia đình Hội Thánh">
              {canWrite && (
                <IconButton
                  icon="plus"
                  label="Thêm gia đình"
                  disabled={locked}
                  onClick={() => {
                    setForm("new");
                    setError("");
                    setSeed((v) => v + 1);
                  }}
                />
              )}
            </SectionHeader>
            <Toolbar>
              <form
                className="family-search"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!locked) setQuery(search);
                }}
              >
                <Field label="Tìm mã hộ, tên hộ hoặc thành viên">
                  <TextInput
                    maxLength={100}
                    disabled={locked}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </Field>
                <Button type="submit" disabled={locked}>
                  Tìm
                </Button>
              </form>
              <Field label={unitLabel}>
                <Select disabled={locked} value={area} onChange={(e) => setArea(e.target.value)}>
                  <option value="">Tất cả {unitLabel.toLowerCase()}</option>
                  {units
                    .filter((u) => u.kind === "area")
                    .map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                </Select>
              </Field>
              <Field label="Trạng thái hộ">
                <Select
                  disabled={locked}
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                >
                  <option value="active">Đang dùng</option>
                  <option value="merged">Đã gộp</option>
                  <option value="all">Tất cả hộ</option>
                </Select>
              </Field>
            </Toolbar>
            {unitCursor && (
              <Button disabled={locked || more} onClick={() => void moreUnits()}>
                Tải thêm danh mục
              </Button>
            )}
          </Card>
          {loading && <Loading />}
          {detailBusy && !selected && <Loading />}
          {page?.items.length === 0 && (
            <EmptyState
              message={
                query || area || status !== "active"
                  ? "Không có gia đình khớp bộ lọc."
                  : "Chưa có gia đình trong Hội Thánh này."
              }
            />
          )}
          <div className="grid g3">
            {page?.items.map((f) => (
              <Card key={f.id} className="family-card">
                <SectionHeader title={f.code}>
                  <Badge>{f.areaName ?? "Chưa phân khu vực"}</Badge>
                </SectionHeader>
                <div className="family-section">
                  {f.name && <strong>{f.name}</strong>}
                  <p className="small muted">
                    Từ {f.sinceYear ?? "—"} · {f.count ?? 0} hồ sơ
                  </p>
                  {f.status === "merged" && <Badge tone="warn">Đã gộp</Badge>}
                  <div className="list">
                    {f.people?.map((m) => (
                      <div className="li" key={m.id}>
                        <div className="t">
                          <Button variant="link" disabled={locked} onClick={() => onMember(m.id)}>
                            {m.fullName}
                          </Button>
                          <div className="small muted">
                            {householdLabels[m.householdRole]} ·{" "}
                            {m.age === null ? "Chưa rõ tuổi" : `${m.age} tuổi`}
                          </div>
                        </div>
                        <Badge tone={m.participation === "active" ? "good" : "muted"}>
                          {participationLabels[m.participation]}
                        </Badge>
                      </div>
                    ))}
                  </div>
                  <div className="family-actions">
                    {(f.count ?? 0) > 6 && (
                      <Button variant="link" disabled={locked} onClick={() => void open(f.id)}>
                        Xem đầy đủ
                      </Button>
                    )}
                    <Button disabled={locked} onClick={() => void open(f.id)}>
                      Chi tiết {f.code}
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
          {page?.nextCursor && (
            <PaginationControl loading={more || locked} onMore={() => void moreCards()} />
          )}{" "}
          {error && !loading && (
            <Button disabled={locked} onClick={() => setRefresh((v) => v + 1)}>
              Tải lại danh sách
            </Button>
          )}
        </div>
      )}
      <Drawer
        open={!!selected}
        title={selected ? `Gia đình ${selected.code}` : "Gia đình"}
        locked={locked}
        onClose={() => {
          detailGeneration.current++;
          currentId.current = null;
          setSelected(null);
          setPeople(null);
          setHistory(null);
        }}
      >
        {selected && (
          <div className="family-section">
            <KeyValueList
              items={[
                { label: "Tên gia đình", value: selected.name ?? "—" },
                {
                  label: unitLabel,
                  value: `${selected.areaName ?? "Chưa phân khu vực"}${selected.areaStatus === "inactive" ? " · Đã ngừng" : ""}`,
                },
                { label: "Địa chỉ", value: selected.address ?? "—" },
                { label: "Sinh hoạt từ năm", value: selected.sinceYear ?? "Chưa rõ" },
                { label: "Ghi chú", value: selected.notes ?? "—" },
                {
                  label: "Trạng thái hộ",
                  value: selected.status === "merged" ? "Đã gộp" : "Đang dùng",
                },
                { label: "Chủ hộ", value: selected.head?.fullName ?? "Chưa có chủ hộ" },
              ]}
            />
            {selected.mergedInto && (
              <Feedback tone="warning">
                Hộ đã gộp vào {selected.mergedInto.code}.{" "}
                <Button
                  variant="link"
                  disabled={locked}
                  onClick={() => void open(selected.mergedInto?.id as string)}
                >
                  Xem hộ đích
                </Button>
              </Feedback>
            )}
            {canWrite && selected.status === "active" && (
              <div className="family-actions">
                <Button
                  disabled={locked || detailBusy}
                  onClick={() => {
                    setForm("edit");
                    setSeed((v) => v + 1);
                    setError("");
                  }}
                >
                  Sửa hộ
                </Button>
                {(["roles", "transfer", "split", "merge"] as const).map((kind) => (
                  <Button
                    disabled={locked || detailBusy}
                    key={kind}
                    onClick={() => {
                      setAction(kind);
                      setSeed((v) => v + 1);
                      setError("");
                    }}
                  >
                    {familyActionLabels[kind]}
                  </Button>
                ))}
              </div>
            )}
            <SectionHeader title={`Thành viên · ${selected.count} hồ sơ`} />
            {people?.items.map((m) => (
              <div className="li" key={m.id}>
                <div className="t">
                  <Button variant="link" disabled={locked} onClick={() => onMember(m.id)}>
                    {m.fullName}
                  </Button>
                  <div className="small muted">
                    {householdLabels[m.householdRole]} ·{" "}
                    {m.age === null ? "Chưa rõ tuổi" : `${m.age} tuổi`}
                  </div>
                </div>
                <Badge>{participationLabels[m.participation]}</Badge>
              </div>
            ))}
            {people?.items.length === 0 && <p className="muted">Chưa có thành viên trong hộ.</p>}
            {people?.nextCursor && (
              <PaginationControl loading={locked || detailBusy} onMore={() => void morePeople()} />
            )}
            {detailBusy && <Loading />}
            <Button disabled={locked || detailBusy} onClick={() => void loadHistory()}>
              Lịch sử và liên kết hộ
            </Button>
            {history?.items.map((h) => (
              <div className="family-history-item" key={h.id}>
                <strong>{familyEventLabels[h.event] ?? "Thay đổi gia đình"}</strong>
                <p className="small muted">
                  {new Date(h.occurredAt).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}{" "}
                  · {h.actorKind === "owner" ? "Nhà cung cấp" : "Người dùng Hội Thánh"} · Hiệu lực{" "}
                  {dayLabel(h.effectiveOn)}
                </p>
                {h.reason && <p>{h.reason}</p>}
                {familyHistoryChanges(h).map((line) => (
                  <p className="small" key={line}>
                    {line}
                  </p>
                ))}
                {h.changes.length > 0 && (
                  <p>{h.changes.length} hồ sơ được ghi nhận trong thao tác.</p>
                )}
                {h.changes.slice(0, expanded.includes(h.id) ? 100 : 5).map((c) => (
                  <p key={c.id} className="small">
                    {c.fullName ?? "Thành viên"}:{" "}
                    {householdLabels[c.fromRole as keyof typeof householdLabels]} →{" "}
                    {householdLabels[c.toRole as keyof typeof householdLabels]}
                    {c.fromFamilyId !== c.toFamilyId
                      ? ` · ${c.fromCode ?? "Hộ nguồn"} → ${c.toCode ?? "Hộ đích"}`
                      : ""}
                  </p>
                ))}
                {h.changes.length > 5 && (
                  <Button
                    variant="link"
                    disabled={locked}
                    onClick={() =>
                      setExpanded((old) =>
                        old.includes(h.id) ? old.filter((id) => id !== h.id) : [...old, h.id],
                      )
                    }
                  >
                    {expanded.includes(h.id) ? "Thu gọn thay đổi" : "Xem đầy đủ thay đổi"}
                  </Button>
                )}
                {h.related.map((f) => (
                  <Button
                    variant="link"
                    disabled={locked}
                    key={f.id}
                    onClick={() => void open(f.id)}
                  >
                    {f.code}
                  </Button>
                ))}
              </div>
            ))}
            {history?.nextCursor && (
              <PaginationControl
                loading={locked || detailBusy}
                onMore={() => void loadHistory(history.nextCursor as string)}
              />
            )}
          </div>
        )}
      </Drawer>
      <Modal
        open={!!form}
        title={form === "new" ? "Thêm gia đình" : "Sửa hộ"}
        locked={locked}
        onClose={() => setForm(null)}
      >
        {form && options && (
          <FamilyForm
            key={`${form}:${selected?.version ?? 0}:${seed}`}
            original={form === "edit" ? selected : null}
            units={units}
            unitLabel={unitLabel}
            today={options.asOfDate}
            locked={locked}
            error={error}
            onSubmit={submitMeta}
            onClose={() => setForm(null)}
            onReload={() => void reloadForm()}
          />
        )}{" "}
        {pendingControls}
      </Modal>
      <Modal
        open={!!action}
        title={action ? familyActionLabels[action] : "Thao tác gia đình"}
        locked={locked}
        onClose={() => setAction(null)}
      >
        {action && selected && options && (
          <FamilyCommandForm
            key={`${action}:${selected.version}:${seed}`}
            source={selected}
            kind={action}
            realm={realm}
            base={base}
            units={units}
            unitLabel={unitLabel}
            today={options.asOfDate}
            locked={locked}
            error={error}
            onError={fail}
            onPreview={(c) => void showPreview(c)}
            onClose={() => setAction(null)}
            onReload={() => void reloadForm()}
          />
        )}{" "}
        {pendingControls}
      </Modal>
      <Modal
        open={!!preview}
        title="Xem trước thay đổi gia đình"
        locked={locked}
        onClose={() => setPreview(null)}
      >
        {preview && (
          <div className="family-section">
            <p>
              Hội Thánh {ctx?.church.name} · {ctx?.church.code}
            </p>
            <p>
              Hộ nguồn: <strong>{preview.data.source.code}</strong> ·{" "}
              {preview.data.source.areaName ?? "Chưa phân khu vực"}
            </p>
            {preview.data.target && (
              <p>
                Hộ đích: <strong>{preview.data.target.code}</strong> ·{" "}
                {preview.data.target.areaName ?? "Chưa phân khu vực"}
              </p>
            )}
            {preview.data.kind === "area" ? (
              <p>
                Khu vực mới: {preview.data.areaAfter ?? "Chưa phân khu vực"} ·{" "}
                {preview.data.sourceAfter.count} hồ sơ đọc theo khu vực mới
              </p>
            ) : (
              <>
                <p>
                  Nguồn: {preview.data.sourceBefore.count} → {preview.data.sourceAfter.count} hồ sơ
                  · Chủ hộ {preview.data.sourceBefore.head ?? "chưa có"} →{" "}
                  {preview.data.sourceAfter.head ?? "chưa có"}
                </p>
                {preview.data.targetAfter && (
                  <p>
                    Đích: {preview.data.targetBefore?.count ?? 0} → {preview.data.targetAfter.count}{" "}
                    hồ sơ · Chủ hộ {preview.data.targetBefore?.head ?? "chưa có"} →{" "}
                    {preview.data.targetAfter.head ?? "chưa có"}
                  </p>
                )}
                <TableFrame label="Thay đổi thành viên">
                  <table className="family-command-table">
                    <thead>
                      <tr>
                        <th>Thành viên</th>
                        <th>Vai trò hiện tại</th>
                        <th>Vai trò mới</th>
                        <th>Thay đổi hộ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.data.changes.map((m) => (
                        <tr key={m.id}>
                          <td>{m.fullName}</td>
                          <td>{householdLabels[m.fromRole as keyof typeof householdLabels]}</td>
                          <td>{householdLabels[m.toRole as keyof typeof householdLabels]}</td>
                          <td>{m.fromFamilyId !== m.toFamilyId ? "Sang hộ đích" : "Giữ hộ"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableFrame>
              </>
            )}
            <p>
              Hiệu lực {dayLabel(preview.data.command.effectiveOn)} · {preview.data.command.reason}
            </p>
            {preview.data.kind === "merge" && (
              <Feedback tone="warning">
                Chuyển toàn bộ hồ sơ, gồm chuyển đi/qua đời. Hộ nguồn giữ mã và liên kết để tra cứu.
              </Feedback>
            )}
            {error && <Feedback tone="error">{error}</Feedback>}
            {pending ? (
              pendingControls
            ) : (
              <DialogActions>
                <Button disabled={locked} onClick={() => setPreview(null)}>
                  Quay lại sửa
                </Button>
                <Button
                  variant="primary"
                  disabled={locked}
                  onClick={() =>
                    mutation.send(preview.path, preview.method, preview.body, preview.version)
                  }
                >
                  Xác nhận thay đổi
                </Button>
              </DialogActions>
            )}
          </div>
        )}
      </Modal>
      <Modal
        open={reconcile}
        title="Đối soát trước thao tác mới"
        locked={busy}
        onClose={() => setReconcile(false)}
      >
        <p>
          Đối soát cả hộ đang dùng và đã gộp trước ý định mới. Chưa xác định kết quả không có nghĩa
          thao tác thất bại.
        </p>
        <DialogActions>
          <Button onClick={() => setReconcile(false)}>Quay lại</Button>
          <Button
            onClick={() => {
              onPending(null);
              setReconcile(false);
              setForm(null);
              setAction(null);
              setPreview(null);
              setSelected(null);
              setStatus("all");
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
function familyHistoryChanges(h: FamilyHistory["items"][number]) {
  const labels: Record<string, string> = {
    name: "Tên gia đình",
    address: "Địa chỉ",
    notes: "Ghi chú",
    sinceYear: "Sinh hoạt từ năm",
    status: "Trạng thái hộ",
  };
  return Object.entries(labels).flatMap(([key, label]) => {
    const before = h.before?.[key],
      after = h.after[key];
    if (before === after) return [];
    const show = (v: unknown) =>
      v === null || v === undefined
        ? "—"
        : v === "merged"
          ? "Đã gộp"
          : v === "active"
            ? "Đang dùng"
            : String(v);
    return [`${label}: ${show(before)} → ${show(after)}`];
  });
}
