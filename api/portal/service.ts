import type { ClientSession, ObjectId } from "mongodb";
import type { ChurchGrant } from "../authorization/church-grant";
import type { TenantGrant } from "../authorization/tenant-grant";
import { requireCondition } from "../errors";
import type { FinancePersonalGiving } from "../finance/personal-giving";
import type { Database } from "../infrastructure/database";
import { businessDay, validDay } from "../members/dates";
import { type PortalMembers, portalEligible } from "../members/portal";
import type { Prayers } from "../prayers/service";
import type { PortalRites } from "../rites/portal";
import { TenantQueries } from "../tenant-queries";

export interface PortalGrant extends ChurchGrant {
  subjectMemberId?: ObjectId;
  subjectMemberVersion?: number;
}
export class MemberPortal {
  private query: TenantQueries;
  constructor(
    private db: Database,
    private members: PortalMembers,
    private rites: PortalRites,
    private giving: FinancePersonalGiving,
    private prayers: Prayers,
    key: string,
    private now: () => Date,
  ) {
    this.query = new TenantQueries(key, now, "member-portal");
  }
  // All personal projections resolve their subject from the fresh account-backed grant.
  private async subject(g: PortalGrant, tx: ClientSession) {
    requireCondition(g.role === "member" && g.scope.kind === "self", 403, "FORBIDDEN");
    g.require("portal:self");
    await g.fence(tx);
    if (!g.subjectMemberId || !g.subjectMemberVersion)
      return { state: "unlinked" as const, member: null };
    const m = await this.members.profile(g.churchId, g.subjectMemberId, tx);
    if (
      !m ||
      !portalEligible(m) ||
      m.version < g.subjectMemberVersion ||
      (await this.members.accessBroken(g.churchId, m.id, g.subjectMemberVersion, tx))
    )
      return { state: "unavailable" as const, member: null };
    await this.members.fence(g.churchId, m.id, m.version, tx);
    return { state: "linked" as const, member: m };
  }
  profile(g: PortalGrant) {
    return this.db.readSnapshot(g.churchId.toHexString(), async (tx) => {
      const { state, member } = await this.subject(g, tx);
      return {
        state,
        profile: member
          ? {
              code: member.code,
              fullName: member.fullName,
              birthDate: member.birthDate,
              gender: member.gender,
              phone: member.phone,
              membership: member.membership,
              participation: member.participation,
              baptism: member.baptism,
            }
          : null,
      };
    });
  }
  rituals(g: PortalGrant, q: URLSearchParams) {
    this.query.allow(q, ["limit", "cursor"]);
    const limit = this.query.limit(q),
      token = q.get("cursor");
    return this.db.readSnapshot(g.churchId.toHexString(), async (tx) => {
      const { member } = await this.subject(g, tx);
      requireCondition(member, 403, "PORTAL_LINK_REQUIRED");
      const context = this.pageContext(g, "rituals", member.id);
      const rows = await this.rites.page(
        g.churchId,
        member.id,
        token ? this.query.decode(token, context) : null,
        limit + 1,
        tx,
      );
      const more = rows.length > limit;
      if (more) rows.pop();
      const last = rows.at(-1);
      return {
        items: rows,
        nextCursor: more && last ? this.query.encode(context, last.date ?? "", last.id) : null,
      };
    });
  }

  private pageContext(g: PortalGrant, route: string, memberId: ObjectId, period?: string) {
    const scope: TenantGrant = {
      actorKind: "church_user",
      churchId: g.churchId,
      actorId: g.actorId,
      canWrite: false,
      policyContext: String(g.version),
      fence: g.fence,
    };
    const filters = [memberId.toHexString(), g.subjectMemberVersion];
    return this.query.context(scope, route, period ? [...filters, period] : filters);
  }

  contributions(g: PortalGrant, q: URLSearchParams) {
    this.query.allow(q, ["period", "limit", "cursor"]);
    const period = q.get("period") ?? businessDay(this.now()).slice(0, 7);
    requireCondition(validDay(`${period}-01`), 400, "INVALID_REQUEST");
    const limit = this.query.limit(q);
    return this.db.readSnapshot(g.churchId.toHexString(), async (tx) => {
      const { member } = await this.subject(g, tx);
      requireCondition(member, 403, "PORTAL_LINK_REQUIRED");
      const context = this.pageContext(g, "giving", member.id, period);
      const token = q.get("cursor");
      const page = await this.giving.page(
        g.churchId,
        member.id,
        period,
        token !== null ? this.query.decode(token, context) : null,
        limit + 1,
        tx,
      );
      const more = page.rows.length > limit;
      if (more) page.rows.pop();
      const last = page.rows.at(-1);
      return {
        period,
        net: page.net,
        items: page.rows.map(({ businessDate, fundName, amount, state }) => ({
          businessDate,
          fundName,
          amount,
          state,
        })),
        nextCursor: more && last ? this.query.encode(context, last.businessDate, last.id) : null,
      };
    });
  }

  prayerRequests(g: PortalGrant, q: URLSearchParams) {
    this.query.allow(q, ["limit", "cursor"]);
    const limit = this.query.limit(q),
      token = q.get("cursor");
    return this.db.readSnapshot(g.churchId.toHexString(), async (tx) => {
      const { member } = await this.subject(g, tx);
      requireCondition(member, 403, "PORTAL_LINK_REQUIRED");
      const context = this.pageContext(g, "prayers", member.id);
      const after = token === null ? null : this.query.decode(token, context);
      const rows = await this.prayers.personalPage(
        g.churchId,
        g.actorId,
        member.id,
        after?.id ?? null,
        limit + 1,
        tx,
      );
      const more = rows.length > limit;
      if (more) rows.pop();
      const last = rows.at(-1);
      return {
        items: rows,
        nextCursor: more && last ? this.query.encode(context, "", last.id) : null,
      };
    });
  }

  sendPrayer(g: PortalGrant, raw: unknown, key: string | null, requestId: string) {
    requireCondition(g.subjectMemberId, 403, "PORTAL_LINK_REQUIRED");
    return this.prayers.sendPersonal(
      {
        actorKind: "church_user",
        actorId: g.actorId,
        churchId: g.churchId,
        memberId: g.subjectMemberId,
        canWrite: true, // This grant is confined to the dedicated portal submission.
        policyContext: String(g.version),
        fence: async (tx) => {
          const { member } = await this.subject(g, tx);
          requireCondition(member, 403, "PORTAL_LINK_REQUIRED");
        },
      },
      raw,
      key,
      requestId,
    );
  }
}
