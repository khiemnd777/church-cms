import { useEffect, useState } from "react";
import { dateLabel, type RitePage, riteNames, riteStates } from "./rites-api";
import { type TenantRealm, tenantRequest } from "./tenant-mutation";
import { Button, EmptyState, Feedback, Loading, PaginationControl } from "./ui/components";
export function MemberRites({
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
  onOpen?: (kind: keyof typeof riteNames, id: string) => void;
  onFail: (e: unknown) => void;
}) {
  const [page, setPage] = useState<RitePage | null>(null),
    [cursor, setCursor] = useState<string | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    setError("");
    void tenantRequest<RitePage>(
      realm,
      `${realm === "owner" ? "owner/" : ""}churches/${churchId}/members/${memberId}/rites${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
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
        if (!abort.signal.aborted) {
          setPage(null);
          setError(e.message);
          onFail(e);
        }
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [realm, churchId, memberId, cursor]);
  return (
    <section aria-label="Sổ lễ nghi của thuộc viên">
      <h4>Sổ lễ nghi</h4>
      {loading && <Loading />}
      {error && <Feedback tone="error">{error}</Feedback>}
      {page && !page.items.length && <EmptyState message="Chưa có bản ghi lễ liên kết." />}
      {page?.items.map((r) => (
        <div className="li" key={r.id}>
          <div className="t">
            <b>{riteNames[r.kind]}</b>
            <span>
              {dateLabel(r.record.date)} · {riteStates[r.state]}
            </span>
          </div>
          <Button disabled={locked || !onOpen} onClick={() => onOpen?.(r.kind, r.id)}>
            Mở sổ
          </Button>
        </div>
      ))}
      {page?.nextCursor && (
        <PaginationControl loading={locked || loading} onMore={() => setCursor(page.nextCursor)} />
      )}
    </section>
  );
}
