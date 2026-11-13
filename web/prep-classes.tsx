import { useEffect, useRef, useState } from "react";
import { businessDay } from "../api/members/dates";
import type { ChurchRef } from "./access-context";
import { ApiError } from "./api";
import type {
  ClassHistory,
  Course,
  CoursePage,
  Enrollment,
  EnrollmentPage,
  MeetingPage,
} from "./prep-classes-api";
import { courseStates } from "./prep-classes-api";
import { CourseForm, EnrollmentForm, MeetingForm } from "./prep-classes-forms";
import {
  authErrorCodes,
  type TenantIntent,
  type TenantRealm,
  tenantRequest,
  useTenantMutation,
} from "./tenant-mutation";
import {
  Badge,
  Button,
  Card,
  Choice,
  DialogActions,
  EmptyState,
  Feedback,
  Field,
  IconButton,
  KeyValueList,
  Loading,
  Modal,
  PaginationControl,
  SectionHeader,
  Select,
  TableFrame,
  Tabs,
  TextArea,
  TextInput,
  Toolbar,
} from "./ui/components";
import "./prep-classes.css";
type Dialog =
  | {
      kind:
        | "create"
        | "edit"
        | "enroll"
        | "regular"
        | "makeup"
        | "history"
        | "activate"
        | "close"
        | "reopen";
    }
  | { kind: "state" | "interview" | "progress"; person: Enrollment };
