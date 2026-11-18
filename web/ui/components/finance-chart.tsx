export interface FinancialPoint {
  period: string;
  netIncome: string | null;
  state: "open" | "closed" | "future";
}
/** Only the bounded SVG scale uses Number; original monetary strings never lose precision. */
export function FinanceChart({ months, year }: { months: FinancialPoint[]; year: string }) {
  const amounts = months.flatMap((m) => (m.netIncome === null ? [] : [BigInt(m.netIncome)])),
    negative = amounts.some((a) => a < 0n),
    max = amounts.reduce((a, b) => (a > (b < 0n ? -b : b) ? a : b < 0n ? -b : b), 1n),
    baseline = negative ? 100 : 180,
    scale = negative ? 75 : 150,
    scrollClass = "chart ui-finance-chart ui-report-chart-scroll";
  return (
    // biome-ignore lint/a11y/noNoninteractiveTabindex: named bounded chart needs keyboard scrolling, as in AttendanceChart and TableFrame
    <section className={scrollClass} tabIndex={0} aria-label="Biểu đồ cuộn 12 tháng">
      <svg
        style={{ minWidth: 640 }}
        viewBox="0 0 640 220"
        role="img"
        aria-label={`Thu ròng từng tháng năm ${year}; số tiền chính xác trong Chi tiết số liệu`}
      >
        <line x1={30} x2={630} y1={baseline} y2={baseline} />
        {months.map((m, i) => {
          const amount = m.netIncome === null ? null : BigInt(m.netIncome),
            magnitude = amount === null ? 0n : amount < 0n ? -amount : amount,
            height =
              amount === null || amount === 0n
                ? 0
                : Math.max(1, Number((magnitude * BigInt(scale * 100)) / max) / 100),
            x = 36 + i * 49;
          return (
            <g key={m.period} className={`ui-finance-${m.state}`}>
              {amount !== null ? (
                <rect
                  x={x}
                  y={amount < 0n ? baseline : baseline - height}
                  width={30}
                  height={height}
                  rx={3}
                />
              ) : (
                <text x={x + 15} y={baseline - 6} textAnchor="middle">
                  —
                </text>
              )}
              <text x={x + 15} y={211} textAnchor="middle">
                T{i + 1}
              </text>
            </g>
          );
        })}
      </svg>
    </section>
  );
}
