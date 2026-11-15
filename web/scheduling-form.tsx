import { useEffect, useState } from "react";
import { businessDay, shiftDay } from "../api/members/dates";
import type { ScheduleInput } from "../api/scheduling/validation";
import type { ScheduleCommand, ScheduleRow } from "./scheduling-api";
import { scheduleStates } from "./scheduling-api";
import { type TenantRealm, tenantRequest } from "./tenant-mutation";
import {
  Button,
  Choice,
  DialogActions,
  EmptyState,
  Field,
  Loading,
  PaginationControl,
  Select,
  TextArea,
  TextInput,
} from "./ui/components";
export function SchedulePicker({
  label,
  value,
  chosen,
  onChange,
  realm,
  prefix,
  kind,
  onFail,
}: {
  label: string;
  value: string | null;
  chosen: string | null;
  onChange: (id: string | null) => void;
  realm: TenantRealm;
  prefix: string;
  kind: "people" | "units" | "choir";
  onFail: (e: unknown) => void;
}) {
  const [q, setQ] = useState(""),
    [cursor, setCursor] = useState<string | null>(null),
    [items, setItems] = useState<{ id: string; name?: string; fullName?: string; code?: string }[]>(
      [],
    ),
    [next, setNext] = useState<string | null>(null),
    [loading, setLoading] = useState(false);
  useEffect(() => {
    const a = new AbortController();
    setLoading(true);
    const timer = setTimeout(() => {
      const params = new URLSearchParams({
        ...(kind === "people" ? { q } : kind === "choir" ? { choir: "true" } : {}),
        ...(cursor ? { cursor } : {}),
      });
      void tenantRequest<{ items: typeof items; nextCursor: string | null }>(
        realm,
        `${prefix}/${kind === "people" ? "people" : "units"}?${params}`,
        { signal: a.signal },
      )
        .then((r) => {
          if (!a.signal.aborted) {
            setItems((old) => (cursor ? [...old, ...r.data.items] : r.data.items));
            setNext(r.data.nextCursor);
          }
        })
        .catch((e) => {
          if (!a.signal.aborted) onFail(e);
        })
        .finally(() => {
          if (!a.signal.aborted) setLoading(false);
        });
    }, 180);
    return () => {
      clearTimeout(timer);
      a.abort();
    };
  }, [q, cursor, kind, prefix, realm]);
  return (
    <div className="schedule-section">
      <Field label={label}>
        <Select value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
          <option value="">Chưa phân công / chưa chọn</option>
          {value && !items.some((i) => i.id === value) && (
            <option value={value}>{chosen ?? "Đang giữ lựa chọn"}</option>
          )}
          {items.map((i) => (
            <option key={i.id} value={i.id}>
              {i.fullName ?? i.name}
              {i.code ? ` · ${i.code}` : ""}
            </option>
          ))}
        </Select>
      </Field>
      {kind === "people" && (
        <Field label={`Tìm ${label.toLowerCase()}`}>
          <TextInput
            value={q}
            maxLength={100}
            onChange={(e) => {
              setCursor(null);
              setQ(e.target.value);
            }}
          />
        </Field>
      )}
      {loading && <Loading />}
      {!loading && !items.length && <EmptyState message="Không có lựa chọn phù hợp." />}
      {next && <PaginationControl loading={loading} onMore={() => setCursor(next)} />}
    </div>
  );
}
export function newSchedule(): ScheduleCommand {
  const day = shiftDay(businessDay(), 1);
  return {
    input: {
      label: "",
      kind: "worship",
      scope: "church",
      unitId: null,
      day,
      startTime: "07:30",
      endDay: day,
      endTime: "09:00",
      location: null,
      scripture: null,
      theme: null,
      speaker: null,
      leaderId: null,
      choirId: null,
      communion: false,
      repeat: { kind: "once" },
    },
    state: "draft",
    range: "one",
    reason: null,
    preview: null,
    conflictsConfirmed: false,
    exceptionsConfirmed: false,
  };
}
export function ScheduleForm({
  initial,
  row,
  locked,
  realm,
  prefix,
  onFail,
  onPreview,
}: {
  initial: ScheduleCommand;
  row: ScheduleRow | null;
  locked: boolean;
  realm: TenantRealm;
  prefix: string;
  onFail: (e: unknown) => void;
  onPreview: (b: ScheduleCommand) => void;
}) {
  const [b, setB] = useState(initial),
    i = b.input;
  const input = <K extends keyof ScheduleInput>(key: K, value: ScheduleInput[K]) =>
    setB((old) => ({ ...old, input: { ...old.input, [key]: value } }));
  const field = (key: "label" | "location" | "scripture" | "theme", label: string, max: number) => (
    <Field label={label}>
      <TextInput
        value={i[key] ?? ""}
        maxLength={max}
        required={key === "label"}
        onChange={(e) => input(key, e.target.value || (key === "label" ? "" : null))}
      />
    </Field>
  );
  return (
    <form
      className="schedule-section"
      onSubmit={(e) => {
        e.preventDefault();
        onPreview(b);
      }}
    >
      <fieldset disabled={locked} className="schedule-section">
        <div className="schedule-grid">
          {field("label", "Tên lịch", 200)}
          <Field label="Loại">
            <Select
              value={i.kind}
              onChange={(e) => input("kind", e.target.value as ScheduleInput["kind"])}
            >
              <option value="worship">Thờ phượng</option>
              <option value="activity">Sinh hoạt</option>
            </Select>
          </Field>
          <Field label="Phạm vi">
            <Select
              value={i.scope}
              onChange={(e) =>
                setB((old) => ({
                  ...old,
                  input: { ...old.input, scope: e.target.value as "church" | "unit", unitId: null },
                }))
              }
            >
              <option value="church">Hội Thánh</option>
              <option value="unit">Đơn vị</option>
            </Select>
          </Field>
          {i.scope === "unit" && (
            <SchedulePicker
              label="Đơn vị"
              kind="units"
              value={i.unitId}
              chosen={row?.unitName ?? null}
              onChange={(id) => input("unitId", id)}
              realm={realm}
              prefix={prefix}
              onFail={onFail}
            />
          )}
          <Field label="Ngày bắt đầu">
            <TextInput
              type="date"
              required
              value={i.day}
              onChange={(e) =>
                setB((old) => ({
                  ...old,
                  input: {
                    ...old.input,
                    day: e.target.value,
                    endDay: old.input.endDay === old.input.day ? e.target.value : old.input.endDay,
                  },
                }))
              }
            />
          </Field>
          <Field label="Giờ bắt đầu">
            <TextInput
              type="time"
              required
              value={i.startTime}
              onChange={(e) => input("startTime", e.target.value)}
            />
          </Field>
          <Field label="Ngày kết thúc">
            <TextInput
              type="date"
              required
              value={i.endDay}
              onChange={(e) => input("endDay", e.target.value)}
            />
          </Field>
          <Field label="Giờ kết thúc">
            <TextInput
              type="time"
              required
              value={i.endTime}
              onChange={(e) => input("endTime", e.target.value)}
            />
          </Field>
          {field("location", "Địa điểm", 200)}
          {field("scripture", "Kinh Thánh", 200)}
          {field("theme", "Chủ đề", 500)}
        </div>
        <Field label="Người giảng · nguồn">
          <Select
            value={i.speaker?.source ?? "none"}
            onChange={(e) =>
              input(
                "speaker",
                e.target.value === "member"
                  ? { source: "member", memberId: "" }
                  : e.target.value === "external"
                    ? { source: "external", fullName: "" }
                    : null,
              )
            }
          >
            <option value="none">Chưa phân công</option>
            <option value="member">Hồ sơ Hội Thánh</option>
            <option value="external">Khách</option>
          </Select>
        </Field>
        {i.speaker?.source === "external" && (
          <Field label="Tên người giảng">
            <TextInput
              required
              maxLength={200}
              value={i.speaker.fullName}
              onChange={(e) => input("speaker", { source: "external", fullName: e.target.value })}
            />
          </Field>
        )}
        {i.speaker?.source === "member" && (
          <SchedulePicker
            label="Người giảng"
            value={i.speaker.memberId}
            chosen={row?.speakerName ?? null}
            onChange={(id) => input("speaker", id ? { source: "member", memberId: id } : null)}
            kind="people"
            realm={realm}
            prefix={prefix}
            onFail={onFail}
          />
        )}
        <div className="schedule-grid">
          <SchedulePicker
            label="Người hướng dẫn"
            value={i.leaderId}
            chosen={row?.leaderName ?? null}
            onChange={(id) => input("leaderId", id)}
            kind="people"
            realm={realm}
            prefix={prefix}
            onFail={onFail}
          />
          <SchedulePicker
            label="Ban hát"
            value={i.choirId}
            chosen={row?.choirName ?? null}
            onChange={(id) => input("choirId", id)}
            kind="choir"
            realm={realm}
            prefix={prefix}
            onFail={onFail}
          />
        </div>
        <Choice
          label="Dự kiến Tiệc Thánh"
          checked={i.communion}
          onChange={(e) => input("communion", e.target.checked)}
        />
        {row && (
          <Field label="Áp dụng thay đổi">
            <Select
              value={b.range}
              onChange={(e) =>
                setB((old) => ({ ...old, range: e.target.value as "one" | "future" }))
              }
            >
              <option value="one">Chỉ lần này</option>
              <option value="future">Từ lần này trở đi (theo thứ tự lịch gốc)</option>
            </Select>
          </Field>
        )}
        {(!row || b.range === "future") && (
          <>
            <Field label="Lặp">
              <Select
                value={i.repeat.kind}
                onChange={(e) =>
                  input(
                    "repeat",
                    e.target.value === "once"
                      ? { kind: "once" }
                      : e.target.value === "weekly"
                        ? {
                            kind: "weekly",
                            interval: 1,
                            weekdays: [new Date(`${i.day}T00:00:00Z`).getUTCDay()],
                            until: shiftDay(i.day, 35),
                          }
                        : {
                            kind: "monthly",
                            weekday: 0,
                            ordinals: [2, 4],
                            until: shiftDay(i.day, 90),
                          },
                  )
                }
              >
                <option value="once">Một lần</option>
                <option value="weekly">Hằng tuần</option>
                <option value="monthly">Theo tháng</option>
              </Select>
            </Field>
            {i.repeat.kind !== "once" && (
              <Field label="Lặp đến ngày">
                <TextInput
                  type="date"
                  required
                  value={i.repeat.until}
                  onChange={(e) => {
                    if (i.repeat.kind !== "once")
                      input("repeat", { ...i.repeat, until: e.target.value });
                  }}
                />
              </Field>
            )}
            {i.repeat.kind === "weekly" && (
              <>
                <Field label="Cách số tuần">
                  <TextInput
                    type="number"
                    min={1}
                    max={4}
                    required
                    value={i.repeat.interval}
                    onChange={(e) => {
                      if (i.repeat.kind === "weekly")
                        input("repeat", { ...i.repeat, interval: Number(e.target.value) });
                    }}
                  />
                </Field>
                <div className="schedule-actions">
                  {[
                    "Chúa nhật",
                    "Thứ Hai",
                    "Thứ Ba",
                    "Thứ Tư",
                    "Thứ Năm",
                    "Thứ Sáu",
                    "Thứ Bảy",
                  ].map((d, n) => (
                    <Choice
                      key={d}
                      label={d}
                      checked={i.repeat.kind === "weekly" && i.repeat.weekdays.includes(n)}
                      onChange={(e) => {
                        if (i.repeat.kind === "weekly")
                          input("repeat", {
                            ...i.repeat,
                            weekdays: e.target.checked
                              ? [...i.repeat.weekdays, n].sort()
                              : i.repeat.weekdays.filter((x) => x !== n),
                          });
                      }}
                    />
                  ))}
                </div>
              </>
            )}
            {i.repeat.kind === "monthly" && (
              <>
                <Field label="Ngày trong tuần">
                  <Select
                    value={i.repeat.weekday}
                    onChange={(e) => {
                      if (i.repeat.kind === "monthly")
                        input("repeat", { ...i.repeat, weekday: Number(e.target.value) });
                    }}
                  >
                    {[
                      "Chúa nhật",
                      "Thứ Hai",
                      "Thứ Ba",
                      "Thứ Tư",
                      "Thứ Năm",
                      "Thứ Sáu",
                      "Thứ Bảy",
                    ].map((d, n) => (
                      <option key={d} value={n}>
                        {d}
                      </option>
                    ))}
                  </Select>
                </Field>
                <div className="schedule-actions">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <Choice
                      key={n}
                      label={`Lần thứ ${n}`}
                      checked={i.repeat.kind === "monthly" && i.repeat.ordinals.includes(n)}
                      onChange={(e) => {
                        if (i.repeat.kind === "monthly")
                          input("repeat", {
                            ...i.repeat,
                            ordinals: e.target.checked
                              ? [...i.repeat.ordinals, n].sort()
                              : i.repeat.ordinals.filter((x) => x !== n),
                          });
                      }}
                    />
                  ))}
                </div>
              </>
            )}
          </>
        )}
        <Field label="Trạng thái">
          <Select
            value={b.state}
            onChange={(e) =>
              setB((old) => ({ ...old, state: e.target.value as ScheduleCommand["state"] }))
            }
          >
            {Object.entries(scheduleStates)
              .filter(([k]) => !!row || k !== "cancelled")
              .map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
          </Select>
        </Field>
        <Field label="Lý do thay đổi / xác nhận trùng giờ">
          <TextArea
            maxLength={500}
            required={!!row}
            value={b.reason ?? ""}
            onChange={(e) => setB((old) => ({ ...old, reason: e.target.value || null }))}
          />
        </Field>
      </fieldset>
      <DialogActions>
        <Button type="submit" variant="primary" disabled={locked}>
          Xem trước
        </Button>
      </DialogActions>
    </form>
  );
}
