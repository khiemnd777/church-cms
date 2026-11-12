import { useEffect, useState } from "react";
import type { OverviewDto, OverviewTarget } from "../api/overview/contracts";
import type { ChurchRef } from "./access-context";
import { ApiError } from "./api";
import { dayLabel } from "./members-api";
import { authErrorCodes, type TenantRealm, tenantRequest } from "./tenant-mutation";
import { Badge, Button, Card, Feedback, IconButton, Loading, SectionHeader } from "./ui/components";
import {
  OverviewBar,
  OverviewHero,
  OverviewShortcut,
  OverviewStages,
} from "./ui/components/overview";
import "./overview.css";
interface Props {
  realm: TenantRealm;
  churchId: string;
  pending: boolean;
  onAuthError: (e: unknown) => void;
  onTitle: (title: string, context?: string) => void;
  onChurch?: (c: ChurchRef) => void;
  onBack?: () => void;
  onNavigate: (target: OverviewTarget) => void;
}
export function OverviewView({
  realm,
  churchId,
  pending,
  onAuthError,
  onTitle,
  onChurch,
  onBack,
  onNavigate,
}: Props) {
  const [value, setValue] = useState<OverviewDto | null>(null),
    [error, setError] = useState(""),
    [reload, setReload] = useState(0),
    [loading, setLoading] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    setValue(null);
    setError("");
    setLoading(true);
    tenantRequest<OverviewDto>(
      realm,
      `${realm === "owner" ? "owner/" : ""}churches/${churchId}/overview`,
      { signal: abort.signal },
    )
      .then((r) => {
        if (abort.signal.aborted) return;
        setValue(r.data);
        onTitle("Tổng quan", `${r.data.church.name} · ${r.data.church.code}`);
        onChurch?.(r.data.church);
      })
      .catch((e) => {
        if (abort.signal.aborted) return;
        if (
          e instanceof ApiError &&
          [...authErrorCodes, "FORBIDDEN", "CHURCH_SUSPENDED"].includes(e.code)
        )
          onAuthError(e);
        setError(e instanceof Error ? e.message : "Không tải được Tổng quan.");
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [realm, churchId, reload]);
  const members = (filters: Record<string, string> = {}) =>
      onNavigate({ kind: "members", filters: { participation: "current", ...filters } }),
    link = (label: string, fn: () => void) => (
      <Button variant="link" disabled={pending} onClick={fn}>
        {label} →
      </Button>
    );
  return (
    <div className="overview-section">
      <div className="overview-actions">
        {onBack && (
          <Button variant="link" disabled={pending} onClick={onBack}>
            ← Chi tiết Hội Thánh
          </Button>
        )}
        <Button disabled={pending || loading} onClick={() => setReload((x) => x + 1)}>
          Làm mới
        </Button>
      </div>
      {error && <Feedback tone="error">{error}</Feedback>}
      {loading && <Loading />}
      {value && (
        <>
          <OverviewHero
            name={value.church.name}
            code={value.church.code}
            address={[value.church.address, value.church.district, value.church.province]
              .filter(Boolean)
              .join(" · ")}
            day={value.day}
            secretary={value.organization.secretary}
            term={value.organization.boardTerm}
          />
          {!value.organization.configured && (
            <Feedback tone="warning">
              Hội Thánh chưa hoàn tất cấu hình. Các số liệu hồ sơ hiện có vẫn được hiển thị.
            </Feedback>
          )}
          <p className="muted small">
            Số liệu lúc {new Date(value.asOf).toLocaleString("vi-VN", { timeZone: value.timezone })}{" "}
            · Đang sinh hoạt / vắng lâu
          </p>
          <section className="grid g4">
            <Card className="kpi">
              <div className="lbl">THUỘC VIÊN</div>
              <div className="big num">{value.members.total.toLocaleString("vi-VN")}</div>
              <div className="small muted">
                Tín hữu <b>{value.members.believer}</b> · Thân hữu <b>{value.members.visitor}</b>
              </div>
              <div className="foot num">
                <span>
                  Đã báp-têm <b>{value.members.baptism.baptized}</b>
                </span>
                <span>
                  Chưa <b>{value.members.baptism.not_baptized}</b> · Chưa rõ{" "}
                  <b>{value.members.baptism.unknown}</b>
                </span>
                <span>
                  Thành viên <b>{value.members.membership.member}</b> · Dự bị{" "}
                  <b>{value.members.membership.preparatory}</b> · Thiếu nhi{" "}
                  <b>{value.members.membership.child}</b>
                </span>
                <span>
                  Nam <b>{value.members.gender.male}</b> · Nữ <b>{value.members.gender.female}</b> ·
                  Chưa rõ <b>{value.members.gender.unknown}</b>
                </span>
                {link("Xem danh sách", () => members())}
              </div>
            </Card>
            <Card className="kpi">
              <div className="lbl">GIA ĐÌNH TÍN HỮU</div>
              <div className="big num">{value.families.believerFamilies}</div>
              <div className="small muted">Có tín hữu đang sinh hoạt / vắng lâu</div>
              <div className="foot num">
                <span>
                  Bình quân <b>{value.families.believersPerFamily ?? "—"}</b> tín hữu/gia đình
                </span>
                <span>
                  {value.organization.activeAreas} {value.organization.areaLabel.toLowerCase()} đang
                  dùng
                </span>
                {link("Xem gia đình", () => onNavigate({ kind: "families" }))}
              </div>
            </Card>
            <Card className="kpi">
              <div className="lbl">THỜ PHƯỢNG CHÚA NHẬT</div>
              <div className="big num">—</div>
              <div className="small muted">Chưa khả dụng</div>
              <div className="foot">
                <span>Điểm danh chưa triển khai</span>
              </div>
            </Card>
            <Card className="kpi">
              <div className="lbl">LỄ NGHI NĂM {value.day.slice(0, 4)}</div>
              <div className="big num">—</div>
              <div className="small muted">Chưa khả dụng</div>
              <div className="foot">
                <span>Sổ lễ nghi chưa triển khai</span>
              </div>
            </Card>
          </section>
          <section className="grid g2">
            <Card>
              <SectionHeader title="Thân hữu">
                <IconButton
                  icon="arrow"
                  label="Xem danh sách thân hữu"
                  disabled={pending}
                  onClick={() => members({ type: "visitor" })}
                />
              </SectionHeader>
              <div className="overview-section">
                <div className="mini">
                  <div>
                    <b className="num">{value.visitors.total}</b>
                    <span>Đang theo dõi</span>
                  </div>
                  <div>
                    <b className="num">{value.visitors.new30}</b>
                    <span>Mới đến 30 ngày</span>
                  </div>
                  <div>
                    <b className="num">—</b>
                    <span>Dự thờ phượng: Chưa khả dụng</span>
                  </div>
                  <div>
                    <b className="num">{value.visitors.convertedYear}</b>
                    <span>Chuyển thành tín hữu năm {value.day.slice(0, 4)}</span>
                  </div>
                </div>
                <OverviewStages
                  items={[
                    { label: "Mới đến", count: value.visitors.stages.new },
                    { label: "Đang tìm hiểu", count: value.visitors.stages.exploring },
                    { label: "Đã tin Chúa", count: value.visitors.stages.believed },
                  ]}
                />
                <div className="list">
                  {value.visitors.latest.map((p) => (
                    <div className="li" key={p.id}>
                      <div className="t">
                        <b>
                          <Button
                            variant="link"
                            disabled={pending}
                            onClick={() => onNavigate({ kind: "members", memberId: p.id })}
                          >
                            {p.fullName}
                          </Button>
                        </b>
                        <span>Đến lần đầu {dayLabel(p.firstVisit ?? null)}</span>
                      </div>
                      <Badge tone="friend">
                        {p.stage === "new"
                          ? "Mới đến"
                          : p.stage === "exploring"
                            ? "Đang tìm hiểu"
                            : "Đã tin Chúa"}
                      </Badge>
                    </div>
                  ))}
                </div>
                {!value.visitors.latest.length && (
                  <p>Chưa có thân hữu có ngày đến lần đầu được xác định.</p>
                )}
                {link("Mới đến trong 30 ngày", () =>
                  members({ type: "visitor", firstVisit: "last30" }),
                )}
              </div>
            </Card>
            <Card>
              <SectionHeader title="Sinh nhật tuần này">
                <IconButton
                  icon="arrow"
                  label="Xem tất cả sinh nhật tuần này"
                  disabled={pending}
                  onClick={() => members({ birthday: "week" })}
                />
              </SectionHeader>
              <div className="overview-section">
                <p>
                  {dayLabel(value.birthdays.from)}–{dayLabel(value.birthdays.to)} ·{" "}
                  {value.birthdays.total} người
                </p>
                <div className="list">
                  {value.birthdays.items.map((p) => (
                    <div className="li" key={p.id}>
                      <div className="t">
                        <b>
                          <Button
                            variant="link"
                            disabled={pending}
                            onClick={() => onNavigate({ kind: "members", memberId: p.id })}
                          >
                            {p.fullName}
                          </Button>
                        </b>
                        <span>
                          {dayLabel(p.birthday ?? null)} · tròn {p.turnAge} tuổi
                        </span>
                      </div>
                      {p.birthday === value.day && <Badge tone="good">Hôm nay</Badge>}
                    </div>
                  ))}
                </div>
                {!value.birthdays.total && <p>Không có sinh nhật trong tuần này.</p>}
                {value.birthdays.total > 6 && (
                  <p className="muted small">và {value.birthdays.total - 6} người khác</p>
                )}
                <div className="links-row">
                  {link(
                    `Tháng ${value.birthdays.month.period}: ${value.birthdays.month.count} người`,
                    () => members({ birthday: `month:${value.birthdays.month.period}` }),
                  )}
                  {link(
                    `Tháng ${value.birthdays.nextMonth.period}: ${value.birthdays.nextMonth.count} người`,
                    () => members({ birthday: `month:${value.birthdays.nextMonth.period}` }),
                  )}
                </div>
              </div>
            </Card>
          </section>
          <Card>
            <SectionHeader title="Thao tác nhanh" />
            <div className="qa">
              <OverviewShortcut
                icon="search"
                label="Tra cứu thuộc viên"
                disabled={pending}
                onClick={() => members()}
              />
              <OverviewShortcut
                icon="plus"
                label="Thêm thuộc viên"
                disabled={pending || !value.organization.configured}
                onClick={() => onNavigate({ kind: "members", create: true })}
              />
              <OverviewShortcut icon="qr" label="Điểm danh QR" disabled />
              <OverviewShortcut icon="drop" label="Sổ Báp-têm" disabled />
              <OverviewShortcut icon="stamp" label="Đề xuất chi" disabled />
              <OverviewShortcut icon="print" label="In giấy chứng nhận" disabled />
              <OverviewShortcut icon="heart" label="Thăm viếng" disabled />
              <OverviewShortcut icon="chart" label="Báo cáo Tổng Liên Hội" disabled />
            </div>
          </Card>
          <section className="grid g-73">
            <Card>
              <SectionHeader title="Hiện diện thờ phượng 12 Chúa nhật gần nhất" />
              <p>— · Chưa khả dụng</p>
            </Card>
            <Card>
              <SectionHeader title="Cần quan tâm tuần này" />
              <div className="overview-section">
                <p>
                  Thân hữu mới đến trong 30 ngày: <b>{value.visitors.new30}</b>
                </p>
                {link("Xem thân hữu mới", () => members({ type: "visitor", firstVisit: "last30" }))}
                <p>Vắng 3 Chúa nhật liên tiếp · Lớp dự bị · Đề xuất chi · Cầu thay</p>
                <p className="muted">— · Chưa khả dụng</p>
              </div>
            </Card>
          </section>
          <section className="grid g2">
            <Card>
              <SectionHeader
                title={`Thuộc viên theo ${value.organization.areaLabel.toLowerCase()}`}
              >
                <IconButton
                  icon="arrow"
                  label="Xem Ban ngành & Khu vực"
                  disabled={pending}
                  onClick={() => onNavigate({ kind: "bans" })}
                />
              </SectionHeader>
              <div className="overview-section">
                {value.areas.map((a) => {
                  const label = value.organization.areaLabels.find((l) => l.id === a.id);
                  return (
                    <OverviewBar
                      key={a.id}
                      label={`${label?.name ?? "Khu vực không khả dụng"}${label?.status === "inactive" ? " · Đã ngừng dùng" : ""}`}
                      value={a.people}
                      maximum={value.areas[0]?.people ?? 0}
                    >
                      <b>{a.people}</b> người · {a.families} GĐ
                    </OverviewBar>
                  );
                })}
                {!value.areas.length && <p>Chưa có thuộc viên trong khu vực.</p>}
                {value.areaGroupCount > 6 && (
                  <p className="muted small">
                    Hiển thị 6/{value.areaGroupCount} khu vực có thuộc viên.
                  </p>
                )}
                <p>
                  Chưa phân khu vực: {value.unassigned.people} người · {value.unassigned.families}{" "}
                  GĐ
                </p>
              </div>
            </Card>
            <Card>
              <SectionHeader title="Lễ nghi gần đây" />
              <p>— · Chưa khả dụng</p>
            </Card>
          </section>
        </>
      )}
    </div>
  );
}
