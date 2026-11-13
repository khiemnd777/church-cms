import { lastSunday } from "../api/attendance/reporting";
import { businessDay, shiftDay } from "../api/members/dates";
import { check, type SyntheticClient } from "./p2-fixtures";
import { certificateFixture, createCertificateRite } from "./p35-fixtures";
import { p36Session } from "./p36-fixtures";
export async function p36Workflow(owner: SyntheticClient, c: { id: string }, memberId: string) {
  const b = `owner/churches/${c.id}`,
    checks: string[] = [];
  const ok = (v: unknown, label: string) => {
    check(v, label);
    checks.push(label);
  };
  const person = (await owner.call(`${b}/members/${memberId}`)).payload.data;
  const prepared = await owner.call(
    `${b}/members/${memberId}`,
    { membership: "preparatory", baptism: { status: "not_baptized", date: null, place: null } },
    { method: "PATCH", version: person.version },
  );
  ok(
    prepared.status === 200,
    `Member explicit preparation data ${prepared.status} ${prepared.payload?.error?.code ?? ""}`,
  );
  const made = await owner.call(`${b}/members/${memberId}/cards`, {});
  ok(made.status === 201, "Card issued");
  const cardId = made.payload.data.cardId as string,
    image = (await owner.call(`${b}/cards/${cardId}/render`)).payload.data;
  const worship = await p36Session(
      owner,
      c.id,
      lastSunday(businessDay()),
      { reportingKind: "sunday_reference" },
      [],
      false,
    ),
    ap = `${b}/attendance/sessions/${worship.id}`,
    s = (await owner.call(ap)).payload.data;
  const resolved = await owner.call(`${ap}/qr-resolutions`, {
    code: image.payload,
    generation: s.generation,
  });
  ok(resolved.status === 200, "QR resolution");
  const proof = resolved.payload.data;
  ok(
    (
      await owner.call(
        `${ap}/scans`,
        { resolutionToken: proof.resolutionToken, generation: proof.session.generation },
        { version: proof.participant.version },
      )
    ).status === 200,
    "QR commit uses Attendance",
  );
  const after = (await owner.call(ap)).payload.data;
  ok(
    (await owner.call(`${ap}/close`, {}, { version: after.version })).status === 200,
    "Worship closed",
  );
  const path = `${b}/prep-classes/courses`,
    madeCourse = await owner.call(path, {
      name: "Lớp workflow synthetic",
      startOn: shiftDay(businessDay(), -14),
      teacher: "Giảng viên synthetic",
      baptismOn: null,
      lessons: ["Bài học synthetic"],
    });
  ok(madeCourse.status === 201, "Course create");
  const courseId = madeCourse.payload.data.courseId as string;
  ok(
    (
      await owner.call(`${path}/${courseId}/enrollments`, {
        memberId,
        confirmUnknown: false,
        reason: null,
      })
    ).status === 201,
    "Explicit enrollment",
  );
  const course = (await owner.call(`${path}/${courseId}`)).payload.data;
  ok(
    (
      await owner.call(
        `${path}/${courseId}/activate`,
        { reason: "Mở khóa synthetic" },
        { version: course.version },
      )
    ).status === 200,
    "Course activate",
  );
  const meeting = await owner.call(`${path}/${courseId}/meetings`, {
    lessonId: course.lessons[0].id,
    kind: "regular",
    heldOn: businessDay(),
    location: null,
    memberIds: null,
  });
  ok(meeting.status === 201, "Class session create");
  const classSessionId = meeting.payload.data.sessionId as string,
    cp = `${b}/attendance/sessions/${classSessionId}`,
    preview = (await owner.call(`${cp}/candidates`)).payload.data;
  ok(
    (await owner.call(`${cp}/open`, { previewToken: preview.previewToken }, { version: 1 }))
      .status === 200,
    "Class session open",
  );
  const classState = (await owner.call(cp)).payload.data;
  ok(
    (
      await owner.call(
        `${cp}/participants/${memberId}`,
        { present: true, generation: classState.generation },
        { method: "PATCH", version: 1 },
      )
    ).status === 200,
    "Class presence explicit",
  );
  const cs = (await owner.call(cp)).payload.data;
  ok(
    (await owner.call(`${cp}/close`, {}, { version: cs.version })).status === 200,
    "Class session closed",
  );
  const enrollments = (await owner.call(`${path}/${courseId}/enrollments`)).payload.data,
    enrollment = enrollments.items.find((x: { memberId: string }) => x.memberId === memberId);
  ok(enrollment.creditedLessonIds.length === 1, "Closed class credit");
  ok(
    (
      await owner.call(
        `${path}/${courseId}/enrollments/${memberId}/interview`,
        { heldOn: businessDay(), interviewer: "Mục sư synthetic", reason: "Ghi nhận sự kiện" },
        { version: enrollment.version },
      )
    ).status === 200,
    "Manual interview event",
  );
  const riteId = await createCertificateRite(owner, c.id, memberId, "baptism"),
    input = certificateFixture("baptism", riteId);
  input.supplements.birthDate = person.birthDate ? null : "1990-01-02";
  const d = await owner.call(`${b}/certificates/drafts`, { input, reason: null });
  ok(d.status === 201, "Certificate draft");
  const draftId = d.payload.data.draftId as string,
    p = await owner.call(`${b}/certificates/drafts/${draftId}/prepare`, {}, { version: 1 });
  ok(p.status === 200, "Certificate artifacts prepared");
  const issued = await owner.call(
    `${b}/certificates/drafts/${draftId}/issue`,
    {
      previewId: p.payload.data.id,
      context: p.payload.data.context,
      confirm: true,
      faithConfirmed: true,
      reason: null,
    },
    { version: 1 },
  );
  ok(issued.status === 200, "Certificate atomic issue");
  const editionId = issued.payload.data.editionId as string,
    e = (await owner.call(`${b}/certificates/editions/${editionId}`)).payload.data;
  ok(
    e.pdfHash === p.payload.data.pdfHash && e.docxHash === p.payload.data.docxHash,
    "Issued artifact hashes match preview",
  );
  const overview = (await owner.call(`${b}/overview`)).payload.data;
  ok(
    overview.attendance.value === 1 &&
      overview.rites.counts.baptism === 1 &&
      overview.classes.enrollments === 1,
    "Cross-module overview reconciliation",
  );
  const linked = (await owner.call(`${b}/members/${memberId}/certificates`)).payload.data;
  ok(
    linked.items.some((x: { id: string }) => x.id === editionId),
    "Member certificate link",
  );
  return {
    churchId: c.id,
    memberId,
    cardId,
    cardPayload: image.payload,
    sessionId: worship.id,
    courseId,
    classSessionId,
    riteId,
    draftId,
    editionId,
    pdfHash: e.pdfHash,
    docxHash: e.docxHash,
    checks,
  };
}
