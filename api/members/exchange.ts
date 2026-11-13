import { type ClientSession, type Document, ObjectId } from "mongodb";
import type { AttendanceReporting } from "../attendance/reporting";
import type { TenantGrant } from "../authorization/tenant-grant";
import { type Candidate, type ExportColumn, limits } from "../data-exchange/contracts";
import { requireCondition } from "../errors";
import type { Families } from "../families/service";
import { type FamilyInput, familyCreate } from "../families/validation";
import { objectId } from "../http-validation";
import type { Database } from "../infrastructure/database";
import type { Organization } from "../organization/service";
import { type Baptism, type Member, phoneKey, searchName, type Visitor } from "./models";
import { MemberQueries } from "./queries";
import { createMember } from "./validation";

export const candidate = (m: Member): Candidate => ({
  id: m._id.toHexString(),
  code: m.code,
  fullName: m.fullName,
  birthDate: m.birthDate,
  phone: m.phone,
  version: m.version,
});
export class ExchangeMembers {
  private queries: MemberQueries;
  constructor(
    private db: Database,
    private families: Families,
    private organization: Organization,
    key: string,
    now: () => Date,
    private createRecord: (
      g: TenantGrant,
      body: unknown,
      tx: ClientSession,
      op: ObjectId,
      requestId: string,
      meta?: FamilyInput,
    ) => Promise<{
      safeResult: Record<string, unknown>;
      resourceRefs: { type: string; id: string }[];
    }>,
    private validateDates: (m: {
      birthDate: string | null;
      baptism: Baptism;
      visitor: Visitor | null;
    }) => void,
    private reporting?: AttendanceReporting,
  ) {
    this.queries = new MemberQueries(key, now);
  }
  private get rows() {
    return this.db.db.collection<Member>("members");
  }
  references(g: TenantGrant, tx: ClientSession) {
    return this.organization.exchangeReferences(g.churchId, tx);
  }
  familiesByCodes(g: TenantGrant, codes: string[], tx: ClientSession) {
    return this.families.byCodes(g.churchId, codes, tx);
  }
  async byCodes(g: TenantGrant, codes: string[], tx: ClientSession) {
    return this.rows
      .find({ churchId: g.churchId, code: { $in: codes } }, { session: tx })
      .toArray();
  }
  async byIds(g: TenantGrant, ids: string[], tx: ClientSession) {
    return this.rows
      .find({ churchId: g.churchId, _id: { $in: ids.map(objectId) } }, { session: tx })
      .toArray();
  }
  async familyHeads(g: TenantGrant, familyIds: ObjectId[], tx: ClientSession) {
    return this.rows
      .find(
        { churchId: g.churchId, familyId: { $in: familyIds }, householdRole: "head" },
        { session: tx, projection: { _id: 1, familyId: 1, version: 1 } },
      )
      .toArray();
  }
  async candidates(
    g: TenantGrant,
    inputs: { fullName: string; birthDate: string | null; phone: string | null }[],
    tx: ClientSession,
  ) {
    const phones = [
        ...new Set(inputs.map((r) => phoneKey(r.phone)).filter((p): p is string => !!p)),
      ],
      clauses: Document[] = inputs
        .filter((r) => r.fullName && r.birthDate)
        .map((r) => ({ nameKey: searchName(r.fullName), birthDate: r.birthDate }));
    if (phones.length) clauses.push({ phoneKey: { $in: phones } });
    if (!clauses.length) return [];
    const rows = await this.rows
      .find({ churchId: g.churchId, $or: clauses }, { session: tx })
      .limit(10001)
      .toArray();
    requireCondition(rows.length <= 10000, 413, "FILE_LIMIT");
    return rows;
  }
  validate(raw: unknown) {
    const parsed = createMember.safeParse(raw);
    if (!parsed.success)
      return parsed.error.issues.map(
        (i) => `${i.path.join(".") || "Hồ sơ"}: Kiểm tra giá trị theo mẫu nhập.`,
      );
    try {
      this.validateDates({
        birthDate: parsed.data.birthDate,
        baptism: parsed.data.baptism,
        visitor: parsed.data.visitor
          ? {
              ...parsed.data.visitor,
              caregiverId: parsed.data.visitor.caregiverId
                ? objectId(parsed.data.visitor.caregiverId)
                : null,
            }
          : null,
      });
      return [];
    } catch {
      return ["Ngày phải hợp lệ, không ở tương lai hoặc trước ngày sinh."];
    }
  }
  async create(
    g: TenantGrant,
    body: unknown,
    tx: ClientSession,
    op: ObjectId,
    requestId: string,
    meta?: FamilyInput,
  ) {
    const result = await this.createRecord(
      g,
      body,
      tx,
      op,
      requestId,
      meta ? familyCreate.parse(meta) : undefined,
    );
    const ref = result.resourceRefs.find((r) => r.type === "member");
    requireCondition(ref, 500, "DEPENDENCY_UNAVAILABLE");
    const member = await this.rows.findOne(
      { _id: new ObjectId(ref.id), churchId: g.churchId },
      { session: tx },
    );
    requireCondition(member, 500, "DEPENDENCY_UNAVAILABLE");
    return member;
  }
  async snapshot(
    g: TenantGrant,
    filters: Record<string, string>,
    columns: ExportColumn[],
    tx: ClientSession,
  ) {
    const q = new URLSearchParams(filters),
      w =
        this.reporting && (q.has("attendance") || q.has("attendanceUntil"))
          ? await this.reporting.window(g, tx, q.get("attendanceUntil"))
          : undefined,
      plan = this.queries.pipeline(
        g,
        q,
        this.families,
        false,
        w && this.reporting
          ? { stages: this.reporting.absentStages(g, w), fingerprint: w.fingerprint }
          : undefined,
      );
    requireCondition(!q.has("cursor") && !q.has("limit"), 400, "INVALID_REQUEST");
    const rows = await this.rows
      .aggregate<Member>([...plan.stages.slice(0, -1), { $limit: limits.exportRows + 1 }], {
        session: tx,
        maxTimeMS: 10_000,
      })
      .toArray();
    requireCondition(rows.length <= limits.exportRows, 413, "FILE_LIMIT");
    const data: string[][] = [];
    for (let i = 0; i < rows.length; i += 100) {
      const batch = rows.slice(i, i + 100),
        fs = await this.families.byIds(
          g.churchId,
          [...new Map(batch.map((m) => [m.familyId.toHexString(), m.familyId])).values()],
          tx,
        ),
        ids = [
          ...new Map(
            [
              ...batch.flatMap((m) => m.assignment.unitIds),
              ...fs.flatMap((f) => (f.areaId ? [f.areaId] : [])),
            ].map((id) => [id.toHexString(), id]),
          ).values(),
        ];
      const labels: Awaited<ReturnType<Organization["labels"]>> = [];
      for (let j = 0; j < ids.length; j += 500)
        labels.push(...(await this.organization.labels(g.churchId, ids.slice(j, j + 500), tx)));
      for (const m of batch) {
        const f = fs.find((f) => f._id.equals(m.familyId));
        const record: Record<ExportColumn, string> = {
          code: m.code,
          fullName: m.fullName,
          type: m.type,
          membership: m.membership ?? "",
          participation: m.participation,
          familyCode: f?.code ?? "",
          area: labels.find((u) => u.id === f?.areaId?.toHexString())?.name ?? "",
          ministries: m.assignment.unitIds
            .map((id) => labels.find((u) => u.id === id.toHexString())?.name ?? "")
            .join("\n"),
          gender: m.gender,
          birthDate: m.birthDate ?? "",
          phone: m.phone ?? "",
          householdRole: m.householdRole,
          baptismStatus: m.baptism.status,
          baptismDate: m.baptism.date ?? "",
          baptismPlace: m.baptism.place ?? "",
        };
        data.push(columns.map((c) => record[c]));
      }
    }
    return { data, sourceContext: w?.fingerprint ?? null };
  }
}
