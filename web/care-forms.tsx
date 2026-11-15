import { type FormEvent, useState } from "react";
import type { AlertCommand, SignalCommand } from "../api/care/validation";
import { businessDay } from "../api/members/dates";
import type { NeedRow, SuggestionDetail, SuggestionRow } from "./care-api";
import { needKinds } from "./care-api";
import type { TenantRealm } from "./tenant-mutation";
import { Button, DialogActions, Field, Select, TextArea, TextInput } from "./ui/components";
import { CarePeoplePicker } from "./visitation-form";
export function NeedForm({
  record,
  action,
  realm,
  prefix,
  locked,
  onPreview,
  onCancel,
  onError,
}: {
  record: NeedRow | null;
  action: SignalCommand["action"];
  realm: TenantRealm;
  prefix: string;
  locked: boolean;
  onPreview: (b: SignalCommand) => void;
  onCancel: () => void;
  onError: (e: unknown) => void;
}) {
  const [kind, setKind] = useState<NeedRow["kind"]>(record?.kind ?? "illness"),
    [selected, setSelected] = useState(
      record
        ? [
            {
              id: record.target.id,
              code: record.targetSnapshot.code,
              fullName: record.targetSnapshot.name,
            },
          ]
        : [],
    ),
    [day, setDay] = useState(record?.occurredOn ?? businessDay()),
    [summary, setSummary] = useState(record?.summary ?? ""),
    [reason, setReason] = useState("");
  function submit(e: FormEvent) {
    e.preventDefault();
    if (locked) return;
    const common = { reason: reason.trim() || null, preview: null, confirmed: false },
      fields = { occurredOn: day, summary: summary.trim() || null };
    if (action === "create") {
      if (!selected[0]) return;
      onPreview({
        action,
        kind,
        target: { kind: kind === "bereavement" ? "family" : "member", id: selected[0].id },
        fields,
        ...common,
      });
    } else onPreview(action === "correct" ? { action, fields, ...common } : { action, ...common });
  }
  return (
    <form onSubmit={submit} className="care-section" aria-label="Nguồn nhu cầu chăm sóc">
      <p>
        Nội dung nguồn dùng chung cho Owner, Mục sư và Thư ký có quyền chăm sóc. Chỉ ghi ngày đã
        biết; ngày tin Chúa không được thay bằng ngày nhập.
      </p>
      <Field label="Loại nhu cầu">
        <Select
          disabled={locked || !!record}
          value={kind}
          onChange={(e) => {
            const next = e.target.value as typeof kind;
            if ((next === "bereavement") !== (kind === "bereavement")) setSelected([]);
            setKind(next);
            setDay(next === "new_believer" ? "" : businessDay());
          }}
        >
          {(["illness", "new_believer", "bereavement"] as const).map((k) => (
            <option key={k} value={k}>
              {needKinds[k]}
            </option>
          ))}
        </Select>
      </Field>
      {action === "create" ? (
        <CarePeoplePicker
          realm={realm}
          prefix={prefix}
          kind={kind === "bereavement" ? "family" : "member"}
          label="Đối tượng nhu cầu"
          selected={selected}
          locked={locked}
          onChange={setSelected}
          onError={onError}
        />
      ) : (
        <p>
          {record?.targetSnapshot.name} · {record?.targetSnapshot.code}
        </p>
      )}
      {action !== "end" && (
        <>
          <Field
            label={kind === "new_believer" ? "Ngày tin Chúa đã xác nhận" : "Ngày ghi nhận nhu cầu"}
          >
            <TextInput
              type="date"
              value={day}
              required
              max={businessDay()}
              disabled={locked}
              onChange={(e) => setDay(e.target.value)}
            />
          </Field>
          <Field label="Ghi chú nhu cầu · tùy chọn">
            <TextArea
              rows={3}
              maxLength={500}
              disabled={locked}
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
            />
          </Field>
        </>
      )}
      <Field label={action === "create" ? "Lý do ghi nhận · tùy chọn" : "Lý do thay đổi nguồn"}>
        <TextArea
          required={action !== "create"}
          rows={3}
          maxLength={500}
          value={reason}
          disabled={locked}
          onChange={(e) => setReason(e.target.value)}
        />
      </Field>
      <DialogActions>
        <Button disabled={locked} onClick={onCancel}>
          Hủy
        </Button>
        <Button
          type="submit"
          variant="primary"
          disabled={locked || (action === "create" && !selected.length)}
        >
          Xem trước nguồn
        </Button>
      </DialogActions>
    </form>
  );
}
export function DecisionForm({
  detail,
  action,
  realm,
  prefix,
  locked,
  onPreview,
  onCancel,
  onError,
}: {
  detail: SuggestionDetail;
  action: AlertCommand["action"];
  realm: TenantRealm;
  prefix: string;
  locked: boolean;
  onPreview: (b: AlertCommand) => void;
  onCancel: () => void;
  onError: (e: unknown) => void;
}) {
  const row = detail.record as SuggestionRow,
    [description, setDescription] = useState(`${needKinds[row.kind]} · ${row.targetSnapshot.name}`),
    [priority, setPriority] = useState<"normal" | "high">("normal"),
    [plannedOn, setPlannedOn] = useState(""),
    [people, setPeople] = useState<{ id: string; code: string; fullName: string }[]>([]),
    [reason, setReason] = useState("");
  function submit(e: FormEvent) {
    e.preventDefault();
    if (locked) return;
    const common = { reason: reason.trim() || null, preview: null, confirmed: false };
    onPreview(
      action === "dismiss"
        ? { action, ...common }
        : {
            action,
            fields: {
              description,
              priority,
              plannedOn: plannedOn || null,
              assigneeId: people[0]?.id ?? null,
            },
            mode: detail.existing ? "link" : "create",
            caseId: detail.existing?.id ?? null,
            caseVersion: detail.existing?.version ?? null,
            ...common,
          },
    );
  }
  return (
    <form onSubmit={submit} className="care-section" aria-label="Quyết định đề nghị chăm sóc">
      <p>
        {row.targetSnapshot.name} · {needKinds[row.kind]}
      </p>
      {action === "convert" &&
        (detail.existing ? (
          <p>
            Đã có hồ sơ đang mở {detail.existing.code}. Xác nhận sẽ liên kết hồ sơ này; thông tin và
            phân công hiện có được giữ nguyên.
          </p>
        ) : (
          <>
            <Field label="Mô tả thăm viếng">
              <TextArea
                rows={4}
                maxLength={2000}
                required
                value={description}
                disabled={locked}
                onChange={(e) => setDescription(e.target.value)}
              />
            </Field>
            <div className="care-grid">
              <Field label="Ưu tiên thăm viếng">
                <Select
                  value={priority}
                  disabled={locked}
                  onChange={(e) => setPriority(e.target.value as typeof priority)}
                >
                  <option value="normal">Thường</option>
                  <option value="high">Cao</option>
                </Select>
              </Field>
              <Field label="Ngày dự kiến thăm · có thể chưa rõ">
                <TextInput
                  type="date"
                  value={plannedOn}
                  disabled={locked}
                  onChange={(e) => setPlannedOn(e.target.value)}
                />
              </Field>
            </div>
            <CarePeoplePicker
              realm={realm}
              prefix={prefix}
              label="Người phụ trách thăm viếng"
              selected={people}
              locked={locked}
              onChange={setPeople}
              onError={onError}
            />
            {!people.length && <p>Chưa phân công. Có thể giao người sau trong hồ sơ thăm viếng.</p>}
          </>
        ))}
      <Field label="Lý do quyết định">
        <TextArea
          rows={3}
          maxLength={500}
          required
          value={reason}
          disabled={locked}
          onChange={(e) => setReason(e.target.value)}
        />
      </Field>
      <DialogActions>
        <Button disabled={locked} onClick={onCancel}>
          Hủy
        </Button>
        <Button type="submit" variant="primary" disabled={locked}>
          Xem trước quyết định
        </Button>
      </DialogActions>
    </form>
  );
}
