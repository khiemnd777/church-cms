import { type FormEvent, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { AccessContextView, type ChurchRef } from "./access-context";
import { AccountManagement } from "./account-management";
import type { ResumeReset } from "./accounts-api";
import { ApiError, api, refreshCsrf } from "./api";
import { ChurchApp } from "./church-app";
import { ChurchManagement } from "./church-management";
import type { OrganizationIntent } from "./organization-api";
import { OrganizationManagement } from "./organization-management";
import { useOrganizationNavigation } from "./organization-navigation";
import { AppShell, AuthCard, Button, Feedback, Field, Loading, TextInput } from "./ui/components";
import "@fontsource/be-vietnam-pro/400.css";
import "@fontsource/be-vietnam-pro/500.css";
import "@fontsource/be-vietnam-pro/600.css";
import "@fontsource/be-vietnam-pro/700.css";
import "@fontsource/lora/600.css";
import "@fontsource/lora/700.css";
import "./style.css";
interface Owner {
  email: string;
  displayName: string;
  employeeId: string;
  sessionState: "password_change" | "full";
}
type Screen = "loading" | "login" | "change" | "support" | "home" | "reauth";
function ownerRoute() {
  const match = /^\/owner\/churches\/([a-f0-9]{24})\/(accounts|manage|config)$/i.exec(
    location.pathname,
  );
  return match
    ? { kind: match[2] as "accounts" | "manage" | "config", churchId: match[1] as string }
    : { kind: "churches" as const, churchId: null };
}
function App() {
  const [route, setRoute] = useState(ownerRoute),
    [currentChurch, setCurrentChurch] = useState<ChurchRef | null>(null),
    [resumeReset, setResumeReset] = useState<ResumeReset | null>(null);
  const updateChurch = useCallback((church: ChurchRef | null) => setCurrentChurch(church), []);
  const [organizationPending, setOrganizationPending] = useState<OrganizationIntent | null>(null);
  useOrganizationNavigation(organizationPending);
  function ownerNavigate(kind: "churches" | "accounts" | "manage" | "config", id?: string) {
    if (organizationPending) return;
    history.pushState(
      null,
      "",
      kind === "churches"
        ? id
          ? `/owner/churches/${id}`
          : "/owner"
        : `/owner/churches/${id}/${kind}`,
    );
    setRoute(ownerRoute());
  }
  useEffect(() => {
    const back = () => setRoute(ownerRoute());
    window.addEventListener("popstate", back);
    return () => window.removeEventListener("popstate", back);
  }, []);
  const [screen, setScreen] = useState<Screen>("loading"),
    [owner, setOwner] = useState<Owner | null>(null),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [confirmation, setConfirmation] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [listRequest, setListRequest] = useState(0),
    [pageTitle, setPageTitle] = useState("Hội Thánh"),
    [pageContext, setPageContext] = useState("");
  const setHeading = useCallback((title: string, context = "") => {
    setPageTitle(title);
    setPageContext(context);
  }, []);
  const heading = useRef<HTMLHeadingElement>(null),
    busyRef = useRef(false),
    lastActivity = useRef(0);
  function navigate(next: Screen) {
    if (next === "home") setNotice("");
    setPassword("");
    setConfirmation("");
    setError("");
    setScreen(next);
    const path =
      next === "change"
        ? "/owner/change-password"
        : next === "support"
          ? "/owner/support"
          : next === "home" || next === "reauth"
            ? /^\/owner\/churches\/[a-f0-9]{24}(?:\/(?:accounts|manage|config))?$/i.test(
                location.pathname,
              )
              ? location.pathname
              : "/owner"
            : "/owner/login";
    history.replaceState(null, "", path);
  }
  async function load() {
    try {
      const identity = await api<Owner>("me");
      setOwner(identity);
      setEmail(identity.email);
      navigate(identity.sessionState === "password_change" ? "change" : "home");
    } catch (e) {
      if (e instanceof ApiError && e.code === "REAUTH_REQUIRED") {
        navigate("reauth");
      } else if (e instanceof ApiError && ["SESSION_EXPIRED", "SESSION_REVOKED"].includes(e.code)) {
        setOwner(null);
        navigate("login");
      } else {
        navigate("login");
        setError(e instanceof Error ? e.message : "Không thể kết nối.");
      }
    }
  }
  useEffect(() => {
    if (location.pathname === "/owner/support") navigate("support");
    else void load();
  }, []);
  useEffect(() => {
    heading.current?.focus();
  }, [screen, pageTitle]);
  function handleError(e: unknown) {
    if (e instanceof ApiError) {
      if (e.code === "REAUTH_REQUIRED") {
        navigate("reauth");
        return;
      }
      if (["SESSION_EXPIRED", "SESSION_REVOKED"].includes(e.code)) {
        setOwner(null);
        navigate("login");
        setError(e.message);
        return;
      }
      setError(`${e.message}${e.retryAfter ? ` Thử lại sau ${e.retryAfter} giây.` : ""}`);
    } else setError("Không thể hoàn tất thao tác. Vui lòng thử lại.");
  }
  useEffect(() => {
    if (screen !== "home") return;
    async function touch() {
      if (document.visibilityState !== "visible" || Date.now() - lastActivity.current < 30000)
        return;
      lastActivity.current = Date.now();
      try {
        await api("activity", {});
      } catch (e) {
        handleError(e);
      }
    }
    const events = ["pointerdown", "keydown"] as const;
    for (const event of events) window.addEventListener(event, touch);
    // Read-only session checks never extend idle time; foreground activity uses a separate endpoint.
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void api("me").catch(handleError);
    }, 30000);
    function visible() {
      if (document.visibilityState === "visible") void api("me").catch(handleError);
    }
    document.addEventListener("visibilitychange", visible);
    return () => {
      for (const event of events) window.removeEventListener(event, touch);
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [screen]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    const secret = password;
    setPassword("");
    setConfirmation("");
    try {
      if (screen === "login") {
        // Recover a session whose post-login /me response was lost; never submit a new login
        // with an authenticated CSRF token against the bootstrap-only endpoint.
        try {
          const existing = await api<Owner>("me");
          setOwner(existing);
          setEmail(existing.email);
          navigate(existing.sessionState === "password_change" ? "change" : "home");
          return;
        } catch (e) {
          if (e instanceof ApiError && e.code === "REAUTH_REQUIRED") {
            navigate("reauth");
            return;
          }
          if (!(e instanceof ApiError && ["SESSION_EXPIRED", "SESSION_REVOKED"].includes(e.code)))
            throw e;
        }
        await refreshCsrf();
        await api("login", { email, password: secret });
        await load();
      } else if (screen === "change") {
        if (secret !== confirmation)
          throw new ApiError("VALIDATION_FAILED", "Mật khẩu nhập lại không khớp.");
        if ([...secret].length < 8 || [...secret].length > 128)
          throw new ApiError("VALIDATION_FAILED", "Mật khẩu mới phải có 8–128 ký tự.");
        await api("change-initial-password", { newPassword: secret, confirmation });
        setOwner(null);
        navigate("login");
        setNotice("Đã đổi mật khẩu.");
      } else if (screen === "reauth") {
        await refreshCsrf();
        await api("reauth", { password: secret });
        await load();
      }
    } catch (e) {
      handleError(e);
      if (screen === "change" && e instanceof ApiError && e.code === "NETWORK_ERROR")
        setNotice("Chưa xác định kết quả đổi mật khẩu. Hãy về đăng nhập và thử mật khẩu mới.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  async function logout() {
    if (busyRef.current || organizationPending) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await refreshCsrf();
      await api("logout", {});
      setOwner(null);
      setNotice("");
      navigate("login");
    } catch (e) {
      handleError(e);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  const feedback = (
    <>
      {error && <Feedback tone="error">{error}</Feedback>}
      {notice && <Feedback tone="success">{notice}</Feedback>}
    </>
  );
  function authCard(title: string, content: ReactNode) {
    return (
      <AuthCard title={title} headingRef={heading}>
        {content}
      </AuthCard>
    );
  }
  if (screen === "loading") return authCard("QLHT", <Loading>Đang kết nối…</Loading>);
  if (screen === "support")
    return authCard(
      "Hỗ trợ tài khoản",
      <>
        <p>Nếu quên mật khẩu hoặc mất quyền truy cập tài khoản, vui lòng liên hệ:</p>
        <p>
          <strong>Dịch vu chăm sóc và hỗ trợ</strong>
        </p>
        <Button variant="primary" className="wide" onClick={() => navigate("login")}>
          Về đăng nhập
        </Button>
      </>,
    );
  if (screen === "login" || screen === "change" || screen === "reauth")
    return authCard(
      screen === "login" ? "Đăng nhập" : screen === "change" ? "Đổi mật khẩu" : "Xác thực lại",
      <>
        {screen !== "login" && (
          <p className="muted identity">{owner?.email || email || "Phiên owner hiện tại"}</p>
        )}
        {feedback}
        <form onSubmit={submit} aria-busy={busy}>
          {screen === "login" && (
            <Field label="Email">
              <TextInput
                type="email"
                name="email"
                autoComplete="username"
                required
                maxLength={254}
                value={email}
                disabled={busy}
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>
          )}
          <Field
            label={screen === "change" ? "Mật khẩu mới" : "Mật khẩu"}
            hint={screen === "change" ? "8–128 ký tự" : undefined}
          >
            <TextInput
              type="password"
              name="password"
              autoComplete={screen === "change" ? "new-password" : "current-password"}
              required
              value={password}
              disabled={busy}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          {screen === "change" && (
            <Field label="Nhập lại mật khẩu">
              <TextInput
                type="password"
                name="confirmation"
                autoComplete="new-password"
                required
                value={confirmation}
                disabled={busy}
                onChange={(e) => setConfirmation(e.target.value)}
              />
            </Field>
          )}
          <Button variant="primary" className="wide" type="submit" disabled={busy}>
            {busy
              ? "Đang xử lý…"
              : screen === "login"
                ? "Đăng nhập"
                : screen === "change"
                  ? "Lưu mật khẩu"
                  : "Tiếp tục"}
          </Button>
        </form>
        {screen === "login" ? (
          <Button variant="link" onClick={() => navigate("support")}>
            Quên mật khẩu hoặc mất tài khoản?
          </Button>
        ) : (
          <Button variant="link" disabled={busy} onClick={logout}>
            Đăng xuất
          </Button>
        )}
      </>,
    );
  return (
    <AppShell
      activeId={
        route.kind === "config" ? "config" : route.kind === "accounts" ? "accounts" : "churches"
      }
      title={pageTitle}
      context={pageContext}
      identity={{ displayName: owner?.displayName ?? "", email: owner?.email ?? "" }}
      busy={busy || !!organizationPending}
      onLogout={logout}
      items={[
        {
          id: "churches",
          disabled: !!organizationPending,
          label: "Hội Thánh",
          icon: "house",
          onSelect: () => {
            ownerNavigate("churches");
            setListRequest((x) => x + 1);
          },
        },
        {
          id: "accounts",
          label: "Tài khoản",
          description: currentChurch ? currentChurch.name : "Chọn Hội Thánh trước",
          icon: "users",
          disabled: !currentChurch || !!organizationPending,
          onSelect: () => {
            if (currentChurch) ownerNavigate("accounts", currentChurch.id);
          },
        },
        {
          id: "config",
          label: "Cấu hình",
          icon: "gear",
          description: currentChurch?.name ?? "Chọn Hội Thánh trước",
          disabled: !currentChurch || currentChurch.status !== "active" || !!organizationPending,
          onSelect: () => {
            if (currentChurch) ownerNavigate("config", currentChurch.id);
          },
        },
      ]}
    >
      {feedback}
      {route.kind === "config" && route.churchId ? (
        <OrganizationManagement
          key={`${owner?.employeeId}:${route.churchId}`}
          realm="owner"
          churchId={route.churchId}
          pending={organizationPending}
          onPending={setOrganizationPending}
          onAuthError={handleError}
          onTitle={setHeading}
          onChurch={updateChurch}
          onBack={() => ownerNavigate("churches", route.churchId as string)}
        />
      ) : route.kind === "accounts" && route.churchId ? (
        <AccountManagement
          key={route.churchId}
          churchId={route.churchId}
          onAuthError={handleError}
          onTitle={setHeading}
          onChurch={updateChurch}
          onReturn={() => ownerNavigate("churches", route.churchId as string)}
          onRecentAuth={(request) => {
            setResumeReset(request);
            navigate("reauth");
          }}
          resumeReset={resumeReset}
          onResumeHandled={() => setResumeReset(null)}
        />
      ) : route.kind === "manage" && route.churchId ? (
        <AccessContextView
          key={route.churchId}
          realm="owner"
          churchId={route.churchId}
          onTitle={setHeading}
          onAuthError={handleError}
          onChurch={updateChurch}
          onBack={() => ownerNavigate("churches", route.churchId as string)}
        />
      ) : (
        <ChurchManagement
          onAuthError={handleError}
          onTitle={setHeading}
          listRequest={listRequest}
          onChurch={updateChurch}
          onAccounts={() => {
            if (currentChurch) ownerNavigate("accounts", currentChurch.id);
          }}
          onConfig={() => {
            if (currentChurch) ownerNavigate("config", currentChurch.id);
          }}
          onManage={() => {
            if (currentChurch) ownerNavigate("manage", currentChurch.id);
          }}
        />
      )}
    </AppShell>
  );
}
const root = document.getElementById("root");
if (root) createRoot(root).render(location.pathname.startsWith("/h/") ? <ChurchApp /> : <App />);
