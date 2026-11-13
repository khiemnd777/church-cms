import { useEffect, useRef, useState } from "react";
import type { PrepClasses } from "../api/prep-classes/service";
import { type TenantRealm, tenantRequest } from "./tenant-mutation";
import { Button, EmptyState, Feedback, Loading, PaginationControl } from "./ui/components";

type Page = Awaited<ReturnType<PrepClasses["memberCourses"]>>;
export function MemberPrepClasses({
  realm,
  churchId,
  memberId,
  locked,
  onOpen,
  onFail,
}: {
  realm: TenantRealm;
  churchId: string;
  memberId: string;
  locked: boolean;
  onOpen?: (id: string) => void;
  onFail: (e: unknown) => void;
}) {
  const [page, setPage] = useState<Page | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false),
    [cursor, setCursor] = useState<string | null>(null);
  const epoch = useRef(0);
  useEffect(() => {
    const n = ++epoch.current,
      abort = new AbortController();
    setLoading(true);
    setError("");
    void tenantRequest<Page>(
      realm,
      `${realm === "owner" ? "owner/" : ""}churches/${churchId}/members/${memberId}/prep-classes${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
      { signal: abort.signal },
    )
      .then((r) => {
        if (n === epoch.current)
          setPage((old) => ({
            ...r.data,
            items: cursor ? [...(old?.items ?? []), ...r.data.items] : r.data.items,
          }));
      })
      .catch((e) => {
        if (!abort.signal.aborted) {
          setPage(null);
          setError(e.message);
          onFail(e);
        }
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => {
      abort.abort();
      epoch.current++;
    };
  }, [realm, churchId, memberId, cursor]);
  return (
    <section aria-label="Lớp dự bị của thuộc viên">
      <h4>Lớp dự bị</h4>
      {loading && <Loading />}
      {error && <Feedback tone="error">{error}</Feedback>}
      {page && !page.items.length && <EmptyState message="Chưa ghi danh lớp dự bị." />}
      {page?.items.map((item, index) => (
        <div className="li" key={item.course?.id ?? index}>
          <div className="t">
            <b>{item.course?.name ?? "Khóa học"}</b>
            <span>
              {item.state === "studying" ? "Đang học" : "Ngừng học"} ·{" "}
              {item.interview ? "Đã phỏng vấn" : "Chưa phỏng vấn"}
            </span>
          </div>
          {item.course && (
            <Button
              disabled={locked || !onOpen}
              onClick={() => {
                if (item.course) onOpen?.(item.course.id);
              }}
            >
              Xem lớp
            </Button>
          )}
        </div>
      ))}
      {page?.nextCursor && (
        <PaginationControl loading={locked || loading} onMore={() => setCursor(page.nextCursor)} />
      )}
    </section>
  );
}
