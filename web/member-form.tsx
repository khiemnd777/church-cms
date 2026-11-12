import { type FormEvent, useEffect, useState } from "react";
import { ageOn } from "../api/members/dates";
import {
  baptismLabels,
  dayLabel,
  type FamilyPage,
  genderLabels,
  householdLabels,
  type MemberDto,
  type MemberOptions,
  membershipLabels,
  stageLabels,
} from "./members-api";
import type { UnitDto } from "./organization-api";
import { type TenantRealm, tenantRequest } from "./tenant-mutation";
import {
  Button,
  Choice,
  DialogActions,
  Feedback,
  Field,
  SectionHeader,
  Select,
  TextInput,
} from "./ui/components";
export function MemberForm({
  original,
  options,
  units,
  realm,
  base,
  locked,
  error,
  fields,
  onSubmit,
  onClose,
  onReload,
}: {
  original: MemberDto | null;
  options: MemberOptions;
  units: UnitDto[];
  realm: TenantRealm;
  base: string;
  locked: boolean;
  error: string;
  fields: Record<string, string>;
  onSubmit: (body: object) => void;
  onClose: () => void;
  onReload: () => void;
}) {
  const [name, setName] = useState(original?.fullName ?? ""),
    [gender, setGender] = useState(original?.gender ?? "unknown"),
    [birth, setBirth] = useState(original?.birthDate ?? ""),
    [phone, setPhone] = useState(original?.phone ?? ""),
    [type, setType] = useState<"believer" | "visitor">(original?.type ?? "believer"),
    [membership, setMembership] = useState(original?.membership ?? "preparatory"),
    [householdRole, setRole] = useState(original?.householdRole ?? "head"),
    [familyMode, setFamilyMode] = useState<"new" | "existing">("new"),
    [family, setFamily] = useState<FamilyPage["items"][number] | null>(null),
    [area, setArea] = useState(""),
    [mode, setMode] = useState(
      original?.assignment.mode ?? options.settings?.defaultAssignmentMode ?? "auto",
    ),
    [ids, setIds] = useState<string[]>(original?.assignment.unitIds ?? []),
    [force, setForce] = useState(false),
    [baptism, setBaptism] = useState(original?.baptism.status ?? "unknown"),
    [baptismDate, setBaptismDate] = useState(original?.baptism.date ?? ""),
    [place, setPlace] = useState(original?.baptism.place ?? ""),
    [firstVisit, setFirstVisit] = useState(original?.visitor?.firstVisit ?? ""),
    [believed, setBelieved] = useState(original?.visitor?.believedOn ?? ""),
    [stage, setStage] = useState(original?.visitor?.stage ?? "new"),
    [referrer, setReferrer] = useState(original?.visitor?.referrer ?? ""),
    [caregiver, setCaregiver] = useState(original?.visitor?.caregiverId ?? ""),
    [consent, setConsent] = useState(false);
  const age = ageOn(birth || null, options.asOfDate),
    band =
      age === null
        ? undefined
        : options.ageBands.find((b) => age >= b.min && (b.max === null || age <= b.max));
  const choices = [
    ...new Map([...units, ...(original?.units ?? [])].map((u) => [u.id, u])).values(),
  ].filter((u) => u.kind === "age_ministry" || u.kind === "service_ministry");
  function submit(e: FormEvent) {
    e.preventDefault();
    const profile = {
      fullName: name,
      gender,
      birthDate: birth || null,
      phone: phone.trim() || null,
      membership: type === "believer" ? membership : null,
      householdRole,
      baptism: {
        status: baptism,
        date: baptism === "baptized" ? baptismDate || null : null,
        place: baptism === "baptized" ? place.trim() || null : null,
      },
    };
    const visitor = {
      firstVisit: firstVisit || null,
      believedOn: believed || null,
      referrer: referrer.trim() || null,
      caregiverId: caregiver || null,
    };
    const assignment = {
        mode,
        unitIds:
          mode === "auto"
            ? []
            : ids.filter((id) => choices.some((u) => u.id === id && u.kind === "age_ministry")),
        serviceUnitIds: ids.filter((id) =>
          choices.some((u) => u.id === id && u.kind === "service_ministry"),
        ),
      },
      assignmentContext = {
        settingsVersion: options.settings?.version ?? 0,
        asOfDate: options.asOfDate,
      };
    if (!original) {
      onSubmit({
        ...profile,
        type,
        visitor: type === "visitor" ? { ...visitor, stage } : null,
        family:
          familyMode === "new"
            ? { kind: "new", areaId: area || null }
            : { kind: "existing", id: family?.id ?? "" },
        assignment,
        assignmentContext,
        consent,
      });
    } else
      onSubmit({
        ...profile,
        ...(type === "visitor" ? { visitor } : {}),
        ...(force || ((birth || null) !== original.birthDate && mode === "auto")
          ? { assignment, assignmentContext }
          : {}),
      });
  }
  return (
    <form className="member-form" onSubmit={submit} aria-busy={locked}>
      <SectionHeader title="Thông tin cá nhân" />
      <div className="form">
        <Field label="Họ và tên" error={fields.fullName}>
          <TextInput
            required
            maxLength={200}
            value={name}
            disabled={locked}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field label="Giới tính" error={fields.gender}>
          <Select
            value={gender}
            disabled={locked}
            onChange={(e) => setGender(e.target.value as typeof gender)}
          >
            {Object.entries(genderLabels).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Ngày sinh"
          optional
          error={fields.birthDate}
          hint="Chưa rõ ngày sinh thì để trống."
        >
          <TextInput
            type="date"
            max={options.asOfDate}
            value={birth}
            disabled={locked}
            onChange={(e) => {
              setBirth(e.target.value);
              if (mode === "auto") setForce(true);
            }}
          />
        </Field>
        <Field label="Điện thoại" optional error={fields.phone}>
          <TextInput
            type="tel"
            maxLength={40}
            value={phone}
            disabled={locked}
            onChange={(e) => setPhone(e.target.value)}
          />
        </Field>
        <Field label="Loại thuộc viên">
          <Select
            value={type}
            disabled={locked || !!original}
            onChange={(e) => setType(e.target.value as typeof type)}
          >
            <option value="believer">Tín hữu</option>
            <option value="visitor">Thân hữu</option>
          </Select>
        </Field>
        {type === "believer" && (
          <Field label="Tình trạng tín hữu" error={fields.membership}>
            <Select
              value={membership}
              disabled={locked}
              onChange={(e) => setMembership(e.target.value as typeof membership)}
            >
              {Object.entries(membershipLabels).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </div>
      <div className="member-form-group">
        <SectionHeader title="Gia đình" />
        {original ? (
          <p>
            {original.family.code} · {original.family.areaName ?? "Chưa phân khu vực"}
          </p>
        ) : (
          <>
            <div className="opts">
              <Choice
                type="radio"
                name="familyMode"
                label="Tạo gia đình mới"
                checked={familyMode === "new"}
                disabled={locked}
                onChange={() => {
                  setFamilyMode("new");
                  setRole("head");
                }}
              />
              <Choice
                type="radio"
                name="familyMode"
                label="Chọn gia đình có sẵn"
                checked={familyMode === "existing"}
                disabled={locked}
                onChange={() => {
                  setFamilyMode("existing");
                  setRole("other");
                }}
              />
            </div>
            {familyMode === "new" ? (
              <Field label="Khu vực" optional>
                <Select value={area} disabled={locked} onChange={(e) => setArea(e.target.value)}>
                  <option value="">Chưa phân khu vực</option>
                  {units
                    .filter((u) => u.kind === "area" && u.status === "active")
                    .map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                </Select>
              </Field>
            ) : (
              <FamilyPicker
                realm={realm}
                base={base}
                locked={locked}
                value={family}
                onChange={setFamily}
              />
            )}
          </>
        )}
        <Field label="Vai trò trong hộ" error={fields.householdRole}>
          <Select
            value={householdRole}
            disabled={locked}
            onChange={(e) => setRole(e.target.value as typeof householdRole)}
          >
            {Object.entries(householdLabels).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="member-form-group">
        <SectionHeader title="Xếp ban" />
        <div className="opts">
          <Choice
            type="radio"
            name="assignmentMode"
            label="Tự động theo độ tuổi"
            checked={mode === "auto"}
            disabled={locked}
            onChange={() => {
              setMode("auto");
              setForce(true);
            }}
          />
          <Choice
            type="radio"
            name="assignmentMode"
            label="Thủ công"
            checked={mode === "manual"}
            disabled={locked}
            onChange={() => {
              setMode("manual");
              setForce(true);
            }}
          />
        </div>
        {mode === "auto" ? (
          <>
            <p>
              {birth
                ? `${age} tuổi · ${band?.name ?? "Chưa đủ tuổi vào ban"}`
                : "Chưa rõ ngày sinh · chưa tự xếp ban"}
            </p>
            {original && (
              <>
                <p className="small muted">
                  Đã xếp ngày {dayLabel(original.assignment.asOfDate)}. Sửa thông tin khác giữ
                  nguyên ban đã lưu.
                </p>
                <Button disabled={locked} onClick={() => setForce(true)}>
                  {force ? "Sẽ xếp lại khi lưu" : "Xếp lại theo tuổi hôm nay"}
                </Button>
              </>
            )}
          </>
        ) : (
          <div className="opts">
            {choices
              .filter((u) => u.kind === "age_ministry")
              .map((u) => (
                <Choice
                  key={u.id}
                  label={`${u.name}${u.status === "inactive" ? " · Đã ngừng" : ""}`}
                  checked={ids.includes(u.id)}
                  disabled={locked || (u.status === "inactive" && !ids.includes(u.id))}
                  onChange={(e) => {
                    setIds((old) =>
                      e.target.checked ? [...old, u.id] : old.filter((id) => id !== u.id),
                    );
                    setForce(true);
                  }}
                />
              ))}
          </div>
        )}
      </div>
      <div className="member-form-group">
        <SectionHeader title="Ban phục vụ" />
        <div className="opts">
          {choices
            .filter((u) => u.kind === "service_ministry")
            .map((u) => (
              <Choice
                key={u.id}
                label={`${u.name}${u.status === "inactive" ? " · Đã ngừng" : ""}`}
                checked={ids.includes(u.id)}
                disabled={locked || (u.status === "inactive" && !ids.includes(u.id))}
                onChange={(e) => {
                  setIds((old) =>
                    e.target.checked ? [...old, u.id] : old.filter((id) => id !== u.id),
                  );
                  setForce(true);
                }}
              />
            ))}
        </div>
      </div>
      {type === "visitor" && (
        <div className="member-form-group">
          <SectionHeader title="Theo dõi thân hữu" />
          <div className="form">
            {!original && (
              <Field label="Giai đoạn">
                <Select
                  value={stage}
                  disabled={locked}
                  onChange={(e) => setStage(e.target.value as typeof stage)}
                >
                  {Object.entries(stageLabels).map(([id, label]) => (
                    <option key={id} value={id}>
                      {label}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            <Field label="Đến lần đầu" optional>
              <TextInput
                type="date"
                max={options.asOfDate}
                value={firstVisit}
                disabled={locked}
                onChange={(e) => setFirstVisit(e.target.value)}
              />
            </Field>
            <Field label="Ngày tin Chúa" optional>
              <TextInput
                type="date"
                max={options.asOfDate}
                value={believed}
                disabled={locked}
                onChange={(e) => setBelieved(e.target.value)}
              />
            </Field>
            <Field label="Người giới thiệu" optional>
              <TextInput
                maxLength={200}
                value={referrer}
                disabled={locked}
                onChange={(e) => setReferrer(e.target.value)}
              />
            </Field>
          </div>
          <CaregiverPicker
            realm={realm}
            base={base}
            locked={locked}
            value={caregiver}
            label={original?.caregiverName ?? null}
            onChange={setCaregiver}
          />
        </div>
      )}
      <div className="member-form-group">
        <SectionHeader title="Báp-têm · thông tin hồ sơ" />
        <div className="form">
          <Field label="Báp-têm">
            <Select
              value={baptism}
              disabled={locked}
              onChange={(e) => setBaptism(e.target.value as typeof baptism)}
            >
              {Object.entries(baptismLabels).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          {baptism === "baptized" && (
            <>
              <Field label="Ngày Báp-têm" optional>
                <TextInput
                  type="date"
                  max={options.asOfDate}
                  value={baptismDate}
                  disabled={locked}
                  onChange={(e) => setBaptismDate(e.target.value)}
                />
              </Field>
              <Field label="Nơi Báp-têm" optional>
                <TextInput
                  maxLength={200}
                  value={place}
                  disabled={locked}
                  onChange={(e) => setPlace(e.target.value)}
                />
              </Field>
            </>
          )}
        </div>
      </div>
      {!original && (
        <Choice
          required
          label="Đã xác nhận đồng ý lưu trữ thông tin"
          checked={consent}
          disabled={locked}
          onChange={(e) => setConsent(e.target.checked)}
        />
      )}
      {error && <Feedback tone="error">{error}</Feedback>}
      <DialogActions>
        <Button disabled={locked} onClick={onClose}>
          Hủy
        </Button>
        {error && (
          <Button disabled={locked} onClick={onReload}>
            Tải bản mới
          </Button>
        )}
        <Button
          variant="primary"
          type="submit"
          disabled={locked || (!original && familyMode === "existing" && !family)}
        >
          Lưu hồ sơ
        </Button>
      </DialogActions>
    </form>
  );
}
export function FamilyPicker({
  realm,
  base,
  locked,
  value,
  onChange,
}: {
  realm: TenantRealm;
  base: string;
  locked: boolean;
  value: FamilyPage["items"][number] | null;
  onChange: (f: FamilyPage["items"][number] | null) => void;
}) {
  const [query, setQuery] = useState(""),
    [page, setPage] = useState<FamilyPage | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function load(cursor?: string) {
    setBusy(true);
    setError("");
    try {
      const r = await tenantRequest<FamilyPage>(
        realm,
        `${base}/families?${new URLSearchParams({ q: query, ...(cursor ? { cursor } : {}) })}`,
      );
      setPage((old) => ({
        ...r.data,
        items: cursor ? [...(old?.items ?? []), ...r.data.items] : r.data.items,
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không tải được gia đình.");
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  return (
    <div className="member-form-group">
      <div className="member-picker">
        <Field label="Tìm mã hộ">
          <TextInput
            maxLength={100}
            value={query}
            disabled={locked || busy}
            onChange={(e) => setQuery(e.target.value)}
          />
        </Field>
        <Button disabled={locked || busy} onClick={() => void load()}>
          Tra cứu hộ
        </Button>
      </div>
      <Field label="Gia đình có sẵn">
        <Select
          required
          value={value?.id ?? ""}
          disabled={locked || busy}
          onChange={(e) => onChange(page?.items.find((f) => f.id === e.target.value) ?? null)}
        >
          <option value="">Chọn gia đình</option>
          {page?.items.map((f) => (
            <option key={f.id} value={f.id}>
              {f.code} · {f.headName ?? "Chưa có chủ hộ"} · {f.areaName ?? "Chưa phân khu vực"}
            </option>
          ))}
        </Select>
      </Field>
      {page?.nextCursor && (
        <Button disabled={locked || busy} onClick={() => void load(page.nextCursor as string)}>
          Xem thêm gia đình
        </Button>
      )}
      {error && <Feedback tone="error">{error}</Feedback>}
    </div>
  );
}
function CaregiverPicker({
  realm,
  base,
  locked,
  value,
  label,
  onChange,
}: {
  realm: TenantRealm;
  base: string;
  locked: boolean;
  value: string;
  label: string | null;
  onChange: (id: string) => void;
}) {
  const [query, setQuery] = useState(""),
    [items, setItems] = useState<{ id: string; fullName: string; code: string }[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function load() {
    setBusy(true);
    setError("");
    try {
      const r = await tenantRequest<{ items: typeof items }>(
        realm,
        `${base}/members?${new URLSearchParams({ q: query, limit: "25" })}`,
      );
      setItems(r.data.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không tải được hồ sơ.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="member-form-group">
      <div className="member-picker">
        <Field label="Tìm người chăm sóc">
          <TextInput
            maxLength={100}
            value={query}
            disabled={locked || busy}
            onChange={(e) => setQuery(e.target.value)}
          />
        </Field>
        <Button disabled={locked || busy} onClick={() => void load()}>
          Tra cứu người
        </Button>
      </div>
      <Field label="Người chăm sóc" optional>
        <Select value={value} disabled={locked || busy} onChange={(e) => onChange(e.target.value)}>
          <option value="">Chưa giao</option>
          {value && !items.some((m) => m.id === value) && (
            <option value={value}>{label ?? "Người đã chọn"}</option>
          )}
          {items.map((m) => (
            <option key={m.id} value={m.id}>
              {m.code} · {m.fullName}
            </option>
          ))}
        </Select>
      </Field>
      {error && <Feedback tone="error">{error}</Feedback>}
    </div>
  );
}
