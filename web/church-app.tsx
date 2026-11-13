import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import type { OverviewTarget } from "../api/overview/contracts";
import { AccessContextView } from "./access-context";
import type { Role, Scope } from "./accounts-api";
import { ApiError, churchAuth, refreshChurchCsrf } from "./api";
import { AttendanceView } from "./attendance";
import { CertificatesView } from "./certificates";
import { FamiliesManagement } from "./families-management";
import { MembersManagement } from "./members-management";
import { OrganizationManagement } from "./organization-management";
import { OrganizationRuntimeView } from "./organization-runtime";
import { OverviewView } from "./overview";
import { usePendingNavigation } from "./pending-navigation";
import { RitesView } from "./rites";
import { kindTabs } from "./rites-api";
import type { TenantIntent } from "./tenant-mutation";
import { AppShell, AuthCard, Button, Feedback, Field, Loading, TextInput } from "./ui/components";

interface User {
  principalKind: "church_user";
  accountId: string;
  churchId: string;
  churchCode: string;
  email: string;
  displayName: string;
  sessionState: "password_change" | "full";
  role?: Role;
  scope?: Scope;
  version?: number;
}
type Screen = "loading" | "login" | "change" | "reauth" | "home" | "support" | "mismatch";
export function ChurchApp() {
  const code = decodeURIComponent(location.pathname.split("/")[2] ?? "").toUpperCase();
  const [screen, setScreen] = useState<Screen>(
      location.pathname.endsWith("/support") ? "support" : "loading",
    ),
    [user, setUser] = useState<User | null>(null),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [confirmation, setConfirmation] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [fields, setFields] = useState<Record<string, string>>({}),
    [busy, setBusy] = useState(false),
    [title, setTitle] = useState("Thông tin truy cập"),
    [context, setContext] = useState(""),
    [reload, setReload] = useState(0);
  const [section, setSection] = useState(
    location.pathname.endsWith("/forms")
      ? "forms"
      : location.pathname.endsWith("/rites")
        ? "rites"
        : location.pathname.endsWith("/attendance")
          ? "attendance"
          : location.pathname.endsWith("/overview")
            ? "overview"
            : location.pathname.endsWith("/bans")
              ? "bans"
              : location.pathname.endsWith("/roles")
                ? "roles"
                : location.pathname.endsWith("/config")
                  ? "config"
                  : location.pathname.endsWith("/members")
                    ? "members"
                    : location.pathname.endsWith("/families")
                      ? "families"
                      : "access",
  );
  useEffect(() => {
    const back = () =>
      setSection(
        location.pathname.endsWith("/forms")
          ? "forms"
          : location.pathname.endsWith("/rites")
            ? "rites"
            : location.pathname.endsWith("/attendance")
              ? "attendance"
              : location.pathname.endsWith("/overview")
                ? "overview"
                : location.pathname.endsWith("/bans")
                  ? "bans"
                  : location.pathname.endsWith("/roles")
                    ? "roles"
                    : location.pathname.endsWith("/config")
                      ? "config"
                      : location.pathname.endsWith("/members")
                        ? "members"
                        : location.pathname.endsWith("/families")
                          ? "families"
                          : "access",
      );
    window.addEventListener("popstate", back);
    return () => window.removeEventListener("popstate", back);
  }, []);
  const [familyToOpen, setFamilyToOpen] = useState<string | null>(null),
    [memberToOpen, setMemberToOpen] = useState<string | null>(null);
  const [pendingIntent, setPendingIntent] = useState<TenantIntent | null>(null);
  usePendingNavigation(pendingIntent);
  function selectSection(next: string, query?: URLSearchParams) {
    if (pendingIntent) return;
    setSection(next);
    history.pushState(
      null,
      "",
      `/h/${code}${next === "forms" || next === "rites" || next === "attendance" || next === "overview" || next === "access" || next === "config" || next === "members" || next === "families" || next === "bans" || next === "roles" ? `/${next}` : ""}${query?.size ? `?${query}` : ""}`,
    );
    if (next === "access") setReload((x) => x + 1);
  }
  const guard = useRef(false),
    lastActivity = useRef(0),
    heading = useRef<HTMLHeadingElement>(null);
  const onTitle = useCallback((name: string, ctx = "") => {
    setTitle(name);
    setContext(ctx);
  }, []);
  function navigate(next: Screen, selectedSection = section) {
    setPassword("");
    setConfirmation("");
    setFields({});
    setScreen(next);
    history.replaceState(
      null,
      "",
      `/h/${code}${next === "home" || next === "reauth" ? (selectedSection === "forms" || selectedSection === "rites" || selectedSection === "attendance" || selectedSection === "overview" || selectedSection === "access" || selectedSection === "config" || selectedSection === "members" || selectedSection === "families" || selectedSection === "bans" || selectedSection === "roles" ? `/${selectedSection}${location.search}` : "") : next === "change" ? "/change-password" : next === "support" ? "/support" : "/login"}`,
    );
  }
  function accept(identity: User) {
    if (identity.churchCode.toUpperCase() !== code) {
      setUser(null);
      setContext("");
      setError("");
      navigate("mismatch");
      return false;
    }
    setUser(identity);
    setEmail(identity.email);
    setError("");
    const entry = /^\/h\/[^/]+(?:\/(?:login|change-password))?$/.test(location.pathname);
    const nextSection =
      entry && !pendingIntent && ["pastor", "secretary"].includes(identity.role ?? "")
        ? "overview"
        : section;
    if (nextSection !== section) setSection(nextSection);
    navigate(identity.sessionState === "password_change" ? "change" : "home", nextSection);
    return true;
  }
  function fail(e: unknown) {
    if (e instanceof ApiError) {
      if (e.code === "REAUTH_REQUIRED") {
        navigate("reauth");
        return;
      }
      if (
        [
          "SESSION_EXPIRED",
          "SESSION_REVOKED",
          "CHURCH_SUSPENDED",
          "FORBIDDEN",
          "PASSWORD_CHANGE_REQUIRED",
        ].includes(e.code)
      ) {
        setUser(null);
        setContext("");
        navigate("login");
      }
      setFields(e.fieldErrors ?? {});
      setError(`${e.message}${e.retryAfter ? ` Thử lại sau ${e.retryAfter} giây.` : ""}`);
    } else setError("Không thể hoàn tất thao tác. Vui lòng thử lại.");
  }
  async function load() {
    try {
      const me = await churchAuth<User>("me");
      if (accept(me)) await refreshChurchCsrf();
    } catch (e) {
      if (e instanceof ApiError && ["SESSION_EXPIRED", "SESSION_REVOKED"].includes(e.code)) {
        setUser(null);
        navigate("login");
      } else fail(e);
    }
  }
  useEffect(() => {
    if (screen !== "support") void load();
  }, []);
  useEffect(() => {
    heading.current?.focus();
  }, [screen]);
  useEffect(() => {
    const back = () => {
      setUser(null);
      setContext("");
      setScreen("loading");
      location.reload();
    };
    window.addEventListener("popstate", back);
    return () => window.removeEventListener("popstate", back);
  }, []);
  useEffect(() => {
    if (screen !== "home") return;
    const sync = async (touch = false) => {
      try {
        const current = await churchAuth<User>("me");
        if (current.churchCode !== code || current.accountId !== user?.accountId) {
          setUser(null);
          setContext("");
          navigate("mismatch");
          return;
        }
        setUser(current);
        if (current.sessionState !== "full") {
          navigate("change");
          return;
        }
        if (touch) {
          await refreshChurchCsrf();
          await churchAuth("activity", {});
        }
      } catch (e) {
        fail(e);
      }
    };
    const activity = () => {
      if (document.visibilityState !== "visible" || Date.now() - lastActivity.current < 30_000)
        return;
      lastActivity.current = Date.now();
      void sync(true);
    };
    const visible = () => {
      if (document.visibilityState === "visible") void sync();
    };
    window.addEventListener("pointerdown", activity);
    window.addEventListener("keydown", activity);
    document.addEventListener("visibilitychange", visible);
    const timer = setInterval(visible, 30_000);
    return () => {
      window.removeEventListener("pointerdown", activity);
      window.removeEventListener("keydown", activity);
      document.removeEventListener("visibilitychange", visible);
      clearInterval(timer);
    };
  }, [screen, user?.accountId, code]);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (guard.current) return;
    guard.current = true;
    setBusy(true);
    setError("");
    setFields({});
    const secret = password,
      confirm = confirmation;
    setPassword("");
    setConfirmation("");
    try {
      if (screen === "login") {
        try {
          const current = await churchAuth<User>("me");
          accept(current);
          return;
        } catch (existing) {
          if (existing instanceof ApiError && existing.code === "REAUTH_REQUIRED") {
            navigate("reauth");
            return;
          }
          if (
            !(
              existing instanceof ApiError &&
              ["SESSION_EXPIRED", "SESSION_REVOKED", "CHURCH_SUSPENDED"].includes(existing.code)
            )
          )
            throw existing;
        }
        await refreshChurchCsrf();
        await churchAuth("login", { churchCode: code, email, password: secret });
        setNotice("");
        await load();
      } else if (screen === "change") {
        if (secret !== confirm)
          throw new ApiError("VALIDATION_FAILED", "Mật khẩu nhập lại không khớp.", undefined, {
            confirmation: "Mật khẩu nhập lại không khớp.",
          });
        if ([...secret].length < 8 || [...secret].length > 128)
          throw new ApiError("VALIDATION_FAILED", "Mật khẩu mới phải có 8–128 ký tự.");
        await churchAuth("change-initial-password", { newPassword: secret, confirmation: confirm });
        setUser(null);
        navigate("login");
        setNotice("Đã đổi mật khẩu.");
      } else if (screen === "reauth") {
        await refreshChurchCsrf();
        await churchAuth("reauth", { password: secret });
        await load();
      }
    } catch (error) {
      fail(error);
      if (
        screen === "change" &&
        error instanceof ApiError &&
        ["NETWORK_ERROR", "OUTCOME_UNKNOWN", "DEPENDENCY_UNAVAILABLE"].includes(error.code)
      )
        setNotice(
          "Chưa xác định kết quả đổi mật khẩu. Về đăng nhập và thử mật khẩu mới trước khi yêu cầu cấp lại.",
        );
    } finally {
      guard.current = false;
      setBusy(false);
    }
  }
  async function logout() {
    if (guard.current || pendingIntent) return;
    guard.current = true;
    setBusy(true);
    try {
      try {
        const current = await churchAuth<User>("me");
        if (user && (current.accountId !== user.accountId || current.churchCode !== code)) {
          setUser(null);
          setContext("");
          navigate("mismatch");
          return;
        }
      } catch (e) {
        if (!(e instanceof ApiError && e.code === "REAUTH_REQUIRED")) throw e;
      }
      await refreshChurchCsrf();
      await churchAuth("logout", {});
      setUser(null);
      setContext("");
      setNotice("");
      setError("");
      navigate("login");
    } catch (e) {
      if (
        e instanceof ApiError &&
        ["SESSION_EXPIRED", "SESSION_REVOKED", "CHURCH_SUSPENDED"].includes(e.code)
      ) {
        setUser(null);
        setContext("");
        setNotice("");
        setError("");
        navigate("login");
      } else fail(e);
    } finally {
      guard.current = false;
      setBusy(false);
    }
  }
  function overviewNavigate(target: OverviewTarget) {
    if (pendingIntent) return;
    if (target.kind === "members") {
      setMemberToOpen(target.memberId ?? null);
      const q = new URLSearchParams(target.filters);
      if (target.memberId) q.set("memberId", target.memberId);
      if (target.create) q.set("action", "create");
      selectSection("members", q);
    } else {
      const q = new URLSearchParams();
      if (target.kind === "attendance" && target.sessionId) q.set("sessionId", target.sessionId);
      if (target.kind === "rites") {
        if (target.tab) q.set("tab", target.tab);
        if (target.riteId) q.set("riteId", target.riteId);
        if (target.courseId) q.set("courseId", target.courseId);
      }
      selectSection(target.kind, q);
    }
  }
  const feedback = (
    <>
      {error && <Feedback tone="error">{error}</Feedback>}
      {notice && <Feedback>{notice}</Feedback>}
    </>
  );
  if (screen === "home" && user)
    return (
      <AppShell
        title={title}
        context={context}
        activeId={section}
        identity={user}
        busy={busy || !!pendingIntent}
        onLogout={() => void logout()}
        items={[
          ...(["pastor", "secretary"].includes(user.role ?? "")
            ? [
                {
                  id: "overview",
                  label: "Tổng quan",
                  icon: "home" as const,
                  disabled: !!pendingIntent,
                  onSelect: () => selectSection("overview"),
                },
              ]
            : []),
          {
            id: "access",
            disabled: !!pendingIntent,
            label: "Thông tin truy cập",
            icon: "house",
            onSelect: () => selectSection("access"),
          },
          {
            id: "roles",
            label: "Phân quyền",
            icon: "users",
            disabled: !!pendingIntent,
            onSelect: () => selectSection("roles"),
          },
          ...(["pastor", "secretary", "ministry_lead"].includes(user.role ?? "")
            ? [
                {
                  id: "attendance",
                  label: "Điểm danh",
                  icon: "check" as const,
                  disabled: !!pendingIntent,
                  onSelect: () => selectSection("attendance"),
                },
                ...(["pastor", "secretary"].includes(user.role ?? "")
                  ? [
                      {
                        id: "forms",
                        label: "Biểu mẫu & Báo cáo",
                        icon: "file" as const,
                        disabled: !!pendingIntent,
                        onSelect: () => selectSection("forms"),
                      },
                      {
                        id: "rites",
                        label: "Sổ lễ nghi",
                        icon: "book" as const,
                        disabled: !!pendingIntent,
                        onSelect: () => selectSection("rites"),
                      },
                    ]
                  : []),
                {
                  id: "bans",
                  label: "Ban ngành & Khu vực",
                  icon: "users" as const,
                  disabled: !!pendingIntent,
                  onSelect: () => selectSection("bans"),
                },
              ]
            : []),
          ...(user.role === "pastor" || user.role === "secretary"
            ? [
                {
                  id: "members",
                  label: "Thuộc viên",
                  icon: "users" as const,
                  disabled: !!pendingIntent,
                  onSelect: () => {
                    setMemberToOpen(null);
                    selectSection("members");
                  },
                },
                {
                  id: "families",
                  label: "Gia đình",
                  icon: "house" as const,
                  disabled: !!pendingIntent,
                  onSelect: () => {
                    setFamilyToOpen(null);
                    selectSection("families");
                  },
                },
                {
                  id: "config",
                  label: "Cấu hình",
                  icon: "gear" as const,
                  disabled: !!pendingIntent,
                  onSelect: () => selectSection("config"),
                },
              ]
            : []),
        ]}
      >
        {feedback}
        {section === "overview" ? (
          <OverviewView
            key={`${user.accountId}:${user.churchId}:${user.version}`}
            realm="church"
            churchId={user.churchId}
            pending={!!pendingIntent}
            onTitle={onTitle}
            onAuthError={fail}
            onNavigate={overviewNavigate}
          />
        ) : section === "forms" ? (
          <CertificatesView
            key={`${user.accountId}:${user.churchId}:${user.version}`}
            realm="church"
            churchId={user.churchId}
            pending={pendingIntent}
            onPending={setPendingIntent}
            onAuthError={fail}
            onTitle={onTitle}
          />
        ) : section === "rites" ? (
          <RitesView
            onCertificate={(kind, id) =>
              selectSection("forms", new URLSearchParams({ kind, riteId: id }))
            }
            key={`${user.accountId}:${user.churchId}:${user.version}`}
            realm="church"
            churchId={user.churchId}
            pending={pendingIntent}
            onPending={setPendingIntent}
            onAuthError={fail}
            onTitle={onTitle}
            onAttendance={(id) =>
              selectSection("attendance", new URLSearchParams({ sessionId: id }))
            }
            onMember={(id) => {
              setMemberToOpen(id);
              selectSection("members", new URLSearchParams({ memberId: id }));
            }}
          />
        ) : section === "attendance" ? (
          <AttendanceView
            key={`${user.accountId}:${user.churchId}:${user.version}`}
            realm="church"
            churchId={user.churchId}
            pending={pendingIntent}
            onPending={setPendingIntent}
            onTitle={onTitle}
            onAuthError={fail}
          />
        ) : section === "bans" || section === "roles" ? (
          <OrganizationRuntimeView
            key={`${user.accountId}:${user.churchId}:${user.version}:${section}`}
            realm="church"
            churchId={user.churchId}
            pending={pendingIntent}
            onPending={setPendingIntent}
            onTitle={onTitle}
            onAuthError={fail}
            policyOnly={section === "roles"}
            onConfig={() => selectSection("config")}
            onMember={(id) => {
              setMemberToOpen(id);
              selectSection("members");
            }}
          />
        ) : section === "families" ? (
          <FamiliesManagement
            key={`${user.accountId}:${user.churchId}:${user.version}`}
            realm="church"
            churchId={user.churchId}
            pending={pendingIntent}
            onPending={setPendingIntent}
            onTitle={onTitle}
            onAuthError={fail}
            initialFamilyId={familyToOpen}
            onMember={(id) => {
              if (!pendingIntent) {
                setMemberToOpen(id);
                selectSection("members");
              }
            }}
          />
        ) : section === "members" ? (
          <MembersManagement
            key={`${user.accountId}:${user.churchId}:${user.version}:${location.search}`}
            realm="church"
            churchId={user.churchId}
            initialMemberId={memberToOpen ?? new URLSearchParams(location.search).get("memberId")}
            onCertificate={(id) => selectSection("forms", new URLSearchParams({ editionId: id }))}
            onAttendance={(id) =>
              selectSection("attendance", new URLSearchParams({ sessionId: id }))
            }
            onRite={(kind, id) =>
              selectSection("rites", new URLSearchParams({ riteId: id, tab: kindTabs[kind] }))
            }
            onClass={(id) =>
              selectSection("rites", new URLSearchParams({ courseId: id, tab: "class" }))
            }
            initialCreate={new URLSearchParams(location.search).get("action") === "create"}
            onFamily={(id) => {
              if (!pendingIntent) {
                setFamilyToOpen(id);
                selectSection("families");
              }
            }}
            pending={pendingIntent}
            onPending={setPendingIntent}
            onTitle={onTitle}
            onAuthError={fail}
          />
        ) : section === "config" ? (
          <OrganizationManagement
            key={`${user.accountId}:${user.churchId}:${user.version}`}
            realm="church"
            churchId={user.churchId}
            pending={pendingIntent}
            onPending={setPendingIntent}
            onTitle={onTitle}
            onAuthError={fail}
          />
        ) : (
          <AccessContextView
            key={`${user.accountId}:${user.churchId}:${user.version}:${reload}`}
            realm="church"
            churchId={user.churchId}
            onTitle={onTitle}
            onAuthError={fail}
          />
        )}
      </AppShell>
    );
  return (
    <AuthCard
      title={
        screen === "change"
          ? "Đổi mật khẩu"
          : screen === "reauth"
            ? "Xác thực lại"
            : screen === "support"
              ? "Hỗ trợ tài khoản"
              : screen === "mismatch"
                ? "Phiên đăng nhập đã thay đổi"
                : screen === "loading"
                  ? "QLHT"
                  : "Đăng nhập"
      }
      headingRef={heading}
    >
      {screen === "loading" ? (
        <Loading>Đang kết nối…</Loading>
      ) : screen === "support" ? (
        <>
          <p>Nếu quên mật khẩu hoặc mất quyền truy cập tài khoản, vui lòng liên hệ:</p>
          <p>
            <strong>Dịch vu chăm sóc và hỗ trợ</strong>
          </p>
          <Button variant="primary" className="wide" onClick={() => navigate("login")}>
            Về đăng nhập
          </Button>
        </>
      ) : screen === "mismatch" ? (
        <>
          <Feedback tone="warning">
            Phiên hiện tại không khớp tài khoản hoặc Hội Thánh của trang này. Thông tin trước đã
            được xóa khỏi màn hình. Đăng xuất phiên hiện tại để tiếp tục.
          </Feedback>
          <Button disabled={busy} onClick={() => void logout()}>
            Đăng xuất
          </Button>
        </>
      ) : (
        <>
          {screen !== "login" && (
            <p className="muted identity">{user?.email || email || "Phiên người dùng hiện tại"}</p>
          )}
          {feedback}
          <form onSubmit={submit} aria-busy={busy}>
            {screen === "login" && (
              <Field label="Email" error={fields.email}>
                <TextInput
                  type="email"
                  required
                  maxLength={254}
                  autoComplete="username"
                  name="email"
                  value={email}
                  disabled={busy}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </Field>
            )}
            <Field
              label={screen === "change" ? "Mật khẩu mới" : "Mật khẩu"}
              hint={screen === "change" ? "8–128 ký tự" : undefined}
              error={fields.newPassword ?? fields.password}
            >
              <TextInput
                type="password"
                required
                name="password"
                autoComplete={screen === "change" ? "new-password" : "current-password"}
                value={password}
                disabled={busy}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
            {screen === "change" && (
              <Field label="Nhập lại mật khẩu" error={fields.confirmation}>
                <TextInput
                  type="password"
                  required
                  name="confirmation"
                  autoComplete="new-password"
                  value={confirmation}
                  disabled={busy}
                  onChange={(e) => setConfirmation(e.target.value)}
                />
              </Field>
            )}
            <Button variant="primary" className="wide" type="submit" disabled={busy}>
              {busy
                ? "Đang xử lý…"
                : screen === "change"
                  ? "Lưu mật khẩu"
                  : screen === "reauth"
                    ? "Tiếp tục"
                    : "Đăng nhập"}
            </Button>
          </form>
          {screen === "login" ? (
            <Button variant="link" onClick={() => navigate("support")}>
              Quên mật khẩu hoặc mất tài khoản?
            </Button>
          ) : (
            <>
              <Button variant="link" disabled={busy} onClick={() => void logout()}>
                Đăng xuất
              </Button>
              {screen === "change" && notice && (
                <Button
                  variant="link"
                  disabled={busy}
                  onClick={() => {
                    setUser(null);
                    navigate("login");
                  }}
                >
                  Về đăng nhập
                </Button>
              )}
            </>
          )}
        </>
      )}
    </AuthCard>
  );
}
