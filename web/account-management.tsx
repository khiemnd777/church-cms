import { type FormEvent, useEffect, useRef, useState } from "react";
import type { ChurchRef } from "./access-context";
import {
  type AccountDto,
  type AccountMutation,
  type AccountPage,
  account,
  accountList,
  accountOperation,
  type CredentialInfo,
  type ResumeReset,
  type Role,
  roleLabels,
  scopeLabel,
  sendAccountIntent,
} from "./accounts-api";
import { ApiError, type Intent } from "./api";
import { ScopePicker } from "./organization-scope-picker";
import { type ChurchSummary, church } from "./tenancy-api";
import {
  Badge,
  Button,
  DialogActions,
  EmptyState,
  Feedback,
  Field,
  IconButton,
  KeyValueList,
  Loading,
  Modal,
  PaginationControl,
  Select,
  TableFrame,
  TextInput,
  Toolbar,
} from "./ui/components";

type Mode = "create" | "manage" | "permissions" | "status" | "reset" | "credential";
const authentication = (e: unknown) =>
  e instanceof ApiError &&
  ["SESSION_EXPIRED", "SESSION_REVOKED", "REAUTH_REQUIRED", "PASSWORD_CHANGE_REQUIRED"].includes(
    e.code,
  );
const uncertain = (e: unknown) =>
  e instanceof ApiError &&
  ["NETWORK_ERROR", "OUTCOME_UNKNOWN", "OPERATION_IN_PROGRESS", "DEPENDENCY_UNAVAILABLE"].includes(
    e.code,
  );
