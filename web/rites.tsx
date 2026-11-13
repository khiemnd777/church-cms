import { useEffect, useRef, useState } from "react";
import type { RiteCommand } from "../api/rites/validation";
import type { ChurchRef } from "./access-context";
import { ApiError } from "./api";
import { PrepClassesView } from "./prep-classes";
import {
  dateLabel,
  type Rite,
  type RiteHistory,
  type RitePage,
  type RitePeople,
  type RitePreview,
  type RiteRow,
  riteNames,
  riteStates,
  riteTabs,
  tabKinds,
} from "./rites-api";
import { RiteForm } from "./rites-forms";
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
  TableFrame,
  Tabs,
  TextInput,
  Toolbar,
} from "./ui/components";
import "./rites.css";
type Props = {
  realm: TenantRealm;
  churchId: string;
  pending: TenantIntent | null;
  onPending: (i: TenantIntent | null) => void;
  onAuthError: (e: unknown) => void;
  onTitle: (title: string, context?: string) => void;
  onChurch?: (c: ChurchRef) => void;
  onAttendance: (id: string) => void;
  onMember: (id: string) => void;
  onCertificate?: (kind: "baptism" | "dedication" | "marriage", riteId: string) => void;
};
export function RitesView(props: Props) {
  const focusTab = useRef(false);
  const [tab, setTab] = useState(() => {
    const t = new URLSearchParams(location.search).get("tab");
    return riteTabs.some((x) => x.id === t) ? (t as string) : "class";
  });
  function change(id: string) {
    if (props.pending) return;
    focusTab.current = true;
    setTab(id);
    const u = new URL(location.href);
    u.searchParams.set("tab", id);
    u.searchParams.delete("riteId");
    window.history.replaceState(null, "", u);
  }
  useEffect(() => {
    if (!focusTab.current) return;
    const frame = requestAnimationFrame(() => {
      const button = document.getElementById(`rites-tab-${tab}`);
      button?.focus();
      button?.scrollIntoView({ block: "nearest", inline: "nearest" });
      focusTab.current = false;
    });
    return () => cancelAnimationFrame(frame);
  }, [tab]);
  return tab === "class" ? (
    <PrepClassesView {...props} onTab={change} />
  ) : (
    <RitesLedger {...props} key={tab} tab={tab as keyof typeof tabKinds} onTab={change} />
  );
}
const factLabel = (f: unknown) => {
  if (!f || typeof f !== "object" || !("status" in f)) return "Không áp dụng";
  const b = f as { status: string; date: string | null; place: string | null };
  return `${b.status === "baptized" ? "Đã Báp-têm" : b.status === "not_baptized" ? "Chưa Báp-têm" : "Chưa rõ"} · ${dateLabel(b.date)} · ${b.place ?? "Chưa rõ nơi"}`;
};
function snapshotLabel(s: Record<string, unknown> | null) {
  if (!s) return "Chưa có";
  if ("baptism" in s) return factLabel(s.baptism);
  const r = s as unknown as RiteRow;
  return r.record
    ? `${riteStates[r.state]} · ${dateLabel(r.record.date)} · ${r.people.map((p) => p.fullName).join(", ")}`
    : "—";
}
export function RiteSummary({
  row,
  onMember,
  locked,
}: {
  row: RiteRow;
  onMember?: (id: string) => void;
  locked?: boolean;
}) {
  const p = row.record.payload;
  return (
    <div className="rites-section">
      <KeyValueList
        items={[
          { label: "Loại lễ", value: riteNames[row.kind] },
          { label: "Ngày cử hành", value: dateLabel(row.record.date) },
          { label: "Trạng thái", value: riteStates[row.state] },
          { label: "Nguồn", value: row.record.historical ? "Thông tin lịch sử" : "Ghi sổ" },
          { label: "Nơi", value: p.place ?? "Chưa rõ" },
          { label: "Ghi chú", value: row.record.note ?? "—" },
          ...(p.kind === "funeral"
            ? [
                { label: "Ngày qua đời", value: dateLabel(p.deathOn) },
                { label: "Hưởng thọ", value: p.age === null ? "Chưa rõ" : String(p.age) },
              ]
            : []),
          ...(p.kind === "communion"
            ? [
                {
                  label: "Số người dự",
                  value: p.count === null ? "Chưa ghi nhận" : String(p.count),
                },
              ]
            : []),
        ]}
      />
      {row.people.map((person, i) => (
        <div key={`${person.memberId ?? person.fullName}:${i}`} className="rites-actions">
          <span>
            {p.kind === "marriage"
              ? i === 0
                ? "Chú rể"
                : i === 1
                  ? "Cô dâu"
                  : "Người cử hành"
              : p.kind === "dedication"
                ? i === 0
                  ? "Con"
                  : i <= p.parents.length
                    ? { father: "Cha", mother: "Mẹ", guardian: "Người giám hộ" }[
                        p.parents[i - 1]?.role ?? "guardian"
                      ]
                    : "Người cử hành"
                : p.kind === "communion"
                  ? "Chủ lễ"
                  : i === 0
                    ? "Người liên quan"
                    : "Người cử hành"}
            : <b>{person.fullName}</b> · {dateLabel(person.birthDate)} ·{" "}
            {person.source === "member" ? person.code : "Ngoài Hội Thánh"}
          </span>
          {person.memberId && onMember && (
            <Button disabled={locked} onClick={() => onMember(person.memberId as string)}>
              Xem hồ sơ
            </Button>
          )}
        </div>
      ))}
      {p.kind === "marriage" && (
        <section>
          <h4>Rao hôn phối</h4>
          {!p.announcements.length ? (
            <p>Chưa ghi nhận.</p>
          ) : (
            p.announcements.map((a, i) => (
              <p key={`${a.date}:${i}`}>
                {dateLabel(a.date)} ·{" "}
                {{ planned: "Dự kiến", announced: "Đã rao", cancelled: "Đã hủy" }[a.state]} ·{" "}
                {a.note ?? "—"}
              </p>
            ))
          )}
        </section>
      )}
    </div>
  );
}
function RitesLedger({
  tab,
  onTab,
  ...props
}: Props & { tab: keyof typeof tabKinds; onTab: (id: string) => void }) {
  const {
      realm,
      churchId,
      pending,
      onPending,
      onAuthError,
      onTitle,
      onChurch,
      onMember,
      onCertificate,
    } = props,
    kind = tabKinds[tab],
    base = `${realm === "owner" ? "owner/" : ""}churches/${churchId}`,
    prefix = `${base}/rites`;
  const [identity, setIdentity] = useState<{ key: string; capabilities: string[] } | null>(null),
    [page, setPage] = useState<RitePage | null>(null),
    [facts, setFacts] = useState<RitePeople | null>(null),
    [selected, setSelected] = useState<Rite | null>(null),
    [selectedId, setSelectedId] = useState(
      new URLSearchParams(location.search).get("riteId") ?? "",
    ),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [q, setQ] = useState(""),
    [year, setYear] = useState(""),
    [state, setState] = useState(""),
    [cursor, setCursor] = useState<string | null>(null),
    [factCursor, setFactCursor] = useState<string | null>(null),
    [refresh, setRefresh] = useState(0),
    [dialog, setDialog] = useState<"form" | "history" | null>(null),
    [creating, setCreating] = useState(false),
    [seed, setSeed] = useState<RitePeople["items"][number] | null>(null),
    [history, setHistory] = useState<RiteHistory | null>(null),
    [preview, setPreview] = useState<{ data: RitePreview; body: RiteCommand } | null>(null),
    [previewBusy, setPreviewBusy] = useState(false),
    [confirmed, setConfirmed] = useState(false);
  const dialogTrigger = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!dialog) {
      dialogTrigger.current?.focus();
      dialogTrigger.current = null;
    }
  }, [dialog]);
  const epoch = useRef(0),
    canManage = !!identity?.capabilities.includes("rites:manage");
  function fail(e: unknown) {
    if (
      e instanceof ApiError &&
      [...authErrorCodes, "FORBIDDEN", "CHURCH_SUSPENDED"].includes(e.code)
    ) {
      setPage(null);
      setFacts(null);
      setSelected(null);
      setIdentity(null);
      setDialog(null);
      setPreview(null);
      onAuthError(e);
    } else setError(e instanceof Error ? e.message : "Không tải được sổ lễ nghi.");
  }
  const mutation = useTenantMutation({
    realm,
    churchId,
    principalKey: identity?.key ?? "",
    canWrite: canManage,
    pending,
    onPending,
    onAuthError: fail,
    operationPath: `${prefix}/operations`,
    prefix,
    onSuccess: (data) => {
      if (data && typeof data === "object" && "riteId" in data && typeof data.riteId === "string")
        select(data.riteId);
      setDialog(null);
      setPreview(null);
      setCursor(null);
      setFactCursor(null);
      setRefresh((n) => n + 1);
    },
  });
  const locked = mutation.busy || !!pending || previewBusy;
  function select(id: string) {
    setSelectedId(id);
    setSelected(null);
    const u = new URL(location.href);
    if (id) u.searchParams.set("riteId", id);
    else u.searchParams.delete("riteId");
    u.searchParams.set("tab", tab);
    window.history.replaceState(null, "", u);
  }
  useEffect(() => {
    const n = ++epoch.current,
      a = new AbortController();
    setLoading(true);
    setError("");
    void (async () => {
      const ctx = await tenantRequest<{
        church: ChurchRef;
        capabilities: string[];
        policyVersion: number;
        principal: { employeeId?: string; accountId?: string; version: number };
      }>(realm, `${base}/context`, { signal: a.signal });
      if (n !== epoch.current) return;
      setIdentity({
        key: `${ctx.data.principal.accountId ?? ctx.data.principal.employeeId}:${churchId}:${ctx.data.principal.version}:${ctx.data.policyVersion}`,
        capabilities: ctx.data.capabilities,
      });
      onTitle("Sổ lễ nghi", `${ctx.data.church.name} · ${ctx.data.church.code}`);
      onChurch?.(ctx.data.church);
      const r = await tenantRequest<RitePage>(
        realm,
        `${prefix}/records?${new URLSearchParams({ kind, q, ...(year.length === 4 ? { year } : {}), ...(state ? { state } : {}), ...(cursor ? { cursor } : {}) })}`,
        { signal: a.signal },
      );
      if (n !== epoch.current) return;
      setPage((old) => ({
        ...r.data,
        items: cursor ? [...(old?.items ?? []), ...r.data.items] : r.data.items,
      }));
      if (tab === "bap") {
        const f = await tenantRequest<RitePeople>(
          realm,
          `${prefix}/baptism-facts?${new URLSearchParams({ q, ...(factCursor ? { cursor: factCursor } : {}) })}`,
          { signal: a.signal },
        );
        if (n !== epoch.current) return;
        setFacts((old) => ({
          ...f.data,
          items: factCursor ? [...(old?.items ?? []), ...f.data.items] : f.data.items,
        }));
      }
      if (selectedId) {
        const d = await tenantRequest<Rite>(realm, `${prefix}/records/${selectedId}`, {
          signal: a.signal,
        });
        if (n === epoch.current) setSelected(d.data);
      }
    })()
      .catch((e) => {
        if (!a.signal.aborted) fail(e);
      })
      .finally(() => {
        if (!a.signal.aborted) setLoading(false);
      });
    return () => {
      a.abort();
      epoch.current++;
    };
  }, [realm, churchId, tab, selectedId, q, year, state, cursor, factCursor, refresh]);
  function openForm(f: RitePeople["items"][number] | null = null, newRecord = false) {
    dialogTrigger.current = document.activeElement as HTMLElement;
    setError("");
    mutation.setError("");
    setPreview(null);
    setConfirmed(false);
    setSeed(f);
    setCreating(newRecord);
    setDialog("form");
  }
  async function submit(body: RiteCommand) {
    const n = epoch.current,
      editing = creating ? null : selected;
    setError("");
    if (body.state === "recorded" || body.state === "void" || editing?.recordedAt) {
      setPreviewBusy(true);
      try {
        const r = await tenantRequest<RitePreview>(
          realm,
          `${prefix}/records${editing ? `/${editing.id}` : ""}/preview`,
          { method: "POST", body, headers: editing ? { "If-Match": `"${editing.version}"` } : {} },
        );
        if (n === epoch.current) {
          setPreview({ data: r.data, body });
          setConfirmed(false);
        }
      } catch (e) {
        if (n === epoch.current) fail(e);
      } finally {
        setPreviewBusy(false);
      }
    } else
      mutation.send(
        `${prefix}/records${editing ? `/${editing.id}` : ""}`,
        editing ? "PATCH" : "POST",
        body,
        editing?.version,
      );
  }
  async function showHistory(next?: string) {
    if (!selected) return;
    const n = epoch.current;
    if (dialog !== "history") dialogTrigger.current = document.activeElement as HTMLElement;
    setDialog("history");
    try {
      const r = await tenantRequest<RiteHistory>(
        realm,
        `${prefix}/records/${selected.id}/history${next ? `?cursor=${encodeURIComponent(next)}` : ""}`,
      );
      if (n === epoch.current)
        setHistory((old) => ({
          ...r.data,
          items: next ? [...(old?.items ?? []), ...r.data.items] : r.data.items,
        }));
    } catch (e) {
      if (n === epoch.current) fail(e);
    }
  }
  const p = selected?.record.payload;
  const pendingFeedback = pending ? (
    <Feedback tone="warning">
      Thao tác chưa rõ kết quả. Giữ nguyên intent và đối soát trước khi ghi tiếp.
      <div className="rites-actions">
        <Button disabled={mutation.busy} onClick={() => void mutation.execute(pending, true)}>
          Thử lại / kiểm tra thao tác
        </Button>
        <Button
          disabled={mutation.busy}
          onClick={() => {
            if (window.confirm("Đọc lại sổ để đối soát trước thao tác mới?")) {
              onPending(null);
              setDialog(null);
              setPreview(null);
              setRefresh((n) => n + 1);
            }
          }}
        >
          Đối soát sổ
        </Button>
      </div>
    </Feedback>
  ) : null;
  return (
    <div className="rites-section">
      <SectionHeader title="Sổ lễ nghi">
        {canManage && (
          <Button
            variant="primary"
            disabled={locked || loading}
            onClick={() => openForm(null, true)}
          >
            + Ghi lễ
          </Button>
        )}
      </SectionHeader>
      <Tabs
        id="rites"
        value={tab}
        items={riteTabs.map((t) => ({ ...t, disabled: locked }))}
        onChange={onTab}
      />
      <section
        role="tabpanel"
        id={`rites-panel-${tab}`}
        aria-labelledby={`rites-tab-${tab}`}
        className="rites-section"
      >
        {error && <Feedback tone="error">{error}</Feedback>}
        {mutation.error && <Feedback tone="error">{mutation.error}</Feedback>}
        {mutation.notice && <Feedback>{mutation.notice}</Feedback>}
        {(error || mutation.error) && !dialog && (
          <Button disabled={locked} onClick={() => setRefresh((n) => n + 1)}>
            Tải lại sổ
          </Button>
        )}
        {!dialog && pendingFeedback}
        <Toolbar>
          <Field label="Tìm người/mã hồ sơ">
            <TextInput
              maxLength={100}
              value={q}
              disabled={locked}
              onChange={(e) => {
                setQ(e.target.value);
                setCursor(null);
                setFactCursor(null);
              }}
            />
          </Field>
          <Field label="Năm">
            <TextInput
              inputMode="numeric"
              placeholder="Tất cả"
              pattern="[0-9]{4}"
              maxLength={4}
              value={year}
              disabled={locked}
              onChange={(e) => {
                setYear(e.target.value);
                setCursor(null);
              }}
            />
          </Field>
          <Field label="Trạng thái">
            <Select
              value={state}
              disabled={locked}
              onChange={(e) => {
                setState(e.target.value);
                setCursor(null);
              }}
            >
              <option value="">Tất cả</option>
              {Object.entries(riteStates).map(([s, n]) => (
                <option key={s} value={s}>
                  {n}
                </option>
              ))}
            </Select>
          </Field>
        </Toolbar>
        {loading && <Loading />}
        {tab === "bap" && facts && (
          <Card>
            <div className="rites-section">
              <SectionHeader title="Thông tin Báp-têm hiện hành từ hồ sơ/import" />
              <p>
                Giữ thông tin chưa rõ ngày/nơi. Bộ lọc năm/trạng thái bên trên áp dụng cho bản ghi
                lễ phía dưới.
              </p>
              <TableFrame label="Thông tin Báp-têm hiện hành">
                <table>
                  <thead>
                    <tr>
                      <th>Ngày Báp-têm</th>
                      <th>Họ tên</th>
                      <th>Ngày sinh</th>
                      <th>Mục sư cử hành</th>
                      <th>Nơi</th>
                      <th>Nguồn</th>
                      <th>Thao tác</th>
                    </tr>
                  </thead>
                  <tbody>
                    {facts.items.map((m) => (
                      <tr key={m.id}>
                        <td>{dateLabel(m.baptism.date)}</td>
                        <td>
                          <Button disabled={locked} onClick={() => onMember(m.id)}>
                            {m.fullName}
                          </Button>
                        </td>
                        <td>{dateLabel(m.birthDate)}</td>
                        <td>{m.rite?.people[1]?.fullName ?? "Chưa rõ"}</td>
                        <td>{m.baptism.place ?? "Chưa rõ"}</td>
                        <td>
                          {m.rite ? "Có bản ghi lễ" : "Từ hồ sơ/import · chưa bổ sung chi tiết lễ"}
                        </td>
                        <td>
                          {m.rite ? (
                            <Button disabled={locked} onClick={() => select(m.rite?.id ?? "")}>
                              Xem chi tiết
                            </Button>
                          ) : canManage ? (
                            <Button disabled={locked} onClick={() => openForm(m, true)}>
                              Bổ sung lễ
                            </Button>
                          ) : (
                            "—"
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableFrame>
              {!facts.items.length && <EmptyState message="Chưa có hồ sơ ghi nhận Báp-têm." />}
              {facts.nextCursor && (
                <PaginationControl
                  loading={loading || locked}
                  onMore={() => setFactCursor(facts.nextCursor)}
                />
              )}
            </div>
          </Card>
        )}
        {tab === "com" && (
          <Card>
            <SectionHeader title={`Lễ Tiệc Thánh${year ? ` năm ${year}` : ""}`} />
            <p>
              Lễ kế tiếp:{" "}
              {page?.nextPlanned
                ? dateLabel(page.nextPlanned.record.date)
                : "Chưa có lịch được ghi"}
              . Số dự do người nhập; không tự lấy từ điểm danh.
            </p>
          </Card>
        )}
        {page && (
          <div className="rites-section">
            <TableFrame label={`Sổ ${riteNames[kind]}`}>
              <table>
                <thead>
                  <tr>
                    <th>
                      {tab === "com" ? "Ngày cử hành" : tab === "fun" ? "Ngày an táng" : "Ngày"}
                    </th>
                    <th>
                      {tab === "ded"
                        ? "Tên con"
                        : tab === "wed"
                          ? "Chú rể"
                          : tab === "fun"
                            ? "Người qua đời"
                            : tab === "com"
                              ? "Chủ lễ"
                              : "Họ tên"}
                    </th>
                    {tab === "bap" || tab === "ded" ? <th>Ngày sinh</th> : null}
                    <th>
                      {tab === "ded"
                        ? "Cha mẹ/người giám hộ"
                        : tab === "wed"
                          ? "Cô dâu"
                          : tab === "fun"
                            ? "Hưởng thọ"
                            : tab === "com"
                              ? "Số người dự"
                              : "Mục sư cử hành"}
                    </th>
                    <th>{tab === "bap" ? "Nơi" : "Ghi chú"}</th>
                    <th>Trạng thái</th>
                    <th>Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {page.items.map((r) => {
                    const payload = r.record.payload;
                    return (
                      <tr key={r.id}>
                        <td>{dateLabel(r.record.date)}</td>
                        <td>{r.people[0]?.fullName ?? "Chưa rõ"}</td>
                        {tab === "bap" || tab === "ded" ? (
                          <td>{dateLabel(r.people[0]?.birthDate ?? null)}</td>
                        ) : null}
                        <td>
                          {payload.kind === "dedication"
                            ? r.people
                                .slice(1, 1 + payload.parents.length)
                                .map((p) => p.fullName)
                                .join(", ") || "Chưa rõ"
                            : payload.kind === "marriage"
                              ? r.people[1]?.fullName
                              : payload.kind === "funeral"
                                ? payload.age === null
                                  ? "Chưa rõ"
                                  : String(payload.age)
                                : payload.kind === "communion"
                                  ? payload.count === null
                                    ? "Chưa ghi nhận"
                                    : String(payload.count)
                                  : (r.people[1]?.fullName ?? "Chưa rõ")}
                        </td>
                        <td>
                          {tab === "bap" ? (payload.place ?? "Chưa rõ") : (r.record.note ?? "—")}
                        </td>
                        <td>
                          <Badge>{riteStates[r.state]}</Badge>
                        </td>
                        <td>
                          <Button disabled={locked} onClick={() => select(r.id)}>
                            Xem chi tiết
                          </Button>
                          {onCertificate &&
                            ["baptism", "dedication", "marriage"].includes(r.kind) && (
                              <IconButton
                                icon="print"
                                label="Giấy chứng nhận"
                                disabled={locked || r.state !== "recorded"}
                                onClick={() =>
                                  onCertificate(
                                    r.kind as "baptism" | "dedication" | "marriage",
                                    r.id,
                                  )
                                }
                              />
                            )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableFrame>
            {!page.items.length && <EmptyState message="Chưa có bản ghi lễ phù hợp." />}
            {page.nextCursor && (
              <PaginationControl
                loading={locked || loading}
                onMore={() => setCursor(page.nextCursor)}
              />
            )}
          </div>
        )}
        {selected && (
          <Card>
            <div className="rites-section">
              <SectionHeader title={`Chi tiết ${riteNames[selected.kind]}`} />
              <RiteSummary row={selected} onMember={onMember} locked={locked} />
              {p?.kind === "baptism" && (
                <Feedback>
                  Thông tin hồ sơ hiện hành: {factLabel(selected.currentBaptism)}. Snapshot lễ được
                  giữ theo lần ghi nhận.
                </Feedback>
              )}
              <div className="rites-actions">
                {onCertificate && ["baptism", "dedication", "marriage"].includes(selected.kind) && (
                  <IconButton
                    icon="print"
                    label="Giấy chứng nhận"
                    disabled={locked || selected.state !== "recorded"}
                    onClick={() =>
                      onCertificate(
                        selected.kind as "baptism" | "dedication" | "marriage",
                        selected.id,
                      )
                    }
                  />
                )}
                {canManage && (
                  <Button disabled={locked} onClick={() => openForm(null, false)}>
                    Sửa / đính chính
                  </Button>
                )}
                <Button
                  disabled={locked}
                  onClick={() => {
                    setHistory(null);
                    void showHistory();
                  }}
                >
                  Lịch sử
                </Button>
                <Button disabled={locked} onClick={() => select("")}>
                  Đóng chi tiết
                </Button>
              </div>
            </div>
          </Card>
        )}
      </section>
      {dialog && (
        <Modal
          open
          locked={locked}
          title={
            dialog === "history"
              ? "Lịch sử lễ"
              : creating
                ? `Ghi ${riteNames[kind]}`
                : "Sửa / đính chính lễ"
          }
          onClose={() => {
            if (!locked) {
              setDialog(null);
              setPreview(null);
            }
          }}
        >
          {pendingFeedback}
          {error && <Feedback tone="error">{error}</Feedback>}
          {mutation.error && <Feedback tone="error">{mutation.error}</Feedback>}
          {dialog === "form" && (
            <>
              <div hidden={!!preview}>
                <RiteForm
                  key={creating ? `new:${seed?.id ?? ""}` : selected?.id}
                  kind={kind}
                  rite={creating ? null : selected}
                  seed={seed}
                  realm={realm}
                  prefix={prefix}
                  locked={locked || !!preview}
                  onFail={fail}
                  onSubmit={(body) => void submit(body)}
                  onCancel={() => setDialog(null)}
                />
              </div>
              {preview && (
                <div className="rites-section">
                  <h4>Preview xác nhận / đính chính</h4>
                  {preview.data.before && (
                    <>
                      <h4>Trước</h4>
                      <RiteSummary row={preview.data.before} />
                    </>
                  )}
                  <h4>Sau</h4>
                  <RiteSummary
                    row={{
                      ...preview.data.after,
                      id: "preview",
                      kind: preview.data.after.record.payload.kind,
                      version: 0,
                      recordedAt: null,
                    }}
                  />
                  {kind === "baptism" && (
                    <KeyValueList
                      items={[
                        {
                          label: "Báp-têm trên hồ sơ · trước",
                          value: factLabel(preview.data.baptismBefore),
                        },
                        {
                          label: "Báp-têm trên hồ sơ · sau",
                          value: factLabel(preview.data.baptismAfter),
                        },
                      ]}
                    />
                  )}
                  <Choice
                    checked={confirmed}
                    disabled={locked}
                    onChange={(e) => setConfirmed(e.target.checked)}
                    label="Tôi xác nhận sự kiện và thông tin trước/sau"
                  />
                  <DialogActions>
                    <Button disabled={locked} onClick={() => setPreview(null)}>
                      Quay lại
                    </Button>
                    <Button
                      variant="primary"
                      disabled={locked || !confirmed}
                      onClick={() => {
                        const editing = creating ? null : selected;
                        mutation.send(
                          `${prefix}/records${editing ? `/${editing.id}` : ""}`,
                          editing ? "PATCH" : "POST",
                          { ...preview.body, preview: preview.data.context },
                          editing?.version,
                        );
                      }}
                    >
                      Xác nhận
                    </Button>
                  </DialogActions>
                </div>
              )}
            </>
          )}
          {dialog === "history" && (
            <div className="rites-section">
              {!history ? (
                <Loading />
              ) : (
                history.items.map((h) => (
                  <Card key={h.id}>
                    <SectionHeader
                      title={`${h.event === "profile_baptism_changed" ? "Thông tin hồ sơ thay đổi" : h.event === "created" ? "Tạo bản ghi" : "Đính chính"} · ${new Date(h.occurredAt).toLocaleString("vi-VN")}`}
                    />
                    <KeyValueList
                      items={[
                        { label: "Người ghi", value: `${h.actorKind} · ${h.actorId}` },
                        { label: "Lý do", value: h.reason ?? "—" },
                        { label: "Trước", value: snapshotLabel(h.before) },
                        { label: "Sau", value: snapshotLabel(h.after) },
                      ]}
                    />
                    {"record" in h.after && <RiteSummary row={h.after as unknown as RiteRow} />}
                  </Card>
                ))
              )}
              {history?.nextCursor && (
                <PaginationControl
                  loading={locked}
                  onMore={() => void showHistory(history.nextCursor as string)}
                />
              )}
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
