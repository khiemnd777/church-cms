import { type ClientSession, ObjectId } from "mongodb";
import type { AttendanceReporting } from "../attendance/reporting";
import type { TenantGrant } from "../authorization/tenant-grant";
import type { CareFamilies } from "../families/care";
import type { CareMembers } from "../members/care";
import { shiftDay } from "../members/dates";
import type { CareEvidence, CareSignal, CareSnapshot, CareTarget } from "./models";
import { careKinds } from "./validation";
export const targetKey = (t: CareTarget) => `${t.kind}:${t.id}`;
export class CareSources {
  constructor(
    private members: CareMembers,
    private families: CareFamilies,
    private attendance: AttendanceReporting,
  ) {}
  window(g: TenantGrant, tx: ClientSession) {
    return this.attendance.window(g, tx);
  }
  page(g: TenantGrant, after: string | null, limit: number, tx: ClientSession) {
    return this.members.page(g, after, limit, tx);
  }
  async load(g: TenantGrant, targets: CareTarget[], tx: ClientSession) {
    const ids = (kind: CareTarget["kind"]) => [
      ...new Set(targets.filter((t) => t.kind === kind).map((t) => t.id)),
    ];
    const members = await this.members.facts(g, ids("member"), tx),
      families = await this.families.facts(g, ids("family"), tx),
      window = await this.window(g, tx);
    const presence = await this.attendance.members(
      g,
      ids("member").map((id) => new ObjectId(id)),
      tx,
      window,
    );
    return { members, families, window, presence };
  }
  assess(
    target: CareTarget,
    signals: CareSignal[],
    ctx: Awaited<ReturnType<CareSources["load"]>>,
    day: string,
  ) {
    const p = target.kind === "member" ? ctx.members.get(target.id) : ctx.families.get(target.id),
      snapshot: CareSnapshot | null = p ? { ...target, code: p.code, name: p.name } : null,
      available = !!p?.available,
      recent = (date: string) => date >= shiftDay(day, -29) && date <= day;
    const kinds = careKinds.filter((k) =>
      target.kind === "family" ? k === "bereavement" : k !== "bereavement",
    );
    return {
      target,
      p,
      snapshot,
      available,
      conditions: kinds.map((kind) => {
        const evidence: CareEvidence[] = [];
        let qualifies: boolean | null = false;
        if (available) {
          if (kind === "absence") {
            const last = ctx.window.days.slice(-3);
            qualifies = last.every((d) => d.state === "closed")
              ? (ctx.presence.get(target.id)?.absent3 ?? false)
              : null;
            if (qualifies)
              for (const d of last)
                evidence.push({
                  type: "attendance",
                  id: d.sessionId as string,
                  version: d.version as number,
                  day: d.day,
                  summary: null,
                });
          } else {
            const member = ctx.members.get(target.id);
            if (kind === "new_believer" && member?.belief && recent(member.belief))
              evidence.push({
                type: "belief",
                id: member.id,
                version: member.version,
                day: member.belief,
                summary: null,
              });
            for (const s of signals.filter((s) => s.state === "open" && s.kind === kind))
              if (kind !== "new_believer" || recent(s.occurredOn))
                evidence.push({
                  type: "signal",
                  id: s._id.toHexString(),
                  version: s.version,
                  day: s.occurredOn,
                  summary: s.summary,
                });
            qualifies = evidence.length > 0;
          }
        }
        return { kind, qualifies, evidence };
      }),
    };
  }
  async fence(g: TenantGrant, source: ReturnType<CareSources["assess"]>, tx: ClientSession) {
    if (source.p)
      await (source.target.kind === "member" ? this.members : this.families).fence(g, source.p, tx);
  }
}
