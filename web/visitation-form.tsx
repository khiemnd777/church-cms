import { type FormEvent, useEffect, useState } from "react";
import { businessDay } from "../api/members/dates";
import type { VisitPerson } from "../api/visitation/models";
import type { VisitCommand, VisitFields } from "../api/visitation/validation";
import { type TenantRealm, tenantRequest } from "./tenant-mutation";
import {
  Button,
  DialogActions,
  EmptyState,
  Field,
  Loading,
  PaginationControl,
  Select,
  TextArea,
  TextInput,
} from "./ui/components";
import {
  type CareCase,
  type CareEntry,
  type CarePeople,
  careOutcomes,
  careReasons,
} from "./visitation-api";

const reasonCodes = Object.keys(careReasons) as VisitFields["reasonCode"][];
export function CarePeoplePicker({
  realm,
  prefix,
  label,
  kind = "member",
  selected,
  max = 1,
  locked,
  onChange,
  onError,
}: {
  realm: TenantRealm;
  prefix: string;
  label: string;
  kind?: "member" | "family" | null;
  selected: VisitPerson[];
  max?: number;
  locked: boolean;
  onChange: (p: VisitPerson[]) => void;
  onError: (e: unknown) => void;
}) {
  const [term, setTerm] = useState(""),
    [cursor, setCursor] = useState<string | null>(null),
    [data, setData] = useState<CarePeople | null>(null),
    [loading, setLoading] = useState(false);
  useEffect(() => {
    const a = new AbortController();
    setLoading(true);
    void tenantRequest<CarePeople>(
      realm,
      `${prefix}/people?${new URLSearchParams({ ...(kind ? { kind } : {}), q: term, ...(cursor ? { cursor } : {}) })}`,
      { signal: a.signal },
    )
      .then((r) => {
        if (!a.signal.aborted)
          setData((old) => ({
            ...r.data,
            items: cursor
              ? [
                  ...new Map(
                    [...(old?.items ?? []), ...r.data.items].map((p) => [p.id, p]),
                  ).values(),
                ]
              : r.data.items,
          }));
      })
      .catch((e) => {
        if (!a.signal.aborted) onError(e);
      })
      .finally(() => {
        if (!a.signal.aborted) setLoading(false);
      });
    return () => a.abort();
  }, [realm, prefix, kind, term, cursor]);
  return (
    <section className="care-section">
      <Field label={`${label} · tìm tên hoặc mã`}>
        <TextInput
          value={term}
          maxLength={100}
          disabled={locked}
          onChange={(e) => {
            setTerm(e.target.value);
            setCursor(null);
          }}
        />
      </Field>
      <Field label={label}>
        <Select
          value=""
          disabled={locked || loading || (max > 1 && selected.length >= max)}
          onChange={(e) => {
            const p = data?.items.find((p) => p.id === e.target.value);
            if (p) onChange(max === 1 ? [p] : [...selected.filter((s) => s.id !== p.id), p]);
          }}
        >
          <option value="">{kind === "family" ? "Chọn gia đình" : "Chọn người"}</option>
          {data?.items
            .filter((p) => !selected.some((s) => s.id === p.id))
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.fullName} · {p.code}
              </option>
            ))}
        </Select>
      </Field>
      {loading && <Loading />}
      {data && !data.items.length && !loading && (
        <EmptyState message="Chưa có lựa chọn phù hợp trong nguồn hiện tại." />
      )}
      {selected.map((p) => (
        <div key={p.id} className="care-actions">
          <span>
            {p.fullName} · {p.code}
          </span>
          <Button
            disabled={locked}
            onClick={() => onChange(selected.filter((x) => x.id !== p.id))}
            aria-label={`Bỏ ${label}: ${p.fullName}`}
          >
            Bỏ
          </Button>
        </div>
      ))}
      {data?.nextCursor && (
        <PaginationControl loading={loading || locked} onMore={() => setCursor(data.nextCursor)} />
      )}
    </section>
  );
}
export function VisitationForm({
  action,
  record,
  entry,
  realm,
  prefix,
  locked,
  onPreview,
  onCancel,
  onError,
}: {
  action: VisitCommand["action"];
  record: CareCase | null;
  entry?: CareEntry;
  realm: TenantRealm;
  prefix: string;
  locked: boolean;
  onPreview: (b: VisitCommand) => void;
  onCancel: () => void;
  onError: (e: unknown) => void;
}) {
  const [kind, setKind] = useState<"member" | "family">("member"),
    [target, setTarget] = useState<VisitPerson[]>([]),
    [reason, setReason] = useState(""),
    [fields, setFields] = useState<VisitFields>({
      reasonCode: record?.reasonCode ?? "other",
      description: record?.description ?? "",
      priority: record?.priority ?? "normal",
      plannedOn: record?.plannedOn ?? null,
      assigneeId: record?.assigneeId ?? null,
    }),
    [assignee, setAssignee] = useState<VisitPerson[]>(record?.assignee ? [record.assignee] : []),
    [participants, setParticipants] = useState<VisitPerson[]>(
      entry?.participants ??
        (record?.current.assigneeAvailable && record.assignee ? [record.assignee] : []),
    ),
    [visitedOn, setVisitedOn] = useState(entry?.visitedOn ?? businessDay()),
    [outcome, setOutcome] = useState<CareEntry["outcome"]>(entry?.outcome ?? "visited"),
    [note, setNote] = useState(entry?.note ?? "");
  function submit(e: FormEvent) {
    e.preventDefault();
    if (locked) return;
    const common = { reason: reason.trim() || null, preview: null, confirmed: false };
    if (action === "create") {
      if (!target[0]) return;
      onPreview({
        action,
        target: { kind, id: target[0].id },
        fields: { ...fields, assigneeId: assignee[0]?.id ?? null },
        ...common,
      });
    } else if (action === "update")
      onPreview({ action, fields: { ...fields, assigneeId: assignee[0]?.id ?? null }, ...common });
    else if (action === "record" || action === "correct") {
      if (!participants.length) return;
      const body = { visitedOn, participantIds: participants.map((p) => p.id), outcome, note };
      if (action === "record") onPreview({ action, entry: body, ...common });
      else if (entry)
        onPreview({
          action,
          entryId: entry.id,
          entryVersion: entry.version,
          entry: body,
          ...common,
        });
    } else onPreview({ action, ...common });
  }
  const picker = { realm, prefix, locked, onError };
  return (
    <form className="care-section" onSubmit={submit}>
      {action === "create" && (
        <>
          <Field label="Loại đối tượng">
            <Select
              value={kind}
              disabled={locked}
              onChange={(e) => {
                setKind(e.target.value as typeof kind);
                setTarget([]);
              }}
            >
              <option value="member">Thuộc viên / thân hữu</option>
              <option value="family">Gia đình</option>
            </Select>
          </Field>
          <CarePeoplePicker
            {...picker}
            key={kind}
            label="Đối tượng thăm viếng"
            kind={kind}
            selected={target}
            onChange={setTarget}
          />
        </>
      )}
      {(action === "create" || action === "update") && (
        <>
          <div className="care-grid">
            <Field label="Nhóm lý do">
              <Select
                disabled={locked}
                value={fields.reasonCode}
                onChange={(e) =>
                  setFields({ ...fields, reasonCode: e.target.value as VisitFields["reasonCode"] })
                }
              >
                {reasonCodes.map((k) => (
                  <option key={k} value={k}>
                    {careReasons[k]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Ưu tiên">
              <Select
                disabled={locked}
                value={fields.priority}
                onChange={(e) =>
                  setFields({ ...fields, priority: e.target.value as VisitFields["priority"] })
                }
              >
                <option value="normal">Thường</option>
                <option value="high">Cao</option>
              </Select>
            </Field>
          </div>
          <Field label="Mô tả thăm viếng">
            <TextArea
              disabled={locked}
              required
              maxLength={2000}
              value={fields.description}
              onChange={(e) => setFields({ ...fields, description: e.target.value })}
            />
          </Field>
          <Field label="Ngày dự kiến">
            <TextInput
              disabled={locked}
              type="date"
              value={fields.plannedOn ?? ""}
              onChange={(e) => setFields({ ...fields, plannedOn: e.target.value || null })}
            />
          </Field>
          <CarePeoplePicker
            {...picker}
            label="Người phụ trách"
            selected={assignee}
            onChange={setAssignee}
          />
        </>
      )}
      {(action === "record" || action === "correct") && (
        <>
          <div className="care-grid">
            <Field label="Ngày thăm">
              <TextInput
                type="date"
                disabled={locked}
                required
                max={businessDay()}
                value={visitedOn}
                onChange={(e) => setVisitedOn(e.target.value)}
              />
            </Field>
            <Field label="Kết quả lần thăm">
              <Select
                disabled={locked}
                value={outcome}
                onChange={(e) => setOutcome(e.target.value as typeof outcome)}
              >
                {Object.entries(careOutcomes).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <CarePeoplePicker
            {...picker}
            label="Người tham gia"
            max={10}
            selected={participants}
            onChange={setParticipants}
          />
          <Field label="Ghi chú lần thăm">
            <TextArea
              disabled={locked}
              required
              maxLength={2000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
        </>
      )}
      <Field label="Lý do thao tác / đính chính">
        <TextArea
          disabled={locked}
          maxLength={500}
          required={action === "cancel" || action === "correct"}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </Field>
      <DialogActions>
        <Button disabled={locked} onClick={onCancel}>
          Quay lại
        </Button>
        <Button
          type="submit"
          variant="primary"
          disabled={
            locked ||
            (action === "create" && !target.length) ||
            ((action === "record" || action === "correct") && !participants.length)
          }
        >
          Xem trước
        </Button>
      </DialogActions>
    </form>
  );
}
