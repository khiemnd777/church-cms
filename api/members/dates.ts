export function validDay(day: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day.startsWith("0000")) return false;
  const date = new Date(`${day}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === day;
}
export function businessDay(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (kind: string) => parts.find((p) => p.type === kind)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
export function anniversary(birthDate: string, year: number) {
  const day = `${year}-${birthDate.slice(5)}`;
  return validDay(day) ? day : `${year}-03-01`;
}
export function ageOn(birthDate: string | null, today: string): number | null {
  if (!birthDate) return null;
  const year = Number(today.slice(0, 4));
  return year - Number(birthDate.slice(0, 4)) - (today < anniversary(birthDate, year) ? 1 : 0);
}
export function birthdayFilterValid(value: string) {
  return (
    value === "week" ||
    /^month:(?:[1-9]|1[0-2])$/.test(value) ||
    (/^month:\d{4}-(?:0[1-9]|1[0-2])$/.test(value) && validDay(`${value.slice(6)}-01`))
  );
}
export function shiftDay(day: string, offset: number) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}
export function monthPeriod(today: string, offset = 0) {
  const d = new Date(`${today.slice(0, 7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + offset);
  return d.toISOString().slice(0, 7);
}
export function birthdayWindow(today: string, filter: string) {
  const year = Number(today.slice(0, 4));
  if (filter.startsWith("month:")) {
    const explicit = /^month:\d{4}-/.test(filter),
      month = Number(explicit ? filter.slice(11) : filter.slice(6)),
      selectedYear = explicit ? Number(filter.slice(6, 10)) : year;
    const end = new Date("2000-01-01T00:00:00Z");
    end.setUTCFullYear(selectedYear, month, 0);
    return {
      year: selectedYear,
      from: `${String(selectedYear).padStart(4, "0")}-${String(month).padStart(2, "0")}-01`,
      to: end.toISOString().slice(0, 10),
    };
  }
  const date = new Date(`${today}T00:00:00Z`),
    start = new Date(date);
  start.setUTCDate(start.getUTCDate() - start.getUTCDay());
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  return { year, from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
}
