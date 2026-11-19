import { useEffect, useState } from "react";
import type { MemberPortal } from "../api/portal/service";
import { ApiError, churchRequest } from "./api";
import { vnd, vnToday } from "./finance-income-api";
import { type PersonalPrayerAccess, PersonalPrayers } from "./personal-prayers";
import {
  Button,
  Card,
  EmptyState,
  Feedback,
  Field,
  KeyValueList,
  Loading,
  PaginationControl,
  SectionHeader,
  Stack,
  TextInput,
} from "./ui/components";

type Profile = Awaited<ReturnType<MemberPortal["profile"]>>;
type Giving = Awaited<ReturnType<MemberPortal["contributions"]>>;
type Rituals = Awaited<ReturnType<MemberPortal["rituals"]>>;
const membership = {
  member: "Tín hữu chính thức",
  preparatory: "Tín hữu dự bị",
  child: "Thiếu nhi",
};
const gender = { male: "Nam", female: "Nữ", unknown: "Chưa rõ" };
const baptism = { baptized: "Đã Báp-têm", not_baptized: "Chưa Báp-têm", unknown: "Chưa rõ" };
const riteNames: Record<Rituals["items"][number]["kind"], string> = {
  baptism: "Báp-têm",
  dedication: "Dâng con",
  marriage: "Thành hôn",
  funeral: "An táng",
  communion: "Tiệc Thánh",
};

const portalTitles = {
  profile: "Hồ sơ của tôi",
  rites: "Lễ nghi của tôi",
  giving: "Dâng hiến của tôi",
  prayers: "Cầu thay của tôi",
};
const validPeriod = (value: string) => /^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(value);

const printDay = (value: string | null) =>
  value ? value.split("-").reverse().join("/") : "Chưa có";

