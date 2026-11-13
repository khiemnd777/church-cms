import type { ClientSession } from "mongodb";
import type { TenantGrant } from "../authorization/tenant-grant";
import { requireCondition } from "../errors";
import { businessDay } from "../members/dates";
import type { RiteMembers } from "../members/rites";
import { canonical } from "../operations/service";
import type { CertificateClasses } from "../prep-classes/certificates";
import type { CertificateRites } from "../rites/certificates";
import type { Tenancy } from "../tenancy/service";
import { type CertificateSnapshot, type DocumentContent, templateVersion, titles } from "./models";
import type { CertificateInput } from "./validation";
export const labelDay = (s: string | null) =>
  s ? s.split("-").reverse().join("/") : "[Chưa bổ sung]";
export class CertificateSources {
  constructor(
    private members: RiteMembers,
    private rites: CertificateRites,
    private classes: CertificateClasses,
    private tenancy: Tenancy,
    private now: () => Date,
  ) {}
  memberIdentity(g: TenantGrant, id: string, tx: ClientSession) {
    return this.members.identity(g, id, tx);
  }
  async capture(
    g: TenantGrant,
    input: CertificateInput,
    tx: ClientSession,
    fence = false,
  ): Promise<{ snapshot: CertificateSnapshot; memberIds: string[] }> {
    const church = await this.tenancy.certificateIdentity(g.churchId, tx);
    const rite = input.riteId ? await this.rites.get(g, input.riteId, tx) : null;
    const primary =
      input.memberId ??
      rite?.people.slice(0, rite.kind === "marriage" ? 2 : 1).find((p) => p.memberId)?.memberId;
    requireCondition(primary, 422, "CERT_SOURCE_REQUIRED");
    requireCondition(!rite || rite.kind === input.kind, 422, "CERT_SOURCE_REQUIRED");
    const ids = [...new Set([primary, ...(rite?.memberIds ?? [])])];
    const members: Awaited<ReturnType<RiteMembers["identity"]>>[] = [];
    for (const id of ids) members.push(await this.members.identity(g, id, tx));
    const member = members.find((m) => m.id === primary);
    requireCondition(member, 404, "NOT_FOUND");
    const course = input.courseId ? await this.classes.get(g, input.courseId, member.id, tx) : null;
    const missing: string[] = [],
      conflicts: string[] = [],
      differences: string[] = [],
      supplements: Record<string, string> = {};
    const pick = (
      key: keyof CertificateInput["supplements"],
      label: string,
      known: string | null,
      required: boolean,
    ) => {
      const value = input.supplements[key];
      if (known && value && known !== value)
        conflicts.push(`${label}: khác dữ kiện nguồn đã biết.`);
      if (!known && value) {
        supplements[key] = value;
        if (!input.supplementReason) missing.push("Lý do bổ sung dữ kiện");
      }
      const result = known ?? value;
      if (required && !result) missing.push(label);
      return result;
    };
    requireCondition(input.issuedOn <= businessDay(this.now()), 422, "CERT_DATE_INVALID");
    if (rite && rite.state !== "recorded") conflicts.push("Lễ chưa được ghi nhận hoặc đã hủy.");
    if (rite?.kind === "baptism") {
      const p = rite.record.payload;
      if (
        canonical(member.baptism) !==
        canonical({ status: "baptized", date: rite.record.date, place: p.place })
      )
        conflicts.push("Báp-têm trên hồ sơ hiện hành khác sổ lễ. Đối soát nguồn trước khi chốt.");
    }
    const people = rite?.people ?? [
      {
        fullName: member.fullName,
        birthDate: member.birthDate,
        memberId: member.id,
        source: "member",
      },
    ];
    const person = people[0];
    requireCondition(person, 422, "CERT_SOURCE_REQUIRED");
    if (
      rite?.people.some(
        (p) =>
          p.memberId &&
          members.some(
            (m) =>
              m.id === p.memberId && (p.fullName !== m.fullName || p.birthDate !== m.birthDate),
          ),
      )
    )
      differences.push("Họ tên/ngày sinh hiện hành đã thay đổi; bản này dùng snapshot lễ đã chọn.");
    const birth = pick("birthDate", "Ngày sinh", person.birthDate, input.kind !== "marriage"),
      date = pick(
        "eventDate",
        "Ngày cử hành",
        rite?.record.date ?? null,
        input.kind !== "application",
      ),
      place = pick(
        "place",
        "Nơi cử hành",
        rite?.record.payload.place ?? null,
        input.kind !== "application",
      );
    if (birth)
      requireCondition(
        birth <= businessDay(this.now()) && birth <= input.issuedOn && (!date || birth <= date),
        422,
        "CERT_DATE_INVALID",
      );
    if (date)
      requireCondition(
        date <= businessDay(this.now()) && input.issuedOn >= date,
        422,
        "CERT_DATE_INVALID",
      );
    const paragraphs: DocumentContent["paragraphs"] = [];
    if (input.kind === "baptism")
      paragraphs.push(
        { text: "Chứng nhận", style: "body" },
        { text: person.fullName, style: "name" },
        {
          text: `sinh ngày ${labelDay(birth)}, đã tin nhận Chúa Cứu Thế Giê-xu và chịu Lễ Báp-têm ngày ${labelDay(date)} tại ${place ?? "[Chưa bổ sung nơi]"}.`,
          style: "body",
        },
        { text: "Ma-thi-ơ 28:19", style: "small" },
      );
    if (input.kind === "dedication") {
      const payload = rite?.record.payload;
      requireCondition(payload?.kind === "dedication", 422, "CERT_SOURCE_REQUIRED");
      const names = payload.parents
        .map(
          (p, i) =>
            `${{ father: "Cha", mother: "Mẹ", guardian: "Người giám hộ" }[p.role]}: ${people[i + 1]?.fullName ?? "Chưa rõ"}`,
        )
        .join("; ");
      const parents = pick("parents", "Cha mẹ/người giám hộ", names || null, true);
      paragraphs.push(
        { text: "Chứng nhận em", style: "body" },
        { text: person.fullName, style: "name" },
        {
          text: `sinh ngày ${labelDay(birth)}. Cha mẹ/người giám hộ: ${parents ?? "[Chưa bổ sung]"}. Em đã được dâng lên Chúa trong giờ thờ phượng ngày ${labelDay(date)} tại ${place ?? "[Chưa bổ sung nơi]"}.`,
          style: "body",
        },
      );
    } else requireCondition(!input.supplements.parents, 422, "CERT_SUPPLEMENT_INVALID");
    if (input.kind === "marriage") {
      const payload = rite?.record.payload;
      requireCondition(payload?.kind === "marriage" && people[1], 422, "CERT_SOURCE_REQUIRED");
      paragraphs.push(
        { text: `${person.fullName} & ${people[1].fullName}`, style: "name" },
        {
          text: `đã được kết hợp trong Lễ Thành hôn cử hành tại ${place ?? "[Chưa bổ sung nơi]"} ngày ${labelDay(date)}.`,
          style: "body",
        },
      );
      const announcements = payload.announcements.filter((a) => a.state === "announced");
      paragraphs.push({
        text: announcements.length
          ? `Rao hôn phối đã ghi nhận: ${announcements.map((a) => labelDay(a.date)).join("; ")}.`
          : "Rao hôn phối: chưa có thông tin đã rao trong sổ.",
        style: "small",
      });
    }
    if (input.kind === "application") {
      requireCondition(
        !input.supplements.eventDate && !input.supplements.place,
        422,
        "CERT_SUPPLEMENT_INVALID",
      );
      const group = pick("group", "Nhóm/đơn vị", null, false);
      if (!input.requestedOn) missing.push("Ngày xin chịu Báp-têm");
      paragraphs.push(
        { text: "Kính gửi Mục sư Quản nhiệm và Ban Chấp sự,", style: "body" },
        { text: "Tôi tên", style: "body" },
        { text: person.fullName, style: "name" },
        {
          text: `sinh ngày ${labelDay(birth)}, thuộc ${group ?? "[Nhóm/đơn vị chưa bổ sung]"}. ${course ? `Khóa đã ghi danh: ${course.course.name} (không xác nhận hoàn thành khóa).` : "Khóa dự bị Báp-têm: ................................"} Tôi xin được chịu Lễ Báp-têm ngày ${labelDay(input.requestedOn)}.`,
          style: "body",
        },
        {
          text: "Lời làm chứng (điền ngoài hệ thống):\n................................................................................\n................................................................................",
          style: "body",
        },
        {
          text: "Ý kiến người hướng dẫn (điền ngoài hệ thống):\n................................................................................\n................................................................................",
          style: "body",
        },
      );
    } else
      requireCondition(
        !input.supplements.group && !input.requestedOn,
        422,
        "CERT_SUPPLEMENT_INVALID",
      );
    if (input.kind === "marriage")
      requireCondition(!input.supplements.birthDate, 422, "CERT_SUPPLEMENT_INVALID");
    const signatures =
      input.kind === "application"
        ? [
            { label: "Người làm đơn", name: input.signers.applicant },
            { label: "Người hướng dẫn / Mục sư", name: input.signers.guide },
          ]
        : [
            { label: "Thư ký", name: input.signers.secretary },
            { label: "Mục sư", name: input.signers.pastor },
          ];
    if (fence) {
      for (const m of members) await this.members.fence(g, m.id, m.version, tx);
      if (rite) await this.rites.fence(g, rite.id, rite.version, tx);
      if (course && input.courseId)
        await this.classes.fence(
          g,
          input.courseId,
          member.id,
          course.course.version,
          course.enrollment.version,
          tx,
        );
    }
    return {
      snapshot: {
        templateVersion,
        templateFingerprint: "",
        input,
        content: {
          reference: "",
          kind: input.kind,
          title: titles[input.kind],
          churchName: church.name,
          affiliation: input.affiliation,
          paragraphs,
          signatures,
          issuedOn: input.issuedOn,
        },
        sources: { church, rite, members, course },
        supplements,
        missing: [...new Set(missing)],
        conflicts,
        differences,
      },
      memberIds: ids,
    };
  }
}
