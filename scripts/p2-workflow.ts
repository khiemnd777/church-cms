import { importFields } from "../api/data-exchange/contracts";
import { fileDigest, makeFile } from "../api/data-exchange/files";
import { businessDay } from "../api/members/dates";
import { check, type SyntheticClient } from "./p2-fixtures";
export async function p2Workflow(
  owner: SyntheticClient,
  secretary: SyntheticClient,
  church: { id: string; code: string },
) {
  const b = `churches/${church.id}`,
    o = `owner/${b}`,
    day = businessDay(),
    results: string[] = [];
  const ok = (condition: unknown, name: string) => {
    check(condition, name);
    results.push(name);
  };
  ok(
    (
      await owner.call(
        `${o}/organization/settings`,
        { unitType: "custom", customUnitLabel: "Giáo khu" },
        { method: "PATCH", version: 1 },
      )
    ).status === 200,
    "P21 config public API",
  );
  const area = await owner.call(`${o}/organization/units`, {
      kind: "area",
      name: "Giáo khu workflow synthetic",
    }),
    service = await owner.call(`${o}/organization/units`, {
      kind: "service_ministry",
      name: "Ban workflow synthetic",
    });
  ok(area.status === 201 && service.status === 201, "P21 organization units");
  const areaId = area.payload.data.unit.id as string,
    serviceId = service.payload.data.unit.id as string;
  const make = (name: string, extra: object = {}) => ({
    fullName: name,
    gender: "unknown",
    birthDate: "2000-01-02",
    phone: null,
    type: "believer",
    membership: "member",
    householdRole: "head",
    baptism: { status: "unknown", date: null, place: null },
    visitor: null,
    family: { kind: "new", areaId },
    assignment: { mode: "auto", unitIds: [] },
    assignmentContext: { settingsVersion: 2, asOfDate: day },
    consent: true,
    ...extra,
  });
  const a = await secretary.call(`${b}/members`, make("Nguyễn workflow synthetic"));
  ok(a.status === 201, "P22 member create");
  const personA = a.payload.data.member.id as string;
  const profileA = (await secretary.call(`${b}/members/${personA}`)).payload.data,
    familyId = profileA.familyId as string;
  const v = await secretary.call(
    `${b}/members`,
    make("Trần visitor workflow synthetic", {
      type: "visitor",
      membership: null,
      householdRole: "child",
      family: { kind: "existing", id: familyId },
      visitor: {
        stage: "exploring",
        firstVisit: day,
        believedOn: null,
        referrer: null,
        caregiverId: null,
      },
    }),
  );
  ok(v.status === 201, "P22 visitor create");
  const personV = v.payload.data.member.id as string;
  ok(
    (
      await secretary.call(
        `${b}/members/${personV}/conversion`,
        { effectiveOn: day, believedOn: day, reason: "Synthetic conversion workflow" },
        { version: 1 },
      )
    ).status === 200,
    "P22 conversion retains identity",
  );
  let family = (await secretary.call(`${b}/families/${familyId}`)).payload.data;
  ok(
    (
      await secretary.call(
        `${b}/families/${familyId}`,
        { name: "Gia đình workflow synthetic", address: "Địa chỉ workflow synthetic" },
        { method: "PATCH", version: family.version },
      )
    ).status === 200,
    "P23 family metadata history",
  );
  family = (await secretary.call(`${b}/families/${familyId}`)).payload.data;
  const child = (await secretary.call(`${b}/members/${personV}`)).payload.data;
  ok(
    (
      await secretary.call(
        `${b}/families/${familyId}/roles`,
        {
          kind: "roles",
          effectiveOn: day,
          reason: "Synthetic household role",
          roleChanges: [{ id: personV, version: child.version, role: "relative" }],
        },
        { method: "PATCH", version: family.version },
      )
    ).status === 200,
    "P23 explicit family role command",
  );
  const unit = (await secretary.call(`${b}/organization/units/${serviceId}`)).payload.data,
    person = (await secretary.call(`${b}/members/${personA}`)).payload.data;
  ok(
    (
      await secretary.call(
        `${b}/organization/units/${serviceId}/memberships`,
        {
          changes: [{ id: personA, version: person.version, add: true }],
          effectiveOn: day,
          reason: "Synthetic ministry assignment",
        },
        { version: unit.version },
      )
    ).status === 200,
    "P24 service membership public command",
  );
  const assigned = (await secretary.call(`${b}/members/${personA}`)).payload.data;
  ok(
    assigned.assignment.mode === "auto" && assigned.assignment.unitIds.length === 2,
    "P24 service preserves automatic age band",
  );
  const term = await owner.call(`${o}/organization/board-terms`, {
    label: "Nhiệm kỳ workflow synthetic",
    startOn: day,
    endOn: "2030-12-31",
    appointments: [{ memberId: personA, position: "secretary" }],
    effectiveOn: day,
    reason: "Synthetic term",
  });
  ok(term.status === 201, "P24 board term draft");
  ok(
    (
      await owner.call(
        `${o}/organization/board-terms/${term.payload.data.term.id}/confirm`,
        { effectiveOn: day, reason: "Synthetic term confirmation" },
        { version: 1 },
      )
    ).status === 200,
    "P24 board term confirmation",
  );
  const values: Record<string, string> = {
    externalId: "P26-WORKFLOW-001",
    fullName: "Lê imported workflow synthetic",
    gender: "unknown",
    birthDate: "2000-01-02",
    type: "believer",
    membership: "member",
    householdRole: "head",
    familyKey: "P26-HO-NEW",
    area: "Giáo khu workflow synthetic",
    assignmentMode: "auto",
    baptismStatus: "unknown",
    consent: "true",
  };
  const csv = (await makeFile(importFields, [importFields.map((f) => values[f] ?? "")], "csv"))
    .bytes;
  const importPath = `${b}/data-exchange/imports`,
    source = "P26 synthetic workflow",
    upload = await secretary.call(importPath, csv, {
      headers: { "x-file-format": "csv", "x-import-source": encodeURIComponent(source) },
    });
  ok(upload.status === 201, "P25 CSV staging");
  const importId = upload.payload.data.importId as string;
  ok(
    (await secretary.call(`${importPath}/${importId}/rows`)).payload.data.counts.create === 1,
    "P25 preview before domain writes",
  );
  let job = (await secretary.call(`${importPath}/${importId}`)).payload.data;
  ok(
    (await secretary.call(`${importPath}/${importId}/prepare`, {}, { version: job.version }))
      .status === 200,
    "P25 prepare",
  );
  job = (await secretary.call(`${importPath}/${importId}`)).payload.data;
  ok(
    (
      await secretary.call(
        `${importPath}/${importId}/batches`,
        { token: job.planToken, nextBatch: 0, consent: true },
        { version: job.version },
      )
    ).status === 200,
    "P25 atomic import batch",
  );
  const exportBody = {
      filters: { q: profileA.code },
      columns: ["code", "fullName", "birthDate", "phone"],
      format: "xlsx",
    },
    preview = await secretary.call(`${b}/data-exchange/exports/preview`, exportBody);
  ok(preview.status === 200 && preview.payload.data.count === 1, "P25 scoped export preview");
  const exported = await secretary.call(`${b}/data-exchange/exports`, {
    ...exportBody,
    previewToken: preview.payload.data.previewToken,
  });
  ok(exported.status === 201, "P25 export artifact");
  const exportId = exported.payload.data.export.id as string,
    download = await secretary.call(`${b}/data-exchange/exports/${exportId}/download`);
  ok(
    download.status === 200 &&
      fileDigest(download.bytes as Uint8Array) === exported.payload.data.export.digest,
    "P25 immutable artifact bytes checksum",
  );
  const total = await secretary.call(`${b}/overview`);
  ok(
    total.status === 200 &&
      total.payload.data.members.total === 3 &&
      total.payload.data.visitors.total === 0 &&
      total.payload.data.visitors.convertedYear === 1 &&
      total.payload.data.families.believerFamilies === 2,
    "P26 cross-P2 overview reconciliation",
  );
  ok(
    (await secretary.call(`${b}/members/${personA}/history`)).payload.data.items.length >= 2,
    "P22/P24 member history",
  );
  ok(
    (await secretary.call(`${b}/families/${familyId}/history`)).payload.data.items.length >= 4,
    "P23 family history",
  );
  return {
    results,
    importId,
    exportId,
    exportDigest: exported.payload.data.export.digest as string,
    csv,
    source,
    memberId: personA,
    serviceId,
  };
}
