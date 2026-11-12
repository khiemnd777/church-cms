import { useState } from "react";
import { emptyFamily, type FamilyDto, type FamilyInput } from "./families-api";
import type { UnitDto } from "./organization-api";
import {
  Button,
  DialogActions,
  Feedback,
  Field,
  Select,
  TextArea,
  TextInput,
} from "./ui/components";
export function FamilyFields({
  value,
  onChange,
  units,
  unitLabel,
  today,
  locked,
}: {
  value: FamilyInput;
  onChange: (v: FamilyInput) => void;
  units: UnitDto[];
  unitLabel: string;
  today: string;
  locked: boolean;
}) {
  const set = (key: keyof FamilyInput, next: string | number | null) =>
    onChange({ ...value, [key]: next });
  return (
    <div className="form">
      <Field label="Tên gia đình" optional>
        <TextInput
          maxLength={200}
          value={value.name ?? ""}
          disabled={locked}
          onChange={(e) => set("name", e.target.value || null)}
        />
      </Field>
      <Field label={unitLabel} optional>
        <Select
          value={value.areaId ?? ""}
          disabled={locked}
          onChange={(e) => set("areaId", e.target.value || null)}
        >
          <option value="">Chưa phân {unitLabel.toLowerCase()}</option>
          {value.areaId && !units.some((u) => u.id === value.areaId) && (
            <option value={value.areaId}>Giữ khu vực đã lưu</option>
          )}
          {units
            .filter((u) => u.kind === "area" && (u.status === "active" || u.id === value.areaId))
            .map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
                {u.status === "inactive" ? " · Đã ngừng" : ""}
              </option>
            ))}
        </Select>
      </Field>
      <Field label="Sinh hoạt từ năm" optional hint="Chưa rõ năm thì để trống.">
        <TextInput
          type="number"
          min={1}
          max={Number(today.slice(0, 4))}
          step={1}
          value={value.sinceYear ?? ""}
          disabled={locked}
          onChange={(e) => set("sinceYear", e.target.value ? Number(e.target.value) : null)}
        />
      </Field>
      <Field label="Địa chỉ" optional>
        <TextInput
          maxLength={500}
          value={value.address ?? ""}
          disabled={locked}
          onChange={(e) => set("address", e.target.value || null)}
        />
      </Field>
      <Field label="Ghi chú" optional>
        <TextArea
          maxLength={1000}
          value={value.notes ?? ""}
          disabled={locked}
          onChange={(e) => set("notes", e.target.value || null)}
        />
      </Field>
    </div>
  );
}
export function FamilyForm({
  original,
  units,
  unitLabel,
  today,
  locked,
  error,
  onSubmit,
  onClose,
  onReload,
}: {
  original: FamilyDto | null;
  units: UnitDto[];
  unitLabel: string;
  today: string;
  locked: boolean;
  error: string;
  onSubmit: (v: FamilyInput, reason: string, effectiveOn: string) => void;
  onClose: () => void;
  onReload: () => void;
}) {
  const [value, setValue] = useState<FamilyInput>(
      original
        ? {
            name: original.name,
            address: original.address,
            notes: original.notes,
            sinceYear: original.sinceYear,
            areaId: original.areaId,
          }
        : emptyFamily,
    ),
    [reason, setReason] = useState(""),
    [day, setDay] = useState(today);
  const areaChanged = !!original && value.areaId !== original.areaId;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(
          Object.fromEntries(
            Object.entries(value).map(([k, v]) => [
              k,
              typeof v === "string" ? v.trim() || null : v,
            ]),
          ) as FamilyInput,
          reason,
          day,
        );
      }}
      aria-busy={locked}
    >
      <FamilyFields
        value={value}
        onChange={setValue}
        units={units}
        unitLabel={unitLabel}
        today={today}
        locked={locked}
      />
      {areaChanged && (
        <>
          <Feedback tone="warning">
            Đổi {unitLabel.toLowerCase()} áp dụng cho toàn bộ hồ sơ hiện thuộc hộ. Xem trước trước
            khi xác nhận.
          </Feedback>
          <Field label="Ngày hiệu lực">
            <TextInput
              type="date"
              required
              max={today}
              value={day}
              disabled={locked}
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
        </>
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
        <Button variant="primary" type="submit" disabled={locked}>
          {areaChanged ? "Xem trước" : "Lưu gia đình"}
        </Button>
      </DialogActions>
    </form>
  );
}
