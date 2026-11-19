import { useEffect, useRef, useState } from "react";
import {
  type ReportDocument,
  reportLimits,
  reportMark,
  reportTime,
} from "../api/reporting/contracts";
import type { Reports } from "../api/reporting/service";
import { ApiError, downloadFile } from "./api";
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
  Loading,
  Modal,
  PaginationControl,
  Stack,
  TableFrame,
  TextArea,
  TextInput,
} from "./ui/components";

type Listing = Awaited<ReturnType<Reports["list"]>>;
type Templates = Extract<Listing, { kind: "templates" }>;
type Editions = Extract<Listing, { kind: "editions" }>;
type Preview = Awaited<ReturnType<Reports["prepare"]>>;
type Edition = Awaited<ReturnType<Reports["viewEdition"]>>;
type Layout = Awaited<ReturnType<Reports["viewTemplate"]>>["layout"];
import "./church-report.css";
const templateStates = { checked: "Đã kiểm tra", active: "Đang dùng", retired: "Ngừng dùng" };

function ReportTable({ document }: { document: ReportDocument }) {
  return (
    <Card spacing="content">
      <Stack space="compact">
        <strong>{reportMark}</strong>
        <p>
          {document.church} · {document.template}
        </p>
        <p>Hiện trạng lúc tổng hợp: {reportTime(document.capturedAt)} (giờ Việt Nam)</p>
        <p>
          Sự kiện trong kỳ: {document.from} – {document.to}
        </p>
      </Stack>
      <TableFrame label="Chỉ tiêu báo cáo">
        <table
          className="church-report-layout"
          data-columns={document.widths.length}
          aria-label="Chỉ tiêu báo cáo"
        >
          <tbody>
            {document.rows.map((row, rowIndex) => (
              // Layout is immutable during preview or after issue.
              // biome-ignore lint/suspicious/noArrayIndexKey: position is the identity of a template row
              <tr key={rowIndex}>
                {row.map((cell, cellIndex) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: position is the identity of a template cell
                  <td key={cellIndex}>{cell.bold ? <strong>{cell.value}</strong> : cell.value}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </TableFrame>
      <Stack space="compact">
        {document.warnings.map((warning) => (
          <p key={warning}>{warning}</p>
        ))}
      </Stack>
    </Card>
  );
}

export function ChurchReport({
  open,
  base,
  realm,
  churchId,
  identity,
  pending,
  onPending,
  onAuthError,
  onClose,
}: {
  open: boolean;
  base: string;
  realm: TenantRealm;
  churchId: string;
  identity: { key: string; caps: string[] };
  pending: TenantIntent | null;
  onPending: (intent: TenantIntent | null) => void;
  onAuthError: (error: unknown) => void;
  onClose: () => void;
}) {
  const prefix = `${base}/reports`,
    canUpload = identity.caps.includes("reports:templates:upload"),
    canActivate = identity.caps.includes("reports:templates:activate");
  const [templates, setTemplates] = useState<Templates | null>(null),
    [editions, setEditions] = useState<Editions | null>(null),
    [templatePage, setTemplatePage] = useState<string | null>(null),
    [editionPage, setEditionPage] = useState<string | null>(null),
    [layout, setLayout] = useState<{ id: string; layout: Layout } | null>(null),
    [file, setFile] = useState<File | null>(null),
    [uploadReset, resetUpload] = useState(0),
    [refresh, setRefresh] = useState(0),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false),
    [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [preview, setPreview] = useState<Preview | null>(null),
    [shown, setShown] = useState<Edition | null>(null),
    [replacement, setReplacement] = useState<Edition | null>(null),
    [reason, setReason] = useState(""),
    [confirm, setConfirm] = useState(false);
  const replacementField = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (replacement) replacementField.current?.querySelector("textarea")?.focus();
  }, [replacement]);
  const own = pending?.path.startsWith(`${prefix}/`) ? pending : null;
  const fail = (e: unknown) => {
    if (e instanceof ApiError && authErrorCodes.includes(e.code)) {
      onAuthError(e);
      return;
    }
    if (e instanceof ApiError && ["FORBIDDEN", "CHURCH_SUSPENDED"].includes(e.code)) {
      setPreview(null);
      setShown(null);
      setTemplates(null);
      setEditions(null);
    }
    setError(e instanceof Error ? e.message : "Không tải được báo cáo.");
  };
  const invalidatePreview = () => {
    setPreview(null);
    setConfirm(false);
  };
  const reload = () => {
    setTemplatePage(null);
    setEditionPage(null);
    setRefresh((n) => n + 1);
  };
  const mutation = useTenantMutation({
    realm,
    churchId,
    principalKey: identity.key,
    canWrite: identity.caps.includes("reports:use"),
    pending,
    onPending,
    onAuthError,
    onAccessLoss: () => {
      invalidatePreview();
      reload();
    },
    operationPath: `${prefix}/operations`,
    prefix,
    onSuccess: (data) => {
      if (data && typeof data === "object" && "id" in data && typeof data.id === "string") {
        if ("edition" in data && data.edition === true) {
          setReplacement(null);
          setReason("");
          void loadEdition(data.id);
        }
      }
      setFile(null);
      resetUpload((n) => n + 1);
      invalidatePreview();
      reload();
    },
  });
  const locked = busy || mutation.busy || !!pending;
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const options = { signal: controller.signal };
    setLoading(true);
    void Promise.all([
      tenantRequest<Templates>(
        realm,
        `${prefix}/list?${new URLSearchParams({ kind: "templates", ...(templatePage ? { cursor: templatePage } : {}) })}`,
        options,
      ),
      tenantRequest<Editions>(
        realm,
        `${prefix}/list?${new URLSearchParams({ kind: "editions", ...(editionPage ? { cursor: editionPage } : {}) })}`,
        options,
      ),
    ])
      .then(([t, e]) => {
        if (controller.signal.aborted) return;
        setTemplates((old) => ({
          ...t.data,
          items:
            templatePage && old
              ? [
                  ...old.items,
                  ...t.data.items.filter((row) => !old.items.some((x) => x.id === row.id)),
                ]
              : t.data.items,
        }));
        setEditions((old) => ({
          ...e.data,
          items:
            editionPage && old
              ? [
                  ...old.items,
                  ...e.data.items.filter((row) => !old.items.some((x) => x.id === row.id)),
                ]
              : e.data.items,
        }));
        setFrom((d) => d || `${t.data.day.slice(0, 4)}-01-01`);
        setTo((d) => d || t.data.day);
      })
      .catch((e) => {
        if (!controller.signal.aborted) fail(e);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [open, prefix, realm, templatePage, editionPage, refresh]);

  async function loadEdition(id: string) {
    setBusy(true);
    try {
      setShown((await tenantRequest<Edition>(realm, `${prefix}/editions/${id}`)).data);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }
  async function viewTemplate(id: string) {
    setBusy(true);
    setError("");
    try {
      setLayout(
        (await tenantRequest<{ id: string; layout: Layout }>(realm, `${prefix}/templates/${id}`))
          .data,
      );
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }
  async function download(path: string) {
    setBusy(true);
    setError("");
    try {
      await downloadFile(path);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }
  async function prepare() {
    if (!templates?.activeId) return;
    invalidatePreview();
    setShown(null);
    setError("");
    setBusy(true);
    try {
      const r = await tenantRequest<Preview>(realm, `${prefix}/preview`, {
        method: "POST",
        body: {
          templateId: templates.activeId,
          from,
          to,
          ...(replacement ? { previousId: replacement.id, reason: reason.trim() } : {}),
        },
      });
      setPreview(r.data);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }
  function upload() {
    if (!file || !canUpload || locked) return;
    setError("");
    if (!/\.xlsx$/i.test(file.name) || file.size > reportLimits.upload || file.size === 0) {
      setError("Chọn file .xlsx có dung lượng từ 1 byte đến 512 KB.");
      return;
    }
    void mutation.execute({
      realm,
      churchId,
      principalKey: identity.key,
      path: `${prefix}/templates`,
      method: "POST",
      body: {},
      key: crypto.randomUUID(),
      createdAt: Date.now(),
      upload: { file, format: "xlsx", source: "report-template" },
    });
  }
  return (
    <Modal open={open} locked={locked} onClose={onClose} title="Báo cáo Tổng Liên Hội">
      {error && <Feedback tone="error">{error}</Feedback>}
      {mutation.error && <Feedback tone="error">{mutation.error}</Feedback>}
      {Object.entries(mutation.fields).map(([field, message]) => (
        <Feedback tone="error" key={field}>
          {field} · {message}
        </Feedback>
      ))}
      {mutation.notice && <Feedback>{mutation.notice}</Feedback>}
      {own && (
        <Stack space="content">
          <Feedback>Kết quả thao tác chưa rõ. Kiểm tra bằng thao tác đã gửi.</Feedback>
          <Button
            disabled={locked && (busy || mutation.busy)}
            onClick={() => void mutation.execute(own, true)}
          >
            Kiểm tra / thử lại
          </Button>
          <Button
            disabled={busy || mutation.busy}
            onClick={() => {
              onPending(null);
              reload();
            }}
          >
            Đóng lần thử và tải lại danh sách
          </Button>
        </Stack>
      )}
      {loading && <Loading>Đang tải mẫu và báo cáo…</Loading>}
      <Card spacing="content">
        <h3>Mẫu báo cáo</h3>
        {canUpload && (
          <Stack space="content">
            <Button disabled={locked} onClick={() => void download(`${prefix}/starter`)}>
              Tải file khởi đầu
            </Button>
            <Field
              label="Tải mẫu .xlsx"
              hint="Một trang tính, tối đa 512 KB. Mã chỉ tiêu đứng riêng trong ô."
            >
              <TextInput
                key={uploadReset}
                type="file"
                accept=".xlsx"
                disabled={locked}
                onChange={(e) => setFile(e.currentTarget.files?.[0] ?? null)}
              />
            </Field>
            <Button disabled={!file || locked} onClick={upload}>
              Kiểm tra và lưu mẫu
            </Button>
          </Stack>
        )}
        {templates && !templates.items.length && (
          <EmptyState message="Chưa có mẫu riêng cho Hội Thánh." />
        )}
        {templates?.items.map((t) => (
          <Stack space="compact" key={t.id}>
            <p>
              <strong>{t.name}</strong> · {t.id.slice(-8)} · {t.uploadedAt.slice(0, 10)}{" "}
              <Badge>{templateStates[t.state]}</Badge>
            </p>
            <DialogActions>
              <Button disabled={locked} onClick={() => void viewTemplate(t.id)}>
                Xem thử mẫu
              </Button>
              {canActivate && t.state === "checked" && (
                <Button
                  disabled={locked || loading}
                  onClick={() =>
                    mutation.send(`${prefix}/templates/${t.id}/activate`, "POST", {
                      activeId: templates.activeId,
                      selectionVersion: templates.selectionVersion,
                      version: t.version,
                    })
                  }
                >
                  Kích hoạt
                </Button>
              )}
              {canActivate && t.state === "active" && (
                <Button
                  disabled={locked || loading}
                  onClick={() =>
                    mutation.send(`${prefix}/templates/${t.id}/retire`, "POST", {
                      activeId: templates.activeId,
                      selectionVersion: templates.selectionVersion,
                      version: t.version,
                    })
                  }
                >
                  Ngừng dùng
                </Button>
              )}
            </DialogActions>
          </Stack>
        ))}
        {templates?.nextCursor && (
          <PaginationControl
            loading={loading || locked}
            onMore={() => setTemplatePage(templates.nextCursor)}
          />
        )}
        {layout && (
          <Stack space="content">
            <strong>
              {reportMark} · {layout.layout.name}
            </strong>
            <TableFrame label="Xem thử mẫu">
              <table
                className="church-report-layout"
                data-columns={layout.layout.widths.length}
                aria-label="Xem thử mẫu"
              >
                <tbody>
                  {layout.layout.rows.map((row, i) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: immutable template row position
                    <tr key={i}>
                      {row.map((cell, j) => (
                        // biome-ignore lint/suspicious/noArrayIndexKey: immutable template cell position
                        <td key={j}>{cell.bold ? <strong>{cell.text}</strong> : cell.text}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableFrame>
            <Button disabled={locked} onClick={() => setLayout(null)}>
              Đóng xem thử mẫu
            </Button>
          </Stack>
        )}
      </Card>
      <Card spacing="content">
        <h3>Lập báo cáo</h3>
        <p>Mẫu đang dùng: {templates?.activeName ?? "Chưa chọn"}</p>
        <div className="certificates-form-grid">
          <Field label="Từ ngày">
            <TextInput
              type="date"
              value={from}
              disabled={locked || !!replacement}
              max={to || templates?.day}
              onChange={(e) => {
                setFrom(e.target.value);
                invalidatePreview();
              }}
            />
          </Field>
          <Field label="Đến ngày">
            <TextInput
              type="date"
              value={to}
              disabled={locked || !!replacement}
              min={from}
              max={templates?.day}
              onChange={(e) => {
                setTo(e.target.value);
                invalidatePreview();
              }}
            />
          </Field>
        </div>
        {replacement && (
          <Stack space="content">
            <div ref={replacementField}>
              <Field label="Lý do thay thế">
                <TextArea
                  maxLength={300}
                  value={reason}
                  disabled={locked}
                  onChange={(e) => {
                    setReason(e.target.value);
                    invalidatePreview();
                  }}
                />
              </Field>
            </div>
            <Button
              disabled={locked}
              onClick={() => {
                setReplacement(null);
                invalidatePreview();
              }}
            >
              Hủy thay thế
            </Button>
          </Stack>
        )}
        <Button
          variant="primary"
          disabled={
            locked ||
            loading ||
            !templates?.activeId ||
            !from ||
            !to ||
            (replacement !== null && !reason.trim())
          }
          onClick={() => void prepare()}
        >
          Tổng hợp
        </Button>
        {busy && <Loading>Đang xử lý…</Loading>}
        {preview && (
          <Stack space="content">
            <ReportTable document={preview.document} />
            <Choice
              label="Tôi xác nhận số liệu và các cảnh báo trước khi chốt"
              checked={confirm}
              onChange={(e) => setConfirm(e.target.checked)}
              disabled={locked}
            />
            <Button
              variant="primary"
              disabled={!confirm || locked}
              onClick={() =>
                mutation.send(`${prefix}/issue`, "POST", { previewId: preview.id, confirm: true })
              }
            >
              Chốt báo cáo
            </Button>
          </Stack>
        )}
      </Card>
      <Card spacing="content">
        <h3>Bản chốt và lịch sử</h3>
        {shown && (
          <Stack space="content">
            <p>
              <strong>Bản {shown.revision}</strong> · {shown.issuedAt.slice(0, 10)}
              {shown.supersededBy ? " · Đã thay thế" : ""}
            </p>
            {shown.reason && <p>Lý do thay thế: {shown.reason}</p>}
            <ReportTable document={shown.document} />
            <DialogActions>
              <Button
                disabled={locked}
                onClick={() => void download(`${prefix}/editions/${shown.id}/xlsx`)}
              >
                Excel
              </Button>
              <Button
                disabled={locked}
                onClick={() => void download(`${prefix}/editions/${shown.id}/pdf`)}
              >
                PDF
              </Button>
              {!shown.supersededBy && (
                <Button
                  disabled={locked}
                  onClick={() => {
                    setReplacement(shown);
                    setFrom(shown.document.from);
                    setTo(shown.document.to);
                    setReason("");
                    invalidatePreview();
                  }}
                >
                  Tạo bản thay thế
                </Button>
              )}
            </DialogActions>
          </Stack>
        )}
        {editions && !editions.items.length && <EmptyState message="Chưa có báo cáo đã chốt." />}
        {editions?.items.map((e) => (
          <Stack space="compact" key={e.id}>
            <p>
              {e.name} · {e.from} – {e.to} · Bản {e.revision}
              {e.supersededBy ? " · Đã thay thế" : ""}
            </p>
            <Button disabled={locked} onClick={() => void loadEdition(e.id)}>
              Mở bản chốt
            </Button>
          </Stack>
        ))}
        {editions?.nextCursor && (
          <PaginationControl
            loading={locked || loading}
            onMore={() => setEditionPage(editions.nextCursor)}
          />
        )}
      </Card>
    </Modal>
  );
}
