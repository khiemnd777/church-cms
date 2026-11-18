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
  const snapshotText = (value: object | null) => {
    if (!value) return "Chưa có";
    const v = value as Partial<FundDto & FinanceSettingsBody>;
    if (typeof v.name === "string")
      return `${v.name} · ${v.status === "active" ? "Đang dùng" : "Ngừng dùng"}`;
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
              if (!body.approverRole) return;
              mutation.send(
                `${base}/settings`,
                settings.configured ? "PATCH" : "POST",
                body,
                settings.settings?.version,
              );
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
            <Field label="Vai trò phê duyệt" error={mutation.fields.approverRole}>
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
                {(["pastor", "secretary", "treasurer"] as const).map((r) => (
                  <option key={r} value={r}>
                    {roleLabels[r]}
                  </option>
                ))}
              </Select>
            </Field>
            <p>
              Vai trò duyệt được lập đề xuất. Không được duyệt đề xuất do chính mình tạo. Nghiệp vụ
              gửi/duyệt và thu/chi chưa mở.
            </p>
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
                    Lưu
                  </Button>
                </>
              )}
            </DialogActions>
          </form>
        )}
      </Card>
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
