import { useEffect, useState } from "react";
import type { CertificateInput, CertificateKind } from "../api/certificates/validation";
import { businessDay } from "../api/members/dates";
import type { PrepClasses } from "../api/prep-classes/service";
import type { CertificateDraft } from "./certificates-api";
import { certificateNames } from "./certificates-api";
import type { Rite, RitePage } from "./rites-api";
import { dateLabel } from "./rites-api";
import { RitePersonPicker } from "./rites-forms";
import { type TenantRealm, tenantRequest } from "./tenant-mutation";
import {
  Button,
  DialogActions,
  Feedback,
  Field,
  Loading,
  PaginationControl,
  Select,
  TextArea,
  TextInput,
} from "./ui/components";
export const blankCertificate = (
  kind: CertificateKind,
  riteId: string | null = null,
): CertificateInput => ({
  kind,
  riteId,
  memberId: null,
  courseId: null,
  affiliation: null,
  issuedOn: businessDay(),
  requestedOn: null,
  supplements: { birthDate: null, eventDate: null, place: null, parents: null, group: null },
  supplementReason: null,
  signers: { secretary: null, pastor: null, applicant: null, guide: null },
});
export function CertificateForm({
  draft,
  kind,
  seedRite,
  realm,
  base,
  locked,
  onFail,
  onSave,
  onPrepare,
  onCancel,
}: {
  draft: CertificateDraft | null;
  kind: CertificateKind;
  seedRite: string | null;
  realm: TenantRealm;
  base: string;
  locked: boolean;
  onFail: (e: unknown) => void;
  onSave: (input: CertificateInput, reason: string | null) => void;
  onPrepare: () => void;
  onCancel: () => void;
}) {
  const [input, setInput] = useState<CertificateInput>(
      draft?.input ?? blankCertificate(kind, seedRite),
    ),
    [reason, setReason] = useState(draft?.reason ?? ""),
    [dirty, setDirty] = useState(!draft),
    [q, setQ] = useState(""),
    [rites, setRites] = useState<RitePage | null>(null),
    [cursor, setCursor] = useState<string | null>(null),
    [source, setSource] = useState<Rite | null>(null),
    [member, setMember] = useState<{ fullName: string; birthDate: string | null } | null>(null),
    [courses, setCourses] = useState<Awaited<ReturnType<PrepClasses["memberCourses"]>> | null>(
      null,
    ),
    [courseCursor, setCourseCursor] = useState<string | null>(null),
    [loading, setLoading] = useState(false);
  const put = (next: CertificateInput) => {
    setInput(next);
    setDirty(true);
  };
  useEffect(() => {
    const a = new AbortController();
    setLoading(true);
    void (async () => {
      if (input.kind !== "application") {
        const list = await tenantRequest<RitePage>(
          realm,
          `${base}/rites/records?${new URLSearchParams({ kind: input.kind, state: "recorded", q, ...(cursor ? { cursor } : {}) })}`,
          { signal: a.signal },
        );
        if (a.signal.aborted) return;
        setRites((old) => ({
          ...list.data,
          items: cursor ? [...(old?.items ?? []), ...list.data.items] : list.data.items,
        }));
        if (input.riteId) {
          const r = await tenantRequest<Rite>(realm, `${base}/rites/records/${input.riteId}`, {
            signal: a.signal,
          });
          if (!a.signal.aborted) setSource(r.data);
        } else setSource(null);
      } else if (input.memberId) {
        const m = await tenantRequest<{ fullName: string; birthDate: string | null }>(
          realm,
          `${base}/members/${input.memberId}`,
          { signal: a.signal },
        );
        if (a.signal.aborted) return;
        setMember(m.data);
        const c = await tenantRequest<Awaited<ReturnType<PrepClasses["memberCourses"]>>>(
          realm,
          `${base}/members/${input.memberId}/prep-classes${courseCursor ? `?cursor=${encodeURIComponent(courseCursor)}` : ""}`,
          { signal: a.signal },
        );
        if (!a.signal.aborted)
          setCourses((old) => ({
            ...c.data,
            items: courseCursor ? [...(old?.items ?? []), ...c.data.items] : c.data.items,
          }));
      } else {
        setMember(null);
        setCourses(null);
      }
    })()
      .catch((e) => {
        if (!a.signal.aborted) onFail(e);
      })
      .finally(() => {
        if (!a.signal.aborted) setLoading(false);
      });
    return () => a.abort();
  }, [realm, base, input.kind, input.riteId, input.memberId, q, cursor, courseCursor]);
  const known = {
    birthDate:
      input.kind === "application"
        ? (member?.birthDate ?? null)
        : (source?.people[0]?.birthDate ?? null),
    eventDate: source?.record.date ?? null,
    place: source?.record.payload.place ?? null,
    parents:
      source?.record.payload.kind === "dedication" && source.record.payload.parents.length
        ? source.people
            .slice(1, 1 + source.record.payload.parents.length)
            .map((p) => p.fullName)
            .join("; ")
        : null,
    group: null,
  };
  function resetSource(id: string) {
    put({
      ...input,
      riteId: id || null,
      supplements: blankCertificate(kind).supplements,
      supplementReason: null,
    });
  }
  const supplement = (
    field: keyof CertificateInput["supplements"],
    label: string,
    type = "text",
  ) => (
    <Field
      label={label}
      hint={
        known[field]
          ? "Dữ kiện nguồn đã biết được khóa."
          : "Bổ sung rõ dữ kiện thiếu và lý do; không cập nhật ngược sổ."
      }
    >
      <TextInput
        type={type}
        disabled={locked || !!known[field]}
        value={known[field] ?? input.supplements[field] ?? ""}
        maxLength={field === "parents" ? 2000 : field === "group" ? 300 : 200}
        onChange={(e) =>
          put({ ...input, supplements: { ...input.supplements, [field]: e.target.value || null } })
        }
      />
    </Field>
  );
  return (
    <form
      className="certificates-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(input, reason.trim() || null);
      }}
    >
      <fieldset disabled={locked} className="certificates-form">
        <legend>{certificateNames[kind]}</legend>
        {input.kind === "application" ? (
          <>
            <RitePersonPicker
              label="Người làm đơn"
              value={{ source: "member", memberId: input.memberId ?? "" }}
              onChange={(p) => {
                if (p?.source === "member") {
                  put({
                    ...input,
                    memberId: p.memberId || null,
                    courseId: null,
                    supplements: blankCertificate(kind).supplements,
                  });
                  setCourseCursor(null);
                }
              }}
              external={false}
              optional={false}
              locked={locked || !!draft?.previousEditionId}
              realm={realm}
              prefix={`${base}/rites`}
              onFail={onFail}
            />
            <Field label="Khóa ghi danh tham chiếu">
              <Select
                disabled={locked || !!draft?.previousEditionId}
                value={input.courseId ?? ""}
                onChange={(e) => put({ ...input, courseId: e.target.value || null })}
              >
                <option value="">Không chọn khóa / chưa ghi danh</option>
                {courses?.items.flatMap((c) =>
                  c.course
                    ? [
                        <option key={c.course.id} value={c.course.id}>
                          {c.course.name} · {c.state === "studying" ? "Đang học" : "Ngừng học"}
                        </option>,
                      ]
                    : [],
                )}
              </Select>
            </Field>
            {courses?.nextCursor && (
              <PaginationControl
                loading={loading}
                onMore={() => setCourseCursor(courses.nextCursor)}
              />
            )}
            <Field label="Ngày xin chịu Báp-têm">
              <TextInput
                type="date"
                value={input.requestedOn ?? ""}
                onChange={(e) => put({ ...input, requestedOn: e.target.value || null })}
              />
            </Field>
            {supplement("group", "Nhóm/đơn vị nếu biết")}
          </>
        ) : (
          <>
            <Field label="Tìm người trong sổ lễ">
              <TextInput
                maxLength={100}
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setCursor(null);
                }}
              />
            </Field>
            <Field label="Lễ đã ghi nhận">
              <Select
                required
                value={input.riteId ?? ""}
                disabled={!!draft?.previousEditionId}
                onChange={(e) => resetSource(e.target.value)}
              >
                <option value="">Chọn lễ</option>
                {input.riteId && !rites?.items.some((r) => r.id === input.riteId) && (
                  <option value={input.riteId}>Bản lễ đã chọn</option>
                )}
                {rites?.items.map((r) => (
                  <option key={r.id} value={r.id}>
                    {dateLabel(r.record.date)} ·{" "}
                    {r.people
                      .slice(0, r.kind === "marriage" ? 2 : 1)
                      .map((p) => p.fullName)
                      .join(" & ")}
                  </option>
                ))}
              </Select>
            </Field>
            {rites?.nextCursor && (
              <PaginationControl loading={loading} onMore={() => setCursor(rites.nextCursor)} />
            )}
          </>
        )}
        {loading && <Loading />}
        {source && (
          <Feedback>
            Nguồn: {source.people.map((p) => p.fullName).join("; ")} ·{" "}
            {dateLabel(source.record.date)} · snapshot lễ.
          </Feedback>
        )}
        {kind !== "marriage" && supplement("birthDate", "Ngày sinh", "date")}
        {kind !== "application" && (
          <>
            {supplement("eventDate", "Ngày cử hành", "date")}
            {supplement("place", "Nơi cử hành")}
          </>
        )}
        {kind === "dedication" && supplement("parents", "Cha mẹ/người giám hộ nếu sổ chưa có")}
        <Field label="Lý do bổ sung dữ kiện">
          <TextArea
            maxLength={500}
            value={input.supplementReason ?? ""}
            onChange={(e) => put({ ...input, supplementReason: e.target.value || null })}
          />
        </Field>
        <Field label="Hệ phái/địa hạt nếu đã xác nhận">
          <TextInput
            maxLength={300}
            value={input.affiliation ?? ""}
            onChange={(e) => put({ ...input, affiliation: e.target.value || null })}
          />
        </Field>
        <Field label="Ngày chốt bản">
          <TextInput
            required
            type="date"
            value={input.issuedOn}
            onChange={(e) => put({ ...input, issuedOn: e.target.value })}
          />
        </Field>
        <div className="certificates-form-grid">
          {(kind === "application"
            ? [
                ["applicant", "Tên người làm đơn"],
                ["guide", "Tên người hướng dẫn / Mục sư"],
              ]
            : [
                ["secretary", "Tên Thư ký"],
                ["pastor", "Tên Mục sư"],
              ]
          ).map(([key, label]) => (
            <Field
              key={key}
              label={label as string}
              hint="Để trống tên nếu chưa rõ; giữ vùng ký thủ công."
            >
              <TextInput
                maxLength={200}
                value={input.signers[key as keyof CertificateInput["signers"]] ?? ""}
                onChange={(e) =>
                  put({
                    ...input,
                    signers: { ...input.signers, [key as string]: e.target.value || null },
                  })
                }
              />
            </Field>
          ))}
        </div>
        <Field label="Lý do sửa / thay thế">
          <TextArea
            required={!!draft?.previousEditionId}
            maxLength={500}
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              setDirty(true);
            }}
          />
        </Field>
        <Feedback>
          Mẫu nội bộ có dấu kiểm thử. Chữ ký điền/ký thủ công. Đơn xin không thu thập lời làm chứng
          trong hệ thống.
        </Feedback>
      </fieldset>
      <DialogActions>
        <Button disabled={locked} onClick={onCancel}>
          Đóng
        </Button>
        <Button type="submit" disabled={locked || loading} variant="primary">
          Lưu nháp
        </Button>
        {draft && (
          <Button disabled={locked || loading || dirty} onClick={onPrepare}>
            Chuẩn bị preview
          </Button>
        )}
      </DialogActions>
      {dirty && draft && <Feedback>Lưu thay đổi trước khi chuẩn bị preview.</Feedback>}
    </form>
  );
}
