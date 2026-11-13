import type { AttendanceReporting } from "../attendance/reporting";
import { policyVersion } from "../authorization/church-policy";
import type { TenantGrant } from "../authorization/tenant-grant";
import { requireCondition } from "../errors";
import type { Database } from "../infrastructure/database";
import { businessDay } from "../members/dates";
import type { OverviewMembers } from "../members/overview";
import type { OrganizationRuntime } from "../organization/runtime";
import type { Organization } from "../organization/service";
import type { PrepReporting } from "../prep-classes/reporting";
import type { RiteReporting } from "../rites/reporting";
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
    private attendance: AttendanceReporting,
    private rites: RiteReporting,
    private classes: PrepReporting,
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
        leadership = await this.runtime.overviewLeadership(g, tx, day),
        window = await this.attendance.window(g, tx),
        latest = window.days[11],
        previous = window.days[10],
        last4 = window.days.slice(-4),
        absent3 = await this.members.absent3(g, tx, window, this.attendance),
        rites = await this.rites.read(g, tx, day),
        classes = await this.classes.read(g, tx);
      requireCondition(latest && previous, 503, "DEPENDENCY_UNAVAILABLE");
      return {
        asOf: at.toISOString(),
        day,
        timezone: "Asia/Ho_Chi_Minh",
        policyVersion,
        church,
        ...people,
        organization: { ...units, ...leadership },
        attendance: {
          ...window,
          value: latest.present,
          availability: latest.state === "closed" ? "available" : "not_available",
          latest,
          delta:
            latest.present !== null && previous.present !== null
              ? latest.present - previous.present
              : null,
          average4: last4.every((d) => d.state === "closed")
            ? Math.round((last4.reduce((n, d) => n + (d.present ?? 0), 0) / 4) * 10) / 10
            : null,
          coverage4: last4.filter((d) => d.state === "closed").length,
          absent3,
        },
        rites,
        classes,
      };
    });
  }
}
