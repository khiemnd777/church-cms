import { useEffect, useState } from "react";
import { organizationPath, organizationRequest, type UnitDto } from "./organization-api";
import { Button, Choice, Feedback, Field, TextInput } from "./ui/components";
export function ScopePicker({
  churchId,
  ids,
  onChange,
  locked,
}: {
  churchId: string;
  ids: string[];
  onChange: (ids: string[]) => void;
  locked: boolean;
}) {
  const [items, setItems] = useState<UnitDto[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [q, setQ] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function load(next?: string) {
    setBusy(true);
    setError("");
    try {
      const r = await organizationRequest<{ items: UnitDto[]; nextCursor: string | null }>(
        "owner",
        `${organizationPath("owner", churchId)}/units?${new URLSearchParams({ status: "active", q, limit: "50", ...(next ? { cursor: next } : {}) })}`,
      );
      setItems((old) => (next ? [...old, ...r.data.items] : r.data.items));
      setCursor(r.data.nextCursor);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không tải được đơn vị.");
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void load();
  }, [churchId]);
  return (
    <div className="member-form-group">
      <Field
        label="Tìm đơn vị được giao"
        hint={`Đã chọn ${ids.length}/50. Đơn vị ngừng dùng không còn cấp quyền đọc.`}
      >
        <TextInput
          value={q}
          maxLength={100}
          disabled={locked || busy}
          onChange={(e) => setQ(e.target.value)}
        />
      </Field>
      <Button disabled={locked || busy} onClick={() => void load()}>
        Tìm đơn vị
      </Button>
      <div className="opts">
        {items
          .filter((u) => u.kind !== "board")
          .map((u) => (
            <Choice
              key={u.id}
              label={u.name}
              checked={ids.includes(u.id)}
              disabled={locked || (!ids.includes(u.id) && ids.length >= 50)}
              onChange={(e) =>
                onChange(e.target.checked ? [...ids, u.id] : ids.filter((id) => id !== u.id))
              }
            />
          ))}
      </div>
      {ids
        .filter((id) => !items.some((u) => u.id === id))
        .map((id) => (
          <Choice
            key={id}
            label={`Đơn vị đã chọn ${id} · chưa có trong trang này`}
            checked
            disabled={locked}
            onChange={() => onChange(ids.filter((i) => i !== id))}
          />
        ))}
      {cursor && (
        <Button disabled={locked || busy} onClick={() => void load(cursor)}>
          Xem thêm đơn vị
        </Button>
      )}
      {error && <Feedback tone="error">{error}</Feedback>}
    </div>
  );
}
