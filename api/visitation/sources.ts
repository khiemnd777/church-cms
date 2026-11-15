import type { ClientSession } from "mongodb";
import type { TenantGrant } from "../authorization/tenant-grant";
import type { VisitationFamilies } from "../families/visitation";
import type { VisitationMembers } from "../members/visitation";
import { canonical } from "../operations/service";
import type { VisitCase, VisitSnapshot } from "./models";
import type { VisitTarget } from "./validation";
export class VisitationSources {
  constructor(
    private members: VisitationMembers,
    private families: VisitationFamilies,
  ) {}
  async target(g: TenantGrant, target: VisitTarget, tx: ClientSession) {
    const person = target.kind === "member" ? await this.members.person(g, target.id, tx) : null;
    const familyId = target.kind === "family" ? target.id : person?.familyId;
    const family = familyId ? await this.families.family(g, familyId, tx) : null;
    const snapshot: VisitSnapshot | null =
      target.kind === "member" && person
        ? {
            kind: target.kind,
            id: person.id,
            code: person.code,
            name: person.fullName,
            phone: person.phone,
            familyId: person.familyId,
            familyCode: family?.code ?? null,
            familyName: family?.name ?? null,
            address: family?.address ?? null,
          }
        : target.kind === "family" && family
          ? {
              kind: target.kind,
              id: family.id,
              code: family.code,
              name: family.name ?? family.code,
              phone: null,
              familyId: family.id,
              familyCode: family.code,
              familyName: family.name,
              address: family.address,
            }
          : null;
    return {
      person,
      family,
      snapshot,
      available: !!family?.available && (target.kind === "family" || !!person?.available),
    };
  }
  person(g: TenantGrant, id: string, tx: ClientSession) {
    return this.members.person(g, id, tx);
  }
  page(
    g: TenantGrant,
    kind: VisitTarget["kind"],
    q: string,
    after: { key: string; id: string } | null,
    limit: number,
    tx: ClientSession,
  ) {
    return kind === "member"
      ? this.members.page(g, q, after, limit, tx)
      : this.families.page(g, q, after, limit, tx);
  }
  async current(g: TenantGrant, c: VisitCase, tx: ClientSession) {
    const target = await this.target(g, { kind: c.targetKind, id: c.targetId.toHexString() }, tx),
      assignee = c.assigneeId ? await this.person(g, c.assigneeId.toHexString(), tx) : null;
    return {
      targetAvailable: target.available,
      assigneeAvailable: !c.assigneeId || !!assignee?.available,
      changed:
        canonical(target.snapshot) !== canonical(c.targetSnapshot) ||
        canonical(
          assignee ? { id: assignee.id, code: assignee.code, fullName: assignee.fullName } : null,
        ) !== canonical(c.assigneeSnapshot),
      target: target.snapshot,
      assignee: assignee
        ? { id: assignee.id, code: assignee.code, fullName: assignee.fullName }
        : null,
    };
  }
  async fence(
    g: TenantGrant,
    target: Awaited<ReturnType<VisitationSources["target"]>>,
    people: NonNullable<Awaited<ReturnType<VisitationSources["person"]>>>[],
    tx: ClientSession,
  ) {
    const persons = [...(target.person ? [target.person] : []), ...people];
    for (const p of new Map(persons.map((p) => [p.id, p])).values())
      await this.members.fence(g, p, tx);
    if (target.family) await this.families.fence(g, target.family, tx);
  }
}
