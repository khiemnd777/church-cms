import { z } from "zod";
import { requireCondition } from "../errors";
import { shiftDay } from "../members/dates";
import { daySchema, idSchema as rawIdSchema } from "../members/validation";

const idSchema = rawIdSchema.transform((id) => id.toLowerCase());
const text = (n: number) => z.string().normalize("NFC").trim().min(1).max(n);
const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
export const repeatInput = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("once") }),
  z.strictObject({
    kind: z.literal("weekly"),
    interval: z.number().int().min(1).max(4),
    weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
    until: daySchema,
  }),
  z.strictObject({
    kind: z.literal("monthly"),
    weekday: z.number().int().min(0).max(6),
    ordinals: z.array(z.number().int().min(1).max(5)).min(1).max(5),
    until: daySchema,
  }),
]);
export const scheduleInput = z.strictObject({
  label: text(200),
  kind: z.enum(["worship", "activity"]),
  scope: z.enum(["church", "unit"]),
  unitId: idSchema.nullable(),
  day: daySchema,
  startTime: time,
  endDay: daySchema,
  endTime: time,
  location: text(200).nullable(),
  scripture: text(200).nullable(),
  theme: text(500).nullable(),
  speaker: z
    .discriminatedUnion("source", [
      z.strictObject({ source: z.literal("member"), memberId: idSchema }),
      z.strictObject({ source: z.literal("external"), fullName: text(200) }),
    ])
    .nullable(),
  leaderId: idSchema.nullable(),
  choirId: idSchema.nullable(),
  communion: z.boolean(),
  repeat: repeatInput,
});
export const commandInput = z.strictObject({
  input: scheduleInput,
  state: z.enum(["draft", "scheduled", "cancelled"]),
  range: z.enum(["one", "future"]),
  reason: text(500).nullable(),
  preview: z.string().max(100).nullable(),
  conflictsConfirmed: z.boolean(),
  exceptionsConfirmed: z.boolean(),
});
export type ScheduleInput = z.infer<typeof scheduleInput>;
export type ScheduleCommand = z.infer<typeof commandInput>;
export function times(i: ScheduleInput) {
  const start = new Date(`${i.day}T${i.startTime}:00+07:00`),
    end = new Date(`${i.endDay}T${i.endTime}:00+07:00`);
  requireCondition(
    end > start && end.getTime() - start.getTime() <= 86400000,
    422,
    "SCHEDULE_TIME_INVALID",
  );
  requireCondition((i.scope === "church") === (i.unitId === null), 422, "VALIDATION_FAILED");
  return { start, end };
}
export function expand(i: ScheduleInput, single = false) {
  const { start, end } = times(i),
    r = i.repeat,
    duration = end.getTime() - start.getTime();
  const until = single || r.kind === "once" ? i.day : r.until;
  requireCondition(until >= i.day && until <= shiftDay(i.day, 364), 422, "SCHEDULE_RANGE_LIMIT");
  if (r.kind === "weekly")
    requireCondition(new Set(r.weekdays).size === r.weekdays.length, 422, "VALIDATION_FAILED");
  if (r.kind === "monthly")
    requireCondition(new Set(r.ordinals).size === r.ordinals.length, 422, "VALIDATION_FAILED");
  const first = new Date(`${i.day}T00:00:00Z`),
    firstWeek = Math.floor((first.getTime() / 86400000 - first.getUTCDay()) / 7);
  const result: { day: string; start: Date; end: Date }[] = [];
  for (let day = i.day; day <= until; day = shiftDay(day, 1)) {
    const d = new Date(`${day}T00:00:00Z`),
      weekday = d.getUTCDay();
    const week = Math.floor((d.getTime() / 86400000 - weekday) / 7);
    const include =
      single ||
      r.kind === "once" ||
      (r.kind === "weekly"
        ? r.weekdays.includes(weekday) && (week - firstWeek) % r.interval === 0
        : r.weekday === weekday && r.ordinals.includes(Math.ceil(d.getUTCDate() / 7)));
    if (include) {
      const at = new Date(`${day}T${i.startTime}:00+07:00`);
      result.push({ day, start: at, end: new Date(at.getTime() + duration) });
      requireCondition(result.length <= 200, 422, "SCHEDULE_OCCURRENCE_LIMIT");
    }
  }
  requireCondition(result.length > 0, 422, "SCHEDULE_EMPTY");
  return result;
}
