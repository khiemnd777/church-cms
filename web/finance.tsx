import { useEffect, useRef, useState } from "react";
import { roleLabels } from "./accounts-api";
import { ApiError, churchRequest } from "./api";
import type { SettingsContext } from "./church-settings";
import {
  type FinanceHistoryPage,
  type FinanceSettingsBody,
  type FundDto,
  type FundPage,
  historyLabels,
  type SettingsReply,
} from "./finance-api";
import { vnd } from "./finance-income-api";
import { authErrorCodes, type TenantIntent, useTenantMutation } from "./tenant-mutation";
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
  SectionHeader,
  Select,
  Stack,
  TableFrame,
  TextArea,
  TextInput,
  Toolbar,
} from "./ui/components";
import "./finance.css";

const expenseApprovers = ["pastor", "secretary", "treasurer"] as const;
type Approver = FinanceSettingsBody["approverRole"];
const emptyThreshold = {
  amount: "",
  belowRole: "" as Approver | "",
  atOrAboveRole: "" as Approver | "",
};

export function FinanceConfiguration({
  churchId,
  context,
  pending,
  onPending,
  onAuthError,
}: {
  churchId: string;
  context: SettingsContext;
  pending: TenantIntent | null;
  onPending: (i: TenantIntent | null) => void;
  onAuthError: (e: unknown) => void;
}) {
  const base = `churches/${churchId}/finance`,
    canWrite = context.capabilities.includes("finance:settings:manage"),
    principalKey = `church_user:${context.principal.accountId}:${churchId}:${context.policyVersion}:${context.principal.version}`;
  const [settings, setSettings] = useState<SettingsReply | null>(null),
    [page, setPage] = useState<FundPage | null>(null),
    [body, setBody] = useState<{
      proposerRoles: FinanceSettingsBody["proposerRoles"];
      approverRole: FinanceSettingsBody["approverRole"] | "";
    }>({ proposerRoles: [], approverRole: "" }),
    [threshold, setThreshold] = useState<typeof emptyThreshold | null>(null),
    [settingsPreview, setSettingsPreview] = useState<FinanceSettingsBody | null>(null),
    [q, setQ] = useState(""),
    [search, setSearch] = useState(""),
    [status, setStatus] = useState("active"),
    [cursors, setCursors] = useState<(string | null)[]>([null]),
    [refresh, setRefresh] = useState(0),
    [dialog, setDialog] = useState<{ fund?: FundDto; status?: boolean } | null>(null),
    [name, setName] = useState(""),
    [reason, setReason] = useState(""),
    [historyTarget, setHistoryTarget] = useState<{ path: string; title: string } | null>(null),
    [history, setHistory] = useState<FinanceHistoryPage | null>(null),
    [historyCursors, setHistoryCursors] = useState<(string | null)[]>([null]),
    [error, setError] = useState(""),
    [accessLost, setAccessLost] = useState(false),
    [reconcile, setReconcile] = useState(false),
    [loading, setLoading] = useState(false);
  const mounted = useRef(true),
    accessLostRef = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  function fail(e: unknown) {
    if (
      e instanceof ApiError &&
      [...authErrorCodes, "FORBIDDEN", "CHURCH_SUSPENDED"].includes(e.code)
    ) {
      accessLostRef.current = true;
      setSettings(null);
      setPage(null);
      setHistory(null);
      setDialog(null);
      setHistoryTarget(null);
      setBody({ proposerRoles: [], approverRole: "" });
      setThreshold(null);
      setSettingsPreview(null);
      setName("");
      setReason("");
      setAccessLost(true);
      onAuthError(e);
    }
    setError(e instanceof Error ? e.message : "Không tải được tài chính.");
  }
  const mutation = useTenantMutation({
    realm: "church",
    churchId,
    principalKey,
    canWrite: canWrite && !accessLost,
    pending,
    onPending,
    onAuthError: fail,
    operationPath: `${base}/operations`,
    prefix: base,
    intentResource: { kind: "finance" },
    onAccessLoss: fail,
    onSuccess: () => {
      if (!mounted.current || accessLostRef.current) return;
      setDialog(null);
      setReconcile(false);
      setError("");
      setRefresh((n) => n + 1);
    },
  });
  const locked = loading || mutation.busy || !!pending || accessLost;
  useEffect(() => {
    const abort = new AbortController();
    setSettings(null);
    setError("");
    void churchRequest<SettingsReply>(`${base}/settings`, { signal: abort.signal })
      .then((r) => {
        if (abort.signal.aborted || accessLostRef.current) return;
        setSettings(r.data);
        setThreshold(r.data.settings?.approvalThreshold ?? null);
        setBody(
          r.data.settings
            ? {
                proposerRoles: r.data.settings.proposerRoles,
                approverRole: r.data.settings.approverRole,
              }
            : { proposerRoles: [], approverRole: "" },
        );
      })
      .catch((e) => {
        if (!abort.signal.aborted) fail(e);
      });
    return () => abort.abort();
  }, [base, refresh]);
  useEffect(() => {
    const abort = new AbortController(),
      params = new URLSearchParams({ q: search, status });
    const cursor = cursors.at(-1);
    if (cursor) params.set("cursor", cursor);
    setPage(null);
    void churchRequest<FundPage>(`${base}/funds?${params}`, { signal: abort.signal })
      .then((r) => {
        if (!abort.signal.aborted && !accessLostRef.current) setPage(r.data);
      })
      .catch((e) => {
        if (!abort.signal.aborted) fail(e);
      });
    return () => abort.abort();
  }, [base, status, search, cursors, refresh]);
  useEffect(() => {
    if (!historyTarget) return;
    const abort = new AbortController(),
      params = new URLSearchParams(),
      cursor = historyCursors.at(-1);
    if (cursor) params.set("cursor", cursor);
    setHistory(null);
    void churchRequest<FinanceHistoryPage>(`${historyTarget.path}?${params}`, {
      signal: abort.signal,
    })
      .then((r) => {
        if (!abort.signal.aborted && !accessLostRef.current) setHistory(r.data);
      })
      .catch((e) => {
        if (!abort.signal.aborted) fail(e);
      });
    return () => abort.abort();
  }, [historyTarget, historyCursors, refresh]);
  async function edit(f: FundDto, changeStatus = false) {
    setLoading(true);
    setError("");
    mutation.setError("");
    mutation.setFields({});
    try {
      const r = await churchRequest<FundDto>(`${base}/funds/${f.id}`);
      if (!mounted.current || accessLostRef.current) return;
      setDialog({ fund: r.data, status: changeStatus });
      setName(r.data.name);
      setReason("");
    } catch (e) {
      if (mounted.current) fail(e);
    } finally {
      if (mounted.current) setLoading(false);
    }
  }
  function openHistory(path: string, title: string) {
    setError("");
    setHistory(null);
    setHistoryCursors([null]);
    setHistoryTarget({ path, title });
  }
  const ownPending =
    pending?.resource?.kind === "finance" && pending.churchId === churchId ? pending : null;
  const previewThreshold = !!threshold || !!settings?.settings?.approvalThreshold;
  function saveSettings(next: FinanceSettingsBody) {
    if (locked || !settings) return;
    setSettingsPreview(null);
    mutation.send(
      `${base}/settings`,
      settings.configured ? "PATCH" : "POST",
      next,
      settings.settings?.version,
    );
  }
  const snapshotText = (value: object | null) => {
    if (!value) return "Chưa có";
    const v = value as Partial<FundDto & FinanceSettingsBody>;
    if (typeof v.name === "string")
      return `${v.name} · ${v.status === "active" ? "Đang dùng" : "Ngừng dùng"}`;
    if (v.approvalThreshold) {
      const t = v.approvalThreshold;
      return `Dưới ${vnd(t.amount)}: ${roleLabels[t.belowRole]}. Từ ${vnd(t.amount)}: ${roleLabels[t.atOrAboveRole]}.`;
    }
    return `Đề xuất: ${v.proposerRoles?.map((r) => roleLabels[r]).join(", ") || "Chỉ vai trò duyệt"}; Duyệt: ${v.approverRole ? roleLabels[v.approverRole] : "Chưa cấu hình"}`;
  };
  return (
    <section className="finance-layout" aria-label="Cấu hình tài chính">
      {error && <Feedback tone="error">{error}</Feedback>}
      {mutation.error && <Feedback tone="error">{mutation.error}</Feedback>}
      {mutation.notice && <Feedback tone="success">{mutation.notice}</Feedback>}
      {!canWrite && <Feedback>Chỉ xem tài chính. Mục sư quản lý quỹ và cấu hình.</Feedback>}
      {ownPending && (
        <Feedback tone="warning">
          Kết quả thao tác chưa được xác định. Đối soát trước khi tạo thao tác mới.
          <div className="finance-actions">
            <Button
              disabled={
                mutation.busy || accessLost || !canWrite || ownPending.principalKey !== principalKey
              }
              onClick={() => void mutation.execute(ownPending, true)}
            >
              Kiểm tra kết quả
            </Button>
            <Button disabled={mutation.busy} onClick={() => setReconcile(true)}>
              Về danh sách để đối soát
            </Button>
          </div>
        </Feedback>
      )}
      <Card>
        <SectionHeader title="Quỹ Hội Thánh">
          {canWrite ? (
            <IconButton
              icon="plus"
              label="Thêm quỹ"
              disabled={locked}
              onClick={() => {
                setDialog({});
                setName("");
                setReason("");
                mutation.setFields({});
                mutation.setError("");
              }}
            />
          ) : null}
        </SectionHeader>
        <form
          className="finance-layout"
          onSubmit={(e) => {
            e.preventDefault();
            setCursors([null]);
            setSearch(q.trim());
          }}
        >
          <Toolbar>
            <Field label="Tìm tên quỹ">
              <TextInput
                value={q}
                maxLength={100}
                disabled={locked}
                placeholder="Tìm tên quỹ…"
                onChange={(e) => setQ(e.target.value)}
              />
            </Field>
            <Field label="Trạng thái quỹ">
              <Select
                value={status}
                disabled={locked}
                onChange={(e) => {
                  setCursors([null]);
                  setStatus(e.target.value);
                }}
              >
                <option value="active">Đang dùng</option>
                <option value="inactive">Ngừng dùng</option>
                <option value="all">Tất cả</option>
              </Select>
            </Field>
            <Button type="submit" disabled={locked}>
              Tìm
            </Button>
            <Button
              disabled={locked}
              onClick={() => {
                setCursors([null]);
                setRefresh((n) => n + 1);
              }}
            >
              Tải lại
            </Button>
          </Toolbar>
          {!page && !error && <Loading />}
          {page &&
            (!page.items.length ? (
              <EmptyState message="Chưa có quỹ phù hợp" />
            ) : (
              <TableFrame label="Danh mục quỹ">
                <table>
                  <thead>
                    <tr>
                      <th>Tên quỹ</th>
                      <th>Trạng thái</th>
                      <th>Thao tác</th>
                    </tr>
                  </thead>
                  <tbody>
                    {page.items.map((f) => (
                      <tr key={f.id}>
                        <td>{f.name}</td>
                        <td>
                          <Badge tone={f.status === "active" ? "good" : "muted"}>
                            {f.status === "active" ? "Đang dùng" : "Ngừng dùng"}
                          </Badge>
                        </td>
                        <td>
                          <div className="finance-actions">
                            {canWrite && (
                              <>
                                <Button
                                  aria-label={`Đổi tên ${f.name}`}
                                  disabled={locked}
                                  onClick={() => void edit(f)}
                                >
                                  Đổi tên
                                </Button>
                                <Button disabled={locked} onClick={() => void edit(f, true)}>
                                  {f.status === "active" ? "Ngừng dùng" : "Khôi phục"}
                                </Button>
                              </>
                            )}
                            <Button
                              disabled={locked}
                              onClick={() =>
                                openHistory(
                                  `${base}/funds/${f.id}/history`,
                                  `Lịch sử quỹ ${f.name}`,
                                )
                              }
                            >
                              Lịch sử
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableFrame>
            ))}
          <nav className="finance-actions" aria-label="Phân trang quỹ">
            <Button
              disabled={locked || !page || cursors.length < 2}
              onClick={() => setCursors((xs) => xs.slice(0, -1))}
            >
              Trước
            </Button>
            <Button
              disabled={locked || !page?.nextCursor}
              onClick={() => {
                if (page?.nextCursor) setCursors((xs) => [...xs, page.nextCursor]);
              }}
            >
              Tiếp
            </Button>
          </nav>
        </form>
      </Card>
      <Card spacing="content">
        <SectionHeader title="Đề xuất chi & phê duyệt" />
        {!settings && !error && <Loading />}
        {settings && (
          <form
            className="finance-layout"
            onSubmit={(e) => {
              e.preventDefault();
              if (!body.approverRole || locked) return;
              if (threshold && (!threshold.belowRole || !threshold.atOrAboveRole)) return;
              const next: FinanceSettingsBody = {
                ...body,
                approverRole: body.approverRole,
                approvalThreshold:
                  threshold?.belowRole && threshold.atOrAboveRole
                    ? {
                        amount: threshold.amount,
                        belowRole: threshold.belowRole,
                        atOrAboveRole: threshold.atOrAboveRole,
                      }
                    : null,
              };
              if (previewThreshold) setSettingsPreview(next);
              else saveSettings(next);
            }}
          >
            {!settings.configured && (
              <Feedback>
                Chưa cấu hình. Chưa có quyền nghiệp vụ đề xuất hoặc duyệt được bật.
              </Feedback>
            )}
            <section aria-label="Vai trò được lập đề xuất">
              <p>Vai trò được lập đề xuất</p>
              <div className="finance-actions">
                {(["secretary", "treasurer", "ministry_lead"] as const).map((role) => (
                  <Choice
                    key={role}
                    disabled={!canWrite || locked}
                    type="checkbox"
                    name={`proposer-${role}`}
                    label={roleLabels[role]}
                    checked={body.proposerRoles.includes(role)}
                    onChange={(e) =>
                      setBody((b) => ({
                        ...b,
                        proposerRoles: e.target.checked
                          ? [...b.proposerRoles, role]
                          : b.proposerRoles.filter((r) => r !== role),
                      }))
                    }
                  />
                ))}
              </div>
            </section>
            <Field
              label="Vai trò phê duyệt"
              hint={threshold ? "Dùng cho đề xuất theo quy tắc cũ." : undefined}
              error={mutation.fields.approverRole}
            >
              <Select
                required
                value={body.approverRole}
                disabled={!canWrite || locked}
                onChange={(e) =>
                  setBody((b) => ({
                    ...b,
                    approverRole: e.target.value as FinanceSettingsBody["approverRole"],
                  }))
                }
              >
                <option value="">Chọn vai trò…</option>
                {expenseApprovers.map((r) => (
                  <option key={r} value={r}>
                    {roleLabels[r]}
                  </option>
                ))}
              </Select>
            </Field>
            <Stack space="content">
              <Field label="Duyệt theo hạn mức">
                <Select
                  disabled={!canWrite || locked}
                  value={threshold ? "on" : "off"}
                  onChange={(e) => setThreshold(e.target.value === "on" ? emptyThreshold : null)}
                >
                  <option value="off">Tắt</option>
                  <option value="on">Bật</option>
                </Select>
              </Field>
              {threshold && (
                <Stack space="content">
                  <Field label="Ngưỡng VND">
                    <TextInput
                      required
                      inputMode="numeric"
                      pattern="[1-9][0-9]{0,17}"
                      maxLength={18}
                      value={threshold.amount}
                      disabled={!canWrite || locked}
                      onChange={(e) => setThreshold({ ...threshold, amount: e.target.value })}
                    />
                  </Field>
                  {(["belowRole", "atOrAboveRole"] as const).map((field) => (
                    <Field key={field} label={field === "belowRole" ? "Dưới ngưỡng" : "Từ ngưỡng"}>
                      <Select
                        required
                        disabled={!canWrite || locked}
                        value={threshold[field]}
                        onChange={(e) => setThreshold({ ...threshold, [field]: e.target.value })}
                      >
                        <option value="">Chọn vai trò…</option>
                        {expenseApprovers.map((role) => (
                          <option key={role} value={role}>
                            {roleLabels[role]}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  ))}
                </Stack>
              )}
            </Stack>
            <p>Người lập đề xuất không được tự duyệt.</p>
            <DialogActions>
              {settings.configured && (
                <Button
                  disabled={locked}
                  onClick={() =>
                    openHistory(`${base}/settings/history`, "Lịch sử cấu hình tài chính")
                  }
                >
                  Lịch sử thay đổi
                </Button>
              )}
              {canWrite && (
                <>
                  <Button disabled={locked} onClick={() => setRefresh((n) => n + 1)}>
                    Tải bản hiện hành
                  </Button>
                  <Button variant="primary" type="submit" disabled={locked || !body.approverRole}>
                    {previewThreshold ? "Xem trước" : "Lưu"}
                  </Button>
                </>
              )}
            </DialogActions>
          </form>
        )}
      </Card>
      <Modal
        open={!!settingsPreview}
        title="Xem trước cấu hình duyệt chi"
        locked={locked}
        onClose={() => setSettingsPreview(null)}
      >
        {settingsPreview && (
          <>
            <Stack space="compact">
              <p>Duyệt theo hạn mức: {settingsPreview.approvalThreshold ? "Bật" : "Tắt"}</p>
              <p>{snapshotText(settingsPreview)}</p>
              <p>Hạn mức áp dụng cho đề xuất gửi sau khi lưu cấu hình.</p>
            </Stack>
            <DialogActions>
              <Button onClick={() => setSettingsPreview(null)}>Quay lại</Button>
              <Button
                variant="primary"
                disabled={locked}
                onClick={() => saveSettings(settingsPreview)}
              >
                Lưu
              </Button>
            </DialogActions>
          </>
        )}
      </Modal>
      <Modal
        open={!!dialog}
        locked={locked}
        title={
          dialog?.status
            ? dialog.fund?.status === "active"
              ? "Ngừng dùng quỹ"
              : "Khôi phục quỹ"
            : dialog?.fund
              ? "Đổi tên quỹ"
              : "Thêm quỹ"
        }
        onClose={() => setDialog(null)}
      >
        <form
          className="finance-layout"
          onSubmit={(e) => {
            e.preventDefault();
            if (!dialog) return;
            const f = dialog.fund;
            mutation.send(
              `${base}/funds${f ? `/${f.id}${dialog.status ? "/status" : ""}` : ""}`,
              f ? "PATCH" : "POST",
              dialog.status
                ? { status: f?.status === "active" ? "inactive" : "active", reason }
                : { name },
              f?.version,
            );
          }}
        >
          {dialog?.status ? (
            <>
              <Stack space="compact">
                <p>
                  Quỹ: <strong>{dialog.fund?.name}</strong>
                </p>
                <p>
                  {dialog.fund?.status === "active"
                    ? "Không dùng cho giao dịch mới. Lịch sử được giữ nguyên."
                    : "Cho phép dùng lại quỹ. Giữ nguyên định danh và lịch sử."}
                </p>
              </Stack>
              <Field label="Lý do" error={mutation.fields.reason}>
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
            <Field label="Tên quỹ" error={mutation.fields.name}>
              <TextInput
                required
                maxLength={100}
                value={name}
                disabled={locked}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
          )}
          {mutation.error && <Feedback tone="error">{mutation.error}</Feedback>}
          <DialogActions>
            {!ownPending && (
              <>
                <Button disabled={locked} onClick={() => setDialog(null)}>
                  Hủy
                </Button>
                {dialog?.fund && mutation.error && (
                  <Button
                    disabled={locked}
                    onClick={() => {
                      if (dialog.fund) void edit(dialog.fund, dialog.status);
                    }}
                  >
                    Tải bản mới
                  </Button>
                )}
                <Button variant="primary" type="submit" disabled={locked}>
                  {dialog?.status
                    ? dialog.fund?.status === "active"
                      ? "Ngừng dùng"
                      : "Khôi phục"
                    : "Lưu"}
                </Button>
              </>
            )}
            {ownPending && (
              <>
                <Button
                  disabled={mutation.busy || accessLost}
                  onClick={() => void mutation.execute(ownPending, true)}
                >
                  Kiểm tra kết quả
                </Button>
                <Button disabled={mutation.busy} onClick={() => setReconcile(true)}>
                  Về danh sách để đối soát
                </Button>
              </>
            )}
          </DialogActions>
        </form>
      </Modal>
      <Modal
        open={!!historyTarget}
        title={historyTarget?.title ?? "Lịch sử tài chính"}
        onClose={() => setHistoryTarget(null)}
      >
        <div className="finance-layout">
          {!history && !error && <Loading />}
          {error && <Feedback tone="error">{error}</Feedback>}
          {history?.items.map((h) => (
            <Card spacing="content" key={h.id}>
              <strong>{historyLabels[h.event]}</strong>
              <Stack space="compact">
                <p>
                  {new Date(h.occurredAt).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}{" "}
                  · Người thực hiện: {h.actorName}
                </p>
                <p>Trước: {snapshotText(h.before)}</p>
                <p>Sau: {snapshotText(h.after)}</p>
                {h.reason && <p>Lý do: {h.reason}</p>}
              </Stack>
            </Card>
          ))}
          {history && !history.items.length && <EmptyState message="Chưa có lịch sử" />}
          <nav className="finance-actions" aria-label="Phân trang lịch sử">
            <Button
              disabled={!history || historyCursors.length < 2}
              onClick={() => setHistoryCursors((xs) => xs.slice(0, -1))}
            >
              Trước
            </Button>
            <Button
              disabled={!history?.nextCursor}
              onClick={() => {
                if (history?.nextCursor) setHistoryCursors((xs) => [...xs, history.nextCursor]);
              }}
            >
              Tiếp
            </Button>
          </nav>
          <DialogActions>
            <Button onClick={() => setHistoryTarget(null)}>Đóng</Button>
          </DialogActions>
        </div>
      </Modal>
      <Modal
        open={reconcile}
        title="Đối soát trước thao tác mới"
        locked={mutation.busy}
        onClose={() => setReconcile(false)}
      >
        <p>
          Kiểm tra cấu hình và danh sách, kể cả quỹ ngừng dùng, trước khi tạo thao tác mới. Kết quả
          thao tác cũ vẫn chưa được xác định.
        </p>
        <DialogActions>
          <Button disabled={mutation.busy} onClick={() => setReconcile(false)}>
            Tiếp tục kiểm tra
          </Button>
          <Button
            disabled={mutation.busy}
            onClick={() => {
              onPending(null);
              setDialog(null);
              setReconcile(false);
              setCursors([null]);
              setRefresh((n) => n + 1);
            }}
          >
            Về danh sách để đối soát
          </Button>
        </DialogActions>
      </Modal>
    </section>
  );
}
