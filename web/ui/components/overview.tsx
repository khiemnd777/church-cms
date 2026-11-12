import type { ReactNode } from "react";
import type { IconName } from "../icons";
import { Button, Icon, Tooltip } from ".";
export function OverviewHero({
  name,
  code,
  address,
  day,
  secretary,
  term,
}: {
  name: string;
  code: string;
  address: string;
  day: string;
  secretary: string | null;
  term: string | null;
}) {
  return (
    <section className="hero">
      <div style={{ position: "relative", zIndex: 1, minWidth: 0 }}>
        <div className="eyebrow">
          <span>{code}</span>
        </div>
        <h2>{name}</h2>
        <div className="meta">
          <span>{address || "Chưa có địa chỉ"}</span>
        </div>
        <div className="staff">
          <div>
            <small>MỤC SƯ QUẢN NHIỆM</small>
            <b>—</b>
          </div>
          <div>
            <small>NHIỆM KỲ BAN CHẤP SỰ</small>
            <b>{term ?? "—"}</b>
          </div>
          <div>
            <small>THƯ KÝ NHIỆM KỲ</small>
            <b>{secretary ?? "—"}</b>
          </div>
        </div>
      </div>
      <div className="hero-r">
        <small>HÔM NAY</small>
        <div className="d">
          {new Intl.DateTimeFormat("vi-VN", {
            weekday: "long",
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            timeZone: "Asia/Ho_Chi_Minh",
          }).format(new Date(`${day}T05:00:00Z`))}
        </div>
        <div className="next-sun">
          Lịch giảng & sinh hoạt
          <br />
          <b>Chưa khả dụng</b>
        </div>
        <Button className="hero-btn" disabled title="Lịch giảng & sinh hoạt — Chưa khả dụng">
          <Icon name="book" />
          Lịch giảng & sinh hoạt
        </Button>
      </div>
    </section>
  );
}
export function OverviewStages({ items }: { items: { label: string; count: number }[] }) {
  return (
    <>
      <div
        className="stagebar"
        role="img"
        aria-label={items.map((i) => `${i.label}: ${i.count}`).join("; ")}
      >
        {items.map((i, n) =>
          i.count > 0 ? (
            <i key={i.label} style={{ flex: i.count, opacity: [0.35, 0.65, 1][n] }} />
          ) : null,
        )}
      </div>
      <div className="lgd num">
        {items.map((i, n) => (
          <span key={i.label}>
            <i style={{ opacity: [0.35, 0.65, 1][n] }} />
            {i.label} <b>{i.count}</b>
          </span>
        ))}
      </div>
    </>
  );
}
export function OverviewBar({
  label,
  value,
  maximum,
  children,
}: {
  label: string;
  value: number;
  maximum: number;
  children: ReactNode;
}) {
  return (
    <div className="hbar">
      <span>{label}</span>
      <span className="num">{children}</span>
      <div className="track" role="img" aria-label={`${label}: ${value}`}>
        <div
          className="fill"
          style={{ width: `${maximum ? Math.min(100, (value / maximum) * 100) : 0}%` }}
        />
      </div>
    </div>
  );
}
export function OverviewShortcut({
  label,
  icon,
  disabled,
  onClick,
}: {
  label: string;
  icon: IconName;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <Tooltip label={`${label}${disabled ? " — Chưa khả dụng" : ""}`}>
      <Button
        style={{ width: "100%" }}
        aria-label={label}
        title={`${label}${disabled ? " — Chưa khả dụng" : ""}`}
        disabled={disabled}
        onClick={onClick}
      >
        <Icon name={icon} />
      </Button>
    </Tooltip>
  );
}