const names = {
  create: "Tạo khóa",
  edit: "Sửa khóa",
  enroll: "Ghi danh",
  regular: "Tạo buổi học",
  makeup: "Tạo buổi học bù",
  history: "Lịch sử khóa",
  activate: "Bắt đầu khóa",
  close: "Đóng khóa",
  reopen: "Mở lại khóa",
  state: "Thay đổi ghi danh",
  interview: "Ghi nhận phỏng vấn",
  progress: "Tiến độ học viên",
};
export function PrepClassesView({
  realm,
  churchId,
  pending,
  onPending,
  onAuthError,
  onTitle,
  onChurch,
  onAttendance,
  onMember,
  onTab,
}: {
  realm: TenantRealm;
  churchId: string;
  pending: TenantIntent | null;
  onPending: (v: TenantIntent | null) => void;
  onAuthError: (e: unknown) => void;
  onTitle: (title: string, context?: string) => void;
  onChurch?: (c: ChurchRef) => void;
  onAttendance: (id: string) => void;
  onMember: (id: string) => void;
  onTab?: (id: string) => void;
}) {
  const base = `${realm === "owner" ? "owner/" : ""}churches/${churchId}`,
    prefix = `${base}/prep-classes`;
  const [identity, setIdentity] = useState<{ key: string; capabilities: string[] } | null>(null),
    [list, setList] = useState<CoursePage | null>(null),
    [selected, setSelected] = useState(new URLSearchParams(location.search).get("courseId") ?? ""),
    [course, setCourse] = useState<Course | null>(null),
    [people, setPeople] = useState<EnrollmentPage | null>(null),
    [meetings, setMeetings] = useState<MeetingPage | null>(null),
    [history, setHistory] = useState<ClassHistory | null>(null),
    [dialog, setDialog] = useState<Dialog | null>(null),
    [refresh, setRefresh] = useState(0),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [q, setQ] = useState(""),
    [state, setState] = useState(""),
    [studentQ, setStudentQ] = useState(""),
    [studentState, setStudentState] = useState(""),
    [cursors, setCursors] = useState<string[]>([]),
    [listCursors, setListCursors] = useState<string[]>([]),
    [reason, setReason] = useState(""),
    [confirmed, setConfirmed] = useState(false),
    [interviewOn, setInterviewOn] = useState(businessDay()),
    [interviewer, setInterviewer] = useState("");
  const generation = useRef(0),
    cursor = cursors.at(-1),
    listCursor = listCursors.at(-1),
    canManage = !!identity?.capabilities.includes("classes:manage"),
    canInterview = !!identity?.capabilities.includes("classes:interview"),
    path = `${prefix}/courses/${selected}`;
  function fail(e: unknown) {
    if (
      e instanceof ApiError &&
      [...authErrorCodes, "FORBIDDEN", "CHURCH_SUSPENDED"].includes(e.code)
    ) {
      setCourse(null);
      setList(null);
      setPeople(null);
      setMeetings(null);
      setHistory(null);
      setDialog(null);
      setIdentity(null);
      onAuthError(e);
    } else setError(e instanceof Error ? e.message : "Không tải được lớp dự bị.");
  }
  const mutation = useTenantMutation({
    realm,
    churchId,
    principalKey: identity?.key ?? "",
    canWrite: canManage,
    pending,
    onPending,
    onAuthError: fail,
    operationPath: `${prefix}/operations`,
    prefix,
    onSuccess: (data) => {
      if (
        data &&
        typeof data === "object" &&
        "courseId" in data &&
        typeof data.courseId === "string"
      ) {
        setSelected(data.courseId);
        const url = new URL(location.href);
        url.searchParams.set("courseId", data.courseId);
        url.searchParams.set("tab", "class");
        window.history.replaceState(null, "", url);
      }
      setDialog(null);
      setHistory(null);
      setCursors([]);
      setRefresh((n) => n + 1);
    },
  });
  const locked = mutation.busy || !!pending;
  useEffect(() => {
    const epoch = ++generation.current,
      abort = new AbortController();
    setLoading(true);
    setError("");
    setCourse(null);
    setPeople(null);
    setMeetings(null);
    setHistory(null);
    void (async () => {
      const ctx = await tenantRequest<{
        church: ChurchRef;
        principal: { accountId?: string; employeeId?: string; version?: number };
        capabilities: string[];
        policyVersion: number;
      }>(realm, `${base}/context`, { signal: abort.signal });
      if (epoch !== generation.current) return;
      setIdentity({
        key: `${ctx.data.principal.accountId ?? ctx.data.principal.employeeId}:${churchId}:${ctx.data.principal.version}:${ctx.data.policyVersion}`,
        capabilities: ctx.data.capabilities,
      });
      onTitle("Sổ lễ nghi", `${ctx.data.church.name} · ${ctx.data.church.code}`);
      onChurch?.(ctx.data.church);
      const l = await tenantRequest<CoursePage>(
        realm,
        `${prefix}/courses?${new URLSearchParams({ q, ...(state ? { state } : {}), ...(listCursor ? { cursor: listCursor } : {}) })}`,
        { signal: abort.signal },
      );
      if (epoch !== generation.current) return;
      setList(l.data);
      if (!selected && l.data.items[0]) {
        setSelected(l.data.items[0].id);
        return;
      }
      if (selected) {
        const c = await tenantRequest<Course>(realm, path, { signal: abort.signal });
        if (epoch !== generation.current) return;
        setCourse(c.data);
        const p = await tenantRequest<EnrollmentPage>(
          realm,
          `${path}/enrollments?${new URLSearchParams({ q: studentQ, ...(studentState ? { state: studentState } : {}), ...(cursor ? { cursor } : {}) })}`,
          { signal: abort.signal },
        );
        if (epoch !== generation.current) return;
        setPeople(p.data);
        const m = await tenantRequest<MeetingPage>(realm, `${path}/meetings`, {
          signal: abort.signal,
        });
        if (epoch === generation.current) setMeetings(m.data);
      }
    })()
      .catch((e) => {
        if (!abort.signal.aborted && epoch === generation.current) fail(e);
      })
      .finally(() => {
        if (!abort.signal.aborted && epoch === generation.current) setLoading(false);
      });
    return () => {
      abort.abort();
      generation.current++;
    };
  }, [realm, churchId, selected, refresh, q, state, studentQ, studentState, cursor, listCursor]);
  function select(id: string) {
    if (locked) return;
    setSelected(id);
    setCursors([]);
    setStudentQ("");
    setStudentState("");
    setDialog(null);
    const url = new URL(location.href);
    if (id) url.searchParams.set("courseId", id);
    else url.searchParams.delete("courseId");
    window.history.replaceState(null, "", url);
  }
  function open(d: Dialog) {
    mutation.setError("");
    setReason("");
    setConfirmed(false);
    setDialog(d);
    if (d.kind === "interview") {
      setInterviewOn(d.person.interview?.heldOn ?? businessDay());
      setInterviewer(d.person.interview?.interviewer ?? "");
    }
  }
  async function loadMoreMeetings() {
    if (!meetings?.nextCursor) return;
    const epoch = generation.current;
    try {
      const r = await tenantRequest<MeetingPage>(
        realm,
        `${path}/meetings?cursor=${encodeURIComponent(meetings.nextCursor)}`,
      );
      if (epoch === generation.current)
        setMeetings((old) => ({ ...r.data, items: [...(old?.items ?? []), ...r.data.items] }));
    } catch (e) {
      if (epoch === generation.current) fail(e);
    }
  }
  async function showHistory(cursor?: string) {
    if (!course) return;
    const epoch = generation.current;
    setDialog({ kind: "history" });
    try {
      const r = await tenantRequest<ClassHistory>(
        realm,
        `${path}/history${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
      );
      if (epoch === generation.current)
        setHistory((old) => ({
          ...r.data,
          items: cursor ? [...(old?.items ?? []), ...r.data.items] : r.data.items,
        }));
    } catch (e) {
      if (epoch === generation.current) fail(e);
    }
  }
  const feedback = (
    <>
      {mutation.error && <Feedback tone="error">{mutation.error}</Feedback>}
      {pending && (
        <Feedback tone="warning">
          <p>Thao tác lớp đang chờ đối soát. Chưa tạo thao tác mới.</p>
          <Button
            disabled={mutation.busy || !identity}
            onClick={() => void mutation.execute(pending, true)}
          >
            Kiểm tra kết quả lớp
          </Button>
          <Button
            disabled={mutation.busy}
            onClick={() => {
              if (window.confirm("Đọc lại dữ liệu để đối soát trước khi tạo thao tác mới?")) {
                onPending(null);
                setDialog(null);
                setRefresh((n) => n + 1);
              }
            }}
          >
            Đối soát danh sách lớp
          </Button>
        </Feedback>
      )}
    </>
  );
  return (
    <div className="prep-section">
      <SectionHeader title="Sổ lễ nghi">
        {canManage && (
          <IconButton
            icon="plus"
            label="Tạo khóa"
            disabled={locked || loading}
            onClick={() => open({ kind: "create" })}
          />
        )}
      </SectionHeader>
      <Tabs
        id="rites"
        value="class"
        items={[
          { id: "bap", label: "Báp-têm", disabled: locked || !onTab },
          { id: "class", label: "Lớp dự bị", disabled: locked },
          { id: "ded", label: "Dâng con", disabled: locked || !onTab },
          { id: "wed", label: "Thành hôn", disabled: locked || !onTab },
          { id: "fun", label: "An táng", disabled: locked || !onTab },
          { id: "com", label: "Tiệc Thánh", disabled: locked || !onTab },
        ]}
        onChange={(id) => onTab?.(id)}
      />
      <section
        role="tabpanel"
        id="rites-panel-class"
        aria-labelledby="rites-tab-class"
        className="prep-section"
      >
        {error && <Feedback tone="error">{error}</Feedback>}
        {mutation.notice && <Feedback>{mutation.notice}</Feedback>}
        {!dialog && feedback}
        <Toolbar>
          <Field label="Tìm khóa">
            <TextInput
              value={q}
              maxLength={100}
              disabled={locked}
              onChange={(e) => {
                setQ(e.target.value);
                setListCursors([]);
              }}
            />
          </Field>
          <Field label="Trạng thái khóa">
            <Select
              value={state}
              disabled={locked}
              onChange={(e) => {
                setState(e.target.value);
                setListCursors([]);
              }}
            >
              <option value="">Tất cả</option>
              {Object.entries(courseStates).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <Button disabled={locked} onClick={() => setRefresh((n) => n + 1)}>
            Tải lại lớp
          </Button>
        </Toolbar>
        {loading && <Loading />}
        {list && (
          <>
            <Field label="Khóa học">
              <Select value={selected} disabled={locked} onChange={(e) => select(e.target.value)}>
                <option value="">Chọn khóa</option>
                {course && !list.items.some((c) => c.id === course.id) && (
                  <option value={course.id}>{course.name}</option>
                )}
                {list.items.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} · {courseStates[c.state]}
                  </option>
                ))}
              </Select>
            </Field>
            {!list.items.length && <EmptyState message="Chưa có khóa phù hợp." />}
            <div className="prep-actions">
              <Button
                disabled={locked || !listCursors.length}
                onClick={() => setListCursors((old) => old.slice(0, -1))}
              >
                Khóa trước
              </Button>
              <Button
                disabled={locked || !list.nextCursor}
                onClick={() => {
                  if (list.nextCursor) setListCursors((old) => [...old, list.nextCursor as string]);
                }}
              >
                Khóa tiếp
              </Button>
            </div>
          </>
        )}
        {course && (
          <>
            <Card>
              <SectionHeader title={course.name}>
                <Badge>{courseStates[course.state]}</Badge>
              </SectionHeader>
              <div className="prep-card-content">
                <p>
                  Khai giảng {course.startOn} · Giảng viên: {course.teacher ?? "Chưa ghi"} · Báp-têm
                  dự kiến: {course.baptismOn ?? "Chưa ghi"}
                </p>
                <p>
                  {course.lessons.length} bài bắt buộc · {course.enrollmentCount} ghi danh ·{" "}
                  {course.openSessions} buổi đang mở
                </p>
                <div className="prep-actions">
                  {canManage && (
                    <>
                      <Button
                        disabled={locked || course.state === "closed"}
                        onClick={() => open({ kind: "edit" })}
                      >
                        Sửa khóa
                      </Button>
                      <Button
                        disabled={locked || course.state === "closed"}
                        onClick={() => open({ kind: "enroll" })}
                      >
                        Ghi danh
                      </Button>
                      <Button
                        disabled={locked || course.state !== "active"}
                        onClick={() => open({ kind: "regular" })}
                      >
                        Tạo buổi học
                      </Button>
                      <Button
                        disabled={
                          locked || course.state !== "active" || !course.closedLessonIds.length
                        }
                        onClick={() => open({ kind: "makeup" })}
                      >
                        Học bù
                      </Button>
                      <Button
                        disabled={locked}
                        onClick={() =>
                          open({
                            kind:
                              course.state === "draft"
                                ? "activate"
                                : course.state === "closed"
                                  ? "reopen"
                                  : "close",
                          })
                        }
                      >
                        {course.state === "draft"
                          ? "Bắt đầu khóa"
                          : course.state === "closed"
                            ? "Mở lại khóa"
                            : "Đóng khóa"}
                      </Button>
                    </>
                  )}
                  <Button disabled={locked} onClick={() => void showHistory()}>
                    Lịch sử khóa
                  </Button>
                </div>
                {course.state === "closed" && (
                  <Feedback>
                    Khóa đã đóng: giữ dữ liệu và tiến độ; mở lại có lý do trước khi sửa. Không tự
                    xác nhận hoàn thành hoặc Báp-têm.
                  </Feedback>
                )}
              </div>
            </Card>
            <Card>
              <SectionHeader title="Học viên" />
              <div className="prep-card-content prep-enrollment-content">
                <Toolbar>
                  <Field label="Tìm học viên">
                    <TextInput
                      value={studentQ}
                      maxLength={100}
                      disabled={locked}
                      onChange={(e) => {
                        setStudentQ(e.target.value);
                        setCursors([]);
                      }}
                    />
                  </Field>
                  <Field label="Trạng thái ghi danh">
                    <Select
                      value={studentState}
                      disabled={locked}
                      onChange={(e) => {
                        setStudentState(e.target.value);
                        setCursors([]);
                      }}
                    >
                      <option value="">Tất cả</option>
                      <option value="studying">Đang học</option>
                      <option value="withdrawn">Ngừng học</option>
                    </Select>
                  </Field>
                </Toolbar>
                {people?.openSessions ? (
                  <Feedback>
                    Còn {people.openSessions} buổi đang mở, chưa tính vào số bài xác nhận.
                  </Feedback>
                ) : null}
                {people && !people.items.length && (
                  <EmptyState message="Chưa có học viên phù hợp." />
                )}
                {people && !!people.items.length && (
                  <TableFrame label="Danh sách học viên lớp dự bị">
                    <table>
                      <thead>
                        <tr>
                          <th>Học viên</th>
                          <th>Tuổi khi khai giảng</th>
                          <th>Nhóm</th>
                          <th>Số bài xác nhận</th>
                          <th>Phỏng vấn đức tin</th>
                          <th>Thao tác</th>
                        </tr>
                      </thead>
                      <tbody>
                        {people.items.map((p) => (
                          <tr key={p.id}>
                            <td>
                              <Button
                                variant="link"
                                disabled={locked}
                                onClick={() => onMember(p.memberId)}
                              >
                                {p.fullName}
                              </Button>
                              <div className="small muted">
                                {p.code} · {p.state === "studying" ? "Đang học" : "Ngừng học"}
                              </div>
                            </td>
                            <td>
                              {p.birthDate && p.birthDate > course.startOn
                                ? "Chưa sinh"
                                : (p.ageAtStart ?? "Chưa rõ")}
                            </td>
                            <td>{p.areaName ?? "Chưa có khu vực"}</td>
                            <td>
                              {p.creditedLessonIds.length}/{p.requiredLessons}
                              {p.makeupLessonIds.length > 0 && (
                                <div>
                                  <Badge tone="warn">
                                    Cần học bù {p.makeupLessonIds.length} bài
                                  </Badge>
                                </div>
                              )}
                            </td>
                            <td>{p.interview ? `Đã phỏng vấn · ${p.interview.heldOn}` : "Chưa"}</td>
                            <td>
                              <div className="prep-actions">
                                <Button
                                  disabled={locked}
                                  onClick={() => open({ kind: "progress", person: p })}
                                >
                                  Tiến độ {p.fullName}
                                </Button>
                                {canManage && (
                                  <Button
                                    disabled={locked || course.state === "closed"}
                                    onClick={() => open({ kind: "state", person: p })}
                                  >
                                    {p.state === "studying" ? "Ngừng học" : "Khôi phục ghi danh"}
                                  </Button>
                                )}
                                {canInterview && (
                                  <Button
                                    disabled={locked || course.state === "closed"}
                                    onClick={() => open({ kind: "interview", person: p })}
                                  >
                                    Phỏng vấn {p.fullName}
                                  </Button>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </TableFrame>
                )}
                <div className="prep-actions">
                  <Button
                    disabled={locked || !cursors.length}
                    onClick={() => setCursors((old) => old.slice(0, -1))}
                  >
                    Học viên trước
                  </Button>
                  <Button
                    disabled={locked || !people?.nextCursor}
                    onClick={() => {
                      if (people?.nextCursor)
                        setCursors((old) => [...old, people.nextCursor as string]);
                    }}
                  >
                    Học viên tiếp
                  </Button>
                </div>
              </div>
            </Card>
            <Card>
              <SectionHeader title="Buổi học và học bù" />
              <div className="prep-card-content">
                {meetings && !meetings.items.length && <EmptyState message="Chưa có buổi học." />}
                {meetings?.items.map((m) => (
                  <div className="li" key={m.id}>
                    <div className="t">
                      <b>
                        {course.lessons.find((l) => l.id === m.lessonId)?.title ?? "Bài học"} ·{" "}
                        {m.kind === "makeup" ? "Học bù" : "Buổi chính"}
                      </b>
                      <span>
                        {m.session?.heldOn} ·{" "}
                        {m.session?.state === "closed"
                          ? "Đã chốt"
                          : m.session?.state === "open"
                            ? "Đang mở"
                            : "Nháp"}{" "}
                        · {m.session?.presentCount ?? 0}/{m.session?.includedCount ?? 0} có mặt
                      </span>
                    </div>
                    {m.session && (
                      <Button
                        disabled={locked}
                        onClick={() => {
                          if (m.session) onAttendance(m.session.id);
                        }}
                      >
                        Điểm danh {m.session.heldOn}
                      </Button>
                    )}
                  </div>
                ))}
                {meetings?.nextCursor && (
                  <PaginationControl loading={locked} onMore={() => void loadMoreMeetings()} />
                )}
              </div>
            </Card>
          </>
        )}
      </section>
      <Modal
        open={!!dialog}
        title={dialog ? names[dialog.kind] : "Lớp dự bị"}
        locked={locked}
        onClose={() => setDialog(null)}
      >
        {feedback}
        {(dialog?.kind === "create" || dialog?.kind === "edit") && (
          <CourseForm
            key={`${dialog.kind}:${course?.id}:${course?.version}`}
            course={dialog.kind === "edit" ? course : null}
            locked={locked}
            onCancel={() => setDialog(null)}
            onSubmit={(body) =>
              mutation.send(
                `${prefix}/courses${dialog.kind === "edit" ? `/${selected}` : ""}`,
                dialog.kind === "edit" ? "PATCH" : "POST",
                body,
                dialog.kind === "edit" ? course?.version : undefined,
              )
            }
          />
        )}
        {dialog?.kind === "enroll" && course && (
          <EnrollmentForm
            realm={realm}
            path={path}
            locked={locked}
            onFail={fail}
            onCancel={() => setDialog(null)}
            onSubmit={(b) => mutation.send(`${path}/enrollments`, "POST", b)}
          />
        )}
        {(dialog?.kind === "regular" || dialog?.kind === "makeup") && course && (
          <MeetingForm
            realm={realm}
            path={path}
            course={course}
            kind={dialog.kind}
            locked={locked}
            onFail={fail}
            onCancel={() => setDialog(null)}
            onSubmit={(b) => mutation.send(`${path}/meetings`, "POST", b)}
          />
        )}
        {dialog?.kind === "progress" && course && (
          <div className="prep-detail-list">
            <p>
              <strong>{dialog.person.fullName}</strong> · {dialog.person.code}
            </p>
            {course.lessons.map((l) => (
              <p key={l.id}>
                {l.title}:{" "}
                {dialog.person.creditedLessonIds.includes(l.id)
                  ? "Đã xác nhận"
                  : dialog.person.makeupLessonIds.includes(l.id)
                    ? "Chưa có ghi nhận bài — cần học bù"
                    : "Chưa có buổi chính đã chốt"}
              </p>
            ))}
            <p>
              Phỏng vấn:{" "}
              {dialog.person.interview
                ? `${dialog.person.interview.heldOn} · ${dialog.person.interview.interviewer}`
                : "Chưa ghi nhận"}
            </p>
          </div>
        )}
        {dialog?.kind === "history" && (
          <div className="prep-detail-list">
            {!history && !error && <Loading />}
            {history?.items.map((h) => (
              <details key={h.id}>
                <summary>
                  {historyLabels[h.event] ?? "Thay đổi khóa"} ·{" "}
                  {new Date(h.occurredAt).toLocaleString("vi-VN")}
                </summary>
                <KeyValueList
                  items={[
                    { label: "Lý do", value: h.reason ?? "—" },
                    {
                      label: "Người thực hiện",
                      value: `${h.actorKind === "owner" ? "Nhà cung cấp" : "Tài khoản Hội Thánh"} · ${h.actorId}`,
                    },
                    { label: "Trước", value: summary(h.before) },
                    { label: "Sau", value: summary(h.after) },
                  ]}
                />
              </details>
            ))}
            {history?.nextCursor && (
              <PaginationControl
                loading={locked}
                onMore={() => void showHistory(history.nextCursor as string)}
              />
            )}
          </div>
        )}
        {dialog &&
          ["state", "interview", "activate", "close", "reopen"].includes(dialog.kind) &&
          course && (
            <form
              className="prep-form"
              onSubmit={(e) => {
                e.preventDefault();
                if (dialog.kind === "interview")
                  mutation.send(
                    `${path}/enrollments/${dialog.person.memberId}/interview`,
                    "POST",
                    { heldOn: interviewOn, interviewer, reason },
                    dialog.person.version,
                  );
                else if (dialog.kind === "state")
                  mutation.send(
                    `${path}/enrollments/${dialog.person.memberId}/state`,
                    "POST",
                    {
                      state: dialog.person.state === "studying" ? "withdrawn" : "studying",
                      confirmUnknown: confirmed,
                      reason,
                    },
                    dialog.person.version,
                  );
                else mutation.send(`${path}/${dialog.kind}`, "POST", { reason }, course.version);
              }}
            >
              <p>
                <strong>{course.name}</strong>
                {dialog.kind === "state" || dialog.kind === "interview"
                  ? ` · ${dialog.person.fullName}`
                  : ""}
              </p>
              {dialog.kind === "close" && (
                <Feedback tone="warning">
                  Đóng khóa giữ tiến độ và lịch sử, không tự kết luận hoàn thành hoặc Báp-têm. Còn{" "}
                  {course.openSessions} buổi đang mở; cần chốt trước. Các bài chưa có ghi nhận vẫn
                  giữ nguyên.
                </Feedback>
              )}
              {dialog.kind === "state" && (
                <>
                  <p>
                    {dialog.person.state === "studying"
                      ? "Ngừng học không xóa roster đã mở hoặc lịch sử hiện diện."
                      : "Khôi phục cần hồ sơ còn đủ điều kiện ghi danh."}
                  </p>
                  {dialog.person.state === "withdrawn" && (
                    <Choice
                      label="Xác nhận khi hồ sơ chưa rõ trạng thái Báp-têm"
                      checked={confirmed}
                      disabled={locked}
                      onChange={(e) => setConfirmed(e.target.checked)}
                    />
                  )}
                </>
              )}
              {dialog.kind === "interview" && (
                <>
                  <Feedback>
                    Chỉ ghi nhận sự kiện phỏng vấn, không đánh giá đạt/rớt hoặc ghi nội dung trả
                    lời.
                  </Feedback>
                  <Field label="Ngày phỏng vấn">
                    <TextInput
                      required
                      type="date"
                      value={interviewOn}
                      disabled={locked}
                      onChange={(e) => setInterviewOn(e.target.value)}
                    />
                  </Field>
                  <Field label="Người phỏng vấn">
                    <TextInput
                      required
                      maxLength={200}
                      value={interviewer}
                      disabled={locked}
                      onChange={(e) => setInterviewer(e.target.value)}
                    />
                  </Field>
                </>
              )}
              <Field label="Lý do">
                <TextArea
                  required
                  maxLength={500}
                  value={reason}
                  disabled={locked}
                  onChange={(e) => setReason(e.target.value)}
                />
              </Field>
              <DialogActions>
                <Button disabled={locked} onClick={() => setDialog(null)}>
                  Hủy
                </Button>
                <Button type="submit" variant="primary" disabled={locked}>
                  Xác nhận {names[dialog.kind].toLowerCase()}
                </Button>
              </DialogActions>
            </form>
          )}
      </Modal>
    </div>
  );
}
const historyLabels: Record<string, string> = {
  created: "Tạo khóa",
  metadata_changed: "Sửa khóa",
  activate: "Bắt đầu khóa",
  close: "Đóng khóa",
  reopen: "Mở lại khóa",
  enrolled: "Ghi danh",
  enrollment_state: "Đổi ghi danh",
  interview_recorded: "Ghi nhận phỏng vấn",
  meeting_created: "Tạo buổi",
};
function summary(v: Record<string, unknown> | null) {
  if (!v) return "—";
  return (
    [
      v.name,
      v.fullName,
      v.code,
      typeof v.version === "number" ? `Phiên bản ${v.version}` : null,
      v.state === "studying"
        ? "Đang học"
        : v.state === "withdrawn"
          ? "Ngừng học"
          : v.state === "active"
            ? "Đang học"
            : v.state === "closed"
              ? "Đã đóng"
              : v.state === "draft"
                ? "Nháp"
                : null,
    ]
      .filter(Boolean)
      .join(" · ") || "Đã lưu thay đổi"
  );
}
