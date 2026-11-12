import { useEffect, useRef, useState } from "react";
import {
  emptyFamily,
  type FamilyCommand,
  type FamilyDto,
  type FamilyInput,
  type FamilyPeople,
  type RoleChange,
} from "./families-api";
import { FamilyFields } from "./family-form";
import { FamilyPicker } from "./member-form";
import { householdLabels, participationLabels } from "./members-api";
import type { UnitDto } from "./organization-api";
import { type TenantRealm, tenantRequest } from "./tenant-mutation";
import {
  Button,
  Choice,
  DialogActions,
  Feedback,
  Field,
  Loading,
  Select,
  TableFrame,
  TextArea,
  TextInput,
} from "./ui/components";

type Person = {
  id: string;
  fullName: string;
  version: number;
  householdRole: RoleChange["role"];
  participation: string;
};
export type FamilyAction = "roles" | "transfer" | "split" | "merge";
export const familyActionLabels = {
  roles: "Đổi chủ hộ / vai trò",
  transfer: "Chuyển người",
  split: "Tách hộ",
  merge: "Gộp hộ",
};
export function FamilyCommandForm({
  source,
  kind,
  realm,
  base,
  units,
  unitLabel,
  today,
  locked,
  error,
  onPreview,
  onClose,
  onReload,
  onError,
}: {
  source: FamilyDto;
  kind: FamilyAction;
  realm: TenantRealm;
  base: string;
  units: UnitDto[];
  unitLabel: string;
  today: string;
  locked: boolean;
  error: string;
  onPreview: (command: FamilyCommand) => void;
  onClose: () => void;
  onReload: () => void;
  onError: (e: unknown) => void;
}) {
  const [people, setPeople] = useState<Person[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [loading, setLoading] = useState(false),
    [chosen, setChosen] = useState<string[]>([]),
    [roles, setRoles] = useState<Record<string, RoleChange["role"]>>({}),
    [target, setTarget] = useState<FamilyDto | null>(null),
    [picker, setPicker] = useState<Parameters<typeof FamilyPicker>[0]["value"]>(null),
    [targetRole, setTargetRole] = useState<RoleChange["role"]>("head"),
    [meta, setMeta] = useState<FamilyInput>(emptyFamily),
    [reason, setReason] = useState(""),
    [day, setDay] = useState(today);
  const guard = useRef(false),
    generation = useRef(0);
  async function load(next?: string) {
    if (guard.current) return;
    guard.current = true;
    setLoading(true);
    try {
      const r = await tenantRequest<FamilyPeople>(
        realm,
        `${base}/families/${source.id}/members?${new URLSearchParams({ limit: "100", ...(next ? { cursor: next } : {}) })}`,
      );
      setPeople((old) => {
        const rows = next
          ? [...old, ...r.data.items.filter((m) => !old.some((o) => o.id === m.id))]
          : r.data.items;
        const head = source.head;
        if (head && !rows.some((m) => m.id === head.id))
          return [...rows, { ...head, householdRole: "head" as const }];
        return rows;
      });
      setCursor(r.data.nextCursor);
    } catch (e) {
      onError(e);
    } finally {
      guard.current = false;
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
    return () => {
      generation.current++;
    };
  }, [source.id, source.version]);
  async function choose(f: typeof picker) {
    setPicker(f);
    setTarget(null);
    setTargetRole("head");
    const request = ++generation.current;
    if (!f) return;
    setLoading(true);
    try {
      const r = await tenantRequest<FamilyDto>(realm, `${base}/families/${f.id}`);
      if (request === generation.current) setTarget(r.data);
    } catch (e) {
      onError(e);
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }
  const toChange = (m: Person): RoleChange => ({
    id: m.id,
    version: m.version,
    role: roles[m.id] ?? m.householdRole,
  });
  function preview() {
    const moving = kind === "merge" ? people : people.filter((m) => chosen.includes(m.id)),
      moves = moving.map(toChange),
      roleChanges = people
        .filter(
          (m) =>
            !moving.some((x) => x.id === m.id) && roles[m.id] && roles[m.id] !== m.householdRole,
        )
        .map(toChange);
    if (target?.head && targetRole !== "head")
      roleChanges.push({ id: target.head.id, version: target.head.version, role: targetRole });
    const context = { reason, effectiveOn: day };
    if (kind === "roles")
      onPreview({
        kind,
        ...context,
        roleChanges: people
          .filter((m) => roles[m.id] && roles[m.id] !== m.householdRole)
          .map(toChange),
      });
    else if (kind === "split")
      onPreview({
        kind,
        ...context,
        newFamily: Object.fromEntries(
          Object.entries(meta).map(([k, v]) => [k, typeof v === "string" ? v.trim() || null : v]),
        ) as FamilyInput,
        moves,
        roleChanges,
      });
    else if (target)
      onPreview({
        kind,
        ...context,
        targetFamilyId: target.id,
        targetVersion: target.version,
        moves,
        roleChanges,
      });
  }
  const tooLarge = kind === "merge" && source.count > 100;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        preview();
      }}
    >
      <p>
        Hộ nguồn: <strong>{source.code}</strong> · {source.name ?? "Chưa đặt tên"} · {source.count}{" "}
        hồ sơ
      </p>
      {tooLarge && (
        <Feedback tone="error">
          Hộ có hơn100 hồ sơ. Không gộp một phần; đối soát trước khi tiếp tục.
        </Feedback>
      )}
      {kind === "split" ? (
        <FamilyFields
          value={meta}
          onChange={setMeta}
          units={units}
          unitLabel={unitLabel}
          today={today}
          locked={locked}
        />
      ) : (
        kind !== "roles" && (
          <FamilyPicker
            realm={realm}
            base={base}
            locked={locked}
            value={picker}
            onChange={(f) => void choose(f)}
          />
        )
      )}
      {target && (
        <p>
          Hộ đích: {target.code} · {target.areaName ?? "Chưa phân khu vực"} · {target.count} hồ sơ
        </p>
      )}
      {target?.head && (
        <Field label={`Vai trò mới của ${target.head.fullName} (chủ hộ đích)`}>
          <Select
            disabled={locked}
            value={targetRole}
            onChange={(e) => setTargetRole(e.target.value as RoleChange["role"])}
          >
            {Object.entries(householdLabels).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
      )}
      {!tooLarge && people.length > 0 && (
        <TableFrame label="Chọn thành viên và vai trò">
          <table className="family-command-table">
            <thead>
              <tr>
                {kind !== "roles" && <th>Chuyển</th>}
                <th>Thành viên</th>
                <th>Vai trò sau thao tác</th>
              </tr>
            </thead>
            <tbody>
              {people.map((m) => (
                <tr key={m.id}>
                  {kind !== "roles" && (
                    <td>
                      {kind === "merge" ? (
                        "Tất cả"
                      ) : (
                        <Choice
                          label={`Chuyển ${m.fullName}`}
                          checked={chosen.includes(m.id)}
                          disabled={locked || (chosen.length >= 100 && !chosen.includes(m.id))}
                          onChange={(e) =>
                            setChosen((old) =>
                              e.target.checked ? [...old, m.id] : old.filter((id) => id !== m.id),
                            )
                          }
                        />
                      )}
                    </td>
                  )}
                  <td>
                    {m.fullName}
                    <div className="small muted">
                      {participationLabels[m.participation as keyof typeof participationLabels]}
                    </div>
                  </td>
                  <td>
                    <Select
                      aria-label={`Vai trò của ${m.fullName}`}
                      value={roles[m.id] ?? m.householdRole}
                      disabled={locked}
                      onChange={(e) =>
                        setRoles((old) => ({
                          ...old,
                          [m.id]: e.target.value as RoleChange["role"],
                        }))
                      }
                    >
                      {Object.entries(householdLabels).map(([id, label]) => (
                        <option key={id} value={id}>
                          {label}
                        </option>
                      ))}
                    </Select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableFrame>
      )}
      {loading && <Loading />}
      {cursor && kind !== "merge" && (
        <Button disabled={locked || loading} onClick={() => void load(cursor)}>
          Tải thêm thành viên
        </Button>
      )}
      <Field label="Ngày hiệu lực">
        <TextInput
          required
          type="date"
          max={today}
          value={day}
          disabled={locked}
          onChange={(e) => setDay(e.target.value)}
        />
      </Field>
      <Field label="Lý do">
        <TextArea
          required
          maxLength={500}
          value={reason}
          disabled={locked}
          onChange={(e) => setReason(e.target.value)}
        />
      </Field>
      {error && <Feedback tone="error">{error}</Feedback>}
      <DialogActions>
        <Button disabled={locked} onClick={onClose}>
          Hủy
        </Button>
        {error && (
          <Button disabled={locked} onClick={onReload}>
            Tải bản mới
          </Button>
        )}
        <Button
          variant="primary"
          type="submit"
          disabled={
            locked ||
            loading ||
            tooLarge ||
            ((kind === "transfer" || kind === "merge") && !target) ||
            ((kind === "transfer" || kind === "split") && !chosen.length)
          }
        >
          Xem trước
        </Button>
      </DialogActions>
    </form>
  );
}
