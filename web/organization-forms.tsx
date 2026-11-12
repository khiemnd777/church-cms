import { type FormEvent, useState } from "react";
import type { MemberDto } from "./members-api";
import type { RuntimeUnit, Term } from "./organization-runtime-api";
import { positionLabels } from "./organization-runtime-api";
import { type TenantRealm, tenantRequest } from "./tenant-mutation";
import {
  Button,
  DialogActions,
  Feedback,
  Field,
  Select,
  TextArea,
  TextInput,
} from "./ui/components";
export type Person = Pick<MemberDto, "id" | "code" | "fullName" | "version">;
export function PersonPicker({
  base,
  realm,
  eligible,
  locked,
  onPick,
}: {
  base: string;
  realm: TenantRealm;
  eligible?: boolean;
  locked: boolean;
  onPick: (p: Person) => void;
}) {
  const [q, setQ] = useState(""),
    [items, setItems] = useState<Person[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function load(next?: string) {
    setBusy(true);
    setError("");
    try {
      const r = await tenantRequest<{ items: Person[]; nextCursor: string | null }>(
        realm,
        `${base}/members?${new URLSearchParams({ q, ...(eligible ? { type: "believer", membership: "member", participation: "active" } : {}), ...(next ? { cursor: next } : {}) })}`,
      );
      setItems((old) => (next ? [...old, ...r.data.items] : r.data.items));
      setCursor(r.data.nextCursor);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không tải được người.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="organization-runtime-group">
      <div className="organization-runtime-actions">
        <Field label={eligible ? "Tìm thuộc viên chính thức đang sinh hoạt" : "Tìm người"}>
          <TextInput
            maxLength={100}
            value={q}
            disabled={locked || busy}
            onChange={(e) => setQ(e.target.value)}
          />
        </Field>
        <Button disabled={locked || busy} onClick={() => void load()}>
          Tra cứu người
        </Button>
      </div>
      <Field label="Chọn người">
        <Select
          value=""
          disabled={locked || busy}
          onChange={(e) => {
            const p = items.find((p) => p.id === e.target.value);
            if (p) onPick(p);
          }}
        >
          <option value="">Chọn từ kết quả</option>
          {items.map((p) => (
            <option key={p.id} value={p.id}>
              {p.code} · {p.fullName}
            </option>
          ))}
        </Select>
      </Field>
      {cursor && (
        <Button disabled={locked || busy} onClick={() => void load(cursor)}>
          Xem thêm người
        </Button>
      )}
      {error && <Feedback tone="error">{error}</Feedback>}
    </div>
  );
}
export function OrganizationForm({
  kind,
  unit,
  term,
  action,
  base,
  realm,
  today,
  locked,
  error,
  onClose,
  onSubmit,
}: {
  kind: "details" | "term";
  unit?: RuntimeUnit;
  term?: Term;
  action?: string;
  base: string;
  realm: TenantRealm;
  today: string;
  locked: boolean;
  error: string;
  onClose: () => void;
  onSubmit: (body: object) => void;
}) {
  const [label, setLabel] = useState(term?.label ?? ""),
    [start, setStart] = useState(term?.startOn ?? ""),
    [end, setEnd] = useState(term?.endOn ?? ""),
    [leader, setLeader] = useState<{ id: string; fullName: string } | null>(
      unit?.leader ? unit.leader : null,
    ),
    [schedule, setSchedule] = useState(unit?.scheduleText ?? ""),
    [reason, setReason] = useState(""),
    [day, setDay] = useState(today),
    [appointments, setAppointments] = useState(term?.appointments ?? []),
    [position, setPosition] = useState<"secretary" | "treasurer" | "deacon">("deacon"),
    [preview, setPreview] = useState<object | null>(null);
  const personnel = !action || action === "amend",
    terminal = kind === "term" && !personnel;
  function submit(e: FormEvent) {
    e.preventDefault();
    setPreview({
      reason,
      effectiveOn: day,
      ...(kind === "details"
        ? { leaderMemberId: leader?.id ?? null, scheduleText: schedule.trim() || null }
        : terminal
          ? {}
          : {
              label,
              startOn: start || null,
              endOn: end || null,
              appointments: appointments.map((a) => ({
                memberId: a.memberId,
                position: a.position,
              })),
            }),
    });
  }
  return (
    <form className="organization-runtime-form" onSubmit={submit}>
      {!preview && (
        <>
          {kind === "details" ? (
            <>
              <PersonPicker
                base={base}
                realm={realm}
                eligible
                locked={locked}
                onPick={(p) => setLeader(p)}
              />
              <p>Người phụ trách: {leader?.fullName ?? "Chưa giao"}</p>
              <Button disabled={locked} onClick={() => setLeader(null)}>
                Bỏ người phụ trách
              </Button>
              <Field label="Lịch sinh hoạt" optional>
                <TextArea
                  maxLength={500}
                  value={schedule}
                  disabled={locked}
                  onChange={(e) => setSchedule(e.target.value)}
                />
              </Field>
            </>
          ) : (
            !terminal && (
              <>
                <div className="form">
                  <Field label="Nhiệm kỳ">
                    <TextInput
                      required
                      maxLength={100}
                      value={label}
                      disabled={locked || action === "amend"}
                      onChange={(e) => setLabel(e.target.value)}
                    />
                  </Field>
                  <Field label="Từ ngày" optional>
                    <TextInput
                      type="date"
                      value={start}
                      disabled={locked || action === "amend"}
                      onChange={(e) => setStart(e.target.value)}
                    />
                  </Field>
                  <Field label="Đến ngày" optional>
                    <TextInput
                      type="date"
                      value={end}
                      disabled={locked || action === "amend"}
                      onChange={(e) => setEnd(e.target.value)}
                    />
                  </Field>
                </div>
                <Field label="Chức vụ">
                  <Select
                    value={position}
                    disabled={locked}
                    onChange={(e) => setPosition(e.target.value as typeof position)}
                  >
                    {Object.entries(positionLabels).map(([id, name]) => (
                      <option key={id} value={id}>
                        {name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <PersonPicker
                  base={base}
                  realm={realm}
                  eligible
                  locked={locked}
                  onPick={(p) =>
                    setAppointments((old) => [
                      ...old.filter((a) => a.memberId !== p.id),
                      { memberId: p.id, code: p.code, fullName: p.fullName, position },
                    ])
                  }
                />
                {appointments.map((a) => (
                  <div key={a.memberId} className="organization-runtime-actions">
                    <span>
                      {a.fullName} · {positionLabels[a.position]}
                    </span>
                    <Button
                      disabled={locked}
                      onClick={() =>
                        setAppointments((old) => old.filter((p) => p.memberId !== a.memberId))
                      }
                    >
                      Bỏ
                    </Button>
                  </div>
                ))}
              </>
            )
          )}
          <div className="form">
            <Field label="Ngày hiệu lực">
              <TextInput
                required
                type="date"
                max={today}
                value={day}
                disabled={locked || action === "amend"}
                onChange={(e) => setDay(e.target.value)}
              />
            </Field>
            <Field label="Lý do">
              <TextArea
                required
                maxLength={500}
                value={reason}
                disabled={locked}
                onChange={(e) => setReason(e.target.value)}
              />
            </Field>
          </div>
        </>
      )}
      {preview && (
        <div className="organization-runtime-group">
          <p>
            <b>Xem trước · {unit?.name ?? term?.label ?? label}</b>
          </p>
          {kind === "details" ? (
            <>
              <p>
                Người phụ trách: {unit?.leader?.fullName ?? "Chưa giao"} →{" "}
                {leader?.fullName ?? "Chưa giao"}
              </p>
              <p>
                Lịch: {unit?.scheduleText ?? "Chưa có"} → {schedule || "Chưa có"}
              </p>
            </>
          ) : (
            <>
              <p>
                {terminal
                  ? action === "confirm"
                    ? "Xác nhận nhiệm kỳ"
                    : action === "close"
                      ? "Kết thúc nhiệm kỳ"
                      : "Hủy nhiệm kỳ"
                  : `${start || "Chưa rõ"} → ${end || "Chưa rõ"}`}
              </p>
              {appointments.map((a) => (
                <p key={a.memberId}>
                  {a.fullName} · {positionLabels[a.position]}
                </p>
              ))}
            </>
          )}
          <p>
            {day} · {reason}
          </p>
          <Feedback>Chức vụ tổ chức không cấp quyền tài khoản.</Feedback>
        </div>
      )}
      {error && <Feedback tone="error">{error}</Feedback>}
      <DialogActions>
        <Button disabled={locked} onClick={onClose}>
          Hủy
        </Button>
        {preview ? (
          <>
            <Button disabled={locked} onClick={() => setPreview(null)}>
              Sửa lại
            </Button>
            <Button variant="primary" disabled={locked} onClick={() => onSubmit(preview)}>
              Xác nhận
            </Button>
          </>
        ) : (
          <Button variant="primary" type="submit" disabled={locked}>
            Xem trước
          </Button>
        )}
      </DialogActions>
    </form>
  );
}
