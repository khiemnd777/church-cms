import { describe, expect, test } from "bun:test";
import { capabilitiesFor, policyVersion } from "../api/authorization/church-policy";
import { ownerCapabilities } from "../api/authorization/owner-policy";
import { fundInput, fundStatusInput, settingsInput } from "../api/finance/validation";

describe("P5.1 approved financial boundaries", () => {
  test("NFC names and spaces, exact boundaries and strict request fields", () => {
    expect(fundInput.parse({ name: "  Quỹ  \n Truyền giáo  " }).name).toBe("Quỹ Truyền giáo");
    for (const name of ["", " \t ", "a".repeat(101)])
      expect(fundInput.safeParse({ name }).success).toBe(false);
    expect(fundInput.safeParse({ name: "a".repeat(100) }).success).toBe(true);
    expect(fundInput.safeParse({ name: "Quỹ", balance: 0 }).success).toBe(false);
    expect(fundStatusInput.safeParse({ status: "inactive", reason: " " }).success).toBe(false);
    expect(fundStatusInput.safeParse({ status: "deleted", reason: "Có lý do" }).success).toBe(
      false,
    );
  });
  test("configuration is explicit, role allowlists and unique roles; no self-approval switch", () => {
    for (const value of [
      {},
      { proposerRoles: [], approverRole: null },
      { proposerRoles: ["pastor"], approverRole: "pastor" },
      { proposerRoles: ["secretary", "secretary"], approverRole: "pastor" },
      { proposerRoles: [], approverRole: "member" },
      { proposerRoles: [], approverRole: "pastor", autoApprove: true },
    ])
      expect(settingsInput.safeParse(value).success).toBe(false);
    expect(settingsInput.parse({ proposerRoles: [], approverRole: "secretary" })).toEqual({
      proposerRoles: [],
      approverRole: "secretary",
    });
  });
  test("policy23 advertises approved finance read/write actions only; owner never inherits", () => {
    expect(policyVersion).toBe(26);
    expect(capabilitiesFor("pastor")).toContain("finance:settings:manage");
    expect(capabilitiesFor("treasurer")).toContain("finance:funds:read");
    expect(capabilitiesFor("treasurer")).not.toContain("organization:read");
    expect(capabilitiesFor("treasurer")).not.toContain("members:read");
    expect(capabilitiesFor("treasurer")).toContain("finance:codes:manage");
    expect(capabilitiesFor("treasurer")).toContain("finance:receipts:manage");
    expect(capabilitiesFor("pastor")).toContain("finance:receipts:read");
    expect(capabilitiesFor("pastor")).toContain("finance:payments:read");
    expect(capabilitiesFor("treasurer")).toContain("finance:payments:manage");
    expect(capabilitiesFor("treasurer")).toContain("finance:payments:void");
    expect(capabilitiesFor("treasurer")).toContain("finance:periods:close");
    expect(capabilitiesFor("pastor")).toContain("finance:periods:read");
    expect(capabilitiesFor("pastor")).not.toContain("finance:periods:close");
    expect(capabilitiesFor("pastor")).not.toContain("finance:receipts:manage");
    expect(capabilitiesFor("treasurer")).not.toContain("finance:settings:manage");
    for (const r of ["secretary", "ministry_lead", "member"] as const)
      expect(capabilitiesFor(r).some((c) => c.startsWith("finance:"))).toBe(false);
    expect(ownerCapabilities.some((c) => c.startsWith("finance:"))).toBe(false);
    expect(
      capabilitiesFor("pastor").some((c) =>
        /finance.*(approve|close)|finance:payments:manage/.test(c),
      ),
    ).toBe(false);
  });
});
