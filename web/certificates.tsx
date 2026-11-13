import { useEffect, useRef, useState } from "react";
import type { CertificateInput, CertificateKind } from "../api/certificates/validation";
import type { ChurchRef } from "./access-context";
import { ApiError, downloadFile } from "./api";
import {
  type CertificateDraft,
  type CertificateDraftList,
  type CertificateEdition,
  type CertificateHistory,
  type CertificateList,
  type CertificatePreview,
  certificateNames,
  certificateStates,
} from "./certificates-api";
import { CertificateForm } from "./certificates-forms";
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
  KeyValueList,
  Loading,
  Modal,
  PaginationControl,
  SectionHeader,
  TextArea,
} from "./ui/components";
import { CertificatePage, CertificateTile, CertificateViewport } from "./ui/components/certificate";
import "./certificates.css";
const catalog = [
  { kind: "baptism", name: "Giấy chứng nhận Báp-têm" },
  { kind: "dedication", name: "Giấy chứng nhận Dâng con" },
  { kind: "marriage", name: "Chứng thư Thành hôn" },
  { kind: null, name: "Thư giới thiệu chuyển sinh hoạt" },
  { kind: null, name: "Giấy xác nhận tín hữu" },
  { kind: "application", name: "Đơn xin chịu Báp-têm" },
  { kind: null, name: "Phiếu thăm viếng" },
  { kind: null, name: "Báo cáo thống kê gửi Tổng Liên Hội" },
] as const;
export function CertificatesView({
  realm,
  churchId,
  pending,
  onPending,
  onAuthError,
  onTitle,
  onChurch,
}: {
  realm: TenantRealm;
  churchId: string;
  pending: TenantIntent | null;
  onPending: (v: TenantIntent | null) => void;
  onAuthError: (e: unknown) => void;
  onTitle: (t: string, ctx?: string) => void;
  onChurch?: (c: ChurchRef) => void;
}) {
  const base = `${realm === "owner" ? "owner/" : ""}churches/${churchId}`,
    prefix = `${base}/certificates`;
  const query = new URLSearchParams(location.search),
    seedKind = query.get("kind"),
    seedRite = query.get("riteId");
  const [identity, setIdentity] = useState<{ key: string; caps: string[] } | null>(null),
    [drafts, setDrafts] = useState<CertificateDraftList | null>(null),
    [editions, setEditions] = useState<CertificateList | null>(null),
    [draft, setDraft] = useState<CertificateDraft | null>(null),
    [edition, setEdition] = useState<CertificateEdition | null>(null),
    [preview, setPreview] = useState<CertificatePreview | null>(null),
    [history, setHistory] = useState<CertificateHistory | null>(null),
    [draftId, setDraftId] = useState(query.get("draftId") ?? ""),
    [editionId, setEditionId] = useState(query.get("editionId") ?? ""),
    [kind, setKind] = useState<CertificateKind>(
      seedKind && seedKind in certificateNames ? (seedKind as CertificateKind) : "baptism",
    ),
    [dialog, setDialog] = useState<
      "draft" | "preview" | "edition" | "history" | "revoke" | "revise" | null
    >(seedKind && seedKind in certificateNames ? "draft" : null),
    [creating, setCreating] = useState(!!seedKind),
    [loading, setLoading] = useState(true),
    [refresh, setRefresh] = useState(0),
    [error, setError] = useState(""),
    [preparing, setPreparing] = useState(false),
    [downloading, setDownloading] = useState(false),
    [page, setPage] = useState(0),
    [confirmed, setConfirmed] = useState(false),
    [faith, setFaith] = useState(false),
    [reason, setReason] = useState(""),
    [cursor, setCursor] = useState<string | null>(null),
    [draftCursor, setDraftCursor] = useState<string | null>(null);
  const epoch = useRef(0),
    trigger = useRef<HTMLElement | null>(null),
    canManage = !!identity?.caps.includes("certificates:manage");
  useEffect(() => {
    if (!dialog) {
      trigger.current?.focus();
      trigger.current = null;
    }
  }, [dialog]);
  function fail(e: unknown) {
    if (
      e instanceof ApiError &&
      [...authErrorCodes, "FORBIDDEN", "CHURCH_SUSPENDED"].includes(e.code)
    ) {
      setDrafts(null);
      setEditions(null);
      setDraft(null);
      setEdition(null);
      setPreview(null);
      setHistory(null);
      setDialog(null);
      setIdentity(null);
      onAuthError(e);
    } else setError(e instanceof Error ? e.message : "Chưa tải được biểu mẫu.");
  }
  function route(did: string, eid: string) {
    setDraftId(did);
    setEditionId(eid);
    const u = new URL(location.href);
    u.search = "";
    if (did) u.searchParams.set("draftId", did);
    if (eid) u.searchParams.set("editionId", eid);
    window.history.replaceState(null, "", u);
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
      if (
        data &&
        typeof data === "object" &&
        "draftId" in data &&
        typeof data.draftId === "string"
      ) {
        const eid = "editionId" in data && typeof data.editionId === "string" ? data.editionId : "";
        route(data.draftId, eid);
        setCreating(false);
        setDialog(eid ? "edition" : "draft");
      } else setDialog(null);
      setPreview(null);
      setConfirmed(false);
      setFaith(false);
      setPage(0);
      setCursor(null);
      setDraftCursor(null);
      setRefresh((n) => n + 1);
    },
  });
  const locked = mutation.busy || !!pending || preparing || downloading;
  useEffect(() => {
    const a = new AbortController(),
      n = ++epoch.current;
    setLoading(true);
    setError("");
    void (async () => {
      const ctx = await tenantRequest<{
        church: ChurchRef;
        capabilities: string[];
        policyVersion: number;
        principal: { accountId?: string; employeeId?: string; version: number };
      }>(realm, `${base}/context`, { signal: a.signal });
      if (n !== epoch.current) return;
      setIdentity({
        key: `${ctx.data.principal.accountId ?? ctx.data.principal.employeeId}:${churchId}:${ctx.data.principal.version}:${ctx.data.policyVersion}`,
        caps: ctx.data.capabilities,
      });
      onTitle("Biểu mẫu & Báo cáo", `${ctx.data.church.name} · ${ctx.data.church.code}`);
      onChurch?.(ctx.data.church);
      const list = await tenantRequest<CertificateList>(
        realm,
        `${prefix}/editions${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
        { signal: a.signal },
      );
      if (n !== epoch.current) return;
      setEditions((old) => ({
        ...list.data,
        items: cursor ? [...(old?.items ?? []), ...list.data.items] : list.data.items,
      }));
      const ds = await tenantRequest<CertificateDraftList>(
        realm,
        `${prefix}/drafts${draftCursor ? `?cursor=${encodeURIComponent(draftCursor)}` : ""}`,
        { signal: a.signal },
      );
      if (n !== epoch.current) return;
      setDrafts((old) => ({
        ...ds.data,
        items: draftCursor ? [...(old?.items ?? []), ...ds.data.items] : ds.data.items,
      }));
      if (editionId) {
        const e = await tenantRequest<CertificateEdition>(
          realm,
          `${prefix}/editions/${editionId}`,
          { signal: a.signal },
        );
        if (n !== epoch.current) return;
        setEdition(e.data);
        if (!dialog) setDialog("edition");
      }
      if (draftId) {
        const d = await tenantRequest<CertificateDraft>(realm, `${prefix}/drafts/${draftId}`, {
          signal: a.signal,
        });
        if (n !== epoch.current) return;
        setDraft(d.data);
        setKind(d.data.input.kind);
        if (!dialog) setDialog("draft");
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
  }, [realm, churchId, draftId, editionId, refresh, cursor, draftCursor]);
  function close() {
    if (locked) return;
    setDialog(null);
    setPreview(null);
    setConfirmed(false);
    setFaith(false);
    setError("");
  }
  function openNew(k: CertificateKind) {
    if (locked) return;
    trigger.current = document.activeElement as HTMLElement;
    setKind(k);
    setDraft(null);
    setEdition(null);
    setPreview(null);
    route("", "");
    setCreating(true);
    setDialog("draft");
    mutation.setError("");
    setError("");
  }
  function selectDraft(id: string) {
    if (locked) return;
    trigger.current = document.activeElement as HTMLElement;
    setCreating(false);
    setDraft(null);
    setEdition(null);
    setPreview(null);
    route(id, "");
    setDialog("draft");
    setPage(0);
  }
  function selectEdition(id: string) {
    if (locked) return;
    trigger.current = document.activeElement as HTMLElement;
    setEdition(null);
    setDraft(null);
    setPreview(null);
    route("", id);
    setDialog("edition");
    setPage(0);
  }
  async function prepare() {
    if (!draft) return;
    const n = epoch.current;
    setPreparing(true);
    setError("");
    try {
      const p = await tenantRequest<CertificatePreview>(
        realm,
        `${prefix}/drafts/${draft.id}/prepare`,
        { method: "POST", body: {}, headers: { "If-Match": `"${draft.version}"` } },
      );
      if (n === epoch.current) {
        setPreview(p.data);
        setDialog("preview");
        setConfirmed(false);
        setFaith(false);
        setPage(0);
      }
    } catch (e) {
      if (n === epoch.current) fail(e);
    } finally {
      setPreparing(false);
    }
  }
  async function showHistory(next?: string) {
    const id = draft?.id ?? edition?.draftId;
    if (!id) return;
    const n = epoch.current;
    if (!dialog) trigger.current = document.activeElement as HTMLElement;
    setDialog("history");
    try {
      const h = await tenantRequest<CertificateHistory>(
        realm,
        `${prefix}/drafts/${id}/history${next ? `?cursor=${encodeURIComponent(next)}` : ""}`,
      );
      if (n === epoch.current)
        setHistory((old) => ({
          ...h.data,
          items: next ? [...(old?.items ?? []), ...h.data.items] : h.data.items,
        }));
    } catch (e) {
      if (n === epoch.current) fail(e);
    }
  }
  const recovery = pending ? (
    <Feedback tone="warning">
      Thao tác chưa rõ kết quả. Giữ nguyên intent.
      <div className="certificates-actions">
        <Button disabled={mutation.busy} onClick={() => void mutation.execute(pending, true)}>
          Kiểm tra / thử lại bản
        </Button>
        <Button
          disabled={mutation.busy}
          onClick={() => {
            if (window.confirm("Đọc lại danh sách và đối soát trước ý định mới?")) {
              onPending(null);
              setDialog(null);
              setPreview(null);
              setRefresh((n) => n + 1);
            }
          }}
        >
          Đối soát danh sách bản
        </Button>
      </div>
    </Feedback>
  ) : null;
  const shown = dialog === "preview" ? preview : edition,
    currentPage = shown?.pages[page];
  async function file(format: "pdf" | "docx" | "print") {
    if (!edition || edition.state !== "issued" || locked) return;
    const path = `${prefix}/editions/${edition.id}/${format === "print" ? "print" : `files/${format}`}?version=${edition.version}`;
    if (format === "print") {
      window.open(`/api/v1/${path}`, "_blank", "noopener,noreferrer");
      return;
    }
    setDownloading(true);
    try {
      await downloadFile(path);
    } catch (e) {
      fail(e);
    } finally {
      setDownloading(false);
    }
  }
  return (
    <div className="certificates-section">
      <SectionHeader title="Biểu mẫu & Báo cáo" />
      {loading && <Loading />}
      {error && !dialog && <Feedback tone="error">{error}</Feedback>}
      {!dialog && recovery}
      {mutation.notice && !dialog && <Feedback>{mutation.notice}</Feedback>}
      <div className="certificates-catalog">
        {catalog.map((c) => (
          <CertificateTile
            key={c.name}
            label={c.name}
            unopened={!c.kind}
            report={c.name.startsWith("Báo cáo")}
            disabled={!c.kind || !canManage || locked || loading}
            onClick={() => {
              if (c.kind) openNew(c.kind);
            }}
          />
        ))}
      </div>
      <Card>
        <SectionHeader title="Bản nháp" />
        <div className="certificates-section">
          {drafts && !drafts.items.length && <EmptyState message="Chưa có bản nháp." />}
          {drafts?.items.map((d) => (
            <div className="li" key={d.id}>
              <div className="t">
                <b>{certificateNames[d.input.kind]}</b>
                <span>
                  Nháp · {d.updatedAt.slice(0, 10)} · {d.version}
                </span>
              </div>
              <Button disabled={locked} onClick={() => selectDraft(d.id)}>
                Mở nháp
              </Button>
            </div>
          ))}
          {drafts?.nextCursor && (
            <PaginationControl
              loading={locked || loading}
              onMore={() => setDraftCursor(drafts.nextCursor)}
            />
          )}
        </div>
      </Card>
      <Card>
        <SectionHeader title="Bản đã chốt và lịch sử phiên bản" />
        <div className="certificates-section">
          {editions && !editions.items.length && <EmptyState message="Chưa có bản đã chốt." />}
          {editions?.items.map((e) => (
            <div className="li" key={e.id}>
              <div className="t">
                <b>{certificateNames[e.kind]}</b>
                <span>
                  {e.names.join(" & ")} · v{e.revision} · {certificateStates[e.state]}
                </span>
              </div>
              <Button disabled={locked} onClick={() => selectEdition(e.id)}>
                Mở bản
              </Button>
            </div>
          ))}
          {editions?.nextCursor && (
            <PaginationControl
              loading={locked || loading}
              onMore={() => setCursor(editions.nextCursor)}
            />
          )}
        </div>
      </Card>
      {dialog && (
        <Modal
          open
          locked={locked}
          title={
            dialog === "draft"
              ? "Biểu mẫu · bản nháp"
              : dialog === "preview"
                ? "Xem trước"
                : dialog === "history"
                  ? "Lịch sử chứng nhận"
                  : dialog === "revoke"
                    ? "Thu hồi bản"
                    : dialog === "revise"
                      ? "Tạo phiên bản thay thế"
                      : "Bản đã chốt"
          }
          onClose={close}
        >
          {error && <Feedback tone="error">{error}</Feedback>}
          {preparing && <Loading>Đang tạo bản xem trước DOCX/PDF…</Loading>}
          {downloading && <Loading>Đang tải file…</Loading>}
          {mutation.error && <Feedback tone="error">{mutation.error}</Feedback>}
          {recovery}
          {(dialog === "draft" || dialog === "preview") && (
            <div hidden={dialog === "preview"}>
              {creating || draft ? (
                <CertificateForm
                  key={
                    creating ? `new:${kind}:${seedRite ?? ""}` : `${draft?.id}:${draft?.version}`
                  }
                  draft={creating ? null : draft}
                  kind={kind}
                  seedRite={creating ? seedRite : null}
                  realm={realm}
                  base={base}
                  locked={locked || dialog === "preview"}
                  onFail={fail}
                  onSave={(input: CertificateInput, reason) =>
                    mutation.send(
                      `${prefix}/drafts${!creating && draft ? `/${draft.id}` : ""}`,
                      !creating && draft ? "PATCH" : "POST",
                      { input, reason },
                      !creating ? draft?.version : undefined,
                    )
                  }
                  onPrepare={() => void prepare()}
                  onCancel={close}
                />
              ) : (
                <Loading />
              )}
            </div>
          )}
          {(dialog === "preview" || dialog === "edition") && (
            <div className="certificates-section">
              {!shown ? (
                <Loading />
              ) : (
                <>
                  <KeyValueList
                    items={[
                      { label: "Mẫu", value: certificateNames[shown.snapshot.input.kind] },
                      { label: "Phiên bản mẫu", value: shown.snapshot.templateVersion },
                      { label: "Ngày chốt", value: shown.snapshot.input.issuedOn },
                      { label: "Mã nội bộ", value: shown.snapshot.content.reference },
                    ]}
                  />
                  {shown.snapshot.missing.length > 0 && (
                    <Feedback tone="warning">
                      Cần bổ sung: {shown.snapshot.missing.join("; ")}
                    </Feedback>
                  )}
                  {shown.snapshot.conflicts.length > 0 && (
                    <Feedback tone="error">{shown.snapshot.conflicts.join("; ")}</Feedback>
                  )}
                  {shown.snapshot.differences.length > 0 && (
                    <Feedback>{shown.snapshot.differences.join("; ")}</Feedback>
                  )}
                  <div className="certificates-actions">
                    <Button disabled={locked || page === 0} onClick={() => setPage((n) => n - 1)}>
                      Trước
                    </Button>
                    <span>
                      Trang {page + 1}/{shown.pages.length}
                    </span>
                    <Button
                      disabled={locked || page + 1 >= shown.pages.length}
                      onClick={() => setPage((n) => n + 1)}
                    >
                      Tiếp
                    </Button>
                  </div>
                  <CertificateViewport>
                    {currentPage && (
                      <CertificatePage
                        content={shown.snapshot.content}
                        page={currentPage}
                        index={page}
                        total={shown.pages.length}
                      />
                    )}
                  </CertificateViewport>
                  {dialog === "preview" && preview && draft && (
                    <>
                      <Choice
                        label="Tôi xác nhận nội dung và dữ kiện trước khi chốt"
                        checked={confirmed}
                        disabled={locked}
                        onChange={(e) => setConfirmed(e.target.checked)}
                      />
                      {kind === "baptism" && (
                        <Choice
                          label="Tôi xác nhận riêng nội dung đức tin ghi trong GCN Báp-têm"
                          checked={faith}
                          disabled={locked}
                          onChange={(e) => setFaith(e.target.checked)}
                        />
                      )}
                      <DialogActions>
                        <Button disabled={locked} onClick={() => setDialog("draft")}>
                          Quay lại nháp
                        </Button>
                        <Button
                          variant="primary"
                          disabled={
                            locked ||
                            !confirmed ||
                            (kind === "baptism" && !faith) ||
                            !!preview.snapshot.missing.length ||
                            !!preview.snapshot.conflicts.length
                          }
                          onClick={() =>
                            mutation.send(
                              `${prefix}/drafts/${draft.id}/issue`,
                              "POST",
                              {
                                previewId: preview.id,
                                context: preview.context,
                                confirm: true,
                                faithConfirmed: faith,
                                reason: draft.reason,
                              },
                              draft.version,
                            )
                          }
                        >
                          Chốt bản
                        </Button>
                      </DialogActions>
                    </>
                  )}
                  {dialog === "edition" && edition && (
                    <>
                      <Badge>
                        {certificateStates[edition.state]} · v{edition.revision}
                      </Badge>
                      <div className="certificates-actions">
                        <Button
                          disabled={locked || edition.state !== "issued"}
                          onClick={() => file("docx")}
                        >
                          Word
                        </Button>
                        <Button
                          disabled={locked || edition.state !== "issued"}
                          onClick={() => file("pdf")}
                        >
                          PDF
                        </Button>
                        <Button
                          disabled={locked || edition.state !== "issued"}
                          onClick={() => file("print")}
                        >
                          In
                        </Button>
                        <Button
                          disabled={locked}
                          onClick={() => {
                            setHistory(null);
                            void showHistory();
                          }}
                        >
                          Lịch sử
                        </Button>
                        {canManage && (
                          <>
                            <Button
                              disabled={locked || edition.state === "superseded"}
                              onClick={() => {
                                setReason("");
                                setDialog("revise");
                              }}
                            >
                              Tạo phiên bản thay thế
                            </Button>
                            <Button
                              disabled={locked || edition.state !== "issued"}
                              onClick={() => {
                                setReason("");
                                setDialog("revoke");
                              }}
                            >
                              Thu hồi
                            </Button>
                          </>
                        )}
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          )}
          {(dialog === "revoke" || dialog === "revise") && edition && (
            <form
              className="certificates-form"
              onSubmit={(e) => {
                e.preventDefault();
                mutation.send(
                  `${prefix}/editions/${edition.id}/${dialog}`,
                  "POST",
                  { reason },
                  edition.version,
                );
              }}
            >
              <Feedback>
                Giữ bản và lịch sử trước đó. File đã tải không thể thu hồi khỏi máy người nhận.
              </Feedback>
              <Field label="Lý do">
                <TextArea
                  required
                  maxLength={500}
                  disabled={locked}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </Field>
              <DialogActions>
                <Button disabled={locked} onClick={() => setDialog("edition")}>
                  Quay lại
                </Button>
                <Button type="submit" variant="primary" disabled={locked}>
                  Xác nhận
                </Button>
              </DialogActions>
            </form>
          )}
          {dialog === "history" && (
            <div className="certificates-section">
              {!history ? (
                <Loading />
              ) : (
                history.items.map((h) => (
                  <Card key={h.id}>
                    <KeyValueList
                      items={[
                        {
                          label: "Sự kiện",
                          value:
                            (
                              {
                                draft_created: "Tạo nháp",
                                draft_updated: "Sửa nháp",
                                issued: "Chốt bản",
                                revision_draft_created: "Tạo nháp thay thế",
                                superseded: "Đã thay thế",
                                revoked: "Thu hồi",
                              } as Record<string, string>
                            )[h.event] ?? h.event,
                        },
                        {
                          label: "Thời điểm",
                          value: new Date(h.occurredAt).toLocaleString("vi-VN"),
                        },
                        { label: "Người ghi", value: `${h.actorKind} · ${h.actorId}` },
                        { label: "Lý do", value: h.reason ?? "—" },
                      ]}
                    />
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
