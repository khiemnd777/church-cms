import { policyVersion } from "../authorization/church-policy";
import type { TenantGrant } from "../authorization/tenant-grant";
import { requireCondition } from "../errors";
import type { Database } from "../infrastructure/database";
import { businessDay } from "../members/dates";
import type { OverviewMembers } from "../members/overview";
import type { OrganizationRuntime } from "../organization/runtime";
import type { Organization } from "../organization/service";
import type { Tenancy } from "../tenancy/service";
import type { OverviewDto } from "./contracts";
export class Overview {
  constructor(
    private db: Database,
    private tenancy: Tenancy,
    private members: OverviewMembers,
    private organization: Organization,
    private runtime: OrganizationRuntime,
    private now: () => Date,
  ) {}
  async get(g: TenantGrant): Promise<OverviewDto> {
    requireCondition(!g.unitScope && !g.receiptScope, 403, "FORBIDDEN");
    return this.db.readSnapshot(g.churchId.toHexString(), async (tx) => {
      await g.fence(tx);
      const at = this.now(),
        day = businessDay(at),
        church = await this.tenancy.overview(g.churchId, tx),
        people = await this.members.read(g, tx, day),
        units = await this.organization.overview(
          g,
          tx,
          people.areas.flatMap((a) => (a.id ? [a.id] : [])),
        ),
        leadership = await this.runtime.overviewLeadership(g, tx, day);
      return {
        asOf: at.toISOString(),
        day,
        timezone: "Asia/Ho_Chi_Minh",
        policyVersion,
        church,
        ...people,
        organization: { ...units, ...leadership },
        attendance: { value: null, availability: "not_available" },
        rites: { value: null, availability: "not_available" },
      };
    });
  }
}