export function PortalView({
  churchId,
  kind,
  onAuthError,
  onSupport,
  prayerAccess,
}: {
  churchId: string;
  kind: keyof typeof portalTitles;
  onAuthError: (e: unknown) => void;
  onSupport: () => void;
  prayerAccess?: PersonalPrayerAccess;
}) {
  const [profile, setProfile] = useState<Profile | null>(null),
    [rites, setRites] = useState<Rituals | null>(null),
    [giving, setGiving] = useState<Giving | null>(null),
    [period, setPeriod] = useState(() => vnToday().slice(0, 7)),
    [cursor, setCursor] = useState<string | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [reload, setReload] = useState(0);
  useEffect(() => {
    if (kind === "giving" && !validPeriod(period)) {
      setLoading(false);
      return;
    }
    const a = new AbortController(),
      options = { signal: a.signal };
    const base = `churches/${churchId}/portal`;
    setLoading(true);
    setError("");
    void (async () => {
      const p = await churchRequest<Profile>(`${base}/profile`, options);
      if (a.signal.aborted) return;
      setProfile(p.data);
      if (p.data.state !== "linked") {
        setRites(null);
        setGiving(null);
        if (kind === "prayers") prayerAccess?.onPending(null);
        return;
      }
      if (kind === "rites") {
        const part = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
        const page = await churchRequest<Rituals>(`${base}/rites${part}`, options);
        if (a.signal.aborted) return;
        setRites((old) => ({
          ...page.data,
          items: cursor && old ? [...old.items, ...page.data.items] : page.data.items,
        }));
      } else if (kind === "giving") {
        const params = new URLSearchParams({ period });
        if (cursor) params.set("cursor", cursor);
        const page = await churchRequest<Giving>(`${base}/giving?${params}`, options);
        if (a.signal.aborted) return;
        setGiving((old) => ({
          ...page.data,
          items: cursor && old ? [...old.items, ...page.data.items] : page.data.items,
        }));
      }
    })()
      .catch((e) => {
        if (a.signal.aborted) return;
        setProfile(null);
        setRites(null);
        setGiving(null);
        if (e instanceof ApiError && e.code === "PORTAL_LINK_REQUIRED") {
          setProfile({ state: "unavailable", profile: null });
          return;
        }
        if (
          e instanceof ApiError &&
          [
            "REAUTH_REQUIRED",
            "SESSION_EXPIRED",
            "SESSION_REVOKED",
            "FORBIDDEN",
            "PASSWORD_CHANGE_REQUIRED",
            "CHURCH_SUSPENDED",
          ].includes(e.code)
        )
          onAuthError(e);
        else setError(e instanceof Error ? e.message : "Không tải được thông tin.");
      })
      .finally(() => {
        if (!a.signal.aborted) setLoading(false);
      });
    return () => a.abort();
  }, [churchId, kind, cursor, period, reload]);
  const value = profile?.profile;
  return (
    <Stack space="section">
      <SectionHeader title={portalTitles[kind]} />
      {error && (
        <Stack space="content">
          <Feedback tone="error">{error}</Feedback>
          <Button
            onClick={() => {
              setCursor(null);
              setReload((n) => n + 1);
            }}
          >
            Tải lại
          </Button>
        </Stack>
      )}
      {loading && (
        <Loading>
          {kind === "giving" ? "Đang tải dâng hiến…" : "Đang kiểm tra quyền xem hồ sơ…"}
        </Loading>
      )}
      {profile && profile.state !== "linked" && (
        <Card spacing="content">
          <EmptyState
            message={
              profile.state === "unlinked"
                ? "Chưa có hồ sơ liên kết."
                : "Liên kết cần được xác nhận lại."
            }
          />
          <Button onClick={onSupport}>Hỗ trợ tài khoản</Button>
        </Card>
      )}
      {value && kind === "profile" && (
        <Card spacing="content">
          <SectionHeader title={value.fullName} />
          <KeyValueList
            items={[
              { label: "Mã thuộc viên", value: value.code },
              { label: "Ngày sinh", value: printDay(value.birthDate) },
              { label: "Giới tính", value: gender[value.gender] },
              { label: "Điện thoại", value: value.phone ?? "Chưa có" },
              {
                label: "Tư cách",
                value: value.membership ? membership[value.membership] : "Chưa rõ",
              },
              {
                label: "Sinh hoạt",
                value: value.participation === "long_absent" ? "Vắng lâu" : "Đang sinh hoạt",
              },
              { label: "Báp-têm", value: baptism[value.baptism.status] },
              ...(value.baptism.date
                ? [{ label: "Ngày Báp-têm", value: printDay(value.baptism.date) }]
                : []),
              ...(value.baptism.place
                ? [{ label: "Nơi Báp-têm", value: value.baptism.place }]
                : []),
            ]}
          />
        </Card>
      )}
      {value && kind === "giving" && (
        <>
          <Card spacing="content">
            <Field label="Kỳ dâng hiến">
              <TextInput
                type="month"
                value={period}
                placeholder="YYYY-MM"
                onChange={(e) => {
                  setGiving(null);
                  setCursor(null);
                  setPeriod(e.target.value);
                }}
              />
            </Field>
            {!validPeriod(period) && <Feedback tone="error">Chọn kỳ theo dạng YYYY-MM.</Feedback>}
            {giving && (
              <KeyValueList
                items={[{ label: "Tổng ròng các khoản gắn danh tính", value: vnd(giving.net) }]}
              />
            )}
          </Card>
          {giving && !giving.items.length && <EmptyState message="Chưa có dâng hiến trong kỳ." />}
          {giving && giving.items.length > 0 && (
            <Stack space="section">
              {giving.items.map((row, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: These stateless rows only append within a period; the private projection supplies no receipt ID.
                <Card spacing="content" key={index}>
                  <KeyValueList
                    items={[
                      { label: "Ngày", value: printDay(row.businessDate) },
                      { label: "Quỹ", value: row.fundName },
                      { label: "Phần của tôi", value: vnd(row.amount) },
                      {
                        label: "Trạng thái",
                        value: row.state === "posted" ? "Đã ghi sổ" : "Đã hủy",
                      },
                    ]}
                  />
                </Card>
              ))}
              {giving.nextCursor && (
                <PaginationControl loading={loading} onMore={() => setCursor(giving.nextCursor)} />
              )}
            </Stack>
          )}
        </>
      )}
      {value && kind === "prayers" && prayerAccess && (
        <PersonalPrayers
          churchId={churchId}
          access={prayerAccess}
          onAuthError={onAuthError}
          onLinkLoss={() => {
            prayerAccess.onPending(null);
            setProfile({ state: "unavailable", profile: null });
          }}
        />
      )}
      {value && rites && kind === "rites" && (
        <Stack space="section">
          {!rites.items.length && (
            <EmptyState message="Chưa có lễ nghi đã ghi nhận cho hồ sơ của bạn." />
          )}
          {rites.items.map((r) => (
            <Card key={r.id} spacing="content">
              <SectionHeader title={riteNames[r.kind]} />
              <KeyValueList
                items={[
                  { label: "Ngày", value: printDay(r.date) },
                  { label: "Nơi", value: r.place ?? "Chưa có" },
                  { label: "Vai trò của tôi", value: r.roles.join(", ") || "Chưa xác định" },
                ]}
              />
            </Card>
          ))}
          {rites.nextCursor && (
            <PaginationControl loading={loading} onMore={() => setCursor(rites.nextCursor)} />
          )}
        </Stack>
      )}
    </Stack>
  );
}
