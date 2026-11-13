import { Icon } from "../icons";

// W05 source patterns, with semantic state and progress announcements.
export function AttendanceProgress({ present, total }: { present: number; total: number }) {
  return (
    <div
      className="ui-attendance-track"
      role="progressbar"
      aria-label="Tỷ lệ hiện diện"
      aria-valuemin={0}
      aria-valuemax={total || 1}
      aria-valuenow={present}
      aria-valuetext={`${present} / ${total} có mặt`}
    >
      <div style={{ width: `${total ? (present / total) * 100 : 0}%` }} />
    </div>
  );
}
export function AttendanceItem({
  name,
  detail,
  present,
  status,
  disabled,
  onClick,
}: {
  name: string;
  detail: string;
  present: boolean;
  status: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`att-item ui-attendance-item${present ? " on" : ""}`}
      aria-pressed={present}
      aria-label={`${name} — ${status}`}
      disabled={disabled}
      onClick={onClick}
    >
      <span className="chk" aria-hidden="true">
        {present && <Icon name="tick" />}
      </span>
      <span className="t">
        <b>{name}</b>
        <span>{detail}</span>
        <span className="ui-attendance-status">{status}</span>
      </span>
    </button>
  );
}
