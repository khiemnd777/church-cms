import type { ClientSession } from "mongodb";
import { requireCondition } from "../errors";
import { businessDay } from "../members/dates";
import type { ProgramMembers, ProgramUnitRef } from "../members/programs";
import type { ProgramOrganization } from "../organization/programs";
import type { Scheduling } from "../scheduling/service";
import type { Tenancy } from "../tenancy/service";
import type { ProgramDraft, ProgramGrant, ProgramSnapshot } from "./models";
import type { ProgramRow } from "./validation";
export class ProgramSources {
  constructor(
    private members: ProgramMembers,
    readonly organization: ProgramOrganization,
    private scheduling: Pick<Scheduling, "programSource" | "programOccurrences">,
    private tenancy: Pick<Tenancy, "overview">,
    private now: () => Date,
  ) {}
  async capture(
    g: ProgramGrant,
    unitId: string,
    occurrenceId: string,
    tx: ClientSession,
    rows: ProgramRow[] = [],
    old: ProgramDraft | null = null,
    writing = false,
    suggest = false,
    fence = false,
  ) {
    const cal = await this.scheduling.programSource(g, occurrenceId, unitId, tx, fence),
      day =
        cal.source?.input.day ??
        (old ? businessDay(new Date(old.snapshot.startAt)) : null) ??
        businessDay(this.now());
    const ctx = await this.organization.context(g, unitId, day, tx, writing);
    if (writing)
      requireCondition(
        cal.editable && ctx.unit.status === "active",
        422,
        "PROGRAM_SOURCE_UNAVAILABLE",
      );
    const ref: ProgramUnitRef = {
      id: unitId,
      kind: ctx.unit.kind,
      termMemberIds: ctx.term?.memberIds ?? null,
    };
    const candidates =
      suggest && ctx.available ? await this.members.candidates(g, ref, tx, 50) : [];
    const speaker = cal.source?.input.speaker;
    if (
      suggest &&
      ctx.available &&
      speaker?.source === "member" &&
      !candidates.some((p) => p.id === speaker.memberId)
    ) {
      const [person] = await this.members.selected(g, ref, [speaker.memberId], tx);
      if (person) {
        if (candidates.length === 50) candidates.pop();
        candidates.push(person);
      }
    }
    const ids = [
      ...new Set(
        rows.flatMap((r) => (r.assignment.mode === "member" ? [r.assignment.memberId] : [])),
      ),
    ];
    const selected = ctx.available ? await this.members.selected(g, ref, ids, tx) : [];
    const invalid = ids.filter((id) => !selected.some((p) => p.id === id));
    for (const row of rows)
      if (row.assignment.mode === "member" && invalid.includes(row.assignment.memberId)) {
        const prior = old?.rows.find((p) => p.id === row.id);
        requireCondition(
          prior?.assignment.mode === "member" &&
            prior.assignment.memberId === row.assignment.memberId,
          422,
          "PROGRAM_PERSON_UNAVAILABLE",
        );
      }
    const people = ids.flatMap((id) => {
      const p = selected.find((p) => p.id === id) ?? old?.people.find((p) => p.id === id);
      return p ? [{ id: p.id, fullName: p.fullName, code: p.code }] : [];
    });
    const church = await this.tenancy.overview(g.churchId, tx);
    const source = cal.source;
    const snapshot: ProgramSnapshot = source
      ? {
          churchName: church.name,
          unitName: ctx.unit.name,
          label: source.input.label,
          startAt: source.startAt,
          endAt: source.endAt,
          location: source.input.location,
          scripture: source.input.scripture,
          theme: source.input.theme,
          sourceVersion: source.version,
          sourceAvailable: ctx.available,
          termLabel: ctx.term?.label ?? null,
          capturedAt: this.now().toISOString(),
        }
      : (old?.snapshot ?? {
          churchName: church.name,
          unitName: ctx.unit.name,
          label: "Nguồn không còn phù hợp",
          startAt: "",
          endAt: "",
          location: null,
          scripture: null,
          theme: null,
          sourceVersion: 0,
          sourceAvailable: false,
          termLabel: null,
          capturedAt: this.now().toISOString(),
        });
    if (fence) {
      await this.organization.fence(g, ctx, tx);
      for (const p of selected) await this.members.fence(g, ref, p, tx);
    }
    return {
      cal,
      ctx,
      ref,
      candidates,
      selected,
      invalid,
      people,
      snapshot,
      available: cal.matches && ctx.available,
    };
  }
  async people(
    g: ProgramGrant,
    unitId: string,
    occurrenceId: string,
    tx: ClientSession,
    limit: number,
    q: string,
    after: { key: string; id: string } | null,
  ) {
    const s = await this.capture(g, unitId, occurrenceId, tx, [], null, true);
    const rows = s.ctx.available
      ? await this.members.candidates(g, s.ref, tx, limit, q, after)
      : [];
    return {
      rows,
      available: s.ctx.available,
      context: [
        s.ctx.unit.version,
        s.ctx.term?.id ?? null,
        s.ctx.term?.version ?? null,
        s.snapshot.sourceVersion,
      ],
    };
  }
  async fence(
    g: ProgramGrant,
    s: Awaited<ReturnType<ProgramSources["capture"]>>,
    tx: ClientSession,
  ) {
    await this.scheduling.programSource(g, s.cal.source?.id ?? "", s.ctx.unit.id, tx, true);
    await this.organization.fence(g, s.ctx, tx);
    for (const p of s.selected) await this.members.fence(g, s.ref, p, tx);
  }
  occurrences(g: ProgramGrant, unitId: string, q: URLSearchParams) {
    return this.scheduling.programOccurrences(g, unitId, q);
  }
}
