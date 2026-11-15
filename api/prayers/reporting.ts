import type { ClientSession } from "mongodb";
import type { TenantGrant } from "../authorization/tenant-grant";
import { requireCondition } from "../errors";
import type { PrayerGrant } from "./models";
import type { Prayers } from "./service";
export class PrayerReporting {
  constructor(private prayers: Prayers) {}
  async read(g: TenantGrant, tx: ClientSession) {
    requireCondition(g.prayerAudience, 403, "FORBIDDEN");
    return {
      active: await this.prayers.activeCount(g as PrayerGrant, tx),
      availability: "available" as const,
    };
  }
}
