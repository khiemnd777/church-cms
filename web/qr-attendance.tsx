import { useEffect, useRef, useState } from "react";
import type { Attendance } from "../api/attendance/service";
import { ApiError } from "./api";
import type { Session } from "./attendance-api";
import { QrCamera } from "./qr-camera";
import {
  authErrorCodes,
  type TenantIntent,
  type TenantRealm,
  tenantRequest,
  useTenantMutation,
} from "./tenant-mutation";
import { Button, DialogActions, Feedback, Field, Modal, QrVideo, Select } from "./ui/components";

type Resolution = Awaited<ReturnType<Attendance["qrResolution"]>>;
export function QrAttendance({
  realm,
  churchId,
  session,
  principalKey,
  pending,
  onPending,
  onAuthError,
  onChanged,
  onClose,
}: {
  realm: TenantRealm;
  churchId: string;
  session: Session;
  principalKey: string;
  pending: TenantIntent | null;
  onPending: (v: TenantIntent | null) => void;
  onAuthError: (e: unknown) => void;
  onChanged: () => void;
  onClose: () => void;
}) {
  const prefix = `${realm === "owner" ? "owner/" : ""}churches/${churchId}/attendance`,
    path = `${prefix}/sessions/${session.id}`;
  const video = useRef<HTMLVideoElement>(null),
    camera = useRef<QrCamera | null>(null),
    inflight = useRef(false),
    mounted = useRef(true),
    last = useRef({ code: "", at: 0 }),
    decoded = useRef<(code: string) => void>(() => {}),
    request = useRef<AbortController | null>(null),
    person = useRef("");
  const [active, setActive] = useState(false),
    [resolving, setResolving] = useState(false),
    [facing, setFacing] = useState<"environment" | "user">("environment"),
    [message, setMessage] = useState(""),
    [resolutionError, setResolutionError] = useState("");
  function stop() {
    camera.current?.stop();
    request.current?.abort();
    setActive(false);
  }
  function authFailure(error: unknown) {
    stop();
    onAuthError(error);
  }
  const mutation = useTenantMutation({
    realm,
    churchId,
    principalKey,
    canWrite: true,
    pending,
    onPending,
    onAuthError: authFailure,
    prefix,
    operationPath: `${prefix}/operations`,
    onSuccess: () => {
      setMessage(
        `${person.current || "Thao tác"}: đã ghi nhận có mặt. Người đã có mặt được giữ nguyên.`,
      );
      onChanged();
    },
  });
  const blocked = mutation.busy || !!pending;
  const blockedRef = useRef(blocked);
  blockedRef.current = blocked;
  decoded.current = (code) => {
    if (inflight.current || blockedRef.current || !/^QLHT1:[A-Za-z0-9_-]{43}$/.test(code)) return;
    const now = Date.now();
    if (last.current.code === code && now - last.current.at < 2000) return;
    last.current = { code, at: now };
    inflight.current = true;
    setResolving(true);
    setResolutionError("");
    setMessage("");
    const controller = new AbortController();
    request.current = controller;
    void tenantRequest<Resolution>(realm, `${path}/qr-resolutions`, {
      method: "POST",
      body: { code, generation: session.generation },
      signal: controller.signal,
    })
      .then((r) => {
        if (!mounted.current || controller.signal.aborted || blockedRef.current) return;
        person.current = `${r.data.participant.fullName} · ${r.data.participant.code}`;
        mutation.send(
          `${path}/scans`,
          "POST",
          { resolutionToken: r.data.resolutionToken, generation: session.generation },
          r.data.participant.version,
        );
      })
      .catch((error) => {
        if (controller.signal.aborted || !mounted.current) return;
        setResolutionError(error instanceof Error ? error.message : "Không xác minh được thẻ.");
        if (
          error instanceof ApiError &&
          [...authErrorCodes, "FORBIDDEN", "CHURCH_SUSPENDED"].includes(error.code)
        )
          authFailure(error);
        else if (
          error instanceof ApiError &&
          [
            "VERSION_CONFLICT",
            "QR_RESOLUTION_STALE",
            "ATTENDANCE_STATE",
            "ATTENDANCE_SESSION_CHANGED",
            "RATE_LIMITED",
          ].includes(error.code)
        )
          stop();
      })
      .finally(() => {
        inflight.current = false;
        if (mounted.current) setResolving(false);
      });
  };
  useEffect(() => {
    mounted.current = true;
    if (video.current)
      camera.current = new QrCamera(
        video.current,
        (code) => decoded.current(code),
        (error) => {
          setActive(false);
          setResolutionError(error);
        },
      );
    const hidden = () => {
      if (document.hidden) stop();
    };
    const leaving = () => stop();
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("pagehide", leaving);
    return () => {
      mounted.current = false;
      camera.current?.stop();
      request.current?.abort();
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("pagehide", leaving);
    };
  }, []);
  useEffect(() => {
    if ((pending && !mutation.busy) || mutation.error) stop();
  }, [pending, mutation.busy, mutation.error]);
  return (
    <Modal
      open
      title="Quét QR điểm danh"
      locked={blocked || resolving}
      onClose={() => {
        stop();
        onClose();
      }}
    >
      <div className="attendance-dialog-content">
        <p>
          <strong>{session.label}</strong> · {session.heldOn} ·{" "}
          {session.prepClass ? "Lớp dự bị" : (session.unitName ?? "Toàn Hội Thánh")}
        </p>
        <p>
          Đưa QR trên thẻ vào khung để ghi có mặt. Hình camera chỉ được giải mã trên thiết bị; không
          gửi ảnh lên server.
        </p>
        <QrVideo videoRef={video} />
        {resolving && <Feedback>Đang xác minh thẻ…</Feedback>}
        {message && <Feedback>{message}</Feedback>}
        {resolutionError && <Feedback tone="error">{resolutionError}</Feedback>}
        {mutation.error && <Feedback tone="error">{mutation.error}</Feedback>}
        {pending && (
          <Feedback tone="warning">
            <p>Kết quả đang chờ đối soát. Camera dừng nhận mã mới.</p>
            <Button disabled={mutation.busy} onClick={() => void mutation.execute(pending, true)}>
              Kiểm tra kết quả QR
            </Button>
            <Button
              disabled={mutation.busy}
              onClick={() => {
                if (window.confirm("Đọc lại kết quả buổi trước khi tạo thao tác mới?")) {
                  onPending(null);
                  stop();
                  onChanged();
                  onClose();
                }
              }}
            >
              Đối soát danh sách
            </Button>
          </Feedback>
        )}
        <Field label="Camera">
          <Select
            value={facing}
            disabled={blocked || resolving || active}
            onChange={(e) => setFacing(e.target.value as typeof facing)}
          >
            <option value="environment">Camera sau</option>
            <option value="user">Camera trước</option>
          </Select>
        </Field>
        <DialogActions>
          <Button
            variant="primary"
            disabled={blocked || resolving || active}
            onClick={() => {
              setResolutionError("");
              mutation.setError("");
              setActive(true);
              void camera.current?.start(facing);
            }}
          >
            Bật camera
          </Button>
          <Button disabled={!active} onClick={stop}>
            Dừng camera
          </Button>
          <Button
            disabled={blocked || resolving}
            onClick={() => {
              stop();
              onClose();
            }}
          >
            Đóng — dùng điểm danh tay
          </Button>
        </DialogActions>
      </div>
    </Modal>
  );
}
