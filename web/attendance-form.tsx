import { type FormEvent, useState } from "react";
import { businessDay } from "../api/members/dates";
import type { Session } from "./attendance-api";
import type { UnitPage } from "./organization-api";
import {
  Button,
  Choice,
  DialogActions,
  Feedback,
  Field,
  Select,
  TextArea,
  TextInput,
} from "./ui/components";

export function AttendanceForm({
  value,
  units,
  busy,
  onMoreUnits,
  onCancel,
  onSubmit,
}: {
  value?: Session;
  units: UnitPage | null;
  busy: boolean;
  onMoreUnits: () => void;
  onCancel: () => void;
  onSubmit: (body: object) => void;
}) {
  const [reportingKind, setReportingKind] = useState(value?.reportingKind ?? "general"),
    [review, setReview] = useState(false),
    [confirmed, setConfirmed] = useState(false);
  const reportingChanged = reportingKind !== (value?.reportingKind ?? "general");
  const [label, setLabel] = useState(value?.label ?? ""),
    [heldOn, setHeldOn] = useState(value?.heldOn ?? businessDay()),
    [location, setLocation] = useState(value?.location ?? ""),
    [scope, setScope] = useState(value?.scope ?? "church"),
    [unitId, setUnitId] = useState(value?.unitId ?? ""),
    [reason, setReason] = useState("");
  const draft = !value || value.state === "draft";
  function submit(e: FormEvent) {
    e.preventDefault();
    if (reportingChanged && !review) {
      setReview(true);
      return;
    }
    if (reportingChanged && !confirmed) return;
    onSubmit({
      reportingKind,
      ...(value && reportingChanged ? { reason, referenceConfirmed: true } : {}),
      label,
      location: location.trim() || null,
      ...(draft ? { heldOn, scope, unitId: scope === "unit" ? unitId : null } : { reason }),
    });
  }
  return (
    <form className="attendance-form" onSubmit={submit}>
      {review ? (
        <>
          <Feedback tone="warning">
            Đổi nguồn tổng hợp cho ngày {heldOn}. Mỗi Hội Thánh/Chúa nhật chỉ có một buổi tham
            chiếu. Roster và dấu hiện diện giữ nguyên; tổng hợp/list/export sẽ được tính lại. Nếu đã
            có buổi khác, bỏ chọn buổi cũ có lý do trước.
          </Feedback>
          <Choice
            label="Tôi xác nhận thay đổi nguồn tổng hợp"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            disabled={busy}
          />
          <DialogActions>
            <Button
              disabled={busy}
              onClick={() => {
                setReview(false);
                setConfirmed(false);
              }}
            >
              Quay lại
            </Button>
            <Button type="submit" disabled={busy || !confirmed} variant="primary">
              Xác nhận và lưu
            </Button>
          </DialogActions>
        </>
      ) : (
        <>
          <Field
            label="Tổng hợp"
            hint="Bản cũ mặc định thông thường; chọn rõ nguồn báo cáo Chúa nhật."
          >
            <Select
              value={reportingKind}
              disabled={busy || !!value?.prepClass}
              onChange={(e) => setReportingKind(e.target.value as typeof reportingKind)}
            >
              <option value="general">Thông thường</option>
              <option value="sunday_reference">Tham chiếu thờ phượng Chúa nhật</option>
            </Select>
          </Field>
          <Field label="Tên buổi">
            <TextInput
              required
              maxLength={200}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              disabled={busy}
            />
          </Field>
          <div className="attendance-form-grid">
            <Field label="Ngày">
              <TextInput
                type="date"
                required
                value={heldOn}
                onChange={(e) => setHeldOn(e.target.value)}
                disabled={busy || !draft}
              />
            </Field>
            <Field label="Phạm vi">
              <Select
                value={scope}
                onChange={(e) => setScope(e.target.value as "church" | "unit")}
                disabled={busy || !draft || !!value?.prepClass}
              >
                <option value="church">{value?.prepClass ? "Lớp dự bị" : "Toàn Hội Thánh"}</option>
                <option value="unit">Ban / Khu vực</option>
              </Select>
            </Field>
          </div>
          {scope === "unit" && (
            <>
              <Field label="Đơn vị">
                <Select
                  required
                  value={unitId}
                  onChange={(e) => setUnitId(e.target.value)}
                  disabled={busy || !draft}
                >
                  <option value="">Chọn đơn vị</option>
                  {value?.unitId && !units?.items.some((u) => u.id === value.unitId) && (
                    <option value={value.unitId}>{value.unitName}</option>
                  )}
                  {units?.items
                    .filter((u) => u.kind !== "board")
                    .map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                </Select>
              </Field>
              {units?.nextCursor && draft && (
                <Button disabled={busy} onClick={onMoreUnits}>
                  Thêm đơn vị
                </Button>
              )}
            </>
          )}
          <Field label="Nơi">
            <TextInput
              maxLength={500}
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              disabled={busy}
            />
          </Field>
          {(!draft || (value && reportingChanged)) && (
            <Field label="Lý do sửa">
              <TextArea
                required
                maxLength={500}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                disabled={busy}
              />
            </Field>
          )}
          <DialogActions>
            <Button disabled={busy} onClick={onCancel}>
              Hủy
            </Button>
            <Button type="submit" variant="primary" disabled={busy}>
              Lưu{!value ? " nháp" : ""}
            </Button>
          </DialogActions>
        </>
      )}
    </form>
  );
}
