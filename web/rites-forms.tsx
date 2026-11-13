import { useEffect, useRef, useState } from "react";
import { businessDay } from "../api/members/dates";
import type { PersonInput, RecordInput, RiteCommand } from "../api/rites/validation";
import type { Rite, RitePeople } from "./rites-api";
import { dateLabel, riteStates } from "./rites-api";
import { type TenantRealm, tenantRequest } from "./tenant-mutation";
import {
  Button,
  Choice,
  DialogActions,
  EmptyState,
  Feedback,
  Field,
  Loading,
  PaginationControl,
  Select,
  TextArea,
  TextInput,
} from "./ui/components";
export function RitePersonPicker({
  label,
  value,
  onChange,
  external,
  optional,
  locked,
  realm,
  prefix,
  onFail,
}: {
  label: string;
  value: PersonInput | null;
  onChange: (p: PersonInput | null) => void;
  external: boolean;
  optional?: boolean;
  locked: boolean;
  realm: TenantRealm;
  prefix: string;
  onFail: (e: unknown) => void;
}) {
  const [q, setQ] = useState(""),
    [page, setPage] = useState<RitePeople | null>(null),
    [loading, setLoading] = useState(false),
    [cursor, setCursor] = useState<string | null>(null),
    [chosen, setChosen] = useState("");
  useEffect(() => {
    if (value?.source !== "member") return;
    const a = new AbortController();
    setLoading(true);
    const timer = setTimeout(() => {
      void tenantRequest<RitePeople>(
        realm,
        `${prefix}/people?${new URLSearchParams({ q, ...(cursor ? { cursor } : {}) })}`,
        { signal: a.signal },
      )
        .then((r) => {
          if (!a.signal.aborted)
            setPage((old) => ({
              ...r.data,
              items: cursor ? [...(old?.items ?? []), ...r.data.items] : r.data.items,
            }));
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
  }, [q, cursor, prefix, realm, value?.source]);
  return (
    <fieldset disabled={locked} className="rites-person">
      <legend>{label}</legend>
      <Field label={`${label} · nguồn`}>
        <Select
          value={value?.source ?? "unknown"}
          onChange={(e) => {
            setChosen("");
            setQ("");
            setCursor(null);
            onChange(
              e.target.value === "member"
                ? { source: "member", memberId: "" }
                : e.target.value === "external"
                  ? { source: "external", fullName: "", birthDate: null }
                  : null,
            );
          }}
        >
          {optional && <option value="unknown">Chưa rõ</option>}
          <option value="member">Hồ sơ Hội Thánh</option>
          {external && <option value="external">Người ngoài Hội Thánh</option>}
        </Select>
      </Field>
      {value?.source === "member" && (
        <>
          <Field label={`Tìm ${label}`}>
            <TextInput
              value={q}
              maxLength={100}
              onChange={(e) => {
                setQ(e.target.value);
                setCursor(null);
              }}
            />
          </Field>
          <p>
            {chosen ||
              page?.items.find((m) => m.id === value.memberId)?.fullName ||
              (value.memberId ? `Đã liên kết hồ sơ ${value.memberId}` : "Chưa chọn hồ sơ")}
          </p>
          {loading && <Loading />}
          {page && !page.items.length && <EmptyState message="Không có hồ sơ phù hợp." />}
          <div className="rites-picker-list">
            {page?.items.map((m) => (
              <Button
                key={m.id}
                aria-pressed={value.memberId === m.id}
                onClick={() => {
                  setChosen(`${m.fullName} · ${m.code}`);
                  onChange({ source: "member", memberId: m.id });
                }}
              >
                {m.fullName} · {m.code}
              </Button>
            ))}
          </div>
          {page?.nextCursor && (
            <PaginationControl loading={loading} onMore={() => setCursor(page.nextCursor)} />
          )}
        </>
      )}
      {value?.source === "external" && (
        <>
          <Field label={`${label} · họ tên`}>
            <TextInput
              required
              maxLength={200}
              value={value.fullName}
              onChange={(e) => onChange({ ...value, fullName: e.target.value })}
            />
          </Field>
          <Field label={`${label} · ngày sinh nếu biết`}>
            <TextInput
              type="date"
              value={value.birthDate ?? ""}
              onChange={(e) => onChange({ ...value, birthDate: e.target.value || null })}
            />
          </Field>
        </>
      )}
    </fieldset>
  );
}
function blank(kind: RecordInput["payload"]["kind"]): RecordInput {
  const person = { source: "member" as const, memberId: "" },
    base = { place: null };
  const payload: RecordInput["payload"] =
    kind === "baptism"
      ? { ...base, kind, person, officiant: null }
      : kind === "dedication"
        ? { ...base, kind, child: person, parents: [], officiant: null }
        : kind === "marriage"
          ? {
              ...base,
              kind,
              groom: person,
              bride: { source: "external", fullName: "", birthDate: null },
              officiant: null,
              announcements: [],
            }
          : kind === "funeral"
            ? { ...base, kind, person, deathOn: null, age: null }
            : { ...base, kind, officiant: null, count: null };
  return { payload, date: businessDay(), historical: false, note: null };
}
export function RiteForm({
  kind,
  rite,
  seed,
  realm,
  prefix,
  locked,
  onFail,
  onSubmit,
  onCancel,
}: {
  kind: RecordInput["payload"]["kind"];
  rite: Rite | null;
  seed?: RitePeople["items"][number] | null;
  realm: TenantRealm;
  prefix: string;
  locked: boolean;
  onFail: (e: unknown) => void;
  onSubmit: (body: RiteCommand) => void;
  onCancel: () => void;
}) {
  const [record, setRecord] = useState<RecordInput>(() => {
      if (rite) return rite.record;
      const r = blank(kind);
      if (seed && r.payload.kind === "baptism")
        return {
          ...r,
          date: seed.baptism.date,
          historical: !seed.baptism.date,
          payload: {
            ...r.payload,
            person: { source: "member", memberId: seed.id },
            place: seed.baptism.place,
          },
        };
      return r;
    }),
    [state, setState] = useState<RiteCommand["state"]>(rite?.state ?? "draft"),
    [reason, setReason] = useState(""),
    [decision, setDecision] = useState("preserve");
  const p = record.payload;
  const parentKeys = useRef(
    p.kind === "dedication" ? p.parents.map(() => crypto.randomUUID()) : [],
  );
  const announcementKeys = useRef(
    p.kind === "marriage" ? p.announcements.map(() => crypto.randomUUID()) : [],
  );
  const patch = (payload: RecordInput["payload"]) => setRecord({ ...record, payload });
  const picker = (
    label: string,
    value: PersonInput | null,
    onChange: (v: PersonInput | null) => void,
    external = true,
    optional = true,
  ) => (
    <RitePersonPicker
      label={label}
      value={value}
      onChange={onChange}
      external={external}
      optional={optional}
      locked={locked}
      realm={realm}
      prefix={prefix}
      onFail={onFail}
    />
  );
  function send() {
    let baptismAfter: RiteCommand["baptismAfter"] = null;
    if (p.kind === "baptism" && (state === "recorded" || rite?.state === "recorded")) {
      if (state === "recorded" || decision === "ceremony")
        baptismAfter = { status: "baptized", date: record.date, place: p.place };
      else if (decision === "unknown" || decision === "not_baptized")
        baptismAfter = { status: decision, date: null, place: null };
    }
    onSubmit({ record, state, reason: reason.trim() || null, baptismAfter, preview: null });
  }
  return (
    <form
      className="rites-form"
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      <fieldset disabled={locked} className="rites-form">
        <legend>Thông tin lễ</legend>
        <div className="rites-form-grid">
          <Field label="Ngày cử hành">
            <TextInput
              type="date"
              required={state === "planned" || (state === "recorded" && !record.historical)}
              value={record.date ?? ""}
              onChange={(e) => setRecord({ ...record, date: e.target.value || null })}
            />
          </Field>
          <Field label="Trạng thái">
            <Select
              value={state}
              onChange={(e) => setState(e.target.value as RiteCommand["state"])}
            >
              {Object.entries(riteStates)
                .filter(([s]) => rite || s !== "void")
                .map(([s, label]) => (
                  <option key={s} value={s}>
                    {label}
                  </option>
                ))}
            </Select>
          </Field>
        </div>
        <Choice
          checked={record.historical}
          onChange={(e) => setRecord({ ...record, historical: e.target.checked })}
          label="Thông tin lịch sử; cho phép chưa rõ ngày"
        />
        {(p.kind === "baptism" || p.kind === "funeral") &&
          picker(
            p.kind === "baptism" ? "Người chịu Báp-têm" : "Người qua đời",
            p.person,
            (v) => {
              if (v?.source === "member") patch({ ...p, person: v });
            },
            false,
            false,
          )}
        {p.kind === "dedication" && (
          <>
            {picker(
              "Con được dâng",
              p.child,
              (v) => {
                if (v?.source === "member") patch({ ...p, child: v });
              },
              false,
              false,
            )}
            {!p.parents.length && (
              <Feedback>Chưa rõ cha mẹ/người giám hộ. Không suy từ hộ gia đình.</Feedback>
            )}
            {p.parents.map((parent, i) => (
              <div key={parentKeys.current[i]} className="rites-form">
                <Field label={`Vai trò người ${i + 1}`}>
                  <Select
                    value={parent.role}
                    onChange={(e) =>
                      patch({
                        ...p,
                        parents: p.parents.map((x, j) =>
                          j === i ? { ...x, role: e.target.value as typeof parent.role } : x,
                        ),
                      })
                    }
                  >
                    <option value="father">Cha</option>
                    <option value="mother">Mẹ</option>
                    <option value="guardian">Người giám hộ</option>
                  </Select>
                </Field>
                {picker(
                  `Người liên quan ${i + 1}`,
                  parent.person,
                  (v) => {
                    if (v)
                      patch({
                        ...p,
                        parents: p.parents.map((x, j) => (j === i ? { ...x, person: v } : x)),
                      });
                  },
                  true,
                  false,
                )}
                <Button
                  onClick={() => {
                    parentKeys.current.splice(i, 1);
                    patch({ ...p, parents: p.parents.filter((_, j) => i !== j) });
                  }}
                >
                  Bỏ người liên quan {i + 1}
                </Button>
              </div>
            ))}
            <Button
              disabled={p.parents.length >= 20}
              onClick={() => {
                parentKeys.current.push(crypto.randomUUID());
                patch({
                  ...p,
                  parents: [
                    ...p.parents,
                    { role: "guardian", person: { source: "member", memberId: "" } },
                  ],
                });
              }}
            >
              Thêm cha mẹ/người giám hộ
            </Button>
          </>
        )}
        {p.kind === "marriage" && (
          <>
            {picker(
              "Chú rể",
              p.groom,
              (v) => {
                if (v) patch({ ...p, groom: v });
              },
              true,
              false,
            )}
            {picker(
              "Cô dâu",
              p.bride,
              (v) => {
                if (v) patch({ ...p, bride: v });
              },
              true,
              false,
            )}
            <p>Ít nhất một người liên kết hồ sơ Hội Thánh. Không tự đổi gia đình.</p>
            <fieldset className="rites-form">
              <legend>Rao hôn phối</legend>
              {p.announcements.map((a, i) => (
                <div key={announcementKeys.current[i]} className="rites-form-grid">
                  <Field label={`Ngày rao ${i + 1}`}>
                    <TextInput
                      required
                      type="date"
                      value={a.date}
                      onChange={(e) =>
                        patch({
                          ...p,
                          announcements: p.announcements.map((x, j) =>
                            i === j ? { ...x, date: e.target.value } : x,
                          ),
                        })
                      }
                    />
                  </Field>
                  <Field label={`Trạng thái rao ${i + 1}`}>
                    <Select
                      value={a.state}
                      onChange={(e) =>
                        patch({
                          ...p,
                          announcements: p.announcements.map((x, j) =>
                            i === j ? { ...x, state: e.target.value as typeof a.state } : x,
                          ),
                        })
                      }
                    >
                      <option value="planned">Dự kiến</option>
                      <option value="announced">Đã rao</option>
                      <option value="cancelled">Đã hủy</option>
                    </Select>
                  </Field>
                  <Field label={`Ghi chú rao ${i + 1}`}>
                    <TextInput
                      maxLength={500}
                      value={a.note ?? ""}
                      onChange={(e) =>
                        patch({
                          ...p,
                          announcements: p.announcements.map((x, j) =>
                            i === j ? { ...x, note: e.target.value || null } : x,
                          ),
                        })
                      }
                    />
                  </Field>
                  <Button
                    onClick={() => {
                      announcementKeys.current.splice(i, 1);
                      patch({ ...p, announcements: p.announcements.filter((_, j) => i !== j) });
                    }}
                  >
                    Bỏ lần rao {i + 1}
                  </Button>
                </div>
              ))}
              <Button
                disabled={p.announcements.length >= 100}
                onClick={() => {
                  announcementKeys.current.push(crypto.randomUUID());
                  patch({
                    ...p,
                    announcements: [
                      ...p.announcements,
                      { date: businessDay(), state: "planned", note: null },
                    ],
                  });
                }}
              >
                Thêm lần rao
              </Button>
            </fieldset>
          </>
        )}
        {"officiant" in p &&
          picker("Người cử hành", p.officiant, (v) => patch({ ...p, officiant: v }))}
        <Field label="Nơi">
          <TextInput
            maxLength={200}
            value={p.place ?? ""}
            onChange={(e) => patch({ ...p, place: e.target.value.trim() || null })}
          />
        </Field>
        {p.kind === "funeral" && (
          <>
            <Field label="Ngày qua đời nếu biết">
              <TextInput
                type="date"
                value={p.deathOn ?? ""}
                onChange={(e) => patch({ ...p, deathOn: e.target.value || null })}
              />
            </Field>
            <Field label="Hưởng thọ · người nhập xác nhận">
              <TextInput
                type="number"
                min={0}
                step={1}
                value={p.age ?? ""}
                onChange={(e) =>
                  patch({ ...p, age: e.target.value === "" ? null : Number(e.target.value) })
                }
              />
            </Field>
            <Feedback>Ghi sổ không tự đổi trạng thái qua đời của hồ sơ.</Feedback>
          </>
        )}
        {p.kind === "communion" && (
          <>
            <Field label="Số người dự · nhập tay">
              <TextInput
                type="number"
                min={0}
                step={1}
                value={p.count ?? ""}
                onChange={(e) =>
                  patch({ ...p, count: e.target.value === "" ? null : Number(e.target.value) })
                }
              />
            </Field>
            <Feedback>
              Để trống là chưa ghi nhận; 0 là không có người dự. Không lấy từ điểm danh.
            </Feedback>
          </>
        )}
        <Field label="Ghi chú">
          <TextArea
            maxLength={1000}
            value={record.note ?? ""}
            onChange={(e) => setRecord({ ...record, note: e.target.value || null })}
          />
        </Field>
        {p.kind === "baptism" &&
          (state === "recorded" || rite?.state === "recorded") &&
          (state === "recorded" ? (
            <Feedback>
              Thông tin Báp-têm trên hồ sơ sau xác nhận: Đã Báp-têm · {dateLabel(record.date)} ·{" "}
              {p.place ?? "Chưa rõ nơi"}. Preview sẽ hiển thị trước/sau.
            </Feedback>
          ) : (
            <Field label="Thông tin Báp-têm sau thao tác">
              <Select value={decision} onChange={(e) => setDecision(e.target.value)}>
                <option value="preserve">Giữ thông tin hồ sơ hiện hành</option>
                <option value="unknown">Đính chính: chưa rõ</option>
                <option value="not_baptized">Đính chính: chưa Báp-têm</option>
                <option value="ceremony">Giữ thông tin theo lễ này</option>
              </Select>
            </Field>
          ))}
        <Field label="Lý do">
          <TextArea
            required={!!rite && (!!rite.recordedAt || state !== rite.state || state === "void")}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
      </fieldset>
      <DialogActions>
        <Button disabled={locked} onClick={onCancel}>
          Hủy
        </Button>
        <Button type="submit" variant="primary" disabled={locked}>
          {state === "recorded" || state === "void" || rite?.recordedAt
            ? "Xem trước xác nhận"
            : "Lưu"}
        </Button>
      </DialogActions>
    </form>
  );
}
