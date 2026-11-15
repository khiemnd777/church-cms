import type { AssignedPerson } from "../api/programs/models";
import type { ProgramRow } from "../api/programs/validation";
import { Button, Card, Field, Select, TableFrame, TextArea, TextInput } from "./ui/components";
export function ProgramRows({ rows, people }: { rows: ProgramRow[]; people: AssignedPerson[] }) {
  return (
    <TableFrame label="Tiết mục chương trình">
      <table>
        <thead>
          <tr>
            <th>STT</th>
            <th>Tiết mục</th>
            <th>Người phụ trách</th>
            <th>Nội dung</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, n) => (
            <tr key={r.id}>
              <td className="num">{n + 1}</td>
              <td>{r.title}</td>
              <td>
                {r.assignment.mode === "member"
                  ? (people.find(
                      (p) => p.id === (r.assignment.mode === "member" ? r.assignment.memberId : ""),
                    )?.fullName ?? "Chưa xác định")
                  : r.assignment.mode === "not_applicable"
                    ? "Không áp dụng"
                    : "Chưa phân công"}
              </td>
              <td className="program-detail">{r.detail || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableFrame>
  );
}
export function ProgramEditor({
  rows,
  people,
  selected,
  invalid,
  locked,
  onChange,
}: {
  rows: ProgramRow[];
  people: AssignedPerson[];
  selected: AssignedPerson[];
  invalid: string[];
  locked: boolean;
  onChange: (rows: ProgramRow[]) => void;
}) {
  function change(n: number, next: ProgramRow) {
    onChange(rows.map((r, i) => (i === n ? next : r)));
  }
  function move(n: number, delta: number) {
    const next = [...rows],
      target = n + delta;
    if (target < 0 || target >= rows.length) return;
    [next[n], next[target]] = [next[target] as ProgramRow, next[n] as ProgramRow];
    onChange(next);
  }
  return (
    <div className="program-section">
      {rows.map((r, n) => (
        <Card key={r.id}>
          <div className="program-section">
            <h4>Tiết mục {n + 1}</h4>
            <div className="program-editor-grid">
              <Field label={`Tiết mục ${n + 1} · tên`}>
                <TextInput
                  maxLength={200}
                  required
                  value={r.title}
                  disabled={locked}
                  onChange={(e) => change(n, { ...r, title: e.target.value })}
                />
              </Field>
              <Field label={`Tiết mục ${n + 1} · người phụ trách`}>
                <Select
                  value={r.assignment.mode === "member" ? r.assignment.memberId : r.assignment.mode}
                  disabled={locked}
                  onChange={(e) =>
                    change(n, {
                      ...r,
                      assignment:
                        e.target.value === "unassigned"
                          ? { mode: "unassigned" }
                          : e.target.value === "not_applicable"
                            ? { mode: "not_applicable" }
                            : { mode: "member", memberId: e.target.value },
                    })
                  }
                >
                  <option value="unassigned">Chưa phân công</option>
                  <option value="not_applicable">Không áp dụng</option>
                  {r.assignment.mode === "member" &&
                    !people.some(
                      (p) => p.id === (r.assignment.mode === "member" ? r.assignment.memberId : ""),
                    ) && (
                      <option value={r.assignment.memberId}>
                        {selected.find(
                          (p) =>
                            p.id === (r.assignment.mode === "member" ? r.assignment.memberId : ""),
                        )?.fullName ?? "Phân công đang giữ"}
                        {invalid.includes(r.assignment.memberId)
                          ? " · Không còn trong ban"
                          : " · Đang giữ lựa chọn"}
                      </option>
                    )}
                  {people.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.fullName} · {p.code}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Field label={`Tiết mục ${n + 1} · nội dung`}>
              <TextArea
                maxLength={1000}
                value={r.detail}
                disabled={locked}
                onChange={(e) => change(n, { ...r, detail: e.target.value })}
              />
            </Field>
            <div className="program-actions">
              <Button
                disabled={locked || n === 0}
                aria-label={`Đưa tiết mục ${n + 1} lên`}
                onClick={() => move(n, -1)}
              >
                ↑
              </Button>
              <Button
                disabled={locked || n === rows.length - 1}
                aria-label={`Đưa tiết mục ${n + 1} xuống`}
                onClick={() => move(n, 1)}
              >
                ↓
              </Button>
              <Button
                disabled={locked || rows.length === 1}
                onClick={() => onChange(rows.filter((_, i) => i !== n))}
              >
                Bỏ tiết mục {n + 1}
              </Button>
            </div>
          </div>
        </Card>
      ))}
      <Button
        disabled={locked || rows.length >= 50}
        onClick={() =>
          onChange([
            ...rows,
            {
              id: crypto.randomUUID(),
              templateKey: null,
              title: "Tiết mục mới",
              detail: "",
              assignment: { mode: "unassigned" },
            },
          ])
        }
      >
        + Tiết mục
      </Button>
    </div>
  );
}
