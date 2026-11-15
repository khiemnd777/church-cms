import { useEffect, useRef, useState } from "react";
import { businessDay, validDay } from "../api/members/dates";
import type { ProgramCommand, ProgramRow } from "../api/programs/validation";
import { ApiError } from "./api";
import {
  type Program,
  type ProgramEditions,
  type ProgramHistory,
  type ProgramOccurrences,
  type ProgramPage,
  type ProgramPeople,
  type ProgramPreview,
  type ProgramUnits,
  programEvents,
} from "./programs-api";
import { ProgramEditor, ProgramRows } from "./programs-editor";
import { scheduleDate } from "./scheduling-api";
import {
  type TenantIntent,
  type TenantRealm,
  tenantRequest,
  useTenantMutation,
} from "./tenant-mutation";
import {
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
  Select,
  TextArea,
  TextInput,
  Toolbar,
} from "./ui/components";
import "./programs.css";
type Props = {
  realm: TenantRealm;
  churchId: string;
  pending: TenantIntent | null;
  onPending: (i: TenantIntent | null) => void;
  onAuthError: (e: unknown) => void;
  refreshKey?: number;
};
const command = (action: ProgramCommand["action"]): ProgramCommand => ({
  action,
  unitId: null,
  occurrenceId: null,
  rows: null,
  reason: null,
  preview: null,
  incompleteConfirmed: false,
});
export function ProgramsView(props: Props) {
  const query = new URLSearchParams(location.search);
  const [unit, setUnit] = useState(query.get("programUnit") ?? ""),
    [occurrence, setOccurrence] = useState(query.get("programOccurrence") ?? ""),
    [from, setFrom] = useState(
      query.get("programFrom") && validDay(query.get("programFrom") as string)
        ? (query.get("programFrom") as string)
        : businessDay(),
    ),
    [programId, setProgramId] = useState(query.get("programId") ?? ""),
    [revision, setRevision] = useState(query.get("programRevision") ?? ""),
    [units, setUnits] = useState<ProgramUnits | null>(null),
    [occurrences, setOccurrences] = useState<ProgramOccurrences | null>(null),
    [page, setPage] = useState<ProgramPage | null>(null),
    [doc, setDoc] = useState<Program | null>(null),
    [editions, setEditions] = useState<ProgramEditions | null>(null),
    [history, setHistory] = useState<ProgramHistory | null>(null),
    [rows, setRows] = useState<ProgramRow[]>([]),
    [people, setPeople] = useState<ProgramPeople | null>(null),
    [term, setTerm] = useState(""),
    [peopleCursor, setPeopleCursor] = useState<string | null>(null),
    [listCursor, setListCursor] = useState<string | null>(null),
    [reload, setReload] = useState(0),
    [loading, setLoading] = useState(false),
    [reason, setReason] = useState(""),
    [preview, setPreview] = useState<ProgramPreview | null>(null),
    [intent, setIntent] = useState<ProgramCommand | null>(null),
    [incomplete, setIncomplete] = useState(false);
  const prefix = `${props.realm === "owner" ? "owner/" : ""}churches/${props.churchId}/programs`,
    ownPending = props.pending?.path.startsWith(`${prefix}/`) ?? false,
    dirty = !!doc && JSON.stringify(rows) !== JSON.stringify(doc.rows),
    requestRef = useRef(0);
  const mutation = useTenantMutation({
    ...props,
    principalKey: page?.principalKey ?? "",
    canWrite: page?.canManage ?? false,
    operationPath: `${prefix}/operations`,
    prefix,
    onSuccess: (data) => {
      const result = data as { programId: string };
      setPreview(null);
      setIntent(null);
      setReason("");
      setRevision("");
      setProgramId(result.programId);
      setListCursor(null);
      setReload((n) => n + 1);
    },
  });
  const busy = loading || mutation.busy || !!props.pending,
    edition = editions?.items.find((e) => String(e.revision) === revision) ?? null,
    display = revision ? edition : doc;
  function chooseUnit(value: string) {
    if (busy || dirty) return;
    setUnit(value);
    setOccurrence("");
    setProgramId("");
    setDoc(null);
    setRows([]);
    setHistory(null);
    setRevision("");
    setListCursor(null);
    setPeopleCursor(null);
  }
  function chooseOccurrence(value: string) {
    if (busy || dirty) return;
    setOccurrence(value);
    setProgramId("");
    setDoc(null);
    setRows([]);
    setHistory(null);
    setRevision("");
    setListCursor(null);
    setPeopleCursor(null);
  }
  useEffect(() => {
    const u = new URL(location.href);
    for (const [k, v] of Object.entries({
      programUnit: unit,
      programOccurrence: occurrence,
      programFrom: from,
      programId,
      programRevision: revision,
    })) {
      if (v) u.searchParams.set(k, v);
      else u.searchParams.delete(k);
    }
    window.history.replaceState(null, "", u);
  }, [unit, occurrence, from, programId, revision]);
  useEffect(() => {
    const a = new AbortController();
    void tenantRequest<ProgramUnits>(props.realm, `${prefix}/units`, { signal: a.signal })
      .then((r) => {
        if (!a.signal.aborted) setUnits(r.data);
      })
      .catch((e) => {
        if (!a.signal.aborted) mutation.fail(e);
      });
    return () => a.abort();
  }, [prefix, props.realm, props.refreshKey, reload]);
  useEffect(() => {
    const a = new AbortController();
    setOccurrences(null);
    if (unit)
      void tenantRequest<ProgramOccurrences>(
        props.realm,
        `${prefix}/occurrences?${new URLSearchParams({ unitId: unit, from })}`,
        { signal: a.signal },
      )
        .then((r) => {
          if (!a.signal.aborted) setOccurrences(r.data);
        })
        .catch((e) => {
          if (!a.signal.aborted) mutation.fail(e);
        });
    return () => a.abort();
  }, [unit, from, prefix, props.realm, props.refreshKey, reload]);
  useEffect(() => {
    const a = new AbortController();
    setLoading(true);
    const q = new URLSearchParams({
      ...(unit ? { unitId: unit } : {}),
      ...(occurrence ? { occurrenceId: occurrence } : {}),
      ...(listCursor ? { cursor: listCursor } : {}),
    });
    void tenantRequest<ProgramPage>(props.realm, `${prefix}/drafts?${q}`, { signal: a.signal })
      .then((r) => {
        if (!a.signal.aborted)
          setPage((old) => ({
            ...r.data,
            items: listCursor
              ? [
                  ...new Map(
                    [...(old?.items ?? []), ...r.data.items].map((d) => [d.id, d]),
                  ).values(),
                ]
              : r.data.items,
          }));
      })
      .catch((e) => {
        if (!a.signal.aborted) {
          setPage(null);
          mutation.fail(e);
        }
      })
      .finally(() => {
        if (!a.signal.aborted) setLoading(false);
      });
    return () => a.abort();
  }, [unit, occurrence, listCursor, prefix, props.realm, reload, props.refreshKey]);
  useEffect(() => {
    const a = new AbortController(),
      seq = ++requestRef.current;
    setDoc(null);
    setEditions(null);
    setHistory(null);
    if (!programId) return;
    setLoading(true);
    void Promise.all([
      tenantRequest<Program>(props.realm, `${prefix}/drafts/${programId}`, { signal: a.signal }),
      tenantRequest<ProgramEditions>(props.realm, `${prefix}/drafts/${programId}/editions`, {
        signal: a.signal,
      }),
    ])
      .then(async ([r, e]) => {
        if (revision && !e.data.items.some((item) => String(item.revision) === revision)) {
          const selected = await tenantRequest<ProgramEditions>(
            props.realm,
            `${prefix}/drafts/${programId}/editions?${new URLSearchParams({ revision })}`,
            { signal: a.signal },
          );
          e.data.items = [
            ...new Map(
              [...e.data.items, ...selected.data.items].map((item) => [item.id, item]),
            ).values(),
          ];
          if (!selected.data.items.length)
            throw new ApiError("NOT_FOUND", "Không tìm thấy bản chốt đã chọn.");
        }
        if (a.signal.aborted || seq !== requestRef.current) return;
        setDoc(r.data);
        setRows(structuredClone(r.data.rows));
        setEditions(e.data);
        setUnit(r.data.unitId);
        setOccurrence(r.data.occurrenceId);
        if (r.data.state === "finalized" && !revision) setRevision(String(r.data.latestRevision));
        if (r.data.state === "draft" && !revision) setRevision("");
      })
      .catch((e) => {
        if (!a.signal.aborted) mutation.fail(e);
      })
      .finally(() => {
        if (!a.signal.aborted) setLoading(false);
      });
    return () => a.abort();
  }, [programId, prefix, props.realm, reload, props.refreshKey]);
  useEffect(() => {
    const a = new AbortController();
    if (!unit || !occurrence || !doc || doc.state !== "draft" || !doc.current.editable) {
      setPeople(null);
      return;
    }
    const timer = setTimeout(() => {
      void tenantRequest<ProgramPeople>(
        props.realm,
        `${prefix}/people?${new URLSearchParams({ unitId: unit, occurrenceId: occurrence, q: term, ...(peopleCursor ? { cursor: peopleCursor } : {}) })}`,
        { signal: a.signal },
      )
        .then((r) => {
          if (!a.signal.aborted)
            setPeople((old) => ({
              ...r.data,
              items: peopleCursor
                ? [
                    ...new Map(
                      [...(old?.items ?? []), ...r.data.items].map((p) => [p.id, p]),
                    ).values(),
                  ]
                : r.data.items,
            }));
        })
        .catch((e) => {
          if (!a.signal.aborted) mutation.fail(e);
        });
    }, 180);
    return () => {
      clearTimeout(timer);
      a.abort();
    };
  }, [unit, occurrence, term, peopleCursor, doc?.id, doc?.version, prefix, props.realm]);
  async function moreUnits() {
    if (!units?.nextCursor) return;
    try {
      const r = await tenantRequest<ProgramUnits>(
        props.realm,
        `${prefix}/units?cursor=${encodeURIComponent(units.nextCursor)}`,
      );
      setUnits({ ...r.data, items: [...units.items, ...r.data.items] });
    } catch (e) {
      mutation.fail(e);
    }
  }
  async function moreOccurrences() {
    if (!occurrences?.nextCursor) return;
    try {
      const r = await tenantRequest<ProgramOccurrences>(
        props.realm,
        `${prefix}/occurrences?${new URLSearchParams({ unitId: unit, from, cursor: occurrences.nextCursor })}`,
      );
      setOccurrences({ ...r.data, items: [...occurrences.items, ...r.data.items] });
    } catch (e) {
      mutation.fail(e);
    }
  }
  async function prepare(action: ProgramCommand["action"]) {
    if (busy) return;
    mutation.setBusy(true);
    mutation.setError("");
    const b = {
      ...command(action),
      reason: reason || null,
      ...(action === "create" ? { unitId: unit, occurrenceId: occurrence } : {}),
      ...(action === "save" ? { rows } : {}),
    };
    try {
      const r = await tenantRequest<ProgramPreview>(
        props.realm,
        `${prefix}/drafts${action === "create" ? "" : `/${doc?.id}`}/preview`,
        {
          method: "POST",
          body: b,
          headers: doc && action !== "create" ? { "If-Match": `"${doc.version}"` } : {},
        },
      );
      setPreview(r.data);
      setIntent(b);
      setIncomplete(false);
    } catch (e) {
      mutation.fail(e);
    } finally {
      mutation.setBusy(false);
    }
  }
  async function viewHistory(cursor: string | null = null) {
    if (!doc || busy) return;
    mutation.setBusy(true);
    try {
      const r = await tenantRequest<ProgramHistory>(
        props.realm,
        `${prefix}/drafts/${doc.id}/history${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
      );
      setHistory((old) => ({
        ...r.data,
        items: cursor ? [...(old?.items ?? []), ...r.data.items] : r.data.items,
      }));
    } catch (e) {
      mutation.fail(e);
    } finally {
      mutation.setBusy(false);
    }
  }
  async function moreEditions() {
    if (!doc || !editions?.nextCursor) return;
    try {
      const r = await tenantRequest<ProgramEditions>(
        props.realm,
        `${prefix}/drafts/${doc.id}/editions?cursor=${encodeURIComponent(editions.nextCursor)}`,
      );
      setEditions({ ...r.data, items: [...editions.items, ...r.data.items] });
    } catch (e) {
      mutation.fail(e);
    }
  }
  function printLink() {
    if (!doc) return "#";
    return `/api/v1/${prefix}/drafts/${doc.id}/print?${new URLSearchParams(edition ? { version: String(edition.revision), revision: String(edition.revision) } : { version: String(doc.version) })}`;
  }
  const reconcile = ownPending && (
    <Feedback tone="warning">
      Thao tác chương trình đang chờ đối soát.{" "}
      <Button
        disabled={mutation.busy}
        onClick={() => void mutation.execute(props.pending as TenantIntent, true)}
      >
        Đối soát chương trình / thử lại cùng yêu cầu
      </Button>
    </Feedback>
  );
  return (
    <Card className="program-section">
      <SectionHeader title="Chương trình sinh hoạt ban" />
      {mutation.error && <Feedback tone="error">{mutation.error}</Feedback>}
      {mutation.notice && <Feedback tone="success">{mutation.notice}</Feedback>}
      {reconcile}
      <Toolbar>
        <Field label="Chọn ban">
          <Select
            disabled={busy || dirty}
            value={unit}
            onChange={(e) => chooseUnit(e.target.value)}
          >
            <option value="">Chọn ban</option>
            {unit && !units?.items.some((u) => u.id === unit) && (
              <option value={unit}>{doc?.snapshot.unitName ?? "Ban đang chọn"}</option>
            )}
            {units?.items.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Select>
        </Field>
        {units?.nextCursor && (
          <Button disabled={busy || dirty} onClick={() => void moreUnits()}>
            Thêm ban
          </Button>
        )}
        <Field label="Buổi từ ngày">
          <TextInput
            disabled={busy || dirty}
            type="date"
            value={from}
            onChange={(e) => {
              if (validDay(e.target.value)) setFrom(e.target.value);
            }}
          />
        </Field>
        <Field label="Chọn buổi">
          <Select
            disabled={busy || dirty || !unit}
            value={occurrence}
            onChange={(e) => chooseOccurrence(e.target.value)}
          >
            <option value="">Chọn buổi đã xếp lịch</option>
            {occurrence && !occurrences?.items.some((o) => o.id === occurrence) && (
              <option value={occurrence}>{doc?.snapshot.label ?? "Buổi đang chọn"}</option>
            )}
            {occurrences?.items.map((o) => (
              <option key={o.id} value={o.id}>
                {scheduleDate(o.startAt)} · {o.label}
              </option>
            ))}
          </Select>
        </Field>
        {occurrences?.nextCursor && (
          <Button disabled={busy || dirty} onClick={() => void moreOccurrences()}>
            Thêm buổi
          </Button>
        )}
      </Toolbar>
      <Field label="Chọn chương trình">
        <Select
          disabled={busy || dirty}
          value={programId}
          onChange={(e) => {
            setProgramId(e.target.value);
            setRevision("");
            setReason("");
          }}
        >
          <option value="">Chọn chương trình đã lưu</option>
          {programId && !page?.items.some((p) => p.id === programId) && (
            <option value={programId}>{doc?.snapshot.label ?? "Chương trình đang chọn"}</option>
          )}
          {page?.items.map((p) => (
            <option key={p.id} value={p.id}>
              {p.snapshot.unitName} · {p.snapshot.label} ·{" "}
              {p.state === "draft" ? "Bản nháp" : `Bản chốt r${p.latestRevision}`}
            </option>
          ))}
        </Select>
      </Field>
      {page?.nextCursor && (
        <PaginationControl loading={busy} onMore={() => setListCursor(page.nextCursor)} />
      )}
      <div className="program-actions">
        <Button
          disabled={
            busy ||
            dirty ||
            !unit ||
            !occurrence ||
            !!doc ||
            page?.items.some((p) => p.unitId === unit && p.occurrenceId === occurrence) ||
            !page?.canManage
          }
          onClick={() => void prepare("create")}
        >
          Tạo nháp chương trình
        </Button>
        <Button
          disabled={busy || dirty}
          onClick={() => {
            setListCursor(null);
            setReload((n) => n + 1);
          }}
        >
          Làm mới chương trình
        </Button>
      </div>
      {dirty && (
        <Feedback tone="warning">
          Có chỉnh sửa chưa lưu. Lưu nháp trước khi đổi chương trình, sinh lại, chốt hoặc in.
        </Feedback>
      )}
      {loading && <Loading />}
      {!loading && !doc && (
        <EmptyState message="Chọn ban/buổi để tạo nháp hoặc mở chương trình đã lưu." />
      )}
      {doc && (
        <>
          <KeyValueList
            items={[
              { label: "Ban", value: doc.snapshot.unitName },
              { label: "Buổi", value: doc.snapshot.label },
              { label: "Ngày giờ nguồn", value: scheduleDate(doc.snapshot.startAt) },
              {
                label: "Trạng thái",
                value: doc.state === "draft" ? "Bản nháp" : `Bản chốt r${doc.latestRevision}`,
              },
              { label: "Roster lúc soạn", value: scheduleDate(doc.snapshot.capturedAt) },
              { label: "Nhiệm kỳ", value: doc.snapshot.termLabel ?? "—" },
            ]}
          />
          {!doc.current.rosterAvailable && (
            <Feedback tone="warning">
              Chưa xác định nhiệm kỳ/roster phù hợp. Đây không phải ban không có thành viên. Chưa
              thể chốt.
            </Feedback>
          )}
          {doc.current.changed && (
            <Feedback tone="warning">
              Nguồn lịch/ban đã thay đổi. Đối soát trong preview trước khi chốt.
            </Feedback>
          )}
          {!doc.current.editable && (
            <Feedback tone="warning">
              Nguồn không còn mở cho chỉnh sửa. Chương trình giữ để xem/in lưu trữ.
            </Feedback>
          )}
          {doc.current.invalidMemberIds.length > 0 && (
            <Feedback tone="warning">
              Có người không còn thuộc roster hợp lệ. Thay hoặc bỏ phân công trước khi chốt mới.
            </Feedback>
          )}
          {editions && editions.items.length > 0 && (
            <Field label="Xem phiên bản">
              <Select
                disabled={busy || dirty}
                value={revision}
                onChange={(e) => setRevision(e.target.value)}
              >
                <option value="">Bản nháp / bản đang lưu</option>
                {editions.items.map((e) => (
                  <option key={e.id} value={e.revision}>
                    Bản chốt r{e.revision} · {scheduleDate(e.createdAt)}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {editions?.nextCursor && (
            <Button disabled={busy} onClick={() => void moreEditions()}>
              Thêm phiên bản
            </Button>
          )}
          {doc.state === "draft" && !revision ? (
            <>
              <Field label="Tìm người trong ban">
                <TextInput
                  disabled={busy || !doc.current.editable}
                  maxLength={100}
                  value={term}
                  onChange={(e) => {
                    setTerm(e.target.value);
                    setPeopleCursor(null);
                  }}
                />
              </Field>
              {people?.nextCursor && (
                <PaginationControl
                  loading={busy}
                  onMore={() => setPeopleCursor(people.nextCursor)}
                />
              )}
              <ProgramEditor
                rows={rows}
                people={people?.items ?? []}
                selected={doc.people}
                invalid={doc.current.invalidMemberIds}
                locked={busy || !doc.current.editable}
                onChange={setRows}
              />
            </>
          ) : (
            display && <ProgramRows rows={display.rows} people={display.people} />
          )}
          <Field label="Lý do chương trình / đính chính">
            <TextArea
              disabled={busy}
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
          <div className="program-actions">
            {doc.state === "draft" ? (
              <>
                <Button
                  disabled={busy || !!revision || !doc.current.editable || !dirty}
                  onClick={() => void prepare("save")}
                >
                  Lưu nháp
                </Button>
                <Button
                  disabled={busy || dirty || !!revision || !doc.current.editable}
                  onClick={() => void prepare("regenerate")}
                >
                  Sinh lại
                </Button>
                <Button
                  variant="primary"
                  disabled={
                    busy ||
                    dirty ||
                    !!revision ||
                    !doc.current.editable ||
                    !doc.current.rosterAvailable ||
                    doc.current.invalidMemberIds.length > 0
                  }
                  onClick={() => void prepare("finalize")}
                >
                  Xem trước chốt
                </Button>
              </>
            ) : (
              <Button
                disabled={busy || !doc.current.editable || !reason}
                onClick={() => void prepare("amend")}
              >
                Tạo nháp đính chính bản mới nhất
              </Button>
            )}
            <Button
              disabled={busy || dirty || (!!revision && !edition)}
              onClick={() => {
                if (!busy && !dirty && (!revision || edition))
                  window.open(printLink(), "_blank", "noopener,noreferrer");
              }}
            >
              {edition ? `In bản chốt r${edition.revision}` : "In nháp"}
            </Button>
            <Button disabled={busy || dirty} onClick={() => void viewHistory()}>
              Lịch sử chương trình
            </Button>
          </div>
          {history && (
            <section className="program-section">
              <h4>Lịch sử chương trình</h4>
              {history.items.map((h) => (
                <details key={h.id}>
                  <summary>
                    {scheduleDate(h.occurredAt)} ·{" "}
                    {programEvents[h.event as keyof typeof programEvents]} ·{" "}
                    {h.reason ?? "Tạo/lưu chương trình"}
                  </summary>
                  <h5>Trước</h5>
                  {h.before ? (
                    <ProgramRows
                      rows={(h.before as Program).rows}
                      people={(h.before as Program).people}
                    />
                  ) : (
                    <span>Chưa có</span>
                  )}
                  <h5>Sau</h5>
                  <ProgramRows
                    rows={(h.after as Program).rows}
                    people={(h.after as Program).people}
                  />
                </details>
              ))}
              {history.nextCursor && (
                <PaginationControl
                  loading={busy}
                  onMore={() => void viewHistory(history.nextCursor)}
                />
              )}
            </section>
          )}
        </>
      )}
      <Modal
        open={!!preview}
        title={preview?.willFinalize ? "Xác nhận chốt chương trình" : "Xem trước chương trình"}
        locked={mutation.busy || ownPending}
        onClose={() => {
          if (!busy) {
            setPreview(null);
            setIntent(null);
          }
        }}
      >
        {mutation.error && <Feedback tone="error">{mutation.error}</Feedback>}
        {reconcile}
        {preview && intent && (
          <div className="program-section">
            <KeyValueList
              items={[
                { label: "Ban", value: preview.snapshot.unitName },
                { label: "Buổi", value: preview.snapshot.label },
                { label: "Ngày giờ", value: scheduleDate(preview.snapshot.startAt) },
                { label: "Thao tác", value: programEvents[preview.action] },
                { label: "Chưa phân công", value: String(preview.incomplete) },
                { label: "Người không còn hợp lệ", value: String(preview.invalidMemberIds.length) },
              ]}
            />
            {!preview.sourceAvailable && (
              <Feedback tone="warning">
                Nguồn roster chưa xác định; nháp chưa đủ điều kiện chốt.
              </Feedback>
            )}
            {preview.before && (
              <details>
                <summary>Bản đang lưu trước thay đổi</summary>
                <ProgramRows rows={preview.before.rows} people={preview.before.people} />
              </details>
            )}
            <ProgramRows rows={preview.rows} people={preview.people} />
            {preview.willFinalize && preview.incomplete > 0 && (
              <Choice
                label={`Tôi xác nhận còn ${preview.incomplete} tiết mục chưa phân công`}
                checked={incomplete}
                disabled={busy}
                onChange={(e) => setIncomplete(e.target.checked)}
              />
            )}
            <DialogActions>
              <Button
                disabled={busy}
                onClick={() => {
                  setPreview(null);
                  setIntent(null);
                }}
              >
                Quay lại
              </Button>
              <Button
                variant="primary"
                disabled={
                  busy ||
                  (preview.willFinalize &&
                    (!preview.sourceAvailable ||
                      preview.invalidMemberIds.length > 0 ||
                      (preview.incomplete > 0 && !incomplete)))
                }
                onClick={() =>
                  mutation.send(
                    `${prefix}/drafts${intent.action === "create" ? "" : `/${doc?.id}`}`,
                    intent.action === "create" ? "POST" : "PATCH",
                    { ...intent, preview: preview.context, incompleteConfirmed: incomplete },
                    intent.action === "create" ? undefined : doc?.version,
                  )
                }
              >
                {preview.willFinalize ? "Chốt phiên bản" : "Xác nhận lưu chương trình"}
              </Button>
            </DialogActions>
          </div>
        )}
      </Modal>
    </Card>
  );
}
