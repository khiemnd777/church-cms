import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { AccessContextView } from "./access-context";
import type { Role, Scope } from "./accounts-api";
import { ApiError, churchAuth, refreshChurchCsrf } from "./api";
import type { OrganizationIntent } from "./organization-api";
import { OrganizationManagement } from "./organization-management";
import { useOrganizationNavigation } from "./organization-navigation";
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
    location.pathname.endsWith("/config") ? "config" : "access",
  );
  const [organizationPending, setOrganizationPending] = useState<OrganizationIntent | null>(null);
  useOrganizationNavigation(organizationPending);
  function selectSection(next: string) {
    if (organizationPending) return;
    setSection(next);
    history.pushState(null, "", `/h/${code}${next === "config" ? "/config" : ""}`);
    if (next === "access") setReload((x) => x + 1);
  }
  const guard = useRef(false),
    lastActivity = useRef(0),
    heading = useRef<HTMLHeadingElement>(null);
  const onTitle = useCallback((name: string, ctx = "") => {
    setTitle(name);
    setContext(ctx);
  }, []);
  function navigate(next: Screen) {
    setPassword("");
    setConfirmation("");
    setFields({});
    setScreen(next);
    history.replaceState(
      null,
      "",
      `/h/${code}${next === "home" || next === "reauth" ? (section === "config" ? "/config" : "") : next === "change" ? "/change-password" : next === "support" ? "/support" : "/login"}`,
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
    navigate(identity.sessionState === "password_change" ? "change" : "home");
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
    if (guard.current || organizationPending) return;
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
        busy={busy || !!organizationPending}
        onLogout={() => void logout()}
        items={[
          {
            id: "access",
            disabled: !!organizationPending,
            label: "Thông tin truy cập",
            icon: "house",
            onSelect: () => selectSection("access"),
          },
          ...(user.role === "pastor" || user.role === "secretary"
            ? [
                {
                  id: "config",
                  label: "Cấu hình",
                  icon: "gear" as const,
                  disabled: !!organizationPending,
                  onSelect: () => selectSection("config"),
                },
              ]
            : []),
        ]}
      >
        {feedback}
        {section === "config" ? (
          <OrganizationManagement
            key={`${user.accountId}:${user.churchId}:${user.version}`}
            realm="church"
            churchId={user.churchId}
            pending={organizationPending}
            onPending={setOrganizationPending}
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
