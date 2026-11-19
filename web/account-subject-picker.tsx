import { useEffect, useState } from "react";
import type { AccountSubjects } from "../api/identity/account-subjects";
import { ownerRequest } from "./api";
import {
  Badge,
  Button,
  EmptyState,
  Feedback,
  Field,
  Loading,
  PaginationControl,
  Stack,
  TextInput,
} from "./ui/components";

type Page = Awaited<ReturnType<AccountSubjects["options"]>>;
export type SubjectOption = Page["items"][number];

export function AccountSubjectPicker({
  churchId,
  accountId,
  selected,
  onSelect,
  locked,
  detach,
  canAttach,
  onError,
}: {
  churchId: string;
  accountId: string;
  selected: SubjectOption | null;
  onSelect: (value: SubjectOption) => void;
  locked: boolean;
  detach: boolean;
  canAttach: boolean;
  onError: (error: unknown) => void;
}) {
  const [q, setQ] = useState(""),
    [cursor, setCursor] = useState<string | null>(null),
    [page, setPage] = useState<Page | null>(null),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    const timer = setTimeout(() => {
      const query = new URLSearchParams({ q, limit: "15", ...(cursor ? { cursor } : {}) });
      void ownerRequest<Page>(
        `owner/churches/${churchId}/accounts/${accountId}/subject-options?${query}`,
        { signal: controller.signal },
      )
        .then((r) => {
          if (!controller.signal.aborted)
            setPage((old) => ({
              ...r.data,
              items: cursor && old ? [...old.items, ...r.data.items] : r.data.items,
            }));
        })
        .catch((e) => {
          if (!controller.signal.aborted) onError(e);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 150);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [churchId, accountId, q, cursor]);
  return (
    <Stack space="content">
      {page?.current && (
        <Stack space="compact">
          <p>
            Hồ sơ đã liên kết:{" "}
            <strong>
              {page.current.fullName} · {page.current.code}
            </strong>
          </p>
          <Badge tone={page.current.eligible ? "good" : "warn"}>
            {page.current.eligible ? "Đang có hiệu lực" : "Cần xác nhận lại"}
          </Badge>
        </Stack>
      )}
      {!detach && canAttach && (
        <>
          <Field label="Tìm tín hữu cùng Hội Thánh">
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
          {selected && (
            <Feedback>
              Đã chọn: {selected.fullName} · {selected.code} · Ngày sinh:{" "}
              {selected.birthDate ?? "Chưa có"}
            </Feedback>
          )}
          {page && !page.items.length && <EmptyState message="Không tìm thấy tín hữu phù hợp." />}
          {page && page.items.length > 0 && (
            <Stack space="compact">
              {page.items.map((item) => (
                <Button
                  key={item.id}
                  disabled={locked}
                  aria-pressed={selected?.id === item.id}
                  onClick={() => onSelect(item)}
                >
                  {item.fullName} · {item.code} · {item.birthDate ?? "Chưa có ngày sinh"}
                </Button>
              ))}
            </Stack>
          )}
          {page?.nextCursor && (
            <PaginationControl
              loading={locked || loading}
              onMore={() => setCursor(page.nextCursor)}
            />
          )}
        </>
      )}
      {loading && <Loading>Đang tìm hồ sơ…</Loading>}
    </Stack>
  );
}
