import { useEffect, useRef, useState } from "react";
import {
  type Decision,
  type ExportDto,
  exportColumns,
  exportLabels,
  type FileFormat,
  fieldLabels,
  type ImportDto,
  type ImportField,
  importFields,
  type ReviewPage,
  type RowReview,
} from "../api/data-exchange/contracts";
import { downloadFile } from "./api";
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
  Choice,
  DialogActions,
  Feedback,
  Field,
  Loading,
  SectionHeader,
  Select,
  TableFrame,
  TextArea,
  TextInput,
} from "./ui/components";
import "./data-exchange.css";
interface Props {
  realm: TenantRealm;
  churchId: string;
  principalKey: string;
  capabilities: string[];
  filters: Record<string, string>;
  filterSummary: string;
  pending: TenantIntent | null;
  onPending: (i: TenantIntent | null) => void;
  onAuthError: (e: unknown) => void;
  onChanged: () => void;
}
interface JobList {
  items: { id: string; source: string; state: string; processed: number; createdAt: string }[];
  nextCursor: string | null;
}
const states = {
  review: "Cần đối chiếu",
  ready: "Sẵn sàng",
  partial: "Đã ghi một phần",
  completed: "Hoàn tất",
};
const actionLabels = {
  create: "Tạo mới",
  link: "Liên kết mã nguồn",
  skip: "Bỏ qua",
  review: "Cần đối chiếu",
  error: "Lỗi",
};
export function DataExchangePanel(props: Props) {
  const {
      realm,
      churchId,
      principalKey,
      capabilities,
      pending,
      onPending,
      onAuthError,
      onChanged,
    } = props,
    base = `${realm === "owner" ? "owner/" : ""}churches/${churchId}/data-exchange`;
  const canImport = capabilities.includes("data:import"),
    canExport = capabilities.includes("data:export");
  const [mode, setMode] = useState<"import" | "export" | null>(
      pending?.path.startsWith(base) ? "import" : null,
    ),
    [job, setJob] = useState<ImportDto | null>(null),
    [rows, setRows] = useState<ReviewPage | null>(null),
    [jobs, setJobs] = useState<JobList>({ items: [], nextCursor: null }),
    [source, setSource] = useState(""),
    [file, setFile] = useState<File | null>(null),
    [mapping, setMapping] = useState<Partial<Record<ImportField, string>>>({}),
    [decisions, setDecisions] = useState<Record<string, Decision>>({}),
    [inspecting, setInspecting] = useState<RowReview | null>(null),
    [decision, setDecision] = useState<Decision>({ action: "skip", reason: "" }),
    [consent, setConsent] = useState(false),
    [autoRun, setAutoRun] = useState(false),
    [readBusy, setReadBusy] = useState(false),
    [format, setFormat] = useState<FileFormat>("xlsx"),
    [columns, setColumns] = useState<string[]>([
      "code",
      "fullName",
      "type",
      "membership",
      "participation",
      "familyCode",
      "area",
      "ministries",
    ]),
    [preview, setPreview] = useState<{ count: number; asOf: string; previewToken: string } | null>(
      null,
    ),
    [exported, setExported] = useState<ExportDto | null>(null);
  const mounted = useRef(true),
    readGeneration = useRef(0);
  const mutation = useTenantMutation({
    realm,
    churchId,
    principalKey,
    canWrite: canImport || canExport,
    pending,
    onPending,
    onAuthError,
    operationPath: `${base}/operations`,
    prefix: base,
    onSuccess: (data) => {
      const r = data as { importId?: string; export?: ExportDto };
      if (r.importId) {
        void loadJob(r.importId);
        onChanged();
      }
      if (r.export) {
        setMode("export");
        setExported(r.export);
        setPreview(null);
      }
    },
  });
  const { busy, error, notice, fail, setError } = mutation,
    locked = busy || readBusy || !!pending,
    currentPending = pending?.path.startsWith(`${base}/`) ? pending : null;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      readGeneration.current++;
    };
  }, []);
  useEffect(() => {
    setPreview(null);
    setExported(null);
  }, [JSON.stringify(props.filters)]);
  async function read<T>(work: () => Promise<T>) {
    if (readBusy) return;
    setReadBusy(true);
    setError("");
    try {
      return await work();
    } catch (e) {
      if (mounted.current) fail(e);
    } finally {
      if (mounted.current) setReadBusy(false);
    }
  }
  async function loadJobs(cursor?: string) {
    return read(async () => {
      const r = await tenantRequest<JobList>(
        realm,
        `${base}/imports${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
      );
      if (mounted.current)
        setJobs((old) =>
          cursor
            ? { items: [...old.items, ...r.data.items], nextCursor: r.data.nextCursor }
            : r.data,
        );
    });
  }
  async function loadJob(id: string, offset = 0) {
    const generation = ++readGeneration.current;
    setReadBusy(true);
    setError("");
    try {
      const j = await tenantRequest<ImportDto>(realm, `${base}/imports/${id}`),
        r = j.data.selectedSheet
          ? await tenantRequest<ReviewPage>(
              realm,
              `${base}/imports/${id}/rows?offset=${offset}&limit=25`,
            )
          : null;
      if (!mounted.current || readGeneration.current !== generation) return;
      setJob(j.data);
      setRows(r?.data ?? null);
      setMapping(j.data.mapping);
      setDecisions({});
      setInspecting(null);
      setMode("import");
      if (j.data.state === "completed") setAutoRun(false);
    } catch (e) {
      setAutoRun(false);
      if (mounted.current) fail(e);
    } finally {
      if (mounted.current && readGeneration.current === generation) setReadBusy(false);
    }
  }
  useEffect(() => {
    if (autoRun && !locked && job && job.planToken && job.state !== "completed") {
      mutation.send(
        `${base}/imports/${job.id}/batches`,
        "POST",
        { token: job.planToken, nextBatch: job.nextBatch, consent: true },
        job.version,
      );
    }
  }, [autoRun, locked, job?.version]);
  useEffect(() => {
    if (error) setAutoRun(false);
  }, [error]);
  function openMode(next: "import" | "export") {
    setMode(next);
    setError("");
    if (next === "import") void loadJobs();
  }
  async function download(path: string) {
    await read(() => downloadFile(path));
  }
  const exportBody = () => ({ filters: props.filters, columns, format });
  const pendingMatches = !!currentPending && currentPending.principalKey === principalKey;
  return (
    <div className="exchange-section">
      <div className="members-actions">
        {canImport && (
          <Button disabled={locked} onClick={() => openMode("import")}>
            Nhập dữ liệu
          </Button>
        )}
        {canExport && (
          <Button disabled={locked} onClick={() => openMode("export")}>
            Xuất dữ liệu
          </Button>
        )}
      </div>
      {(mode || currentPending) && (
        <Card>
          <SectionHeader
            title={mode === "export" ? "Xuất dữ liệu thuộc viên" : "Nhập dữ liệu thuộc viên"}
          >
            <Button
              disabled={locked}
              onClick={() => {
                setMode(null);
                setAutoRun(false);
              }}
            >
              Đóng
            </Button>
          </SectionHeader>
          <div className="exchange-section">
            {error && <Feedback tone="error">{error}</Feedback>}
            {notice && <Feedback>{notice}</Feedback>}
            {currentPending && (
              <Feedback tone="warning">
                <div className="exchange-section">
                  <p>Thao tác chưa được đối soát. Kiểm tra kết quả trước khi thử hoặc rời trang.</p>
                  {!pendingMatches && <p>Phiên hiện tại không khớp người đã tạo thao tác.</p>}
                  <Button
                    disabled={busy || readBusy || !pendingMatches}
                    onClick={() => void mutation.execute(currentPending, true)}
                  >
                    Kiểm tra kết quả nhập/xuất
                  </Button>
                </div>
              </Feedback>
            )}
            {readBusy && <Loading />}
            {mode === "import" && canImport && (
              <>
                <p>Chọn file → Đối chiếu cột → Xử lý dòng → Xác nhận → Kết quả</p>
                <Feedback>
                  CSV UTF-8 hoặc Excel .xlsx · tối đa 1.000 dòng, 5 MiB. Ngày YYYY-MM-DD; mã và điện
                  thoại dạng text. Ban ngành: mỗi tên một dòng. Dùng các giá trị enum trong hướng
                  dẫn mẫu bên dưới.
                </Feedback>
                <div className="exchange-grid">
                  <Field
                    label="Nguồn dữ liệu"
                    hint="Giữ cùng tên nguồn khi nhập lại để chống trùng."
                  >
                    <TextInput
                      value={source}
                      maxLength={100}
                      disabled={locked}
                      onChange={(e) => setSource(e.target.value)}
                    />
                  </Field>
                  <Field label="File CSV/XLSX">
                    <TextInput
                      type="file"
                      accept=".csv,.xlsx"
                      disabled={locked}
                      onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                    />
                  </Field>
                </div>
                <DialogActions>
                  <Button
                    disabled={locked}
                    onClick={() => void download(`${base}/templates?format=csv`)}
                  >
                    Tải mẫu CSV
                  </Button>
                  <Button
                    disabled={locked}
                    onClick={() => void download(`${base}/templates?format=xlsx`)}
                  >
                    Tải mẫu XLSX
                  </Button>
                  <Button
                    variant="primary"
                    disabled={locked || !source.trim() || !file}
                    onClick={() => {
                      if (!file) return;
                      const format = file.name.toLowerCase().endsWith(".xlsx") ? "xlsx" : "csv";
                      if (file.size > 5 * 1024 * 1024) {
                        setError("File tối đa 5 MiB.");
                        return;
                      }
                      setAutoRun(false);
                      setConsent(false);
                      void mutation.execute({
                        realm,
                        churchId,
                        principalKey,
                        path: `${base}/imports`,
                        method: "POST",
                        body: {},
                        upload: { file, format, source: source.trim() },
                        key: crypto.randomUUID(),
                        createdAt: Date.now(),
                      });
                    }}
                  >
                    Kiểm tra file
                  </Button>
                </DialogActions>
                <details>
                  <summary>Hướng dẫn mẫu nhập</summary>
                  <div className="exchange-section">
                    <p>
                      Mẫu chứa một hồ sơ synthetic. Thay dòng mẫu trước khi nhập. externalId là mã
                      ổn định trong nguồn, không phải mã thuộc viên do hệ thống cấp.
                    </p>
                    <p>
                      type: believer / visitor. membership (believer): member / preparatory / child;
                      visitor để trống. gender: male / female / unknown. householdRole: head /
                      spouse / child / relative / other.
                    </p>
                    <p>
                      consent: true khi đã có căn cứ đồng ý; participation: active. baptismStatus:
                      unknown / not_baptized / baptized. visitorStage: new / exploring / believed.
                      assignmentMode: auto / manual; auto để trống ageMinistries.
                    </p>
                    <p>
                      Gắn hộ cũ bằng familyCode; tạo hộ mới bằng familyKey chung với metadata giống
                      nhau, tối đa một head. Không ghi đè hồ sơ/hộ hiện hữu. Chuyển trạng thái hoặc
                      gia đình dùng màn nghiệp vụ tương ứng.
                    </p>
                  </div>
                </details>
                <details>
                  <summary>Phiên nhập của tôi trong 24 giờ</summary>
                  <div className="exchange-section">
                    {jobs.items.map((j) => (
                      <div className="exchange-job" key={j.id}>
                        <span>
                          {j.source} · {states[j.state as keyof typeof states] ?? j.state} · đã đối
                          soát {j.processed} dòng
                        </span>
                        <Button
                          disabled={locked}
                          onClick={() => {
                            setAutoRun(false);
                            setConsent(false);
                            void loadJob(j.id);
                          }}
                        >
                          Mở phiên
                        </Button>
                      </div>
                    ))}
                    {!jobs.items.length && <p>Chưa có phiên nhập còn hạn.</p>}
                    {jobs.nextCursor && (
                      <Button
                        disabled={locked}
                        onClick={() => void loadJobs(jobs.nextCursor ?? undefined)}
                      >
                        Tải thêm phiên
                      </Button>
                    )}
                  </div>
                </details>
                {job && (
                  <>
                    <SectionHeader title={`Nguồn: ${job.source}`}>
                      <Badge>{states[job.state]}</Badge>
                    </SectionHeader>
                    <p>
                      Đã đối soát {job.processed}/{job.total} dòng · Hết hạn{" "}
                      {new Date(job.expiresAt).toLocaleString("vi-VN")}
                    </p>
                    {job.lastError && (
                      <Feedback tone="warning">
                        Lô vừa thử chưa được ghi. Giữ các lô đã hoàn tất; kiểm tra lại phần còn lại.
                      </Feedback>
                    )}
                    {!job.processed && job.state !== "completed" && (
                      <>
                        <Field label="Sheet dữ liệu">
                          <Select
                            value={job.selectedSheet ?? ""}
                            disabled={locked}
                            onChange={(e) => {
                              if (e.target.value)
                                mutation.send(
                                  `${base}/imports/${job.id}`,
                                  "PATCH",
                                  { selectedSheet: e.target.value },
                                  job.version,
                                );
                            }}
                          >
                            <option value="">Chọn sheet</option>
                            {job.sheets.map((s) => (
                              <option key={s}>{s}</option>
                            ))}
                          </Select>
                        </Field>
                        {job.selectedSheet && (
                          <details>
                            <summary>Đối chiếu cột</summary>
                            <div className="exchange-section">
                              <div className="exchange-grid">
                                {importFields.map((f) => (
                                  <Field key={f} label={fieldLabels[f]}>
                                    <Select
                                      disabled={locked}
                                      value={mapping[f] ?? ""}
                                      onChange={(e) =>
                                        setMapping((old) => {
                                          const next = { ...old };
                                          if (e.target.value) next[f] = e.target.value;
                                          else delete next[f];
                                          return next;
                                        })
                                      }
                                    >
                                      <option value="">Không ánh xạ</option>
                                      {job.headers.map((h) => (
                                        <option key={h}>{h}</option>
                                      ))}
                                    </Select>
                                  </Field>
                                ))}
                              </div>
                              <Button
                                disabled={locked}
                                onClick={() =>
                                  mutation.send(
                                    `${base}/imports/${job.id}`,
                                    "PATCH",
                                    { mapping },
                                    job.version,
                                  )
                                }
                              >
                                Lưu ánh xạ và kiểm tra
                              </Button>
                            </div>
                          </details>
                        )}
                      </>
                    )}
                    {rows && (
                      <>
                        <p>
                          Mới {rows.counts.create ?? 0} · Liên kết {rows.counts.link ?? 0} · Bỏ qua{" "}
                          {rows.counts.skip ?? 0} · Cần đối chiếu {rows.counts.review ?? 0} · Lỗi{" "}
                          {rows.counts.error ?? 0} (phần chưa ghi)
                        </p>
                        <TableFrame label="Đối soát từng dòng nhập">
                          <table className="exchange-table">
                            <thead>
                              <tr>
                                <th>Dòng</th>
                                <th>Mã nguồn</th>
                                <th>Họ tên</th>
                                <th>Kết quả</th>
                                <th>Quyết định</th>
                              </tr>
                            </thead>
                            <tbody>
                              {rows.items.map((r) => (
                                <tr key={r.row}>
                                  <td>{r.row}</td>
                                  <td>{r.externalId || "—"}</td>
                                  <td>{r.fullName || "—"}</td>
                                  <td>
                                    <div className="exchange-cell">
                                      <strong>
                                        {r.outcome
                                          ? {
                                              created: "Đã tạo",
                                              linked: "Đã liên kết",
                                              skipped: "Đã bỏ qua",
                                            }[r.outcome.action]
                                          : actionLabels[r.action]}
                                      </strong>
                                      {r.errors.map((e) => (
                                        <span key={e}>{e}</span>
                                      ))}
                                      {r.warnings.map((w) => (
                                        <span key={w}>{w}</span>
                                      ))}
                                    </div>
                                  </td>
                                  <td>
                                    {job.state !== "completed" && (
                                      <Button
                                        disabled={locked || !!r.outcome}
                                        onClick={() => {
                                          setInspecting(r);
                                          setDecision(
                                            decisions[String(r.row)] ??
                                              job.decisions[String(r.row)] ?? {
                                                action: r.action === "create" ? "create" : "skip",
                                                reason: "",
                                              },
                                          );
                                        }}
                                      >
                                        Đối chiếu dòng {r.row}
                                      </Button>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </TableFrame>
                        <DialogActions>
                          <Button
                            disabled={locked || rows.offset === 0}
                            onClick={() => void loadJob(job.id, Math.max(0, rows.offset - 25))}
                          >
                            Trang trước
                          </Button>
                          <span>
                            {rows.offset + 1}–{Math.min(rows.offset + 25, rows.total)} /{" "}
                            {rows.total}
                          </span>
                          <Button
                            disabled={locked || rows.nextOffset === null}
                            onClick={() => void loadJob(job.id, rows.nextOffset ?? 0)}
                          >
                            Trang sau
                          </Button>
                        </DialogActions>
                      </>
                    )}
                    {inspecting && (
                      <Card>
                        <SectionHeader title={`Đối chiếu dòng ${inspecting.row}`} />
                        <div className="exchange-section">
                          <p>
                            {inspecting.fullName} · {inspecting.externalId}
                          </p>
                          <Field label="Quyết định">
                            <Select
                              disabled={locked}
                              value={decision.action}
                              onChange={(e) =>
                                setDecision({
                                  ...decision,
                                  action: e.target.value as Decision["action"],
                                })
                              }
                            >
                              <option value="skip">Bỏ qua</option>
                              <option value="create">Tạo mới sau đối chiếu</option>
                              <option value="link">Liên kết hồ sơ đã có</option>
                            </Select>
                          </Field>
                          {inspecting.candidates.map((c) => (
                            <div className="exchange-job" key={c.id}>
                              <span>
                                {c.code} · {c.fullName} · {c.birthDate ?? "Chưa rõ ngày sinh"} ·{" "}
                                {c.phone ?? "Chưa có điện thoại"}
                              </span>
                              <Button
                                disabled={locked}
                                onClick={() =>
                                  setDecision({ ...decision, action: "link", memberCode: c.code })
                                }
                              >
                                Chọn {c.code}
                              </Button>
                            </div>
                          ))}
                          {decision.action === "link" && (
                            <Field label="Mã thuộc viên cần liên kết">
                              <TextInput
                                disabled={locked}
                                value={decision.memberCode ?? ""}
                                onChange={(e) =>
                                  setDecision({ ...decision, memberCode: e.target.value })
                                }
                              />
                            </Field>
                          )}
                          <Field label="Lý do đối chiếu">
                            <TextArea
                              maxLength={500}
                              disabled={locked}
                              value={decision.reason}
                              onChange={(e) => setDecision({ ...decision, reason: e.target.value })}
                            />
                          </Field>
                          <DialogActions>
                            <Button disabled={locked} onClick={() => setInspecting(null)}>
                              Hủy đối chiếu
                            </Button>
                            <Button
                              disabled={locked}
                              onClick={() =>
                                mutation.send(
                                  `${base}/imports/${job.id}`,
                                  "PATCH",
                                  { decisions: { [inspecting.row]: decision } },
                                  job.version,
                                )
                              }
                            >
                              Lưu quyết định
                            </Button>
                          </DialogActions>
                        </div>
                      </Card>
                    )}
                    {job.state !== "completed" && (
                      <>
                        <Feedback>
                          Không cập nhật hồ sơ hiện hữu. Mỗi lô tối đa 100 dòng; nếu dừng, các lô đã
                          ghi được giữ lại. Dòng lỗi cần sửa file hoặc chủ động bỏ qua.
                        </Feedback>
                        {!job.planToken && (
                          <Button
                            disabled={locked || !job.selectedSheet}
                            onClick={() => {
                              setConsent(false);
                              mutation.send(
                                `${base}/imports/${job.id}/prepare`,
                                "POST",
                                {},
                                job.version,
                              );
                            }}
                          >
                            Xem trước phần chưa ghi
                          </Button>
                        )}
                        {job.planToken && (
                          <div className="exchange-section">
                            <p>
                              Sẽ tạo {job.counts.create ?? 0}, liên kết {job.counts.link ?? 0}, bỏ
                              qua {job.counts.skip ?? 0} dòng còn lại.
                            </p>
                            <Choice
                              label="Xác nhận nguồn và căn cứ đồng ý xử lý dữ liệu"
                              checked={consent}
                              disabled={locked}
                              onChange={(e) => setConsent(e.target.checked)}
                            />
                            <DialogActions>
                              <Button
                                disabled={locked || !consent || autoRun}
                                variant="primary"
                                onClick={() => setAutoRun(true)}
                              >
                                Xác nhận nhập phần còn lại
                              </Button>
                              <Button disabled={!autoRun} onClick={() => setAutoRun(false)}>
                                Dừng sau lô hiện tại
                              </Button>
                            </DialogActions>
                          </div>
                        )}
                      </>
                    )}
                    <DialogActions>
                      <Button
                        disabled={locked}
                        onClick={() => {
                          setAutoRun(false);
                          void loadJob(job.id, rows?.offset ?? 0);
                        }}
                      >
                        Tải lại đối soát
                      </Button>
                      <Button
                        disabled={locked}
                        onClick={() =>
                          void download(`${base}/imports/${job.id}/reconciliation?format=xlsx`)
                        }
                      >
                        Tải đối soát XLSX
                      </Button>
                      <Button
                        disabled={locked}
                        onClick={() =>
                          void download(`${base}/imports/${job.id}/reconciliation?format=csv`)
                        }
                      >
                        Tải đối soát CSV
                      </Button>
                    </DialogActions>
                  </>
                )}
              </>
            )}
            {mode === "export" && canExport && (
              <>
                <p>
                  Áp dụng bộ lọc hiện tại trên server, tối đa 5.000 hồ sơ và 5 MiB. Không chỉ xuất
                  trang đang hiển thị.
                </p>
                <p>Bộ lọc: {props.filterSummary || "Mặc định danh sách hiện tại"}</p>
                <Field label="Định dạng xuất">
                  <Select
                    value={format}
                    disabled={locked}
                    onChange={(e) => {
                      setFormat(e.target.value as FileFormat);
                      setPreview(null);
                      setExported(null);
                    }}
                  >
                    <option value="xlsx">Excel .xlsx</option>
                    <option value="csv">CSV UTF-8</option>
                  </Select>
                </Field>
                <fieldset disabled={locked}>
                  <legend>Cột xuất</legend>
                  <div className="exchange-grid">
                    {exportColumns.map((c) => (
                      <Choice
                        key={c}
                        label={exportLabels[c]}
                        checked={columns.includes(c)}
                        onChange={(e) => {
                          setColumns((old) =>
                            e.target.checked ? [...old, c] : old.filter((x) => x !== c),
                          );
                          setPreview(null);
                          setExported(null);
                        }}
                      />
                    ))}
                  </div>
                </fieldset>
                {format === "csv" && (
                  <Feedback tone="warning">
                    CSV có thể cần thêm dấu nháy đơn để bảo vệ ô giống công thức. Phần mềm bảng tính
                    có thể đổi mã/điện thoại hoặc cách hiểu CSV; ưu tiên XLSX để giữ ô text. Không
                    tự bỏ prefix khi nhập lại.
                  </Feedback>
                )}
                <Button
                  disabled={locked || !columns.length}
                  onClick={() =>
                    void read(async () => {
                      const r = await tenantRequest<{
                        count: number;
                        asOf: string;
                        previewToken: string;
                      }>(realm, `${base}/exports/preview`, { method: "POST", body: exportBody() });
                      setPreview(r.data);
                      setExported(null);
                    })
                  }
                >
                  Xem trước xuất
                </Button>
                {preview && (
                  <div className="exchange-section">
                    <p>
                      {preview.count} hồ sơ · {columns.length} cột ·{" "}
                      {new Date(preview.asOf).toLocaleString("vi-VN")}. Nếu dữ liệu thay đổi, cần
                      xem trước lại.
                    </p>
                    <Button
                      disabled={locked}
                      variant="primary"
                      onClick={() =>
                        mutation.send(`${base}/exports`, "POST", {
                          ...exportBody(),
                          previewToken: preview.previewToken,
                        })
                      }
                    >
                      Tạo file
                    </Button>
                  </div>
                )}
                {exported && (
                  <div className="exchange-section">
                    <Feedback>
                      Đã tạo file cố định: {exported.count} hồ sơ. Hết hạn{" "}
                      {new Date(exported.expiresAt).toLocaleString("vi-VN")}.
                    </Feedback>
                    {exported.protectedCells > 0 && (
                      <Feedback tone="warning">
                        Đã thêm prefix bảo vệ cho {exported.protectedCells} ô CSV.
                      </Feedback>
                    )}
                    <p>
                      SHA-256: <span className="exchange-hash">{exported.digest}</span>
                    </p>
                    <Button
                      disabled={locked}
                      onClick={() => void download(`${base}/exports/${exported.id}/download`)}
                    >
                      Tải {exported.format.toUpperCase()}
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
