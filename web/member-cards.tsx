import { useEffect, useRef, useState } from "react";
import type { Cards } from "../api/cards/service";
import {
  type TenantIntent,
  type TenantRealm,
  tenantRequest,
  useTenantMutation,
} from "./tenant-mutation";
import {
  Badge,
  Button,
  DialogActions,
  Feedback,
  Field,
  Loading,
  MemberCardView,
  Modal,
  PaginationControl,
  SectionHeader,
  TextArea,
} from "./ui/components";

type Current = Awaited<ReturnType<Cards["current"]>>;
type Rendered = Awaited<ReturnType<Cards["render"]>>;
type History = Awaited<ReturnType<Cards["historyPage"]>>;
export function isCardIntent(intent: TenantIntent | null, base: string) {
  return (
    !!intent &&
    (intent.path.startsWith(`${base}/cards/`) ||
      new RegExp(`^${base}/members/[a-f0-9]{24}/cards$`).test(intent.path))
  );
}
export function MemberCards({
  realm,
  churchId,
  memberId,
  memberName,
  principalKey,
  canManage,
  pending,
  onPending,
  onAuthError,
}: {
  realm: TenantRealm;
  churchId: string;
  memberId: string;
  memberName: string;
  principalKey: string;
  canManage: boolean;
  pending: TenantIntent | null;
  onPending: (v: TenantIntent | null) => void;
  onAuthError: (e: unknown) => void;
}) {
  const base = `${realm === "owner" ? "owner/" : ""}churches/${churchId}`,
    prefix = `${base}/cards`;
  const [current, setCurrent] = useState<Current | null>(null),
    [render, setRender] = useState<Rendered | null>(null),
    [history, setHistory] = useState<History | null>(null),
    [loading, setLoading] = useState(true),
    [refresh, setRefresh] = useState(0),
    [action, setAction] = useState<"replace" | "revoke" | null>(null),
    [reason, setReason] = useState("");
  const epoch = useRef(0);
  const ownPending = isCardIntent(pending, base) ? pending : null;
  const mutation = useTenantMutation({
    realm,
    churchId,
    principalKey,
    canWrite: canManage,
    pending,
    onPending,
    onAuthError,
    prefix,
    intentResource: { kind: "member_card", memberId },
    acceptPath: (path) =>
      path === `${base}/members/${memberId}/cards` || path.startsWith(`${prefix}/`),
    operationPath: `${prefix}/operations`,
    onSuccess: () => {
      setAction(null);
      setRefresh((n) => n + 1);
      setHistory(null);
    },
  });
  const locked = mutation.busy || !!pending;
  useEffect(() => {
    const e = ++epoch.current,
      controller = new AbortController();
    setCurrent(null);
    setRender(null);
    setHistory(null);
    setLoading(true);
    void (async () => {
      const r = await tenantRequest<Current>(realm, `${base}/members/${memberId}/card`, {
        signal: controller.signal,
      });
      if (e !== epoch.current) return;
      setCurrent(r.data);
      if (r.data.eligible && r.data.card?.state === "active") {
        const image = await tenantRequest<Rendered>(
          realm,
          `${prefix}/${r.data.card.id}/render?version=${r.data.card.version}`,
          { signal: controller.signal },
        );
        if (e === epoch.current) setRender(image.data);
      }
    })()
      .catch((e) => {
        if (!controller.signal.aborted) mutation.fail(e);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => {
      controller.abort();
      epoch.current++;
    };
  }, [realm, churchId, memberId, refresh]);
  async function loadHistory(cursor?: string) {
    if (!current?.card) return;
    const e = epoch.current;
    try {
      const r = await tenantRequest<History>(
        realm,
        `${prefix}/${current.card.id}/history${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
      );
      if (e === epoch.current)
        setHistory((old) => ({
          ...r.data,
          items: cursor ? [...(old?.items ?? []), ...r.data.items] : r.data.items,
        }));
    } catch (error) {
      if (e === epoch.current) mutation.fail(error);
    }
  }
  const feedback = (
    <>
      {mutation.error && <Feedback tone="error">{mutation.error}</Feedback>}
      {ownPending && (
        <Feedback tone="warning">
          <p>
            Thao tác thẻ đang chờ đối soát. Giữ nguyên thao tác trước khi cấp hoặc thay thẻ khác.
          </p>
          <Button
            disabled={mutation.busy || !canManage}
            onClick={() => void mutation.execute(ownPending, true)}
          >
            Kiểm tra kết quả thẻ
          </Button>
          <Button
            disabled={mutation.busy}
            onClick={() => {
              if (window.confirm("Đọc lại thẻ hiện tại để đối soát trước thao tác mới?")) {
                onPending(null);
                setAction(null);
                setRefresh((n) => n + 1);
              }
            }}
          >
            Đọc lại thẻ để đối soát
          </Button>
        </Feedback>
      )}
    </>
  );
  return (
    <section className="member-history" aria-label="QR và thẻ thuộc viên">
      <SectionHeader title="QR / Thẻ thuộc viên" />
      {!action && feedback}
      {mutation.notice && <Feedback>{mutation.notice}</Feedback>}
      {loading && <Loading />}
      {current && (
        <>
          {current.card && (
            <p>
              <Badge tone={current.card.state === "active" ? "good" : "warn"}>
                {current.card.state === "active" ? "Đang hiệu lực" : "Đã thu hồi"}
              </Badge>{" "}
              · Phiên bản {current.card.version}
            </p>
          )}
          {!current.eligible && (
            <Feedback tone="warning">
              Hồ sơ không còn đang sinh hoạt hoặc vắng lâu. Không cấp, thay, in hoặc dùng QR cho
              điểm danh.
            </Feedback>
          )}
          {current.profileChanged && current.card?.state === "active" && (
            <Feedback tone="warning">
              Thông tin hồ sơ đã đổi. Thẻ giữ thông tin lúc cấp; thay thẻ nếu cần cập nhật bản in.
            </Feedback>
          )}
          {render && <MemberCardView snapshot={render.card.snapshot} svg={render.svg} />}
          <DialogActions>
            {canManage && (!current.card || current.card.state === "revoked") && (
              <Button
                variant="primary"
                disabled={locked || !current.eligible}
                onClick={() => {
                  mutation.send(`${base}/members/${memberId}/cards`, "POST", {});
                }}
              >
                Cấp thẻ
              </Button>
            )}
            {render && (
              <Button
                disabled={locked}
                onClick={() =>
                  window.open(
                    `/api/v1/${prefix}/${render.card.id}/print?version=${render.card.version}`,
                    "_blank",
                    "noopener,noreferrer",
                  )
                }
              >
                In thẻ
              </Button>
            )}
            {canManage && current.card?.state === "active" && (
              <>
                <Button
                  disabled={locked || !current.eligible}
                  onClick={() => {
                    setAction("replace");
                    setReason("");
                  }}
                >
                  Thay thẻ
                </Button>
                <Button
                  disabled={locked}
                  onClick={() => {
                    setAction("revoke");
                    setReason("");
                  }}
                >
                  Thu hồi thẻ
                </Button>
              </>
            )}
            {current.card && (
              <Button disabled={locked} onClick={() => void loadHistory()}>
                Lịch sử thẻ
              </Button>
            )}
            <Button disabled={locked || loading} onClick={() => setRefresh((n) => n + 1)}>
              Tải lại thẻ
            </Button>
          </DialogActions>
        </>
      )}
      {history && (
        <div className="member-history">
          {history.items.map((h) => (
            <details key={h.id}>
              <summary>
                {{ issued: "Cấp thẻ", replaced: "Thay thẻ", revoked: "Thu hồi thẻ" }[h.event]} ·{" "}
                {new Date(h.occurredAt).toLocaleString("vi-VN")}
              </summary>
              <p>{h.reason ?? "Cấp thẻ mới"}</p>
              <p>
                {h.actorKind === "owner" ? "Nhà cung cấp" : "Tài khoản Hội Thánh"} · {h.actorId}
              </p>
              <p>Trước: {historyCard(h.before)}</p>
              <p>Sau: {historyCard(h.after)}</p>
            </details>
          ))}
          {history.nextCursor && (
            <PaginationControl
              loading={locked}
              onMore={() => void loadHistory(history.nextCursor as string)}
            />
          )}
        </div>
      )}
      <Modal
        open={!!action}
        title={action === "replace" ? "Thay thẻ" : "Thu hồi thẻ"}
        locked={locked}
        onClose={() => setAction(null)}
      >
        {feedback}
        <form
          className="member-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!current?.card || !action) return;
            mutation.send(
              `${prefix}/${current.card.id}/${action}`,
              "POST",
              { reason },
              current.card.version,
            );
          }}
        >
          <p>
            <strong>{memberName}</strong> · Phiên bản {current?.card?.version}
          </p>
          <Feedback tone="warning">
            Mã QR cũ sẽ mất hiệu lực ngay khi lưu. Lịch sử và các lần điểm danh đã ghi vẫn được giữ.
          </Feedback>
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
            <Button disabled={locked} onClick={() => setAction(null)}>
              Hủy
            </Button>
            <Button type="submit" variant="primary" disabled={locked}>
              Xác nhận {action === "replace" ? "thay thẻ" : "thu hồi thẻ"}
            </Button>
          </DialogActions>
        </form>
      </Modal>
    </section>
  );
}

function historyCard(value: Record<string, unknown> | null) {
  if (!value) return "Chưa có thẻ";
  const snapshot = value.snapshot;
  const name =
    snapshot && typeof snapshot === "object" && "fullName" in snapshot
      ? String(snapshot.fullName)
      : "";
  return `${name} · Phiên bản ${String(value.version)} · ${value.state === "active" ? "Đang hiệu lực" : "Đã thu hồi"}`;
}
