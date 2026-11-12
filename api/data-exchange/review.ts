import type { ClientSession } from "mongodb";
import type { TenantGrant } from "../authorization/tenant-grant";
import { type FamilyInput, familyCreate } from "../families/validation";
import { digest } from "../identity/crypto";
import { businessDay } from "../members/dates";
import { candidate, type ExchangeMembers } from "../members/exchange";
import { phoneKey, searchName } from "../members/models";
import { canonical } from "../operations/service";
import type { Candidate, ImportField, RowReview } from "./contracts";
import type { ImportJob, SourceLink } from "./models";
export interface ResolvedRow extends RowReview {
  body: Record<string, unknown>;
  familyMeta: FamilyInput | undefined;
  group: string;
}
const unique = (values: string[]) => [...new Set(values.filter(Boolean))];
export function fieldsFor(job: ImportJob) {
  const sheet = job.sheets.find((s) => s.name === job.selectedSheet);
  if (!sheet) return [];
  return sheet.rows.map((cells, index) => {
    const fields: Partial<Record<ImportField, string>> = {};
    for (const [field, header] of Object.entries(job.mapping))
      fields[field as ImportField] = (cells[sheet.headers.indexOf(header)] ?? "")
        .normalize("NFC")
        .trim();
    return { row: index + 2, fields };
  });
}
export async function reviewRows(
  g: TenantGrant,
  job: ImportJob,
  port: ExchangeMembers,
  links: SourceLink[],
  tx: ClientSession,
  now: Date,
) {
  const inputs = fieldsFor(job),
    { settings, units } = await port.references(g, tx),
    context = digest(
      canonical({
        policy: g.policyContext,
        day: businessDay(now),
        settings: [settings.version, settings.defaultAssignmentMode],
        units: units
          .map((u) => [u._id.toHexString(), u.version, u.name, u.status, u.kind])
          .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
      }),
    );
  const codes = unique(
    inputs.flatMap(({ row, fields: f }) => [
      f.memberCode ?? "",
      f.caregiverCode ?? "",
      job.decisions[String(row)]?.memberCode ?? "",
    ]),
  );
  const members = await port.byCodes(g, codes, tx),
    linkedMembers = await port.byIds(g, unique(links.map((l) => l.memberId.toHexString())), tx),
    families = await port.familiesByCodes(
      g,
      unique(inputs.map((i) => i.fields.familyCode ?? "")),
      tx,
    ),
    matches = await port.candidates(
      g,
      inputs.map(({ fields: f }) => ({
        fullName: f.fullName ?? "",
        birthDate: f.birthDate || null,
        phone: f.phone || null,
      })),
      tx,
    );
  const heads = await port.familyHeads(
    g,
    families.map((f) => f._id),
    tx,
  );
  const rows: ResolvedRow[] = [];
  for (const { row, fields: f } of inputs) {
    const errors: string[] = [],
      warnings: string[] = [],
      decision = job.decisions[String(row)],
      externalId = f.externalId ?? "",
      fullName = f.fullName ?? "",
      linked = links.find((l) => l.externalId === externalId),
      byCode = members.find((m) => m.code === f.memberCode),
      existing = linked ? linkedMembers.find((m) => m._id.equals(linked.memberId)) : undefined;
    let action: RowReview["action"] = "create",
      target: Candidate | null = null;
    if (!externalId || externalId.length > 200) errors.push("Mã nguồn bắt buộc, tối đa 200 ký tự.");
    if (
      inputs.some(
        (i) =>
          i.row !== row &&
          i.fields.externalId === externalId &&
          job.decisions[String(i.row)]?.action !== "skip",
      )
    )
      errors.push("Mã nguồn lặp trong file; chỉ giữ một dòng.");
    if (f.memberCode && !byCode) errors.push("Mã thuộc viên không tồn tại trong Hội Thánh này.");
    if (linked && !existing) errors.push("Liên kết nguồn không còn hồ sơ hợp lệ.");
    if (existing && byCode && !existing._id.equals(byCode._id))
      errors.push("Mã nguồn và mã thuộc viên chỉ tới hai hồ sơ khác nhau.");
    const found = matches
      .filter(
        (m) =>
          (f.birthDate && m.birthDate === f.birthDate && m.nameKey === searchName(fullName)) ||
          (phoneKey(f.phone || null) && m.phoneKey === phoneKey(f.phone || null)),
      )
      .sort((a, b) => a.code.localeCompare(b.code));
    const candidateList = [
      ...new Map(
        [...found, ...(byCode ? [byCode] : [])].map((m) => [m.code, candidate(m)]),
      ).values(),
    ];
    if (found.length > 10)
      warnings.push("Có hơn 10 ứng viên; nhập mã thuộc viên chính xác để đối chiếu.");
    const fileDuplicate = inputs.some(
      (i) =>
        i.row !== row &&
        job.decisions[String(i.row)]?.action !== "skip" &&
        ((f.birthDate &&
          i.fields.birthDate === f.birthDate &&
          searchName(i.fields.fullName ?? "") === searchName(fullName)) ||
          (phoneKey(f.phone || null) &&
            phoneKey(i.fields.phone || null) === phoneKey(f.phone || null))),
    );
    if (fileDuplicate)
      warnings.push("Tên/ngày sinh hoặc điện thoại còn trùng với dòng khác trong file.");
    if (found.length) warnings.push("Có hồ sơ tương đồng; cần đối chiếu, không tự gộp.");
    if (existing) {
      target = candidate(existing);
      action = "skip";
      warnings.push("Mã nguồn đã có; không ghi đè hồ sơ.");
      if (
        (fullName && searchName(fullName) !== existing.nameKey) ||
        (f.birthDate && f.birthDate !== existing.birthDate) ||
        (f.phone && phoneKey(f.phone) !== existing.phoneKey)
      )
        warnings.push("Thông tin file khác hồ sơ đã liên kết.");
    } else if (decision?.action === "link") {
      const chosen = members.find((m) => m.code === decision.memberCode);
      if (!chosen || (byCode && !byCode._id.equals(chosen._id)))
        errors.push("Hồ sơ liên kết không khớp mã thuộc viên.");
      if (!decision.reason.trim()) errors.push("Nhập lý do liên kết mã nguồn.");
      target = chosen ? candidate(chosen) : null;
      action = "link";
    } else if (byCode || found.length || fileDuplicate) {
      if (decision?.action !== "create" || !decision.reason.trim() || byCode) action = "review";
    }
    const family = families.find((fam) => fam.code === f.familyCode);
    const resolveUnit = (name: string, kind: "area" | "age_ministry" | "service_ministry") => {
      const matches = units.filter(
        (u) => u.kind === kind && searchName(u.name) === searchName(name) && u.status === "active",
      );
      if (matches.length !== 1) {
        errors.push(`Không tìm thấy danh mục đang dùng: ${name}.`);
        return undefined;
      }
      return matches[0];
    };
    const area = f.area ? resolveUnit(f.area, "area") : null;
    const resolveNames = (text: string | undefined, kind: "age_ministry" | "service_ministry") =>
      unique((text ?? "").split(/\r?\n/).map((s) => s.trim())).flatMap((name) => {
        const u = resolveUnit(name, kind);
        return u ? [u._id.toHexString()] : [];
      });
    const ageIds = resolveNames(f.ageMinistries, "age_ministry"),
      serviceIds = resolveNames(f.serviceMinistries, "service_ministry");
    const caregiver = members.find((m) => m.code === f.caregiverCode);
    const mode = f.assignmentMode || settings.defaultAssignmentMode;
    const body: Record<string, unknown> = {
      fullName,
      gender: f.gender || "unknown",
      birthDate: f.birthDate || null,
      phone: f.phone || null,
      type: f.type,
      membership: f.membership || null,
      householdRole: f.householdRole,
      baptism: {
        status: f.baptismStatus || "unknown",
        date: f.baptismDate || null,
        place: f.baptismPlace || null,
      },
      visitor:
        f.type === "visitor"
          ? {
              stage: f.visitorStage || "new",
              firstVisit: f.firstVisit || null,
              believedOn: f.believedOn || null,
              referrer: f.referrer || null,
              caregiverId: caregiver?._id.toHexString() ?? null,
            }
          : null,
      family: family
        ? { kind: "existing", id: family._id.toHexString() }
        : { kind: "new", areaId: area?._id.toHexString() ?? null },
      assignment: { mode, unitIds: ageIds, serviceUnitIds: serviceIds },
      assignmentContext: { settingsVersion: settings.version, asOfDate: businessDay(now) },
      consent: f.consent === "true",
    };
    let familyMeta: FamilyInput | undefined;
    const group = f.familyCode
      ? `existing:${f.familyCode}`
      : f.familyKey
        ? `new:${f.familyKey}`
        : `row:${row}`;
    if (action !== "skip" && action !== "link") {
      if (f.participation && f.participation !== "active")
        errors.push(
          "Nhập mới chỉ hỗ trợ đang sinh hoạt; đổi trạng thái qua hồ sơ sau khi đối soát.",
        );
      if (f.memberCode && decision?.action === "create")
        errors.push("Không tạo mới với mã thuộc viên đã có.");
      if (
        f.type !== "visitor" &&
        [f.visitorStage, f.firstVisit, f.believedOn, f.referrer, f.caregiverCode].some(Boolean)
      )
        errors.push("Trường thân hữu chỉ dùng cho hồ sơ thân hữu.");
      if (
        f.caregiverCode &&
        (!caregiver || !["active", "long_absent"].includes(caregiver.participation))
      )
        errors.push("Người chăm sóc không khả dụng.");
      if (f.familyCode) {
        if (
          f.householdRole === "head" &&
          family &&
          heads.some((h) => h.familyId.equals(family._id))
        )
          errors.push("Gia đình đã có chủ hộ; chọn vai trò khác qua nghiệp vụ gia đình.");
        if (!family || family.status !== "active")
          errors.push("Gia đình không tồn tại hoặc đã được gộp.");
        if (f.familyKey || f.familyName || f.familyAddress || f.familyNotes || f.familySinceYear)
          errors.push("Không thay thông tin gia đình hiện hữu bằng file.");
        if (f.area && family?.areaId?.toHexString() !== area?._id.toHexString())
          errors.push("Khu vực khác gia đình hiện hữu; không đổi khu vực bằng file.");
      } else {
        if (!f.familyKey || f.familyKey.length > 200)
          errors.push("Nhập nhóm gia đình mới, tối đa 200 ký tự.");
        const parsed = familyCreate.safeParse({
          areaId: area?._id.toHexString() ?? null,
          name: f.familyName || null,
          address: f.familyAddress || null,
          notes: f.familyNotes || null,
          sinceYear: f.familySinceYear ? Number(f.familySinceYear) : null,
        });
        if (parsed.success) familyMeta = parsed.data;
        else errors.push("Thông tin gia đình mới không hợp lệ.");
      }
      errors.push(...port.validate(body));
    }
    if (decision?.action === "skip") {
      action = "skip";
      errors.length = 0;
      target = existing ? candidate(existing) : null;
    }
    if (errors.length) action = "error";
    const fingerprint = digest(
      canonical({
        row,
        f,
        decision,
        action,
        target,
        candidates: candidateList,
        family: family
          ? [family._id.toHexString(), family.version, family.status, family.areaId]
          : null,
        caregiver: caregiver ? [caregiver._id.toHexString(), caregiver.version] : null,
      }),
    );
    rows.push({
      row,
      externalId,
      fullName,
      errors,
      warnings,
      candidates: candidateList.slice(0, 10),
      action,
      target,
      fingerprint,
      body,
      familyMeta,
      group,
    });
  }
  const done = new Set(job.outcomes.map((o) => o.row));
  const creatingRows = rows.filter((r) => !done.has(r.row) && r.action === "create");
  for (const row of creatingRows) {
    const group = creatingRows.filter((r) => r.group === row.group);
    if (
      row.group.startsWith("new:") &&
      (group.length > 100 ||
        group.some((r) => canonical(r.familyMeta) !== canonical(row.familyMeta)))
    )
      row.errors.push("Nhóm gia đình mới phải ≤100 người và có cùng thông tin gia đình/khu vực.");
    if (group.filter((r) => r.body.householdRole === "head").length > 1)
      row.errors.push("Một gia đình không thể có nhiều chủ hộ.");
    if (row.errors.length) row.action = "error";
  }
  const counts: Record<string, number> = { create: 0, link: 0, skip: 0, review: 0, error: 0 };
  for (const row of rows)
    if (!done.has(row.row)) counts[row.action] = (counts[row.action] ?? 0) + 1;
  return { rows, counts, context };
}
