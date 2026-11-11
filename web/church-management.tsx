import { type FormEvent, useEffect, useRef, useState } from "react";
import { ApiError } from "./api";
import type { ChurchPage } from "./tenancy-api";
import {
  type ChurchDto,
  type ChurchInput,
  type ChurchSummary,
  church,
  churches,
  type Intent,
  operation,
  sendIntent,
} from "./tenancy-api";
import {
  Badge,
  Button,
  Card,
  DialogActions,
  EmptyState,
  Feedback,
  Field,
  Icon,
  IconButton,
  KeyValueList,
  Loading,
  Modal,
  PaginationControl,
  SectionHeader,
  Select,
  StatCard,
  Stats,
  TableFrame,
  TextArea,
  TextInput,
  Toolbar,
} from "./ui/components";

type Draft = {
  name: string;
  province: string;
  district: string;
  address: string;
  contactName: string;
  phone: string;
  email: string;
};
const blank: Draft = {
  name: "",
  province: "",
  district: "",
  address: "",
  contactName: "",
  phone: "",
  email: "",
};
const draftOf = (c: ChurchDto): Draft => ({
  name: c.name,
  province: c.province,
  district: c.district ?? "",
  address: c.address ?? "",
  contactName: c.contact?.name ?? "",
  phone: c.contact?.phone ?? "",
  email: c.contact?.email ?? "",
});
function toInput(d: Draft, creating: boolean): ChurchInput {
  const contact = {
    ...(d.contactName.trim() ? { name: d.contactName.trim() } : {}),
    ...(d.phone.trim() ? { phone: d.phone.trim() } : {}),
    ...(d.email.trim() ? { email: d.email.trim() } : {}),
  };
  return {
    name: d.name.trim(),
    province: d.province.trim(),
    district: d.district.trim() || null,
    address: d.address.trim() || null,
    contact: Object.keys(contact).length
      ? creating
        ? contact
        : {
            name: d.contactName.trim() || null,
            phone: d.phone.trim() || null,
            email: d.email.trim() || null,
          }
      : null,
  };
}
function State({ status }: { status: ChurchDto["status"] }) {
  return (
    <Badge tone={status === "active" ? "good" : "warn"}>
      {status === "active" ? "Hoạt động" : "Tạm ngưng"}
    </Badge>
  );
}
const counter = (value: number | null) =>
  value === null ? "—" : new Intl.NumberFormat("vi-VN").format(value);
