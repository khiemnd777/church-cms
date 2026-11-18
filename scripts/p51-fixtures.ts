import type { FinanceSettingsInput } from "../api/finance/validation";
import { check, type SyntheticClient } from "./p2-fixtures";
export const financeSetup: FinanceSettingsInput = {
  proposerRoles: ["secretary", "treasurer", "ministry_lead"],
  approverRole: "pastor",
};
export const financeRoot = (c: { id: string }) => `churches/${c.id}/finance`;
export async function financeChurch(owner: SyntheticClient, label = "P5.1 synthetic") {
  const r = await owner.call("owner/churches", {
    name: `${label} ${crypto.randomUUID()}`,
    province: "Đà Nẵng",
  });
  check(r.status === 201, "Create synthetic church");
  const c = r.payload.data.church as { id: string; code: string };
  check(
    (
      await owner.call(`owner/churches/${c.id}/organization/settings`, {
        unitType: "area",
        defaultAssignmentMode: "manual",
      })
    ).status === 201,
    "Configure organization independently",
  );
  const unit = await owner.call(`owner/churches/${c.id}/organization/units`, {
    kind: "service_ministry",
    name: "Ban synthetic",
  });
  check(unit.status === 201, "Create synthetic scope unit");
  return { ...c, unitId: unit.payload.data.unit.id as string };
}
