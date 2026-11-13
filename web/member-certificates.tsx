import { useEffect, useState } from "react";
import type { CertificateList } from "./certificates-api";
import { certificateNames, certificateStates } from "./certificates-api";
import { type TenantRealm, tenantRequest } from "./tenant-mutation";
import { Button, EmptyState, Feedback, Loading, PaginationControl } from "./ui/components";
export function MemberCertificates({
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
  const [data, setData] = useState<CertificateList | null>(null),
    [cursor, setCursor] = useState<string | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  useEffect(() => {
    const a = new AbortController();
    setLoading(true);
    void tenantRequest<CertificateList>(
      realm,
      `${realm === "owner" ? "owner/" : ""}churches/${churchId}/members/${memberId}/certificates${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
      { signal: a.signal },
    )
      .then((r) => {
        if (!a.signal.aborted)
          setData((old) => ({
            ...r.data,
            items: cursor ? [...(old?.items ?? []), ...r.data.items] : r.data.items,
          }));
      })
      .catch((e) => {
        if (!a.signal.aborted) {
          setError(e.message);
          onFail(e);
        }
      })
      .finally(() => {
        if (!a.signal.aborted) setLoading(false);
      });
    return () => a.abort();
  }, [realm, churchId, memberId, cursor]);
  return (
    <section aria-label="Chứng nhận của thuộc viên">
      <h4>Chứng nhận</h4>
      {loading && <Loading />}
      {error && <Feedback tone="error">{error}</Feedback>}
      {data && !data.items.length && <EmptyState message="Chưa có bản chứng nhận liên kết." />}
      {data?.items.map((e) => (
        <div className="li" key={e.id}>
          <div className="t">
            <b>{certificateNames[e.kind]}</b>
            <span>
              v{e.revision} · {certificateStates[e.state]}
            </span>
          </div>
          <Button disabled={locked || !onOpen} onClick={() => onOpen?.(e.id)}>
            Mở chứng nhận
          </Button>
        </div>
      ))}
      {data?.nextCursor && (
        <PaginationControl loading={loading || locked} onMore={() => setCursor(data.nextCursor)} />
      )}
    </section>
  );
}
