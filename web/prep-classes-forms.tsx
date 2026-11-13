import { useEffect, useState } from "react";
import { businessDay } from "../api/members/dates";
import type { ClassCandidates, Course, EnrollmentPage } from "./prep-classes-api";
import { type TenantRealm, tenantRequest } from "./tenant-mutation";
import {
  Button,
  Choice,
  DialogActions,
  EmptyState,
  Feedback,
  Field,
  Loading,
  PaginationControl,
  Select,
  TextArea,
  TextInput,
} from "./ui/components";
export function CourseForm({
  course,
  locked,
  onSubmit,
  onCancel,
}: {
  course: Course | null;
  locked: boolean;
  onSubmit: (body: object) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(course?.name ?? ""),
    [startOn, setStart] = useState(course?.startOn ?? businessDay()),
    [teacher, setTeacher] = useState(course?.teacher ?? ""),
    [baptismOn, setBaptism] = useState(course?.baptismOn ?? ""),
    [lessons, setLessons] = useState(course?.lessons.map((l) => l.title).join("\n") ?? ""),
    [reason, setReason] = useState("");
  return (
    <form
      className="prep-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({
          name,
          startOn,
          teacher: teacher.trim() || null,
          baptismOn: baptismOn || null,
          lessons: lessons
            .split("\n")
            .map((s) => s.trim())
            .filter(Boolean),
          ...(course ? { reason } : {}),
        });
      }}
    >
      <Field label="Tên khóa">
        <TextInput
          required
          maxLength={200}
          value={name}
          disabled={locked}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <div className="prep-form-grid">
        <Field label="Khai giảng">
          <TextInput
            type="date"
            required
            value={startOn}
            disabled={locked || course?.startLocked}
            onChange={(e) => setStart(e.target.value)}
          />
        </Field>
        <Field label="Giảng viên">
          <TextInput
            maxLength={200}
            value={teacher}
            disabled={locked}
            onChange={(e) => setTeacher(e.target.value)}
          />
        </Field>
        <Field label="Ngày Báp-têm dự kiến">
          <TextInput
            type="date"
            value={baptismOn}
            disabled={locked}
            onChange={(e) => setBaptism(e.target.value)}
          />
        </Field>
      </div>
      <Field label="Bài bắt buộc — mỗi dòng một bài">
        <TextArea
          required
          rows={6}
          maxLength={40200}
          value={lessons}
          disabled={locked || course?.planLocked}
          onChange={(e) => setLessons(e.target.value)}
        />
      </Field>
      {course?.planLocked && (
        <Feedback>
          Đã có buổi mở: giữ chương trình và ngày khai giảng để bảo toàn lịch sử tiến độ.
        </Feedback>
      )}
      {course && (
        <Field label="Lý do sửa">
          <TextArea
            required
            maxLength={500}
            value={reason}
            disabled={locked}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
      )}
      <DialogActions>
        <Button disabled={locked} onClick={onCancel}>
          Hủy
        </Button>
        <Button type="submit" variant="primary" disabled={locked}>
          Lưu khóa
        </Button>
      </DialogActions>
    </form>
  );
}
export function EnrollmentForm({
  realm,
  path,
  locked,
  onSubmit,
  onCancel,
  onFail,
}: {
  realm: TenantRealm;
  path: string;
  locked: boolean;
  onSubmit: (b: object) => void;
  onCancel: () => void;
  onFail: (e: unknown) => void;
}) {
  const [q, setQ] = useState(""),
    [page, setPage] = useState<ClassCandidates | null>(null),
    [cursor, setCursor] = useState<string | null>(null),
    [person, setPerson] = useState<ClassCandidates["items"][number] | null>(null),
    [confirmed, setConfirmed] = useState(false),
    [reason, setReason] = useState(""),
    [loading, setLoading] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    void tenantRequest<ClassCandidates>(
      realm,
      `${path}/candidates?${new URLSearchParams({ q, ...(cursor ? { cursor } : {}) })}`,
      { signal: abort.signal },
    )
      .then((r) => {
        if (!abort.signal.aborted)
          setPage((old) => ({
            ...r.data,
            items: cursor ? [...(old?.items ?? []), ...r.data.items] : r.data.items,
          }));
      })
      .catch((e) => {
        if (!abort.signal.aborted) onFail(e);
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [realm, path, q, cursor]);
  return (
    <form
      className="prep-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (person)
          onSubmit({
            memberId: person.memberId,
            confirmUnknown: confirmed,
            reason: reason.trim() || null,
          });
      }}
    >
      <Field label="Tìm tín hữu dự bị">
        <TextInput
          value={q}
          maxLength={100}
          disabled={locked}
          onChange={(e) => {
            setQ(e.target.value);
            setCursor(null);
            setPage(null);
          }}
        />
      </Field>
      {loading && <Loading />}
      {page && !page.items.length && (
        <EmptyState message="Không có hồ sơ đủ điều kiện. Kiểm tra loại/tư cách và sinh hoạt tại hồ sơ." />
      )}
      <div className="prep-dialog-list">
        {page?.items.map((p) => (
          <div className="li" key={p.memberId}>
            <div className="t">
              <b>{p.fullName}</b>
              <span>
                {p.code}
                {p.unknownBaptism ? " · Chưa rõ Báp-têm" : ""}
              </span>
            </div>
            <Button
              disabled={locked}
              aria-pressed={person?.memberId === p.memberId}
              onClick={() => {
                setPerson(p);
                setConfirmed(false);
                setReason("");
              }}
            >
              Chọn {p.fullName}
            </Button>
          </div>
        ))}
      </div>
      {page?.nextCursor && (
        <PaginationControl loading={locked || loading} onMore={() => setCursor(page.nextCursor)} />
      )}
      {person && (
        <>
          <p>
            Ghi danh: <strong>{person.fullName}</strong> · {person.code}
          </p>
          {person.unknownBaptism && (
            <>
              <Feedback tone="warning">
                Hồ sơ chưa rõ trạng thái Báp-têm. Cần xác nhận và lý do.
              </Feedback>
              <Choice
                label="Xác nhận cho ghi danh khi chưa rõ trạng thái Báp-têm"
                checked={confirmed}
                disabled={locked}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
            </>
          )}
          <Field label="Lý do ghi danh">
            <TextArea
              required={person.unknownBaptism}
              value={reason}
              maxLength={500}
              disabled={locked}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
        </>
      )}
      <DialogActions>
        <Button disabled={locked} onClick={onCancel}>
          Hủy
        </Button>
        <Button
          type="submit"
          variant="primary"
          disabled={locked || !person || (!!person.unknownBaptism && !confirmed)}
        >
          Xác nhận ghi danh
        </Button>
      </DialogActions>
    </form>
  );
}
export function MeetingForm({
  realm,
  path,
  course,
  kind,
  locked,
  onSubmit,
  onCancel,
  onFail,
}: {
  realm: TenantRealm;
  path: string;
  course: Course;
  kind: "regular" | "makeup";
  locked: boolean;
  onSubmit: (b: object) => void;
  onCancel: () => void;
  onFail: (e: unknown) => void;
}) {
  const [lessonId, setLesson] = useState(
      kind === "makeup" ? (course.closedLessonIds[0] ?? "") : (course.lessons[0]?.id ?? ""),
    ),
    [heldOn, setDay] = useState(businessDay()),
    [location, setLocation] = useState(""),
    [people, setPeople] = useState<EnrollmentPage | null>(null),
    [cursor, setCursor] = useState<string | null>(null),
    [q, setQ] = useState(""),
    [selected, setSelected] = useState<Record<string, string>>({}),
    [loading, setLoading] = useState(false);
  useEffect(() => {
    if (kind !== "makeup") return;
    const abort = new AbortController();
    setLoading(true);
    void tenantRequest<EnrollmentPage>(
      realm,
      `${path}/enrollments?${new URLSearchParams({ state: "studying", q, ...(cursor ? { cursor } : {}) })}`,
      { signal: abort.signal },
    )
      .then((r) => {
        if (!abort.signal.aborted)
          setPeople((old) => ({
            ...r.data,
            items: cursor ? [...(old?.items ?? []), ...r.data.items] : r.data.items,
          }));
      })
      .catch((e) => {
        if (!abort.signal.aborted) onFail(e);
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [kind, realm, path, q, cursor]);
  return (
    <form
      className="prep-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({
          lessonId,
          kind,
          heldOn,
          location: location.trim() || null,
          memberIds: kind === "makeup" ? Object.keys(selected) : null,
        });
      }}
    >
      <Field label="Bài học">
        <Select
          required
          value={lessonId}
          disabled={locked}
          onChange={(e) => {
            setLesson(e.target.value);
            setSelected({});
          }}
        >
          <option value="">Chọn bài</option>
          {course.lessons
            .filter((l) => kind === "regular" || course.closedLessonIds.includes(l.id))
            .map((l) => (
              <option key={l.id} value={l.id}>
                {l.title}
              </option>
            ))}
        </Select>
      </Field>
      {kind === "makeup" && !course.closedLessonIds.length && (
        <Feedback tone="warning">Chưa có buổi chính đã chốt để học bù.</Feedback>
      )}
      <Field label="Ngày học">
        <TextInput
          type="date"
          required
          value={heldOn}
          disabled={locked}
          onChange={(e) => setDay(e.target.value)}
        />
      </Field>
      <Field label="Địa điểm">
        <TextInput
          value={location}
          maxLength={500}
          disabled={locked}
          onChange={(e) => setLocation(e.target.value)}
        />
      </Field>
      {kind === "makeup" && (
        <>
          <Field label="Tìm học viên học bù">
            <TextInput
              value={q}
              maxLength={100}
              disabled={locked}
              onChange={(e) => {
                setQ(e.target.value);
                setCursor(null);
                setPeople(null);
              }}
            />
          </Field>
          {loading && <Loading />}
          <div className="prep-dialog-list">
            {people?.items.map((p) => (
              <Choice
                key={p.memberId}
                label={`${p.fullName} · ${p.code}${p.makeupLessonIds.includes(lessonId) ? " · Cần học bù" : " · Chưa cần học bù bài này"}`}
                checked={!!selected[p.memberId]}
                disabled={locked || !p.makeupLessonIds.includes(lessonId)}
                onChange={(e) =>
                  setSelected((old) => {
                    const next = { ...old };
                    if (e.target.checked) next[p.memberId] = p.fullName;
                    else delete next[p.memberId];
                    return next;
                  })
                }
              />
            ))}
          </div>
          {people?.nextCursor && (
            <PaginationControl
              loading={locked || loading}
              onMore={() => setCursor(people.nextCursor)}
            />
          )}
          <p>
            Đã chọn {Object.keys(selected).length} người:{" "}
            {Object.values(selected).join(", ") || "—"}
          </p>
        </>
      )}
      <DialogActions>
        <Button disabled={locked} onClick={onCancel}>
          Hủy
        </Button>
        <Button
          type="submit"
          variant="primary"
          disabled={locked || !lessonId || (kind === "makeup" && !Object.keys(selected).length)}
        >
          Tạo buổi{kind === "makeup" ? " học bù" : " học"}
        </Button>
      </DialogActions>
    </form>
  );
}
