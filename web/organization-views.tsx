import type { ReactNode } from "react";
import { positionLabels, type RuntimeUnit, type Term } from "./organization-runtime-api";
import { Card, EmptyState, IconButton, SectionHeader, TableFrame } from "./ui/components";

export type OrganizationDisplay = "card" | "table";
export function BoardAppointments({ term, display }: { term: Term; display: OrganizationDisplay }) {
  const needsReview = (id: string) => !term.people.find((p) => p.id === id)?.eligible;
  if (!term.appointments.length) return <EmptyState message="Chưa có nhân sự trong nhiệm kỳ" />;
  if (display === "table")
    return (
      <TableFrame label="Nhân sự Ban Chấp sự">
        <table className="organization-runtime-table">
          <thead>
            <tr>
              <th scope="col">Chức vụ</th>
              <th scope="col">Họ tên</th>
              <th scope="col">Tình trạng</th>
            </tr>
          </thead>
          <tbody>
            {term.appointments.map((a) => (
              <tr key={a.memberId}>
                <td>{positionLabels[a.position]}</td>
                <td>{a.fullName}</td>
                <td>{needsReview(a.memberId) ? "Cần rà soát" : "Đang sinh hoạt"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableFrame>
    );
  return (
    <div className="organization-runtime-cards">
      {term.appointments.map((a) => (
        <Card key={a.memberId}>
          <SectionHeader title={positionLabels[a.position]} />
          <div className="organization-runtime-group">
            <p>{a.fullName}</p>
            {needsReview(a.memberId) && <p>Cần rà soát</p>}
          </div>
        </Card>
      ))}
    </div>
  );
}

export function OrganizationUnitsView({
  units,
  display,
  area,
  scoped,
  locked,
  label,
  onView,
  actions,
}: {
  units: RuntimeUnit[];
  display: OrganizationDisplay;
  area: boolean;
  scoped: boolean;
  locked: boolean;
  label: string;
  onView: (unit: RuntimeUnit) => void;
  actions: (unit: RuntimeUnit) => ReactNode;
}) {
  const leader = (u: RuntimeUnit) =>
    `${u.leader?.fullName ?? "Chưa giao"}${u.leader && !u.leader.eligible ? " · Cần rà soát" : ""}`;
  const viewButton = (u: RuntimeUnit) => (
    <IconButton label={`Xem ${u.name}`} icon="arrow" onClick={() => onView(u)} disabled={locked} />
  );
  if (display === "table")
    return (
      <Card>
        <TableFrame label={`Danh sách ${label}`}>
          <table className="organization-runtime-table organization-units-table">
            <thead>
              <tr>
                <th scope="col">Tên</th>
                {!scoped && <th scope="col">Người phụ trách</th>}
                <th scope="col">Lịch</th>
                {area && !scoped && <th scope="col">Gia đình</th>}
                <th scope="col">Người</th>
                <th scope="col">Hiện diện</th>
                <th scope="col">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {units.map((u) => (
                <tr key={u.id}>
                  <td>{u.name}</td>
                  {!scoped && <td>{leader(u)}</td>}
                  <td>{u.scheduleText ?? "Chưa có"}</td>
                  {area && !scoped && <td>{u.householdCount ?? "—"}</td>}
                  <td>{u.memberCount.value ?? "—"}</td>
                  <td>Chưa có dữ liệu</td>
                  <td>
                    <div className="organization-runtime-actions">
                      {viewButton(u)}
                      {actions(u)}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableFrame>
      </Card>
    );
  return (
    <div className="organization-runtime-cards">
      {units.map((u) => (
        <Card key={u.id}>
          <SectionHeader title={u.name}>{viewButton(u)}</SectionHeader>
          <div className="organization-runtime-group">
            {!scoped && <p>Trưởng đơn vị: {leader(u)}</p>}
            <p>Lịch: {u.scheduleText ?? "Chưa có"}</p>
            {area && !scoped && <p>{u.householdCount ?? "—"} gia đình</p>}
            <p>{u.memberCount.value ?? "—"} người · Hiện diện: Chưa có dữ liệu</p>
            <div className="organization-runtime-actions">{actions(u)}</div>
          </div>
        </Card>
      ))}
    </div>
  );
}
