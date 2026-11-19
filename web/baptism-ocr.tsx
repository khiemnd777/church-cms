import { useEffect, useId, useRef, useState } from "react";
import type { BaptismOcr } from "../api/rites/baptism-ocr";
import type { PersonInput } from "../api/rites/validation";
import { ApiError, churchRequest } from "./api";
import { RitePersonPicker } from "./rites-forms";
import { authErrorCodes, type TenantIntent, useTenantMutation } from "./tenant-mutation";
import {
  Button,
  Choice,
  DialogActions,
  Feedback,
  Field,
  Loading,
  Modal,
  Stack,
  TextInput,
} from "./ui/components";

type Session = Awaited<ReturnType<BaptismOcr["scan"]>>;
type Preview = Awaited<ReturnType<BaptismOcr["preview"]>>;
type RowInput = {
  memberId: string;
  date: string | null;
  place: string | null;
  officiant: PersonInput | null;
  preview: string | null;
};

export function BaptismOcrDialog(props: {
  churchId: string;
  principalKey: string;
  pending: TenantIntent | null;
  onPending: (intent: TenantIntent | null) => void;
  onAuthError: (error: unknown) => void;
  onClose: () => void;
  onOpenRecord: (id: string) => void;
  onRecorded: () => void;
}) {
  const prefix = `churches/${props.churchId}/rites`;
  const endpoint = `${prefix}/baptism-ocr`;
  const upload = useId();
  const mounted = useRef(true);
  const [file, setFile] = useState<File | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [position, setPosition] = useState(0);
  const [zoom, setZoom] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<{ body: RowInput; data: Preview } | null>(null);
  const row = session?.rows[position];
  const path = session && row ? `${endpoint}/${session.id}/rows/${row.index}` : null;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!session) return;
    const timer = setTimeout(
      () => {
        setSession(null);
        setPreview(null);
        setError("Ảnh và kết quả tạm đã hết hạn.");
      },
      Math.max(0, Date.parse(session.expiresAt) - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [session?.id, session?.expiresAt]);
  function fail(e: unknown) {
    if (!mounted.current) return;
    if (
      e instanceof ApiError &&
      [...authErrorCodes, "FORBIDDEN", "CHURCH_SUSPENDED", "BAPTISM_OCR_EXPIRED"].includes(e.code)
    ) {
      setSession(null);
      setPreview(null);
      setFile(null);
      if (e.code !== "BAPTISM_OCR_EXPIRED") props.onAuthError(e);
    }
    setError(e instanceof Error ? e.message : "Không đọc được ảnh.");
  }
  const mutation = useTenantMutation({
    ...props,
    realm: "church",
    canWrite: true,
    prefix: endpoint,
    operationPath: `${prefix}/operations`,
    onAuthError: fail,
    onAccessLoss: fail,
    onSuccess: (data) => {
      if (
        !mounted.current ||
        !row ||
        !data ||
        typeof data !== "object" ||
        !("riteId" in data) ||
        typeof data.riteId !== "string"
      )
        return;
      const id = data.riteId;
      setSession(
        (old) =>
          old && {
            ...old,
            rows: old.rows.map((r) => (r.index === row.index ? { ...r, recordedId: id } : r)),
          },
      );
      setPreview(null);
      props.onRecorded();
    },
  });
  const locked = busy || mutation.busy || !!props.pending;
  const pending = props.pending?.path.startsWith(`${endpoint}/`) ? props.pending : null;
  async function read() {
    if (!file || locked) return;
    setError("");
    setBusy(true);
    try {
      const result = await churchRequest<Session>(endpoint, {
        method: "POST",
        rawBody: file,
        headers: { "Content-Type": file.type },
      });
      if (!mounted.current) return;
      setSession(result.data);
      setPosition(0);
      setZoom(false);
      setImageFailed(false);
      setFile(null);
    } catch (e) {
      fail(e);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  async function prepare(body: RowInput) {
    if (!path || locked) return;
    setError("");
    setBusy(true);
    try {
      const r = await churchRequest<Preview>(`${path}/preview`, { method: "POST", body });
      if (mounted.current) setPreview({ body, data: r.data });
    } catch (e) {
      fail(e);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  function move(i: number) {
    setPosition(i);
    setError("");
    mutation.setError("");
    setPreview(null);
  }
  const existing = row?.recordedId ?? preview?.data.existing;
  const officiant = preview?.body.officiant;
  const officiantLabel =
    officiant?.source === "external"
      ? officiant.fullName
      : officiant?.source === "member"
        ? (preview?.data.preview?.after.people.find((p) => p.memberId === officiant.memberId)
            ?.fullName ?? "—")
        : "Chưa rõ";
  return (
    <Modal
      open
      title={preview?.data.preview ? "Xem trước ghi nhận Báp-têm" : "Nhập từ ảnh sổ cũ"}
      locked={locked}
      onClose={props.onClose}
    >
      {error && <Feedback tone="error">{error}</Feedback>}
      {mutation.error && <Feedback tone="error">{mutation.error}</Feedback>}
      {pending && (
        <Stack space="content">
          <Feedback tone="warning">
            Chưa rõ kết quả ghi. Đối soát cùng yêu cầu trước khi thử lại.
          </Feedback>
          <Button disabled={mutation.busy} onClick={() => void mutation.execute(pending, true)}>
            Đối soát kết quả
          </Button>
          <Button
            disabled={mutation.busy}
            onClick={() => {
              if (!window.confirm("Đọc lại sổ để đối soát trước thao tác mới?")) return;
              props.onPending(null);
              props.onClose();
            }}
          >
            Đối soát sổ
          </Button>
        </Stack>
      )}
      {!session && (
        <Stack space="content">
          <p>Chọn một trang JPEG hoặc PNG, tối đa 5 MiB. Ảnh và kết quả tạm hết hạn sau 24 giờ.</p>
          <TextInput
            hidden
            type="file"
            id={upload}
            aria-label="Tệp ảnh trang sổ"
            accept="image/jpeg,image/png"
            disabled={locked}
            onChange={(e) => {
              const selected = e.currentTarget.files?.[0] ?? null;
              e.currentTarget.value = "";
              if (
                selected &&
                (!["image/jpeg", "image/png"].includes(selected.type) ||
                  selected.size > 5 * 1024 * 1024)
              ) {
                setFile(null);
                setError("Chọn ảnh JPEG hoặc PNG hợp lệ, tối đa 5 MiB.");
              } else {
                setFile(selected);
                setError("");
              }
            }}
          />
          <DialogActions>
            <Button disabled={locked} onClick={() => document.getElementById(upload)?.click()}>
              Chọn ảnh
            </Button>
            <Button variant="primary" disabled={locked || !file} onClick={() => void read()}>
              Đọc ảnh
            </Button>
          </DialogActions>
          {file && <p>{file.name}</p>}
          {busy && <Loading>Đang đọc ảnh…</Loading>}
        </Stack>
      )}
      {session && row && (
        <Stack space="section">
          <div className={zoom ? "rites-ocr-columns rites-ocr-expanded" : "rites-ocr-columns"}>
            <Stack space="content">
              {imageFailed ? (
                <Feedback tone="error">Ảnh tạm không còn khả dụng.</Feedback>
              ) : (
                <img
                  className="rites-ocr-image"
                  src={`/api/v1/${endpoint}/${session.id}/image`}
                  alt="Ảnh trang sổ Báp-têm"
                  onError={() => setImageFailed(true)}
                />
              )}
              <Button disabled={locked || imageFailed} onClick={() => setZoom(!zoom)}>
                {zoom ? "Thu ảnh" : "Phóng ảnh"}
              </Button>
            </Stack>
            <Stack space="content">
              <h3>
                Dòng {position + 1} / {session.rows.length}
              </h3>
              <Stack space="compact">
                {["Họ tên", "Ngày", "Nơi", "Người cử hành"].map((label, i) => (
                  <p key={label}>
                    {label}: {row.cells[i]?.text || "—"}
                    {(row.cells[i]?.score ?? 0) < 0.85 && " · Cần kiểm tra"}
                  </p>
                ))}
              </Stack>
              {existing ? (
                <DialogActions>
                  {!row.recordedId && (
                    <Button disabled={locked} onClick={() => setPreview(null)}>
                      Chọn lại hồ sơ
                    </Button>
                  )}
                  <Button disabled={locked} onClick={() => props.onOpenRecord(existing)}>
                    Xem bản đã ghi
                  </Button>
                </DialogActions>
              ) : preview?.data.preview ? (
                <Stack space="content">
                  <Stack space="compact">
                    <p>
                      Hồ sơ:{" "}
                      {preview.data.preview.after.people.find(
                        (p) => p.memberId === preview.body.memberId,
                      )?.fullName ?? "—"}
                    </p>
                    <p>Ngày: {preview.body.date ?? "Chưa rõ"}</p>
                    <p>Nơi: {preview.body.place ?? "Chưa rõ"}</p>
                    <p>Người cử hành: {officiantLabel}</p>
                    {preview.data.preview.baptismBefore && (
                      <p>
                        Thông tin hiện hành:{" "}
                        {preview.data.preview.baptismBefore.date ?? "Chưa rõ ngày"} ·{" "}
                        {preview.data.preview.baptismBefore.place ?? "Chưa rõ nơi"}
                      </p>
                    )}
                  </Stack>
                  <DialogActions>
                    <Button disabled={locked} onClick={() => setPreview(null)}>
                      Quay lại
                    </Button>
                    <Button
                      variant="primary"
                      disabled={locked || !path || imageFailed}
                      onClick={() => {
                        if (path && preview.data.preview)
                          mutation.send(`${path}/record`, "POST", {
                            ...preview.body,
                            preview: preview.data.preview.context,
                          });
                      }}
                    >
                      Xác nhận ghi nhận
                    </Button>
                  </DialogActions>
                </Stack>
              ) : null}
              {!row.recordedId && (
                <div hidden={!!preview}>
                  <RowReview
                    key={row.index}
                    row={row}
                    prefix={prefix}
                    locked={locked || imageFailed || !!preview}
                    onFail={fail}
                    onReview={prepare}
                  />
                </div>
              )}
            </Stack>
          </div>
          <DialogActions>
            <Button disabled={locked || position === 0} onClick={() => move(position - 1)}>
              Dòng trước
            </Button>
            <Button
              disabled={locked || position + 1 === session.rows.length}
              onClick={() => move(position + 1)}
            >
              {existing ? "Dòng tiếp" : "Bỏ qua dòng"}
            </Button>
            <Button
              disabled={locked}
              onClick={() => {
                setSession(null);
                setPreview(null);
                setError("");
              }}
            >
              Chọn trang khác
            </Button>
          </DialogActions>
        </Stack>
      )}
    </Modal>
  );
}

function RowReview({
  row,
  prefix,
  locked,
  onFail,
  onReview,
}: {
  row: Session["rows"][number];
  prefix: string;
  locked: boolean;
  onFail: (e: unknown) => void;
  onReview: (body: RowInput) => void;
}) {
  const [person, setPerson] = useState<PersonInput | null>({ source: "member", memberId: "" });
  const [date, setDate] = useState(row.date ?? "");
  const [unknown, setUnknown] = useState(false);
  const [place, setPlace] = useState(row.cells[2].text);
  const [officiant, setOfficiant] = useState<PersonInput | null>(null);
  const memberId = person?.source === "member" ? person.memberId : "";
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (memberId && !locked && (unknown || date))
          onReview({
            memberId,
            date: unknown ? null : date,
            place: place.trim() || null,
            officiant,
            preview: null,
          });
      }}
    >
      <Stack space="content">
        <RitePersonPicker
          label="Hồ sơ"
          value={person}
          onChange={setPerson}
          external={false}
          locked={locked}
          realm="church"
          prefix={prefix}
          onFail={onFail}
        />
        <Field label="Ngày">
          <TextInput
            type="date"
            value={date}
            disabled={locked || unknown}
            onChange={(e) => setDate(e.target.value)}
          />
        </Field>
        <Choice
          label="Ngày chưa rõ"
          checked={unknown}
          disabled={locked}
          onChange={(e) => setUnknown(e.target.checked)}
        />
        <Field label="Nơi">
          <TextInput
            value={place}
            maxLength={200}
            disabled={locked}
            onChange={(e) => setPlace(e.target.value)}
          />
        </Field>
        <RitePersonPicker
          label="Người cử hành"
          value={officiant}
          onChange={setOfficiant}
          external
          optional
          locked={locked}
          realm="church"
          prefix={prefix}
          onFail={onFail}
        />
        <DialogActions>
          <Button
            type="submit"
            variant="primary"
            disabled={locked || !memberId || !(date || unknown)}
          >
            Xem trước
          </Button>
        </DialogActions>
      </Stack>
    </form>
  );
}
