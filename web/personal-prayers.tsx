import { useEffect, useState } from "react";
import type { MemberPortal } from "../api/portal/service";
import type { PrayerFields } from "../api/prayers/validation";
import { ApiError, churchRequest } from "./api";
import { prayerCategories } from "./prayers-api";
import { authErrorCodes, type TenantIntent, useTenantMutation } from "./tenant-mutation";
import {
  Badge,
  Button,
  Card,
  Choice,
  ContentSection,
  EmptyState,
  Feedback,
  Field,
  Loading,
  PaginationControl,
  Select,
  Stack,
  TextArea,
  Toolbar,
} from "./ui/components";
import "./prayers.css";

type Page = Awaited<ReturnType<MemberPortal["prayerRequests"]>>;
export interface PersonalPrayerAccess {
  principalKey: string;
  pending: TenantIntent | null;
  onPending: (intent: TenantIntent | null) => void;
}
const labels = { sent: "Đã gửi", closed: "Đã khép lại", cancelled: "Đã hủy" };
const date = new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", dateStyle: "short" });

export function PersonalPrayers({
  churchId,
  access,
  onAuthError,
  onLinkLoss,
}: {
  churchId: string;
  access: PersonalPrayerAccess;
  onAuthError: (error: unknown) => void;
  onLinkLoss: () => void;
}) {
  const { pending, onPending, principalKey } = access;
  const stored = pending?.body as
    | { category?: PrayerFields["category"]; content?: string }
    | undefined;
  const [category, setCategory] = useState(stored?.category ?? ""),
    [content, setContent] = useState(stored?.content ?? ""),
    [confirmed, setConfirmed] = useState(!!pending),
    [page, setPage] = useState<Page | null>(null),
    [cursor, setCursor] = useState<string | null>(null),
    [reload, setReload] = useState(0),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [receipt, setReceipt] = useState("");
  const path = `churches/${churchId}/portal/prayers`;
  function refresh() {
    setCursor(null);
    setReload((n) => n + 1);
  }
  const mutation = useTenantMutation({
    realm: "church",
    churchId,
    principalKey,
    canWrite: true,
    pending,
    onPending,
    prefix: path,
    acceptPath: (target) => target === path,
    intentResource: { kind: "personal_prayer" },
    onAuthError,
    onAccessLoss: (e) => {
      if (e.code === "PORTAL_LINK_REQUIRED") onLinkLoss();
      else if (e.code === "FORBIDDEN") onAuthError(e);
    },
    onSuccess: (data) => {
      setReceipt((data as { code: string }).code);
      setContent("");
      setCategory("");
      setConfirmed(false);
      refresh();
    },
  });

  useEffect(() => {
    const controller = new AbortController();
    setError("");
    setLoading(true);
    void churchRequest<Page>(path + (cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""), {
      signal: controller.signal,
    })
      .then(({ data }) => {
        if (!controller.signal.aborted)
          setPage((prev) => ({
            ...data,
            items: cursor && prev ? [...prev.items, ...data.items] : data.items,
          }));
      })
      .catch((e) => {
        if (controller.signal.aborted) return;
        setPage(null);
        if (e instanceof ApiError && e.code === "PORTAL_LINK_REQUIRED") onLinkLoss();
        else if (
          e instanceof ApiError &&
          [...authErrorCodes, "FORBIDDEN", "CHURCH_SUSPENDED"].includes(e.code)
        )
          onAuthError(e);
        else setError(e instanceof Error ? e.message : "Không tải được yêu cầu.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [path, cursor, reload]);

  const locked = mutation.busy || !!pending;
  return (
    <>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (locked || !confirmed || !category || !content.trim()) return;
          setReceipt("");
          mutation.send(path, "POST", { category, content, confirmed });
        }}
      >
        <Card spacing="content">
          <p>
            Người nhận <strong>Mục sư</strong>
          </p>
          <Field label="Danh mục" error={mutation.fields.category}>
            <Select
              required
              disabled={locked}
              value={category}
              onChange={(e) => {
                setCategory(e.target.value as PrayerFields["category"]);
                setConfirmed(false);
              }}
            >
              <option value="">Chọn danh mục</option>
              {Object.entries(prayerCategories).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Nội dung cầu thay" error={mutation.fields.content}>
            <TextArea
              rows={4}
              maxLength={2000}
              required
              disabled={locked}
              value={content}
              onChange={(e) => {
                setContent(e.target.value);
                setConfirmed(false);
              }}
            />
          </Field>
          <Choice
            label="Xác nhận gửi riêng cho Mục sư"
            checked={confirmed}
            disabled={locked}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          {mutation.error && <Feedback tone="error">{mutation.error}</Feedback>}
          {receipt && <Feedback>Đã gửi yêu cầu {receipt}.</Feedback>}
          {mutation.busy && <Loading>Đang gửi cầu thay…</Loading>}
          {!pending && (
            <Button type="submit" disabled={locked || !confirmed || !category || !content.trim()}>
              Gửi cầu thay
            </Button>
          )}
          {pending && !mutation.busy && (
            <Stack space="content">
              <Feedback tone="warning">Hãy thử lại cùng yêu cầu để xác nhận kết quả.</Feedback>
              <Toolbar>
                <Button onClick={() => void mutation.execute(pending, true)}>Thử lại gửi</Button>
                <Button
                  onClick={() => {
                    onPending(null);
                    setContent("");
                    setCategory("");
                    setConfirmed(false);
                    mutation.setError("");
                    refresh();
                  }}
                >
                  Dừng thử lại
                </Button>
              </Toolbar>
            </Stack>
          )}
        </Card>
      </form>
      <ContentSection title="Yêu cầu tôi đã gửi">
        {loading && <Loading>Đang tải yêu cầu…</Loading>}
        {error && (
          <Stack space="content">
            <Feedback tone="error">{error}</Feedback>
            <Button onClick={refresh}>Tải lại yêu cầu</Button>
          </Stack>
        )}
        {page && !page.items.length && !locked && (
          <EmptyState message="Bạn chưa gửi yêu cầu cầu thay." />
        )}
        {page?.items.map((row) => (
          <Card key={row.id} spacing="compact">
            <p>
              {row.code} · {prayerCategories[row.category]} ·{" "}
              {date.format(new Date(row.submittedAt))}
            </p>
            <p className="prayer-content">{row.content}</p>
            <div>
              <Badge>{labels[row.status]}</Badge>
            </div>
          </Card>
        ))}
        {page?.nextCursor && (
          <PaginationControl loading={loading} onMore={() => setCursor(page.nextCursor)} />
        )}
      </ContentSection>
    </>
  );
}
