import { useEffect, useRef, useState } from "react";
import type { PrayerCommand } from "../api/prayers/validation";
import { ApiError } from "./api";
import {
  type PrayerDetail,
  type PrayerHistoryPage,
  type PrayerPage,
  type PrayerPreview,
  type PrayerRow,
  prayerActions,
  prayerCategories,
  prayerDate,
  prayerStates,
  prayerVisibility,
} from "./prayers-api";
import { PrayerForm } from "./prayers-form";
import {
  authErrorCodes,
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
  ContentList,
  DialogActions,
  EmptyState,
  Feedback,
  Field,
  KeyValueList,
  Loading,
  Modal,
  PaginationControl,
  SectionHeader,
  Select,
  Stack,
  TextInput,
  Toolbar,
} from "./ui/components";

type Props = {
  realm: TenantRealm;
  churchId: string;
  pending: TenantIntent | null;
  onPending: (p: TenantIntent | null) => void;
  onAuthError: (e: unknown) => void;
  otherDialog: boolean;
  onDialog: (open: boolean) => void;
};
export function PrayerFacts({ row }: { row: PrayerRow }) {
  return (
    <KeyValueList
      items={[
        { label: "Mã lời cầu thay", value: row.code },
        { label: "Phạm vi", value: prayerVisibility[row.visibility] },
        { label: "Nội dung", value: <span className="prayer-content">{row.content}</span> },
        { label: "Danh mục", value: prayerCategories[row.category] },
        { label: "Người gửi đã ghi", value: row.requesterSnapshot.name ?? "Chưa khai" },
        { label: "Ngày nhận", value: prayerDate(row.receivedOn) },
        { label: "Trạng thái", value: prayerStates[row.state] },
        { label: "Ngày đã chia sẻ", value: prayerDate(row.sharedOn) },
        { label: "Lý do kết thúc / hủy", value: row.closeReason ?? "—" },
      ]}
    />
  );
}
export function PrayersView(props: Props) {
  const initial = new URLSearchParams(location.search),
    [prayerId, setPrayerId] = useState(initial.get("prayerId") ?? ""),
    [filters, setFilters] = useState({
      state: initial.get("prayerState") ?? "active",
      category: initial.get("prayerCategory") ?? "",
      visibility: initial.get("prayerVisibility") ?? "all",
      q: "",
    }),
    [applied, setApplied] = useState(filters),
    [cursor, setCursor] = useState<string | null>(null),
    [page, setPage] = useState<PrayerPage | null>(null),
    [record, setRecord] = useState<PrayerDetail | null>(null),
    [history, setHistory] = useState<PrayerHistoryPage | null>(null),
    [edit, setEdit] = useState<{
      action: PrayerCommand["action"];
      record: PrayerDetail | null;
    } | null>(null),
    [preview, setPreview] = useState<PrayerPreview | null>(null),
    [intent, setIntent] = useState<PrayerCommand | null>(null),
    [confirmed, setConfirmed] = useState(false),
    [loading, setLoading] = useState(false),
    [detailLoading, setDetailLoading] = useState(false),
    [masked, setMasked] = useState(false),
    [reload, setReload] = useState(0);
  const epoch = useRef(0),
    principal = useRef(""),
    prefix = `${props.realm === "owner" ? "owner/" : ""}churches/${props.churchId}/care/prayers`,
    ownPending = props.pending?.path === prefix || !!props.pending?.path.startsWith(`${prefix}/`);
  function purge(discard: boolean) {
    epoch.current++;
    setMasked(true);
    setPage(null);
    setRecord(null);
    setHistory(null);
    setEdit(null);
    setPreview(null);
    setIntent(null);
    setPrayerId("");
    setFilters({ state: "active", category: "", visibility: "all", q: "" });
    setApplied((old) =>
      old.state === "active" && old.category === "" && old.visibility === "all" && old.q === ""
        ? old
        : { state: "active", category: "", visibility: "all", q: "" },
    );
    setConfirmed(false);
    props.onDialog(false);
    if (discard && ownPending) props.onPending(null);
  }
  function authFailure(e: unknown) {
    purge(false);
    props.onAuthError(e);
  }
  const mutation = useTenantMutation({
    ...props,
    onAuthError: authFailure,
    principalKey: page?.principalKey ?? "",
    canWrite: page?.canManage ?? false,
    prefix,
    operationPath: `${prefix}/operations`,
    onAccessLoss: () => purge(true),
    intentResource: {
      kind: "prayer_request",
      visibility: preview?.visibility ?? record?.visibility ?? "shared",
    },
    onSuccess: (data) => {
      const result = data as { prayerId: string };
      setEdit(null);
      setPreview(null);
      setIntent(null);
      setHistory(null);
      setPrayerId(result.prayerId);
      setCursor(null);
      setReload((n) => n + 1);
    },
  });
  function fail(e: unknown) {
    if (e instanceof ApiError && authErrorCodes.includes(e.code)) authFailure(e);
    else mutation.fail(e);
  }
  const busy = loading || detailLoading || mutation.busy || !!props.pending || props.otherDialog;
  useEffect(() => {
    props.onDialog(!!edit || !!preview);
  }, [!!edit, !!preview]);
  useEffect(
    () => () => {
      epoch.current++;
      props.onDialog(false);
    },
    [],
  );
  useEffect(() => {
    const u = new URL(location.href);
    for (const k of ["prayerId", "prayerState", "prayerCategory", "prayerVisibility", "prayerQ"])
      u.searchParams.delete(k);
    if (prayerId) u.searchParams.set("prayerId", prayerId);
    for (const [key, value] of Object.entries(applied))
      if (value && key !== "q")
        u.searchParams.set(`prayer${key[0]?.toUpperCase()}${key.slice(1)}`, value);
    historyReplace(u);
  }, [prayerId, applied]);
  useEffect(() => {
    const a = new AbortController(),
      token = epoch.current;
    setLoading(true);
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(applied)) if (v) q.set(k, v);
    if (cursor) q.set("cursor", cursor);
    void tenantRequest<PrayerPage>(props.realm, `${prefix}?${q}`, { signal: a.signal })
      .then((r) => {
        if (a.signal.aborted || token !== epoch.current) return;
        if (
          (principal.current && principal.current !== r.data.principalKey) ||
          (ownPending && props.pending?.principalKey !== r.data.principalKey)
        ) {
          purge(true);
          mutation.setError(
            "Quyền hoặc người thao tác đã thay đổi. Nội dung cũ đã được xóa; kết quả cần được người có quyền đối soát.",
          );
        }
        principal.current = r.data.principalKey;
        setPage(r.data);
        setMasked(false);
        if (new URLSearchParams(location.search).get("careSection") === "prayers")
          document.getElementById("prayers")?.scrollIntoView();
      })
      .catch((e) => {
        if (!a.signal.aborted && token === epoch.current) fail(e);
      })
      .finally(() => {
        if (!a.signal.aborted) setLoading(false);
      });
    return () => a.abort();
  }, [prefix, applied, cursor, reload]);
  useEffect(() => {
    if (!prayerId || !page || masked) return;
    const a = new AbortController(),
      token = epoch.current;
    setDetailLoading(true);
    void tenantRequest<PrayerDetail>(props.realm, `${prefix}/${prayerId}`, { signal: a.signal })
      .then((r) => {
        if (!a.signal.aborted && token === epoch.current) {
          setRecord(r.data);
          setHistory(null);
        }
      })
      .catch((e) => {
        if (!a.signal.aborted && token === epoch.current) fail(e);
      })
      .finally(() => {
        if (!a.signal.aborted) setDetailLoading(false);
      });
    return () => a.abort();
  }, [prayerId, reload, page?.principalKey, masked]);
  async function prepare(b: PrayerCommand) {
    if (!edit || busy) return;
    const token = epoch.current;
    mutation.setBusy(true);
    mutation.setError("");
    try {
      const r = await tenantRequest<PrayerPreview>(
        props.realm,
        `${prefix}${edit.record ? `/${edit.record.id}` : ""}/preview`,
        {
          method: "POST",
          body: b,
          headers: edit.record ? { "If-Match": `"${edit.record.version}"` } : {},
        },
      );
      if (token === epoch.current) {
        setPreview(r.data);
        setIntent(b);
        setConfirmed(false);
      }
    } catch (e) {
      if (token === epoch.current) fail(e);
    } finally {
      mutation.setBusy(false);
    }
  }
  function open(action: PrayerCommand["action"]) {
    if (busy || masked) return;
    mutation.setError("");
    setEdit({ action, record: action === "create" ? null : record });
    setPreview(null);
    setIntent(null);
    setConfirmed(false);
  }
  async function showHistory(after: string | null = null) {
    if (!record || busy) return;
    const token = epoch.current;
    mutation.setBusy(true);
    try {
      const r = await tenantRequest<PrayerHistoryPage>(
        props.realm,
        `${prefix}/${record.id}/history${after ? `?cursor=${encodeURIComponent(after)}` : ""}`,
      );
      if (token === epoch.current)
        setHistory((old) => ({
          ...r.data,
          items: after ? [...(old?.items ?? []), ...r.data.items] : r.data.items,
        }));
    } catch (e) {
      if (token === epoch.current) fail(e);
    } finally {
      mutation.setBusy(false);
    }
  }
  const reconcile = ownPending && page && props.pending?.principalKey === page.principalKey && (
    <Feedback tone="warning">
      Thao tác cầu thay đang chờ đối soát.{" "}
      <Button
        disabled={mutation.busy || !page.canManage}
        onClick={() => void mutation.execute(props.pending as TenantIntent, true)}
      >
        Đối soát cầu thay / thử lại cùng yêu cầu
      </Button>
    </Feedback>
  );
  return (
    <section id="prayers" className="care-section" aria-label="Lời cầu thay">
      <Card>
        <div className="care-section">
          <SectionHeader title="Lời cầu thay">
            <Button
              variant="primary"
              disabled={busy || masked || !page?.canManage}
              onClick={() => open("create")}
            >
              Thêm lời cầu thay
            </Button>
          </SectionHeader>
          {mutation.error && <Feedback tone="error">{mutation.error}</Feedback>}
          {mutation.notice && <Feedback tone="success">{mutation.notice}</Feedback>}
          {reconcile}
          <Toolbar>
            <Field label="Tìm đầu nội dung / người gửi / mã">
              <TextInput
                maxLength={100}
                value={filters.q}
                disabled={busy || masked}
                onChange={(e) => setFilters({ ...filters, q: e.target.value })}
              />
            </Field>
            <Field label="Danh mục cầu thay">
              <Select
                value={filters.category}
                disabled={busy || masked}
                onChange={(e) => setFilters({ ...filters, category: e.target.value })}
              >
                <option value="">Tất cả danh mục</option>
                {Object.entries(prayerCategories).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Trạng thái cầu thay">
              <Select
                value={filters.state}
                disabled={busy || masked}
                onChange={(e) => setFilters({ ...filters, state: e.target.value })}
              >
                <option value="active">Đang theo dõi</option>
                <option value="all">Tất cả trạng thái</option>
                {Object.entries(prayerStates).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            </Field>
            {page?.audience === "all" ? (
              <Field label="Phạm vi cầu thay">
                <Select
                  value={filters.visibility}
                  disabled={busy}
                  onChange={(e) => setFilters({ ...filters, visibility: e.target.value })}
                >
                  <option value="all">Tất cả được phép xem</option>
                  <option value="shared">Chung nội bộ</option>
                  <option value="pastoral">Riêng tư · chỉ Mục sư</option>
                </Select>
              </Field>
            ) : (
              <p className="muted">Chung nội bộ</p>
            )}
            <Button
              disabled={busy || masked}
              variant="primary"
              onClick={() => {
                setApplied(filters);
                setCursor(null);
                setReload((n) => n + 1);
              }}
            >
              Lọc cầu thay
            </Button>
            <Button
              disabled={busy}
              onClick={() => {
                if (masked) setApplied({ state: "active", category: "", visibility: "all", q: "" });
                setMasked(false);
                setCursor(null);
                setReload((n) => n + 1);
              }}
            >
              Làm mới cầu thay
            </Button>
          </Toolbar>
          {loading && <Loading />}
          {page && !masked && (
            <>
              <p className="muted">
                Theo bộ lọc: {page.summary.total} lời · {page.summary.active} đang theo dõi ·{" "}
                {page.summary.closed} đã kết thúc · {page.summary.cancelled} đã hủy
              </p>
              <ContentList
                label="Danh sách lời cầu thay"
                className="prayer-content"
                items={page.items.map((p) => {
                  const text = p.content.replace(/\s+/g, " "),
                    snippet = text.length > 120 ? `${text.slice(0, 120)}…` : text;
                  return {
                    id: p.id,
                    icon: p.visibility === "pastoral" ? "lock" : "pray",
                    title: p.visibility === "pastoral" ? `Riêng tư · ${snippet}` : snippet,
                    detail: (
                      <>
                        {p.requesterSnapshot.name ?? "Chưa khai"} · {prayerDate(p.receivedOn)} ·{" "}
                        {prayerCategories[p.category]} · {p.code}
                      </>
                    ),
                    action: (
                      <div className="prayer-row-actions">
                        <Badge>{prayerStates[p.state]}</Badge>
                        <Button disabled={busy} onClick={() => setPrayerId(p.id)}>
                          Chi tiết cầu thay
                        </Button>
                      </div>
                    ),
                  };
                })}
              />
              {!page.items.length && <EmptyState message="Chưa có lời cầu thay phù hợp." />}
              {page.nextCursor && (
                <PaginationControl loading={busy} onMore={() => setCursor(page.nextCursor)} />
              )}
            </>
          )}
        </div>
      </Card>
      {detailLoading && <Loading />}
      {record && !masked && (
        <Card>
          <div className="care-section">
            <SectionHeader title={`Lời cầu thay ${record.code}`} />
            <PrayerFacts row={record} />
            {record.source && (!record.source.available || record.source.changed) && (
              <Feedback tone="warning">
                Hồ sơ người gửi đã thay đổi hoặc không còn hợp lệ. Thông tin đã ghi được giữ nguyên.
              </Feedback>
            )}
            {record.source?.current && record.source.changed && (
              <details>
                <summary>Người gửi trong hồ sơ hiện tại</summary>
                <p>
                  {record.source.current.fullName} · {record.source.current.code}
                </p>
              </details>
            )}
            <Toolbar>
              {["open", "shared"].includes(record.state) && (
                <>
                  {!record.fromPortal && (
                    <Button disabled={busy} onClick={() => open("update")}>
                      Sửa cầu thay
                    </Button>
                  )}
                  {record.visibility === "shared" && record.state === "open" && (
                    <Button disabled={busy} onClick={() => open("share")}>
                      Ghi nhận đã chia sẻ
                    </Button>
                  )}
                  <Button disabled={busy} onClick={() => open("close")}>
                    Kết thúc cầu thay
                  </Button>
                  <Button disabled={busy} onClick={() => open("cancel")}>
                    Hủy lời cầu thay
                  </Button>
                </>
              )}
              {!record.fromPortal && (
                <Button disabled={busy} onClick={() => open("correct")}>
                  Đính chính cầu thay
                </Button>
              )}
              <Button disabled={busy} onClick={() => void showHistory()}>
                Lịch sử cầu thay
              </Button>
              <Button
                disabled={busy}
                onClick={() => {
                  setPrayerId("");
                  setRecord(null);
                  setHistory(null);
                }}
              >
                Đóng chi tiết cầu thay
              </Button>
            </Toolbar>
            {history && (
              <>
                <SectionHeader title="Lịch sử cầu thay" />
                {history.items.map((h) => (
                  <details key={h.id}>
                    <summary>
                      {new Date(h.occurredAt).toLocaleString("vi-VN", {
                        timeZone: "Asia/Ho_Chi_Minh",
                      })}{" "}
                      · {prayerActions[h.event]} · {h.reason ?? "Ghi nhận"}
                    </summary>
                    <div className="care-section">
                      {h.before && (
                        <>
                          <h4>Trước</h4>
                          <PrayerFacts row={h.before as PrayerRow} />
                        </>
                      )}
                      <h4>Sau</h4>
                      <PrayerFacts row={h.after as PrayerRow} />
                    </div>
                  </details>
                ))}
                {history.nextCursor && (
                  <PaginationControl
                    loading={busy}
                    onMore={() => void showHistory(history.nextCursor)}
                  />
                )}
              </>
            )}
          </div>
        </Card>
      )}
      <Modal
        open={!masked && (!!edit || !!preview)}
        title={
          preview
            ? "Xác nhận thay đổi cầu thay"
            : edit
              ? prayerActions[edit.action]
              : "Lời cầu thay"
        }
        onClose={() => {
          if (!mutation.busy && !props.pending) {
            setEdit(null);
            setPreview(null);
            setIntent(null);
          }
        }}
      >
        {mutation.error && <Feedback tone="error">{mutation.error}</Feedback>}
        {reconcile}
        {edit && page && (
          <div hidden={!!preview}>
            <PrayerForm
              key={`${edit.action}:${edit.record?.id ?? "new"}`}
              action={edit.action}
              record={edit.record}
              audience={page.audience}
              realm={props.realm}
              prefix={prefix}
              locked={busy}
              onPreview={(b) => void prepare(b)}
              onCancel={() => setEdit(null)}
              onError={fail}
            />
          </div>
        )}
        {preview && intent && (
          <div className="care-section">
            <PrayerFacts
              row={{
                ...preview.fields,
                id: edit?.record?.id ?? "",
                code: edit?.record?.code ?? "Cấp khi lưu",
                version: edit?.record?.version ?? 0,
                requesterSnapshot: preview.requesterSnapshot,
                visibility: preview.visibility,
                state: preview.state,
                sharedOn: preview.sharedOn,
                closeReason:
                  preview.action === "close" || preview.action === "cancel"
                    ? preview.reason
                    : (preview.before?.closeReason ?? null),
                closedAt: null,
                createdAt: "",
                updatedAt: "",
              }}
            />
            <Stack space="compact">
              <p>
                {preview.visibility === "pastoral"
                  ? "Chỉ Mục sư hợp lệ trong Hội Thánh được xem."
                  : "Owner, Mục sư và Thư ký có quyền trong Hội Thánh được xem."}{" "}
                Phạm vi khóa sau khi lưu.
              </p>
              {preview.reason && <p>Lý do: {preview.reason}</p>}
            </Stack>
            {preview.before && (
              <details>
                <summary>Trước thay đổi</summary>
                <PrayerFacts row={preview.before} />
              </details>
            )}
            <Choice
              label="Tôi đã kiểm tra nội dung phù hợp phạm vi xem."
              checked={confirmed}
              disabled={busy}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            <DialogActions>
              <Button disabled={busy} onClick={() => setPreview(null)}>
                Quay lại sửa
              </Button>
              <Button
                variant="primary"
                disabled={busy || !confirmed}
                onClick={() =>
                  mutation.send(
                    `${prefix}${edit?.record ? `/${edit.record.id}` : ""}`,
                    edit?.record ? "PATCH" : "POST",
                    { ...intent, preview: preview.context, confirmed },
                    edit?.record?.version,
                  )
                }
              >
                Xác nhận lưu cầu thay
              </Button>
            </DialogActions>
          </div>
        )}
      </Modal>
    </section>
  );
}
function historyReplace(url: URL) {
  window.history.replaceState(null, "", url);
}
