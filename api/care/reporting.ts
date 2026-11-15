import type { ClientSession } from "mongodb";
import type { TenantGrant } from "../authorization/tenant-grant";
import type { CareGrant } from "./models";
import type { Care } from "./service";
export class CareReporting {
  constructor(private care: Care) {}
  async read(g: TenantGrant, tx: ClientSession) {
    return {
      ...(await this.care.assessment(g as CareGrant, tx)),
      availability: "available" as const,
    };
  }
}