export function ChurchManagement({
  onAuthError,
  onTitle,
  listRequest,
  onChurch,
  onAccounts,
  onManage,
  onConfig,
}: {
  onAuthError: (error: unknown) => void;
  onTitle: (title: string, context?: string) => void;
  listRequest: number;
  onChurch: (church: ChurchSummary | null) => void;
  onAccounts: () => void;
  onManage: () => void;
  onConfig: () => void;
}) {
  const initialId = /^\/owner\/churches\/([a-f0-9]{24})$/i.exec(location.pathname)?.[1] ?? null;
  const [selected, setSelected] = useState<string | null>(initialId),
    [detail, setDetail] = useState<ChurchSummary | null>(null),
    [page, setPage] = useState<ChurchPage | null>(null),
    [q, setQ] = useState(""),
    [search, setSearch] = useState(""),
    [status, setStatus] = useState(""),
    [loading, setLoading] = useState(false),
    [loadingMore, setLoadingMore] = useState(false),
    [error, setError] = useState(""),
    [refresh, setRefresh] = useState(0),
    [dialog, setDialog] = useState<"create" | "edit" | "status" | null>(null),
    [draft, setDraft] = useState<Draft>(blank),
    [reason, setReason] = useState(""),
    [formError, setFormError] = useState(""),
    [fields, setFields] = useState<Record<string, string>>({}),
    [saving, setSaving] = useState(false),
    [pending, setPending] = useState<Intent | null>(null),
    [similar, setSimilar] = useState<ChurchSummary[]>([]),
    [similarState, setSimilarState] = useState(""),
    [conflict, setConflict] = useState(false);
  const modal = useRef<HTMLDialogElement>(null),
    pendingRef = useRef<Intent | null>(null),
    savingRef = useRef(false),
    lastListRequest = useRef(listRequest),
    listGeneration = useRef(0),
    dialogVersion = useRef<number | undefined>(undefined);
  const auth = (e: unknown) =>
    e instanceof ApiError &&
    [
      "SESSION_EXPIRED",
      "SESSION_REVOKED",
      "REAUTH_REQUIRED",
      "PASSWORD_CHANGE_REQUIRED",
      "FORBIDDEN",
    ].includes(e.code);
  function showError(e: unknown, form = false) {
    if (auth(e)) {
      onAuthError(e);
      return;
    }
    const text = e instanceof Error ? e.message : "Không thể tải dữ liệu.";
    if (form) {
      setFormError(text);
      if (e instanceof ApiError) setFields(e.fieldErrors ?? {});
    } else setError(text);
  }
  function select(id: string | null) {
    setSelected(id);
    setDetail(null);
    setError("");
    history.pushState(null, "", id ? `/owner/churches/${id}` : "/owner/churches");
    if (!id) setRefresh((x) => x + 1);
  }
  useEffect(() => {
    if (lastListRequest.current !== listRequest) {
      lastListRequest.current = listRequest;
      select(null);
    }
  }, [listRequest]);
  useEffect(() => {
    const back = () => {
      const id = /^\/owner\/churches\/([a-f0-9]{24})$/i.exec(location.pathname)?.[1] ?? null;
      setSelected(id);
      setDetail(null);
      setRefresh((x) => x + 1);
    };
    window.addEventListener("popstate", back);
    return () => window.removeEventListener("popstate", back);
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => setSearch(q.trim()), 250);
    return () => clearTimeout(timer);
  }, [q]);
  useEffect(() => {
    if (selected) return;
    onTitle("Hội Thánh", "Quản trị Hội Thánh");
    onChurch(null);
    const generation = ++listGeneration.current,
      controller = new AbortController();
    setLoading(true);
    setLoadingMore(false);
    setPage(null);
    setError("");
    void churches(search, status, undefined, controller.signal)
      .then((r) => {
        if (generation === listGeneration.current) setPage(r.data);
      })
      .catch((e) => {
        if (!controller.signal.aborted) showError(e);
      })
      .finally(() => {
        if (generation === listGeneration.current) setLoading(false);
      });
    return () => {
      controller.abort();
      listGeneration.current++;
    };
  }, [selected, search, status, refresh]);
  useEffect(() => {
    if (!selected) return;
    let current = true;
    setLoading(true);
    setDetail(null);
    setError("");
    void church(selected)
      .then((r) => {
        if (current) {
          setDetail(r.data);
          onChurch(r.data);
          onTitle("Chi tiết Hội Thánh", `${r.data.name} · ${r.data.code} · ${r.data.province}`);
        }
      })
      .catch((e) => {
        if (current) showError(e);
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [selected, refresh]);
  useEffect(() => {
    pendingRef.current = pending;
    const warn = (e: BeforeUnloadEvent) => {
      if (pendingRef.current) {
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [pending]);
  useEffect(() => {
    if (dialog !== "create" && dialog !== "edit") return;
    const name = [...draft.name.trim()].slice(0, 100).join("");
    if (!name) {
      setSimilar([]);
      setSimilarState("");
      return;
    }
    const controller = new AbortController(),
      timer = setTimeout(() => {
        setSimilarState("Đang kiểm tra tên tương tự…");
        void churches(name, "", undefined, controller.signal, 5)
          .then((r) => {
            setSimilar(r.data.items.filter((c) => c.id !== selected));
            setSimilarState("");
          })
          .catch(() => {
            if (!controller.signal.aborted) {
              setSimilar([]);
              setSimilarState(
                "Chưa kiểm tra được tên tương tự. Đối chiếu danh sách trước khi lưu.",
              );
            }
          });
      }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [draft.name, dialog, selected]);
  async function more() {
    if (!page?.nextCursor || loadingMore) return;
    const generation = listGeneration.current;
    setLoadingMore(true);
    setError("");
    try {
      const result = await churches(search, status, page.nextCursor);
      if (generation === listGeneration.current)
        setPage((prev) =>
          prev
            ? { items: [...prev.items, ...result.data.items], nextCursor: result.data.nextCursor }
            : result.data,
        );
    } catch (e) {
      if (generation === listGeneration.current) showError(e);
    } finally {
      if (generation === listGeneration.current) setLoadingMore(false);
    }
  }
  function open(kind: "create" | "edit" | "status") {
    dialogVersion.current = detail?.version;
    setDraft(kind === "edit" && detail ? draftOf(detail) : blank);
    setReason("");
    setFields({});
    setFormError("");
    setConflict(false);
    setPending(null);
    setDialog(kind);
  }
  function close() {
    if (savingRef.current || pendingRef.current) return;
    setDialog(null);
    setFormError("");
  }
  async function finish(saved: ChurchDto) {
    setPending(null);
    pendingRef.current = null;
    setDialog(null);
    setSelected(saved.id);
    setDetail(null);
    setRefresh((x) => x + 1);
    history.pushState(null, "", `/owner/churches/${saved.id}`);
  }
  async function submit(event?: FormEvent) {
    event?.preventDefault();
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setFormError("");
    setFields({});
    let intent = pendingRef.current;
    try {
      if (!intent) {
        const isStatus = dialog === "status";
        intent = {
          path:
            dialog === "create"
              ? "owner/churches"
              : `owner/churches/${detail?.id}${isStatus ? "/status" : ""}`,
          method: dialog === "create" ? "POST" : "PATCH",
          body: isStatus
            ? {
                status: detail?.status === "active" ? "suspended" : "active",
                reason: reason.trim(),
              }
            : toInput(draft, dialog === "create"),
          key: crypto.randomUUID(),
          version: dialog === "create" ? undefined : dialogVersion.current,
          createdAt: Date.now(),
        };
        setPending(intent);
        pendingRef.current = intent;
      }
      if (Date.now() - intent.createdAt >= 24 * 60 * 60_000) {
        setFormError(
          "Thao tác đã quá 24 giờ. Đối soát danh sách và kết quả trước khi tạo thao tác mới.",
        );
        return;
      }
      if (intent.operationId) {
        try {
          const checked = await operation(intent.operationId);
          await finish(checked.data.safeResult.church);
          return;
        } catch (e) {
          if (e instanceof ApiError && e.code === "NOT_FOUND") {
            const retry = { ...intent, operationId: undefined };
            setPending(retry);
            pendingRef.current = retry;
            setFormError(
              "Chưa có kết quả đối soát. Bấm kiểm tra lần nữa để thử lại cùng thao tác.",
            );
            return;
          }
          throw e;
        }
      }
      const result = await sendIntent(intent);
      await finish(result.data.church);
    } catch (e) {
      const unknown =
        e instanceof ApiError &&
        [
          "NETWORK_ERROR",
          "OUTCOME_UNKNOWN",
          "DEPENDENCY_UNAVAILABLE",
          "OPERATION_IN_PROGRESS",
          "IDEMPOTENCY_EXPIRED",
          "IDEMPOTENCY_CONFLICT",
        ].includes(e.code);
      if (unknown && intent) {
        const hold = { ...intent, ...(e.operationId ? { operationId: e.operationId } : {}) };
        setPending(hold);
        pendingRef.current = hold;
      } else {
        setPending(null);
        pendingRef.current = null;
      }
      setConflict(e instanceof ApiError && e.code === "VERSION_CONFLICT");
      showError(e, true);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }
  async function reloadForm() {
    if (!detail || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      const latest = await church(detail.id);
      setDetail(latest.data);
      onTitle(
        "Chi tiết Hội Thánh",
        `${latest.data.name} · ${latest.data.code} · ${latest.data.province}`,
      );
      dialogVersion.current = latest.data.version;
      setDraft(draftOf(latest.data));
      setReason("");
      setFormError("");
      setFields({});
      setConflict(false);
    } catch (e) {
      showError(e, true);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }
  const frozen = saving || pending !== null;
  function input(field: keyof Draft, label: string, required = false, type = "text", full = false) {
    const paths: Partial<Record<keyof Draft, string>> = {
      contactName: "contact.name",
      phone: "contact.phone",
      email: "contact.email",
    };
    return (
      <Field label={label} error={fields[paths[field] ?? field]} full={full}>
        <TextInput
          type={type}
          required={required}
          disabled={frozen}
          value={draft[field]}
          onChange={(e) => setDraft((d) => ({ ...d, [field]: e.target.value }))}
          autoComplete="off"
        />
      </Field>
    );
  }
  return (
    <>
      {error && <Feedback tone="error">{error}</Feedback>}
      {selected ? (
        <>
          <Button variant="link" className="church-back" onClick={() => select(null)}>
            <Icon name="back" /> Hội Thánh
          </Button>
          {loading && <Loading />}
          {detail && (
            <>
              <Card>
                <SectionHeader title={detail.name}>
                  <Button aria-label="Sửa Hội Thánh" onClick={() => open("edit")}>
                    Sửa
                  </Button>
                </SectionHeader>
                <div className="church-record">
                  <div className="church-record-status">
                    <State status={detail.status} />
                    <span className="small muted num">{detail.code}</span>
                  </div>
                  <div className="church-record-columns">
                    <KeyValueList
                      items={[
                        { label: "Địa hạt", value: detail.district || "—" },
                        { label: "Tỉnh/Thành", value: detail.province },
                        { label: "Địa chỉ", value: detail.address || "—" },
                      ]}
                    />
                    <KeyValueList
                      items={[
                        { label: "Người liên hệ", value: detail.contact?.name || "—" },
                        { label: "Điện thoại", value: detail.contact?.phone || "—" },
                        { label: "Email liên hệ", value: detail.contact?.email || "—" },
                      ]}
                    />
                  </div>
                </div>
                <Stats>
                  {(
                    [
                      ["members", "Thuộc viên"],
                      ["families", "Gia đình"],
                      ["ministries", "Ban"],
                      ["areas", "Khu vực"],
                      ["accounts", "Tài khoản"],
                    ] as const
                  ).map(([key, label]) => (
                    <StatCard
                      key={key}
                      compact
                      label={label}
                      value={counter(detail.counters[key].value)}
                      unavailable={detail.counters[key].value === null}
                    />
                  ))}
                </Stats>
              </Card>
              <div className="church-future-actions">
                <Button onClick={onAccounts}>Tài khoản</Button>
                <Button onClick={onManage} disabled={detail.status !== "active"}>
                  Vào quản lý Hội Thánh
                </Button>
              </div>
              <div className="church-future-actions">
                <Button disabled={detail.status !== "active"} onClick={onConfig}>
                  Cấu hình
                </Button>
              </div>
              <div className="church-status-action">
                <Button
                  variant="link"
                  className={detail.status === "active" ? "ui-text-danger" : undefined}
                  onClick={() => open("status")}
                >
                  {detail.status === "active" ? "Tạm ngưng Hội Thánh" : "Mở lại Hội Thánh"}
                </Button>
              </div>
            </>
          )}
        </>
      ) : (
        <>
          <Toolbar>
            <label className="church-search" htmlFor="church-search">
              <span className="sr-only">Tìm Hội Thánh</span>
              <TextInput
                id="church-search"
                className="church-search-input"
                placeholder="Tìm tên, mã, địa bàn…"
                value={q}
                maxLength={200}
                onChange={(e) => setQ([...e.target.value].slice(0, 100).join(""))}
              />
            </label>
            <label htmlFor="church-filter">
              <span className="sr-only">Trạng thái</span>
              <Select
                id="church-filter"
                aria-label="Trạng thái"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                <option value="">Tất cả</option>
                <option value="active">Hoạt động</option>
                <option value="suspended">Tạm ngưng</option>
              </Select>
            </label>
            <IconButton
              label="Thêm Hội Thánh"
              icon="plus"
              variant="primary"
              onClick={() => open("create")}
            />
          </Toolbar>
          {loading && <Loading />}
          {page?.items.length === 0 && (
            <EmptyState
              message={
                search || status
                  ? "Không tìm thấy Hội Thánh phù hợp."
                  : "Chưa có dữ liệu Hội Thánh để hiển thị."
              }
            />
          )}
          {!!page?.items.length && (
            <TableFrame label="Danh sách Hội Thánh">
              <table className="church-table">
                <thead>
                  <tr>
                    <th className="church-code">Mã</th>
                    <th>Hội Thánh</th>
                    <th>Địa bàn</th>
                    <th>Trạng thái</th>
                    <th>
                      <span className="sr-only">Mở chi tiết</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {page.items.map((c) => (
                    <tr key={c.id}>
                      <td className="church-code num muted">{c.code}</td>
                      <td>
                        <Button variant="link" className="church-name" onClick={() => select(c.id)}>
                          {c.name}
                        </Button>
                        <div className="small muted">
                          {counter(c.counters.members.value)} thuộc viên ·{" "}
                          {counter(c.counters.accounts.value)} tài khoản
                        </div>
                      </td>
                      <td>
                        {c.province}
                        {c.district && <div className="small muted">{c.district}</div>}
                      </td>
                      <td>
                        <State status={c.status} />
                      </td>
                      <td>
                        <IconButton
                          label={`Mở ${c.name}`}
                          icon="arrow"
                          onClick={() => select(c.id)}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableFrame>
          )}
          {page?.nextCursor && <PaginationControl loading={loadingMore} onMore={more} />}
          {error && <Button onClick={() => setRefresh((x) => x + 1)}>Tải lại</Button>}
        </>
      )}
      <Modal
        open={dialog !== null}
        title={
          dialog === "status"
            ? detail?.status === "active"
              ? "Tạm ngưng Hội Thánh"
              : "Mở lại Hội Thánh"
            : "Hội Thánh"
        }
        onClose={close}
        locked={frozen}
        dialogRef={modal}
      >
        <form onSubmit={submit} aria-busy={saving}>
          {formError && <Feedback tone="error">{formError}</Feedback>}
          {pending && !saving && (
            <Feedback>
              Chưa xác định kết quả. Giữ nguyên màn hình và kiểm tra cùng thao tác. Nếu tải lại
              trang, đối soát danh sách trước khi tạo mới.
            </Feedback>
          )}
          {dialog === "status" ? (
            <>
              <p>
                <strong>
                  {detail?.name} — {detail?.code}
                </strong>
              </p>
              <p>
                {detail?.status === "active"
                  ? "Người dùng Hội Thánh sẽ không truy cập được. Dữ liệu được giữ nguyên."
                  : "Người dùng có thể đăng nhập lại. Các phiên đã thu hồi không tự khôi phục."}
              </p>
              <div className="form">
                <Field label="Lý do" full>
                  <TextArea
                    required
                    disabled={frozen}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </Field>
              </div>
            </>
          ) : (
            <>
              <div className="form">
                {input("name", "Tên Hội Thánh", true, "text", true)}
                {input("district", "Địa hạt")}
                {input("province", "Tỉnh/Thành", true)}
                {input("address", "Địa chỉ", false, "text", true)}
                {input("contactName", "Người liên hệ")}
                {input("phone", "Điện thoại", false, "tel")}
                {input("email", "Email liên hệ", false, "email", true)}
              </div>
              {similarState && <Loading>{similarState}</Loading>}
              {similar.length > 0 && (
                <Feedback tone="warning">
                  <p>Có Hội Thánh với tên/địa bàn tương tự. Kiểm tra trước khi lưu:</p>
                  <ul>
                    {similar.map((c) => (
                      <li key={c.id}>
                        {c.name} · {c.province} · {c.code}
                      </li>
                    ))}
                  </ul>
                </Feedback>
              )}
            </>
          )}
          {conflict && (
            <p className="small">
              Tải lại sẽ thay nội dung đang nhập bằng phiên bản hiện tại. Hãy kiểm tra lại trước khi
              lưu.
            </p>
          )}
          {pending && !saving && (
            <Button
              variant="link"
              onClick={() => {
                if (
                  window.confirm(
                    "Kết quả chưa được đối soát. Về danh sách để kiểm tra trước khi tạo thao tác mới?",
                  )
                ) {
                  setPending(null);
                  pendingRef.current = null;
                  setDialog(null);
                  select(null);
                }
              }}
            >
              Về danh sách để đối soát
            </Button>
          )}
          <DialogActions>
            {conflict && <Button onClick={reloadForm}>Tải lại dữ liệu</Button>}
            <Button disabled={frozen} onClick={close}>
              Hủy
            </Button>
            <Button
              type="submit"
              variant={dialog === "status" && detail?.status === "active" ? "danger" : "primary"}
              disabled={saving || conflict}
            >
              {saving
                ? "Đang xử lý…"
                : pending
                  ? "Kiểm tra kết quả"
                  : dialog === "status"
                    ? detail?.status === "active"
                      ? "Tạm ngưng"
                      : "Mở lại"
                    : "Lưu"}
            </Button>
          </DialogActions>
        </form>
      </Modal>
    </>
  );
}
