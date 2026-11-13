import type { CertificateInput, CertificateKind } from "../api/certificates/validation";
import { businessDay, shiftDay } from "../api/members/dates";
import type { RiteCommand } from "../api/rites/validation";
import type { SyntheticClient } from "./p2-fixtures";
export function certificateFixture(
  kind: CertificateKind,
  riteId: string | null = null,
  memberId: string | null = null,
): CertificateInput {
  return {
    kind,
    riteId,
    memberId,
    courseId: null,
    affiliation: null,
    issuedOn: businessDay(),
    requestedOn: kind === "application" ? shiftDay(businessDay(), 14) : null,
    supplements: {
      birthDate: kind === "marriage" ? null : "1990-01-02",
      eventDate: null,
      place: null,
      parents: null,
      group: kind === "application" ? "Nhóm synthetic" : null,
    },
    supplementReason: "Bổ sung dữ kiện synthetic được xác nhận",
    signers: {
      secretary: "Thư ký synthetic",
      pastor: "Mục sư synthetic",
      applicant: "Người làm đơn synthetic",
      guide: "Người hướng dẫn synthetic",
    },
  };
}
export function riteFixture(
  kind: "baptism" | "dedication" | "marriage",
  memberId: string,
): RiteCommand {
  const person = { source: "member" as const, memberId },
    external = { source: "external" as const, fullName: "Người ngoài synthetic", birthDate: null };
  const payload =
    kind === "baptism"
      ? { kind, person, officiant: external, place: "Nơi lễ synthetic" }
      : kind === "dedication"
        ? {
            kind,
            child: person,
            parents: [{ role: "guardian" as const, person: external }],
            officiant: external,
            place: "Nơi lễ synthetic",
          }
        : {
            kind,
            groom: person,
            bride: external,
            officiant: external,
            place: "Nơi lễ synthetic",
            announcements: [
              { date: shiftDay(businessDay(), -7), state: "announced" as const, note: null },
            ],
          };
  return {
    record: { payload, date: shiftDay(businessDay(), -1), historical: false, note: null },
    state: "recorded",
    reason: null,
    baptismAfter:
      kind === "baptism"
        ? { status: "baptized", date: shiftDay(businessDay(), -1), place: "Nơi lễ synthetic" }
        : null,
    preview: null,
  };
}
export async function createCertificateRite(
  owner: SyntheticClient,
  churchId: string,
  memberId: string,
  kind: "baptism" | "dedication" | "marriage",
) {
  const prefix = `${owner.realm === "owner" ? "owner/" : ""}churches/${churchId}/rites/records`,
    body = riteFixture(kind, memberId),
    p = await owner.call(`${prefix}/preview`, body);
  if (p.status !== 200) throw Error(`Synthetic rite preview ${p.status}`);
  const r = await owner.call(prefix, { ...body, preview: p.payload.data.context });
  if (r.status !== 201) throw Error(`Synthetic rite create ${r.status}`);
  return r.payload.data.riteId as string;
}
