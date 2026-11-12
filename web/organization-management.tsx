import { type FormEvent, useEffect, useRef, useState } from "react";
import type { ChurchRef } from "./access-context";
import { ApiError } from "./api";
import {
  type OrganizationIntent,
  type OrganizationRealm,
  organizationPath,
  organizationRequest,
  type SettingsDto,
  type SettingsReply,
  type UnitDto,
  type UnitPage,
} from "./organization-api";
import { useTenantMutation } from "./tenant-mutation";
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
import "./organization-management.css";
interface Context {
  church: ChurchRef;
  capabilities: string[];
  principal: { principalKind: string; employeeId?: string; accountId?: string };
}
interface Props {
  realm: OrganizationRealm;
  churchId: string;
  pending: OrganizationIntent | null;
  onPending: (intent: OrganizationIntent | null) => void;
  onAuthError: (error: unknown) => void;
  onTitle: (title: string, context?: string) => void;
  onChurch?: (church: ChurchRef) => void;
  onBack?: () => void;
}
const authCodes = [
  "REAUTH_REQUIRED",
  "SESSION_EXPIRED",
  "SESSION_REVOKED",
  "PASSWORD_CHANGE_REQUIRED",
];
export function OrganizationManagement({
  realm,
  churchId,
  pending,
  onPending,
  onAuthError,
  onTitle,
  onChurch,
  onBack,
}: Props) {
  const base = organizationPath(realm, churchId);
  const [value, setValue] = useState<SettingsReply | null>(null),
    [ctx, setCtx] = useState<Context | null>(null),
    [unitType, setUnitType] = useState<SettingsDto["unitType"]>("area"),
    [custom, setCustom] = useState(""),
    [assignment, setAssignment] = useState<"auto" | "manual">("auto"),
    [refresh, setRefresh] = useState(0),
    [form, setForm] = useState<{
      kind: "service_ministry" | "area";
      unit?: UnitDto;
      status?: boolean;
    } | null>(null),
    [name, setName] = useState(""),
    [reason, setReason] = useState(""),
    [reconcile, setReconcile] = useState(false);
  const canWrite = !!ctx?.capabilities.includes("organization:manage"),
    principalKey = ctx
      ? `${ctx.principal.principalKind}:${ctx.principal.employeeId ?? ctx.principal.accountId}`
      : "";
  const {
    busy,
    setBusy,
    error,
    setError,
    notice,
    setNotice,
    fields,
    setFields,
    fail,
    execute,
    send: sendIntent,
  } = useTenantMutation({
    realm,
    churchId,
    principalKey,
    canWrite,
    pending,
    onPending,
    onAuthError,
    operationPath: `${base}/operations`,
    prefix: base,
    onSuccess: () => {
      setForm(null);
      setReconcile(false);
      setRefresh((v) => v + 1);
    },
  });
  const currentPending = pending?.churchId === churchId && pending.realm === realm ? pending : null;
  const locked = busy || !!pending;
  useEffect(() => {
    const controller = new AbortController();
    setValue(null);
    setCtx(null);
    setError("");
    async function load() {
      try {
        const context = await organizationRequest<Context>(
          realm,
          `${realm === "owner" ? "owner/" : ""}churches/${churchId}/context`,
          { signal: controller.signal },
        );
        if (controller.signal.aborted) return;
        onTitle("Cấu hình Hội Thánh", `${context.data.church.name} · ${context.data.church.code}`);
        onChurch?.(context.data.church);
        if (!context.data.capabilities.includes("organization:read"))
          throw new ApiError("FORBIDDEN", "Bạn không có quyền xem cấu hình Hội Thánh.");
        const result = await organizationRequest<SettingsReply>(realm, `${base}/settings`, {
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        setCtx(context.data);
        setValue(result.data);
        const config = result.data.settings ?? result.data.defaults;
        setUnitType(config.unitType);
        setAssignment(config.defaultAssignmentMode);
        setCustom(result.data.settings?.customUnitLabel ?? "");
      } catch (e) {
        if (!controller.signal.aborted) fail(e);
      }
    }
    void load();
    return () => controller.abort();
  }, [realm, churchId, refresh]);
  function send(path: string, method: "POST" | "PATCH", body: object, version?: number) {
    sendIntent(`${base}/${path}`, method, body, version);
  }
  function saveSettings(e: FormEvent) {
    e.preventDefault();
    send(
      "settings",
      value?.configured ? "PATCH" : "POST",
      {
        unitType,
        defaultAssignmentMode: assignment,
        ...(unitType === "custom" ? { customUnitLabel: custom } : {}),
      },
      value?.settings?.version,
    );
  }
  async function edit(unit: UnitDto, status = false) {
    if (locked) return;
    setBusy(true);
    setError("");
    setFields({});
    setNotice("");
    try {
      const r = await organizationRequest<UnitDto>(realm, `${base}/units/${unit.id}`);
      setForm({ kind: unit.kind as "area" | "service_ministry", unit: r.data, status });
      setName(r.data.name);
      setReason("");
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }
  const unitLabel =
    unitType === "custom"
      ? custom || "Đơn vị"
      : unitType === "branch"
        ? "Chi phái"
        : unitType === "cell_group"
          ? "Nhóm tế bào"
          : "Khu vực";
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
            <Feedback tone="warning">
              Phiên hiện tại không khớp người đã tạo thao tác. Không gửi lại bằng tài khoản khác.
            </Feedback>
          )}
          <DialogActions>
            <Button
              disabled={busy || !ctx || !canWrite || currentPending.principalKey !== principalKey}
              onClick={() => void execute(currentPending, true)}
            >
              Kiểm tra kết quả
            </Button>
            <Button disabled={busy} onClick={() => setReconcile(true)}>
              Quay về đối soát
            </Button>
          </DialogActions>
        </Card>
      )}
      {!value && !error && <Loading />}
      {!value && !busy && (
        <Button disabled={!!pending} onClick={() => setRefresh((v) => v + 1)}>
          Tải lại
        </Button>
      )}
      {value && (
        <>
          {!canWrite && <Feedback>Chỉ xem. Owner hoặc Mục sư quản lý cấu hình Hội Thánh.</Feedback>}
          {!value.configured && (
            <Feedback>Hội Thánh chưa được thiết lập. Chưa có ban phục vụ hoặc khu vực.</Feedback>
          )}
          <Card>
            <form className="organization-settings" onSubmit={saveSettings} aria-busy={busy}>
              <div className="organization-settings-group">
                <SectionHeader title="Tên gọi đơn vị sinh hoạt" />
                <div className="organization-group-content">
                  <div className="opts">
                    {(
                      [
                        ["area", "Khu vực"],
                        ["cell_group", "Nhóm tế bào"],
                        ["branch", "Chi phái"],
                        ["custom", "Khác"],
                      ] as const
                    ).map(([id, label]) => (
                      <Choice
                        key={id}
                        type="radio"
                        name="unitType"
                        label={label}
                        value={id}
                        checked={unitType === id}
                        disabled={!canWrite || locked}
                        onChange={() => setUnitType(id)}
                      />
                    ))}
                  </div>
                  {unitType === "custom" && (
                    <Field label="Tên gọi khác" error={fields.customUnitLabel}>
                      <TextInput
                        required
                        maxLength={40}
                        value={custom}
                        disabled={!canWrite || locked}
                        onChange={(e) => setCustom(e.target.value)}
                      />
                    </Field>
                  )}
                </div>
              </div>
              <div className="organization-settings-group">
                <SectionHeader title="Xếp ban khi thêm thuộc viên" />
                <div className="organization-group-content">
                  <div className="opts">
                    <Choice
                      type="radio"
                      name="assignment"
                      label="Tự động theo độ tuổi"
                      checked={assignment === "auto"}
                      disabled={!canWrite || locked}
                      onChange={() => setAssignment("auto")}
                    />
                    <Choice
                      type="radio"
                      name="assignment"
                      label="Thủ công"
                      checked={assignment === "manual"}
                      disabled={!canWrite || locked}
                      onChange={() => setAssignment("manual")}
                    />
                  </div>
                  <div className="organization-age-grid">
                    {value.ageBands.map((b) => (
                      <div key={b.key} className="organization-age-row">
                        <strong>{b.name}</strong>
                        <span className="muted">
                          {b.max === null ? `từ ${b.min}` : `${b.min}–${b.max}`} tuổi
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              {canWrite && (
                <DialogActions>
                  <Button disabled={locked} onClick={() => setRefresh((v) => v + 1)}>
                    Hủy
                  </Button>
                  <Button variant="primary" disabled={locked} type="submit">
                    {busy ? "Đang xử lý…" : value.configured ? "Lưu" : "Thiết lập"}
                  </Button>
                </DialogActions>
              )}
            </form>
          </Card>
          {value.configured && (
            <>
              <UnitsPanel
                key={`service:${refresh}`}
                realm={realm}
                base={base}
                kind="service_ministry"
                title="Ban phục vụ"
                canWrite={canWrite}
                locked={locked}
                onError={fail}
                onEdit={edit}
                onAdd={() => {
                  setForm({ kind: "service_ministry" });
                  setName("");
                  setFields({});
                  setError("");
                }}
              />
              <UnitsPanel
                key={`area:${refresh}`}
                realm={realm}
                base={base}
                kind="area"
                title={unitLabel}
                canWrite={canWrite}
                locked={locked}
                onError={fail}
                onEdit={edit}
                onAdd={() => {
                  setForm({ kind: "area" });
                  setName("");
                  setFields({});
                  setError("");
                }}
              />
            </>
          )}
          <Card>
            <SectionHeader title="Quỹ / Đề xuất chi & phê duyệt" />
            <p className="muted">Chưa khả dụng.</p>
          </Card>
        </>
      )}
      <Modal
        open={!!form}
        locked={locked}
        title={
          form?.status
            ? form.unit?.status === "active"
              ? "Ngừng sử dụng"
              : "Kích hoạt lại"
            : `${form?.unit ? "Sửa" : "Thêm"} ${form?.kind === "area" ? unitLabel.toLowerCase() : "ban phục vụ"}`
        }
        onClose={() => setForm(null)}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!form) return;
            send(
              `units${form.unit ? `/${form.unit.id}${form.status ? "/status" : ""}` : ""}`,
              form.unit ? "PATCH" : "POST",
              form.status
                ? { status: form.unit?.status === "active" ? "inactive" : "active", reason }
                : { name, ...(!form.unit ? { kind: form.kind } : {}) },
              form.unit?.version,
            );
          }}
        >
          {form?.status ? (
            <>
              <p>
                Hội Thánh: {ctx?.church.name} · {ctx?.church.code}
              </p>
              <p>
                Ban/Khu vực: <strong>{form.unit?.name}</strong>
              </p>
              <p>Giữ dữ liệu và lịch sử. Mục ngừng sử dụng không nhận liên kết mới.</p>
              <Field label="Lý do" error={fields.reason}>
                <TextArea
                  required
                  maxLength={500}
                  value={reason}
                  disabled={locked}
                  onChange={(e) => setReason(e.target.value)}
                />
              </Field>
            </>
          ) : (
            <Field label="Tên" error={fields.name}>
              <TextInput
                required
                maxLength={100}
                value={name}
                disabled={locked}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
          )}
          {error && <Feedback tone="error">{error}</Feedback>}
          {currentPending && <Feedback tone="warning">Thao tác chưa được đối soát.</Feedback>}
          <DialogActions>
            {!currentPending && (
              <Button disabled={locked} onClick={() => setForm(null)}>
                Hủy
              </Button>
            )}
            {currentPending ? (
              <Button
                disabled={busy || !canWrite || currentPending.principalKey !== principalKey}
                onClick={() => void execute(currentPending, true)}
              >
                Kiểm tra kết quả
              </Button>
            ) : (
              <Button variant="primary" disabled={locked} type="submit">
                {form?.status
                  ? form.unit?.status === "active"
                    ? "Ngừng sử dụng"
                    : "Kích hoạt lại"
                  : "Lưu"}
              </Button>
            )}
            {!currentPending && form?.unit && error && (
              <Button
                disabled={busy}
                onClick={() => {
                  if (form?.unit) void edit(form.unit, form.status);
                }}
              >
                Tải bản mới
              </Button>
            )}
            {currentPending && (
              <Button disabled={busy} onClick={() => setReconcile(true)}>
                Quay về đối soát
              </Button>
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
          Kết quả thao tác trước vẫn chưa được xác định. Kiểm tra cấu hình hoặc danh sách, kể cả mục
          đã ngừng sử dụng, trước khi tạo thao tác mới.
        </p>
        <DialogActions>
          <Button onClick={() => setReconcile(false)}>Quay lại</Button>
          <Button
            onClick={() => {
              onPending(null);
              setForm(null);
              setReconcile(false);
              setNotice("Kiểm tra dữ liệu hiện tại trước thao tác mới.");
              setRefresh((v) => v + 1);
            }}
          >
            Về danh sách để đối soát
          </Button>
        </DialogActions>
      </Modal>
    </>
  );
}
function UnitsPanel({
  realm,
  base,
  kind,
  title,
  canWrite,
  locked,
  onError,
  onEdit,
  onAdd,
}: {
  realm: OrganizationRealm;
  base: string;
  kind: "area" | "service_ministry";
  title: string;
  canWrite: boolean;
  locked: boolean;
  onError: (error: unknown) => void;
  onEdit: (unit: UnitDto, status?: boolean) => void;
  onAdd: () => void;
}) {
  const [page, setPage] = useState<UnitPage | null>(null),
    [q, setQ] = useState(""),
    [search, setSearch] = useState(""),
    [status, setStatus] = useState("active"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const generation = useRef(0),
    moreGuard = useRef(false);
  async function load(cursor?: string, signal?: AbortSignal) {
    const requestGeneration = generation.current;
    setBusy(true);
    setError("");
    try {
      const query = new URLSearchParams({
        kind,
        status,
        q: search,
        limit: "25",
        ...(cursor ? { cursor } : {}),
      });
      const result = await organizationRequest<UnitPage>(realm, `${base}/units?${query}`, {
        signal,
      });
      if (signal?.aborted || requestGeneration !== generation.current) return;
      setPage((old) => ({
        ...result.data,
        items: cursor
          ? [
              ...(old?.items ?? []),
              ...result.data.items.filter((u) => !old?.items.some((o) => o.id === u.id)),
            ]
          : result.data.items,
      }));
    } catch (e) {
      if (!signal?.aborted && requestGeneration === generation.current) {
        setError(e instanceof Error ? e.message : "Không tải được danh mục.");
        if (e instanceof ApiError && authCodes.includes(e.code)) onError(e);
      }
    } finally {
      if (!signal?.aborted && requestGeneration === generation.current) setBusy(false);
    }
  }
  useEffect(() => {
    generation.current++;
    const controller = new AbortController();
    setPage(null);
    void load(undefined, controller.signal);
    return () => {
      generation.current++;
      controller.abort();
    };
  }, [search, status, realm, base, kind]);
  return (
    <Card>
      <SectionHeader title={title}>
        {canWrite && (
          <IconButton
            icon="plus"
            label={`Thêm ${title.toLowerCase()}`}
            disabled={locked}
            onClick={onAdd}
          />
        )}
      </SectionHeader>
      <div className="organization-unit-content">
        <Toolbar>
          <form
            className="organization-search"
            onSubmit={(e) => {
              e.preventDefault();
              setSearch(q);
            }}
          >
            <Field label={`Tìm ${title.toLowerCase()}`}>
              <TextInput
                maxLength={100}
                value={q}
                disabled={locked}
                onChange={(e) => setQ(e.target.value)}
              />
            </Field>
            <Button type="submit" disabled={locked}>
              Tìm
            </Button>
          </form>
          <Field label={`Trạng thái ${title.toLowerCase()}`}>
            <Select disabled={locked} value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="active">Đang dùng</option>
              <option value="inactive">Đã ngừng</option>
              <option value="all">Tất cả</option>
            </Select>
          </Field>
        </Toolbar>
        {error && (
          <Feedback tone="error">
            {error}
            <Button disabled={locked} onClick={() => void load()}>
              Tải lại
            </Button>
          </Feedback>
        )}
        {busy && <Loading />}
        {page?.items.length === 0 && (
          <EmptyState
            message={
              search || status !== "active"
                ? "Không có mục phù hợp."
                : `Chưa có ${title.toLowerCase()}.`
            }
          />
        )}
        {!!page?.items.length && (
          <TableFrame label={`Danh sách ${title.toLowerCase()}`}>
            <table>
              <thead>
                <tr>
                  <th>Tên</th>
                  <th>Trạng thái</th>
                  <th>Thuộc viên</th>
                  {canWrite && <th>Thao tác</th>}
                </tr>
              </thead>
              <tbody>
                {page.items.map((unit) => (
                  <tr key={unit.id}>
                    <td>{unit.name}</td>
                    <td>
                      <Badge tone={unit.status === "active" ? "good" : "warn"}>
                        {unit.status === "active" ? "Đang dùng" : "Đã ngừng"}
                      </Badge>
                    </td>
                    <td>—</td>
                    {canWrite && (
                      <td>
                        <div className="organization-actions">
                          <Button disabled={locked} onClick={() => onEdit(unit)}>
                            Sửa
                          </Button>
                          <Button disabled={locked} onClick={() => onEdit(unit, true)}>
                            {unit.status === "active" ? "Ngừng" : "Kích hoạt lại"}
                          </Button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </TableFrame>
        )}
        {page?.nextCursor && (
          <PaginationControl
            loading={busy || locked}
            onMore={() => {
              if (moreGuard.current || busy || locked) return;
              moreGuard.current = true;
              void load(page.nextCursor as string).finally(() => {
                moreGuard.current = false;
              });
            }}
          />
        )}
      </div>
    </Card>
  );
}
