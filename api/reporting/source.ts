import type { ClientSession } from "mongodb";
import { type AttendanceReporting, lastSunday } from "../attendance/reporting";
import type { TenantGrant } from "../authorization/tenant-grant";
import type { ChurchReportMembers } from "../members/church-report";
import { businessDay } from "../members/dates";
import type { Organization } from "../organization/service";
import type { RiteReporting } from "../rites/reporting";
import type { Tenancy } from "../tenancy/service";
import { type Layout, type MetricValues, type ReportDocument, reportMetrics } from "./contracts";

export class ReportSource {
  constructor(
    private members: ChurchReportMembers,
    private organization: Organization,
    private rites: RiteReporting,
    private attendance: AttendanceReporting,
    private tenancy: Tenancy,
    private now: () => Date,
  ) {}

  async capture(
    g: TenantGrant,
    tx: ClientSession,
    layout: Layout,
    from: string,
    to: string,
  ): Promise<ReportDocument> {
    const now = this.now();
    const day = businessDay(now);
    const church = await this.tenancy.certificateIdentity(g.churchId, tx);
    const member = await this.members.read(g, tx, from, to);
    const rites = await this.rites.churchReport(g, tx, from, to);
    const week = (await this.attendance.window(g, tx, lastSunday(to))).days.slice(-4);
    const areas = await this.organization.activeAreaCount(g, tx);
    const coverage = week.filter((x) => x.state === "closed").length;
    const values: MetricValues = {
      baptized_members: member.official,
      preparatory_members: member.preparatory,
      children: member.children,
      visitors: member.visitors,
      believed_visitors: member.undatedBelief ? null : member.believed,
      believer_families: member.families,
      baptisms: rites.baptisms,
      dedications: rites.dedications,
      marriages: rites.marriages,
      funerals: rites.funerals,
      sunday_average:
        coverage === 4
          ? Math.round(week.reduce((n, x) => n + (x.present ?? 0), 0) * 2.5) / 10
          : null,
      areas,
      transferred: member.missingTransfer ? null : member.transfer,
    };
    const warnings = [`Hiện diện: ${coverage}/4 Chúa nhật có buổi tham chiếu đã đóng.`];
    if (member.unknown)
      warnings.push(
        `Báp-têm chưa rõ: ${member.unknown} tín hữu chính thức (chưa tính vào chỉ tiêu đã Báp-têm).`,
      );
    if (member.undatedBelief)
      warnings.push(`Có ${member.undatedBelief} hồ sơ chưa có ngày tin Chúa.`);
    if (member.missingTransfer)
      warnings.push(
        `Có ${member.missingTransfer} hồ sơ chuyển đi thiếu sự kiện trong lịch sử hệ thống.`,
      );
    for (const key of Object.keys(rites.unknown) as (keyof typeof rites.unknown)[]) {
      if (rites.unknown[key])
        warnings.push(
          `${reportMetrics[key]}: ${rites.unknown[key]} sự kiện thiếu ngày, chưa tính vào kỳ.`,
        );
    }
    return {
      church: church.name,
      template: layout.name,
      from,
      to,
      day,
      capturedAt: now.toISOString(),
      warnings,
      widths: layout.widths,
      rows: layout.rows.map((row) =>
        row.map((cell) => ({
          value: cell.metric ? (values[cell.metric] ?? "—") : cell.text,
          bold: cell.bold,
        })),
      ),
    };
  }
}
