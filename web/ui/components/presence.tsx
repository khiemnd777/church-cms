import type { MemberAttendance, Presence } from "../../../api/attendance/reporting";
import { Button, Feedback } from ".";
export const presenceLabels: Record<Presence, string> = {
  present: "Có mặt",
  absent: "Vắng",
  pending: "Chưa chốt",
  outside: "Ngoài roster",
  missing: "Chưa chọn buổi",
};
const glyphs: Record<Presence, string> = {
  present: "●",
  absent: "○",
  pending: "·",
  outside: "–",
  missing: "?",
};
export function PresenceDots({
  value,
  detail = false,
  onOpen,
}: {
  value: MemberAttendance | null;
  detail?: boolean;
  onOpen?: (id: string) => void;
}) {
  if (!value) return <span>—</span>;
  return (
    <div className="ui-presence">
      <fieldset
        className="dots ui-presence-dots"
        aria-label={`Hiện diện 12 Chúa nhật đến ${value.until}`}
      >
        {value.days.map((d) => (
          <span
            key={d.day}
            title={`${d.day}: ${presenceLabels[d.status]}`}
            className={`ui-presence-${d.status}`}
          >
            {detail && d.sessionId && onOpen ? (
              <Button
                variant="link"
                onClick={() => onOpen(d.sessionId as string)}
                aria-label={`Mở buổi ${d.day}: ${presenceLabels[d.status]}`}
              >
                {glyphs[d.status]}
              </Button>
            ) : (
              <span role="img" aria-label={`${d.day}: ${presenceLabels[d.status]}`}>
                {glyphs[d.status]}
              </span>
            )}
          </span>
        ))}
      </fieldset>
      {detail && (
        <>
          <p>
            {value.present}/{value.eligible} CN đủ dữ liệu ·{" "}
            {value.rate === null ? "—" : `${value.rate}%`} · Kỳ đến {value.until}
          </p>
          <p className="small muted">
            ● Có mặt · ○ Vắng · · Chưa chốt · – Ngoài roster · ? Chưa chọn buổi
          </p>
          {value.absent3 && (
            <Feedback tone="warning">Vắng ba Chúa nhật liên tiếp có đủ dữ liệu.</Feedback>
          )}
        </>
      )}
    </div>
  );
}

import type { CSSProperties } from "react";
import type { OverviewDto } from "../../../api/overview/contracts";
export function AttendanceChart({
  value,
  communionDays,
  onOpen,
  disabled,
}: {
  value: OverviewDto["attendance"];
  communionDays: string[];
  onOpen: (id: string) => void;
  disabled: boolean;
}) {
  const maximum = Math.max(1, ...value.days.map((d) => d.present ?? 0));
  return (
    // biome-ignore lint/a11y/noNoninteractiveTabindex: chart controls must remain keyboard-reachable within the bounded horizontal viewport
    <section className="ui-report-chart-scroll" tabIndex={0} aria-label="Biểu đồ cuộn 12 Chúa nhật">
      <fieldset className="ui-report-chart" aria-label="Hiện diện 12 Chúa nhật">
        {value.days.map((d) => (
          <div key={d.day}>
            <Button
              variant="link"
              disabled={disabled || !d.sessionId}
              onClick={() => d.sessionId && onOpen(d.sessionId)}
              aria-label={`${d.day}: ${d.state === "closed" ? `${d.present}/${d.included} hiện diện` : d.sessionId ? "Chưa chốt" : "Chưa chọn buổi"}${communionDays.includes(d.day) ? "; có bản ghi Tiệc Thánh ngày này" : ""}`}
            >
              <span
                className={`ui-report-column ${communionDays.includes(d.day) ? "ui-report-communion" : ""}`}
                style={
                  {
                    "--report-height": `${d.present === null ? 8 : Math.max(4, (d.present / maximum) * 120)}px`,
                  } as CSSProperties
                }
              />
              <span>{d.present ?? "—"}</span>
              <br />
              <small>
                {d.day.slice(8)}/{d.day.slice(5, 7)}
              </small>
            </Button>
          </div>
        ))}
      </fieldset>
    </section>
  );
}