export function AccountManagement({
  churchId,
  onTitle,
  onAuthError,
  onChurch,
  onReturn,
  onRecentAuth,
  resumeReset,
  onResumeHandled,
}: {
  churchId: string;
  onTitle: (title: string, context?: string) => void;
  onAuthError: (e: unknown) => void;
  onChurch: (c: ChurchRef) => void;
  onReturn: () => void;
  onRecentAuth: (r: ResumeReset) => void;
  resumeReset: ResumeReset | null;
  onResumeHandled: () => void;
}) {
  const [churchInfo, setChurch] = useState<ChurchSummary | null>(null),
    [page, setPage] = useState<AccountPage | null>(null),
    [q, setQ] = useState(""),
    [search, setSearch] = useState(""),
    [roleFilter, setRoleFilter] = useState(""),
    [statusFilter, setStatusFilter] = useState(""),
    [refresh, setRefresh] = useState(0),
    [loading, setLoading] = useState(true),
    [more, setMore] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [mode, setMode] = useState<Mode | null>(null),
    [selected, setSelected] = useState<AccountDto | null>(null),
    [email, setEmail] = useState(""),
    [displayName, setDisplayName] = useState(""),
    [unitIds, setUnitIds] = useState<string[]>([]),
    [role, setRole] = useState<Role>("secretary"),
    [reason, setReason] = useState(""),
    [supportReference, setSupportReference] = useState(""),
    [credential, setCredential] = useState<CredentialInfo | null>(null),
    [formError, setFormError] = useState(""),
    [fields, setFields] = useState<Record<string, string>>({}),
    [busy, setBusy] = useState(false),
    [pending, setPending] = useState<Intent | null>(null),
    [conflict, setConflict] = useState(false),
    [existing, setExisting] = useState<string | null>(null);
  const saving = useRef(false),
    intentRef = useRef<Intent | null>(null),
    alive = useRef(true),
    generation = useRef(0);
  const frozen = busy || !!pending;
  function report(e: unknown, form = false) {
    if (authentication(e)) {
      onAuthError(e);
      return;
    }
    const message = e instanceof Error ? e.message : "Không hoàn tất được thao tác.";
    if (form) {
      setFormError(message);
      if (e instanceof ApiError) setFields(e.fieldErrors ?? {});
    } else setError(message);
  }
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => setSearch(q.trim()), 250);
    return () => clearTimeout(timer);
  }, [q]);
  useEffect(() => {
    const controller = new AbortController(),
      current = ++generation.current;
    setLoading(true);
    setError("");
    setPage(null);
    const params = new URLSearchParams({
      q: search,
      role: roleFilter,
      status: statusFilter,
      limit: "25",
    });
    void Promise.all([church(churchId), accountList(churchId, params, controller.signal)])
      .then(([c, p]) => {
        if (controller.signal.aborted || current !== generation.current || !alive.current) return;
        setChurch(c.data);
        onChurch(c.data);
        onTitle("Tài khoản", `${c.data.name} · ${c.data.code}`);
        setPage(p.data);
      })
      .catch((e) => {
        if (!controller.signal.aborted && current === generation.current && alive.current)
          report(e);
      })
      .finally(() => {
        if (current === generation.current && alive.current) setLoading(false);
      });
    return () => {
      controller.abort();
      generation.current++;
    };
  }, [churchId, search, roleFilter, statusFilter, refresh]);
  useEffect(() => {
    const unload = (e: BeforeUnloadEvent) => {
      if (intentRef.current || saving.current) e.preventDefault();
    };
    const back = (e: PopStateEvent) => {
      if (intentRef.current || saving.current) {
        e.stopImmediatePropagation();
        history.pushState(null, "", `/owner/churches/${churchId}/accounts`);
        setFormError("Chưa xác định kết quả. Đối soát trước khi rời trang.");
      }
    };
    window.addEventListener("beforeunload", unload);
    window.addEventListener("popstate", back, true);
    return () => {
      window.removeEventListener("beforeunload", unload);
      window.removeEventListener("popstate", back, true);
    };
  }, [churchId]);
  async function openAccount(id: string, next: Mode = "manage") {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError("");
    setFormError("");
    setFields({});
    setExisting(null);
    setConflict(false);
    setCredential(null);
    try {
      const r = await account(churchId, id);
      if (!alive.current) return;
      setSelected(r.data);
      setRole(r.data.role);
      setUnitIds(r.data.scope.kind === "assigned_units" ? r.data.scope.unitIds : []);
      setMode(next);
      setReason("");
    } catch (e) {
      if (alive.current) report(e);
    } finally {
      saving.current = false;
      if (alive.current) setBusy(false);
    }
  }
  useEffect(() => {
    if (!resumeReset) return;
    const request = resumeReset;
    onResumeHandled();
    setSupportReference(request.supportReference);
    void openAccount(request.accountId, "reset");
  }, [resumeReset]);
  function close() {
    if (saving.current || intentRef.current) return;
    setMode(null);
    setCredential(null);
    setFormError("");
    setFields({});
    setExisting(null);
    setConflict(false);
  }
  function create() {
    setSelected(null);
    setEmail("");
    setDisplayName("");
    setRole("secretary");
    setCredential(null);
    setFormError("");
    setFields({});
    setConflict(false);
    setExisting(null);
    setUnitIds([]);
    setMode("create");
  }
  async function loadMore() {
    if (!page?.nextCursor || more) return;
    const current = generation.current;
    setMore(true);
    try {
      const params = new URLSearchParams({
        q: search,
        role: roleFilter,
        status: statusFilter,
        limit: "25",
        cursor: page.nextCursor,
      });
      const r = await accountList(churchId, params);
      if (alive.current && current === generation.current)
        setPage((p) =>
          p ? { items: [...p.items, ...r.data.items], nextCursor: r.data.nextCursor } : r.data,
        );
    } catch (e) {
      if (alive.current && current === generation.current) report(e);
    } finally {
      if (alive.current) setMore(false);
    }
  }
  function done(data: AccountMutation) {
    if (!alive.current) return;
    intentRef.current = null;
    setPending(null);
    setSelected(data.account);
    setRole(data.account.role);
    setUnitIds(data.account.scope.kind === "assigned_units" ? data.account.scope.unitIds : []);
    setRefresh((x) => x + 1);
    setNotice("Đã lưu thông tin tài khoản.");
    setConflict(false);
    setFormError("");
    setFields({});
    if (data.temporaryCredential) {
      setCredential(data.temporaryCredential);
      setMode("credential");
    } else {
      setCredential(null);
      setMode("manage");
      if (data.credentialReplay === "not_available")
        setFormError(
          "Đã ghi nhận kết quả. Mật khẩu tạm không thể xem lại; kiểm tra tài khoản và chủ động cấp lại nếu cần.",
        );
    }
  }
  async function execute(intent: Intent) {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setFormError("");
    setFields({});
    try {
      done((await sendAccountIntent(intent)).data);
    } catch (e) {
      if (!alive.current) return;
      if (
        e instanceof ApiError &&
        ["RECENT_AUTH_REQUIRED", "REAUTH_REQUIRED"].includes(e.code) &&
        intent.path.endsWith("temporary-passwords") &&
        selected
      ) {
        intentRef.current = null;
        setPending(null);
        onRecentAuth({ accountId: selected.id, supportReference });
      } else if (uncertain(e)) {
        const original = {
          ...intent,
          operationId: e instanceof ApiError ? e.operationId : undefined,
        };
        intentRef.current = original;
        setPending(original);
        setFormError("Chưa xác định kết quả. Giữ nguyên và kiểm tra trước khi thử lại.");
      } else {
        intentRef.current = null;
        setPending(null);
        if (e instanceof ApiError && e.code === "VERSION_CONFLICT") setConflict(true);
        if (e instanceof ApiError && e.code === "ACCOUNT_EXISTS") setExisting(e.resourceId ?? null);
        report(e, true);
      }
    } finally {
      saving.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (frozen || !mode) return;
    const prefix = `owner/churches/${churchId}/accounts`,
      scope =
        role === "member"
          ? { kind: "self" }
          : role === "ministry_lead"
            ? { kind: "assigned_units", unitIds }
            : { kind: "church" };
    let path = prefix,
      method: "POST" | "PATCH" = "POST",
      body: object;
    if (mode === "create") body = { email, displayName, role, scope };
    else {
      if (!selected) return;
      path += `/${selected.id}`;
      if (mode === "permissions") {
        path += "/permissions";
        method = "PATCH";
        body = { role, scope };
      } else if (mode === "status") {
        path += "/status";
        method = "PATCH";
        body = { status: selected.status === "active" ? "locked" : "active", reason };
      } else if (mode === "reset") {
        path += "/temporary-passwords";
        body = { supportReference };
      } else return;
    }
    await execute({
      path,
      method,
      body,
      key: crypto.randomUUID(),
      createdAt: Date.now(),
      ...(mode !== "create" && selected ? { version: selected.version } : {}),
    });
  }
  async function checkResult() {
    const intent = intentRef.current;
    if (!intent || saving.current) return;
    if (Date.now() - intent.createdAt >= 24 * 60 * 60_000) {
      setFormError(
        "Đã quá thời hạn thử lại. Đối chiếu danh sách và thông tin tài khoản trước ý định mới.",
      );
      return;
    }
    if (!intent.operationId) {
      await execute(intent);
      return;
    }
    saving.current = true;
    setBusy(true);
    try {
      const r = await accountOperation(intent.operationId);
      done({ ...r.data.safeResult, operationId: r.data.operationId });
    } catch (e) {
      if (alive.current) report(e, true);
    } finally {
      saving.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function reloadAccount() {
    if (!selected || frozen) return;
    await openAccount(selected.id, "permissions");
  }
  async function copyCredential() {
    if (!credential || !selected) return;
    try {
      await navigator.clipboard.writeText(
        `${location.origin}${credential.loginPath}\nEmail: ${selected.email}\nMật khẩu tạm: ${credential.password}\nHết hạn: ${new Date(credential.expiresAt).toLocaleString("vi-VN")}`,
      );
      setNotice("Đã sao chép thông tin đăng nhập.");
    } catch {
      setFormError("Không sao chép được. Chọn và sao chép thông tin đang hiển thị.");
    }
  }
  const title =
    mode === "create"
      ? "Tạo tài khoản"
      : mode === "permissions"
        ? "Sửa quyền"
        : mode === "status"
          ? selected?.status === "active"
            ? "Khóa tài khoản"
            : "Mở tài khoản"
          : mode === "reset"
            ? "Cấp lại mật khẩu tạm"
            : mode === "credential"
              ? "Thông tin đăng nhập"
              : "Quản lý tài khoản";
  return (
    <>
      <Button variant="link" onClick={onReturn}>
        ← Chi tiết Hội Thánh
      </Button>
      {error && <Feedback tone="error">{error}</Feedback>}
      {notice && <Feedback tone="success">{notice}</Feedback>}
      {churchInfo?.status === "suspended" && (
        <Feedback tone="warning">
          Hội Thánh đang tạm ngưng. Vẫn có thể quản trị tài khoản; người dùng chưa thể đăng nhập.
        </Feedback>
      )}
      <Toolbar>
        <label className="account-search" htmlFor="account-search">
          <span className="sr-only">Tìm tài khoản</span>
          <TextInput
            id="account-search"
            aria-label="Tìm tài khoản"
            className="account-search-input"
            placeholder="Tìm tên, email…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            maxLength={100}
          />
        </label>
        <label htmlFor="account-role">
          <span className="sr-only">Lọc vai trò</span>
          <Select
            id="account-role"
            aria-label="Lọc vai trò"
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
          >
            <option value="">Vai trò</option>
            {Object.entries(roleLabels).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </Select>
        </label>
        <label htmlFor="account-status">
          <span className="sr-only">Lọc trạng thái</span>
          <Select
            id="account-status"
            aria-label="Lọc trạng thái"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="">Trạng thái</option>
            <option value="active">Hoạt động</option>
            <option value="locked">Đã khóa</option>
          </Select>
        </label>
        <IconButton
          label="Thêm tài khoản"
          icon="plus"
          variant="primary"
          disabled={!churchInfo || busy}
          onClick={create}
        />
      </Toolbar>
      {loading && <Loading />}
      {page?.items.length === 0 && (
        <EmptyState
          message={
            search || roleFilter || statusFilter
              ? "Không tìm thấy tài khoản phù hợp."
              : "Chưa có tài khoản trong Hội Thánh này."
          }
        />
      )}
      {!!page?.items.length && (
        <TableFrame label="Danh sách tài khoản">
          <table>
            <thead>
              <tr>
                <th>Họ tên / Email</th>
                <th>Vai trò</th>
                <th>Phạm vi</th>
                <th>Trạng thái</th>
                <th>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {page.items.map((a) => (
                <tr key={a.id}>
                  <td className="account-cell">
                    <Button variant="link" onClick={() => void openAccount(a.id)} disabled={busy}>
                      {a.displayName}
                    </Button>
                    <div className="small muted">{a.email}</div>
                  </td>
                  <td>{roleLabels[a.role]}</td>
                  <td>{scopeLabel(a.scope)}</td>
                  <td>
                    <Badge tone={a.status === "active" ? "good" : "warn"}>
                      {a.status === "active" ? "Hoạt động" : "Đã khóa"}
                    </Badge>
                  </td>
                  <td>
                    <Button
                      onClick={() => void openAccount(a.id)}
                      disabled={busy}
                      aria-label={`Quản lý ${a.displayName}`}
                    >
                      Quản lý
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableFrame>
      )}
      {page?.nextCursor && <PaginationControl loading={more} onMore={() => void loadMore()} />}
      <Modal open={!!mode} title={title} onClose={close} locked={frozen}>
        <p className="small muted">
          {churchInfo ? `${churchInfo.name} · ${churchInfo.code}` : "Đang tải Hội Thánh…"}
        </p>
        {formError && (
          <Feedback tone={pending || conflict ? "warning" : "error"}>{formError}</Feedback>
        )}
        {mode === "manage" && selected && (
          <>
            <KeyValueList
              items={[
                { label: "Họ tên", value: selected.displayName },
                { label: "Email", value: selected.email },
                { label: "Vai trò", value: roleLabels[selected.role] },
                { label: "Phạm vi", value: scopeLabel(selected.scope) },
                {
                  label: "Trạng thái",
                  value: selected.status === "active" ? "Hoạt động" : "Đã khóa",
                },
              ]}
            />
            <DialogActions>
              <Button
                onClick={() => {
                  setFormError("");
                  setMode("permissions");
                }}
              >
                Sửa quyền
              </Button>
              <Button
                onClick={() => {
                  setFormError("");
                  setReason("");
                  setMode("status");
                }}
              >
                {selected.status === "active" ? "Khóa tài khoản" : "Mở tài khoản"}
              </Button>
              <Button
                disabled={selected.status !== "active"}
                onClick={() => {
                  setFormError("");
                  setSupportReference("");
                  setMode("reset");
                }}
              >
                Cấp lại mật khẩu tạm
              </Button>
            </DialogActions>
          </>
        )}
        {mode === "credential" && credential && selected && (
          <>
            <KeyValueList
              items={[
                { label: "URL đăng nhập", value: `${location.origin}${credential.loginPath}` },
                { label: "Email", value: selected.email },
                { label: "Hết hạn", value: new Date(credential.expiresAt).toLocaleString("vi-VN") },
              ]}
            />
            <Field
              label="Mật khẩu tạm"
              hint="Chỉ hiển thị tại bước này. Đóng hoặc tải lại sẽ không xem lại được."
            >
              <TextInput readOnly autoComplete="off" value={credential.password} />
            </Field>
            <DialogActions>
              <Button onClick={() => void copyCredential()}>Sao chép thông tin đăng nhập</Button>
              <Button onClick={close}>Đóng</Button>
            </DialogActions>
          </>
        )}
        {mode && ["create", "permissions", "status", "reset"].includes(mode) && (
          <form onSubmit={submit} aria-busy={busy}>
            {mode !== "create" && selected && (
              <KeyValueList
                items={[
                  { label: "Họ tên", value: selected.displayName },
                  { label: "Email", value: selected.email },
                ]}
              />
            )}
            {(mode === "create" || mode === "permissions") && (
              <div className="form">
                {mode === "create" && (
                  <>
                    <Field label="Email" error={fields.email} full>
                      <TextInput
                        type="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        maxLength={254}
                        disabled={frozen}
                      />
                    </Field>
                    <Field label="Họ tên" error={fields.displayName} full>
                      <TextInput
                        required
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        maxLength={160}
                        disabled={frozen}
                      />
                    </Field>
                  </>
                )}
                <Field label="Vai trò" error={fields.role}>
                  <Select
                    value={role}
                    onChange={(e) => setRole(e.target.value as Role)}
                    disabled={frozen}
                  >
                    {Object.entries(roleLabels).map(([key, label]) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field
                  label="Phạm vi"
                  error={fields.scope}
                  hint="Trưởng ban cần Ban/Khu vực hợp lệ."
                >
                  <Select
                    value={
                      role === "member"
                        ? "self"
                        : role === "ministry_lead"
                          ? "assigned_units"
                          : "church"
                    }
                    disabled={frozen}
                  >
                    <option
                      value={
                        role === "member"
                          ? "self"
                          : role === "ministry_lead"
                            ? "assigned_units"
                            : "church"
                      }
                    >
                      {role === "member"
                        ? "Của mình"
                        : role === "ministry_lead"
                          ? "Ban/Khu vực được giao"
                          : "Toàn Hội Thánh"}
                    </option>
                  </Select>
                </Field>
              </div>
            )}
            {(mode === "create" || mode === "permissions") && role === "ministry_lead" && (
              <ScopePicker
                churchId={churchId}
                ids={unitIds}
                onChange={setUnitIds}
                locked={frozen}
              />
            )}
            {mode === "status" && (
              <>
                <Feedback tone="warning">
                  {selected?.status === "active"
                    ? "Các phiên của tài khoản này sẽ bị thu hồi. Dữ liệu được giữ nguyên."
                    : "Mở tài khoản không khôi phục các phiên cũ. Người dùng phải đăng nhập lại."}
                </Feedback>
                <Field label="Lý do" error={fields.reason}>
                  <TextInput
                    required
                    maxLength={200}
                    value={reason}
                    disabled={frozen}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </Field>
              </>
            )}
            {mode === "reset" && (
              <>
                <Feedback tone="warning">
                  Chỉ cấp lại sau khi xác minh đúng người. Các phiên hiện tại và mật khẩu cũ sẽ bị
                  vô hiệu.
                </Feedback>
                <Field label="Tham chiếu hỗ trợ" error={fields.supportReference}>
                  <TextInput
                    required
                    maxLength={200}
                    value={supportReference}
                    disabled={frozen}
                    onChange={(e) => setSupportReference(e.target.value)}
                  />
                </Field>
              </>
            )}
            {conflict && (
              <Button disabled={frozen} onClick={() => void reloadAccount()}>
                Tải lại tài khoản
              </Button>
            )}
            {existing && (
              <Button disabled={frozen} onClick={() => void openAccount(existing)}>
                Mở tài khoản hiện có
              </Button>
            )}
            <DialogActions>
              <Button disabled={frozen} onClick={close}>
                Hủy
              </Button>
              <Button
                type="submit"
                variant={mode === "status" && selected?.status === "active" ? "danger" : "primary"}
                disabled={frozen || conflict || !churchInfo}
              >
                {busy
                  ? "Đang xử lý…"
                  : mode === "reset"
                    ? "Cấp lại"
                    : mode === "status"
                      ? selected?.status === "active"
                        ? "Khóa"
                        : "Mở tài khoản"
                      : mode === "permissions"
                        ? "Lưu quyền"
                        : "Lưu tài khoản"}
              </Button>
            </DialogActions>
          </form>
        )}
        {pending && (
          <DialogActions>
            <Button disabled={busy} onClick={() => void checkResult()}>
              Kiểm tra kết quả
            </Button>
            <Button
              disabled={busy}
              onClick={() => {
                if (
                  window.confirm(
                    "Chỉ tiếp tục nếu đã đối chiếu tài khoản và không lặp lại thao tác chưa xác định. Bạn đã đối chiếu?",
                  )
                ) {
                  intentRef.current = null;
                  setPending(null);
                  setMode(null);
                  setRefresh((x) => x + 1);
                }
              }}
            >
              Tôi đã đối chiếu
            </Button>
          </DialogActions>
        )}
      </Modal>
    </>
  );
}
