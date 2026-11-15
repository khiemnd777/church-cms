import { canonical } from "../operations/service";
import { type ProgramRow, templateKeys, templateTitles } from "./validation";
export function generateRows(
  people: { id: string }[],
  scripture: string | null,
  theme: string | null,
  speakerId: string | null,
  existing: ProgramRow[] = [],
): ProgramRow[] {
  let next = 0;
  return templateKeys.map((key, index) => ({
    id: existing.find((r) => r.templateKey === key)?.id ?? crypto.randomUUID(),
    templateKey: key,
    title: templateTitles[index] as string,
    detail: key === "word" ? [scripture, theme].filter(Boolean).join(" · ") : "",
    assignment:
      key === "word"
        ? speakerId && people.some((p) => p.id === speakerId)
          ? { mode: "member" as const, memberId: speakerId }
          : { mode: "unassigned" as const }
        : people.length
          ? {
              mode: "member" as const,
              memberId: (people[next++ % people.length] as { id: string }).id,
            }
          : { mode: "unassigned" as const },
  }));
}
export function mergeGenerated(
  rows: ProgramRow[],
  baseline: ProgramRow[],
  generated: ProgramRow[],
): ProgramRow[] {
  return rows.map((row) => {
    const prior = baseline.find((r) => r.templateKey === row.templateKey && r.templateKey !== null),
      fresh = generated.find((r) => r.templateKey === row.templateKey && r.templateKey !== null);
    if (!prior || !fresh) return row;
    return {
      ...row,
      title: row.title === prior.title ? fresh.title : row.title,
      detail: row.detail === prior.detail ? fresh.detail : row.detail,
      assignment:
        canonical(row.assignment) === canonical(prior.assignment)
          ? fresh.assignment
          : row.assignment,
    };
  });
}
