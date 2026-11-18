import { describe, expect, test } from "bun:test";
import { compositionIssues } from "../scripts/ui-composition-check";

const issues = (source: string) => compositionIssues("sample.tsx", source);
describe("UI-COMPOSITION-r1 structure", () => {
  test("rejects the original conditional/fragment composition even with error/loading branches", () => {
    expect(
      issues(
        "<Card>{error && <Feedback/>}{row && <><div/><p/><strong/><Feedback/><p/><TableFrame/></>}</Card>",
      ).length,
    ).toBe(1);
  });
  test("rejects metadata/actions with no spacing owner", () => {
    expect(issues("<Card><p/><p/><Button/></Card>").length).toBe(1);
    expect(
      issues("<Card><SectionHeader/><TableFrame/>{more && <PaginationControl/>}</Card>").length,
    ).toBe(1);
  });
  test("checks nested cards independently and preserves bounded single-body patterns", () => {
    expect(issues("<Card><Stack><Card><p/><p/></Card></Stack></Card>").length).toBe(1);
    expect(issues("<Card><SectionHeader/><KeyValueList/></Card>")).toEqual([]);
    expect(issues("<Card>{/* note */}<Stack/></Card>")).toEqual([]);
  });
  test("checks both sides of a conditional and mapped ungrouped children", () => {
    expect(issues("<Card>{ok ? <p/> : <><p/><p/></>}</Card>").length).toBe(1);
    expect(issues("<Card>{items.map(x => <p key={x}/>)}</Card>").length).toBe(1);
  });
  test("a bare wrapper does not hide missing spacing, even inside a spaced Card", () => {
    expect(issues("<Card><div><p/><p/></div></Card>").length).toBe(1);
    expect(issues('<Card spacing="content"><div><p/><p/></div></Card>').length).toBe(1);
    expect(issues("<Card><Stack><p/><p/></Stack></Card>")).toEqual([]);
  });
  test("permits explicit layout owners and the documented source patterns", () => {
    expect(issues('<Card spacing="section"><ContentSection/><ContentSection/></Card>')).toEqual([]);
    expect(issues('<Card className="kpi"><div/><div/></Card>')).toEqual([]);
    expect(issues('<Card className="program-section"><p/><p/></Card>')).toEqual([]);
    expect(issues('<Card className="ui-auth-card"><Brand/><h1/><form/></Card>')).toEqual([]);
    expect(issues('<Card className="unknown"><p/><p/></Card>').length).toBe(1);
  });
});
