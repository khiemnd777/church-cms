import { resolve } from "node:path";
import type { ObjectId } from "mongodb";
import { AuditReader } from "./audit/reader";
import { policyVersion } from "./authorization/church-policy";
import { ownerCapabilities } from "./authorization/owner-policy";
import type { Config } from "./config";
import { AppError, requireCondition } from "./errors";
import { readJson } from "./http";
import { objectId } from "./http-validation";
import { Accounts } from "./identity/accounts";
import { ChurchIdentity } from "./identity/church-service";
import type { Realm } from "./identity/models";
import { cookie, cookieName, type Identity, type SessionResult } from "./identity/service";
import { Operations } from "./operations/service";
import { Tenancy } from "./tenancy/service";
export interface RequestInfo {
  ip: string;
}
const messages: Record<string, string> = {
  INVALID_CREDENTIALS: "Email hoặc mật khẩu không đúng.",
  TEMP_PASSWORD_EXPIRED: "Mật khẩu tạm đã hết hạn. Liên hệ Dịch vu chăm sóc và hỗ trợ.",
  ACCOUNT_EXISTS: "Email đã có tài khoản trong Hội Thánh này. Mở tài khoản hiện có để quản lý.",
  ACCOUNT_LOCKED: "Tài khoản đang bị khóa. Không thể cấp lại mật khẩu.",
  SCOPE_TARGET_NOT_AVAILABLE: "Chưa có Ban/Khu vực hợp lệ cho phạm vi này.",
  CHURCH_SUSPENDED: "Hội Thánh đang tạm ngưng truy cập.",
  RECENT_AUTH_REQUIRED: "Xác thực lại trước khi cấp lại mật khẩu tạm.",
  REAUTH_REQUIRED: "Vui lòng xác thực lại.",
  SESSION_EXPIRED: "Phiên đã hết hạn. Vui lòng đăng nhập.",
  SESSION_REVOKED: "Phiên không còn hiệu lực. Vui lòng đăng nhập.",
  PASSWORD_CHANGE_REQUIRED: "Vui lòng đổi mật khẩu.",
  VALIDATION_FAILED: "Kiểm tra thông tin đã nhập.",
  RATE_LIMITED: "Bạn đã thử quá nhiều lần. Vui lòng thử lại sau.",
  DEPENDENCY_UNAVAILABLE: "Dịch vụ tạm thời không khả dụng. Vui lòng thử lại.",
  CSRF_FAILED: "Phiên xác thực không hợp lệ. Vui lòng tải lại trang.",
  FORBIDDEN: "Bạn không có quyền thực hiện thao tác này.",
  NOT_FOUND: "Không tìm thấy.",
  PRECONDITION_REQUIRED: "Vui lòng tải lại phiên bản hiện tại trước khi lưu.",
  VERSION_CONFLICT: "Dữ liệu đã thay đổi. Tải lại và kiểm tra trước khi lưu.",
  IDEMPOTENCY_CONFLICT: "Khóa thao tác đã được dùng với nội dung khác.",
  IDEMPOTENCY_EXPIRED:
    "Thao tác đã quá thời hạn thử lại. Đối soát kết quả trước khi tạo thao tác mới.",
  OPERATION_IN_PROGRESS: "Thao tác đang được xử lý. Giữ nguyên và kiểm tra kết quả.",
  INVALID_CURSOR: "Thông tin phân trang không hợp lệ.",
  CURSOR_CONTEXT_MISMATCH: "Bộ lọc hoặc người dùng đã thay đổi. Tìm lại từ đầu.",
  CURSOR_EXPIRED: "Thông tin phân trang đã hết hạn. Tìm lại từ đầu.",
  OUTCOME_UNKNOWN: "Chưa xác định kết quả. Vui lòng kiểm tra lại trước khi thử.",
};
const security = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};
function cookies(req: Request) {
  const map = new Map<string, string>();
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) {
      const k = part.slice(0, i).trim();
      if (map.has(k)) throw new AppError(400, "INVALID_REQUEST");
      map.set(k, part.slice(i + 1).trim());
    }
  }
  return map;
}
export function createApp(
  identity: Identity,
  conf: Config,
  options: { log?: (row: object) => void; dist?: string } = {},
) {
  const operations = new Operations(identity.db, identity.now);
  const auditReader = new AuditReader(identity.db, conf.csrfKey, identity.now);
  const tenancy = new Tenancy(
    identity.db,
    operations,
    identity.audit,
    (ids) => identity.activeAccountCounts(ids),
    conf.csrfKey,
    (id, tx) => identity.suspendChurchSessions(id, tx),
    identity.now,
  );
  const access = tenancy.access();
  const churchIdentity = new ChurchIdentity(identity, access);
  const accounts = new Accounts(
    identity.db,
    access,
    operations,
    identity.audit,
    identity.rate,
    conf.csrfKey,
    identity.now,
  );
  const log = options.log ?? ((row) => console.info(JSON.stringify(row)));
  return async function handle(req: Request, info: RequestInfo): Promise<Response> {
    const started = performance.now(),
      requestId = crypto.randomUUID();
    let route = "unmatched",
      response: Response;
    let actorId: ObjectId | undefined;
    let requestRealm: Realm = "owner",
      actorChurchId: ObjectId | null = null,
      targetChurchId: ObjectId | null = null,
      targetAccountId: ObjectId | undefined;
    const headers = new Headers({
      ...security,
      "X-Request-Id": requestId,
      Date: new Date().toUTCString(),
    });
    const json = (data: unknown, status = 200, meta: Record<string, unknown> = {}) =>
      Response.json({ data, meta: { requestId, ...meta } }, { status, headers });
    const setSession = (result: SessionResult) => {
      headers.append(
        "Set-Cookie",
        cookie(
          cookieName(result.session.realm, result.session.kind === "bootstrap"),
          result.token,
          (result.session.absoluteExpiresAt.getTime() - identity.now().getTime()) / 1000,
        ),
      );
    };
    const clear = (realm: Realm, bootstrap = false) =>
      headers.append("Set-Cookie", cookie(cookieName(realm, bootstrap), "", 0));
    try {
      const url = new URL(req.url),
        path = url.pathname;
      requireCondition(url.origin === conf.origin, 400, "INVALID_REQUEST");
      if (path === "/api/health/live" && req.method === "GET") {
        route = "health.live";
        response = json({ status: "alive" });
      } else if (path === "/api/health/ready" && req.method === "GET") {
        route = "health.ready";
        await identity.db.ready();
        await identity.rate.ready();
        response = json({ status: "ready" });
      } else if (path.startsWith("/api/")) {
        const jar = cookies(req),
          ownerToken = jar.get(cookieName("owner")),
          churchToken = jar.get(cookieName("church"));
        if (path === "/api/v1/auth/csrf" && req.method === "GET") {
          route = "F01";
          const realm = url.searchParams.get("realm");
          requireCondition(realm === "owner" || realm === "church", 400, "INVALID_REQUEST");
          requestRealm = realm;
          const result =
            realm === "church"
              ? await churchIdentity.bootstrap(churchToken, jar.get(cookieName("church", true)))
              : await identity.bootstrap(realm, ownerToken, jar.get(cookieName(realm, true)));
          setSession(result);
          response = json({
            csrfToken: result.csrfToken,
            expiresAt: result.session.absoluteExpiresAt,
          });
        } else if (path === "/api/v1/owner/audit-events") {
          route = "F23";
          requireCondition(req.method === "GET", 405, "METHOD_NOT_ALLOWED");
          const ctx = await identity.authorize(ownerToken, "owner", false, true);
          actorId = ctx.owner._id;
          const grant = identity.ownerGrant(ctx, "audit:read");
          response = json(await auditReader.list(grant, url.searchParams));
        } else if (
          /^\/api\/v1\/owner\/churches\/[^/]+\/accounts(?:\/[^/]+(?:\/(?:permissions|status|temporary-passwords))?)?$/.test(
            path,
          )
        ) {
          const parts = path.split("/"),
            churchId = parts[5] as string,
            id = parts[7],
            action = parts[8];
          const method =
            action === "temporary-passwords"
              ? "POST"
              : action
                ? "PATCH"
                : id
                  ? "GET"
                  : req.method === "GET"
                    ? "GET"
                    : "POST";
          requireCondition(req.method === method, 405, "METHOD_NOT_ALLOWED");
          route =
            action === "temporary-passwords"
              ? "F21"
              : action === "permissions"
                ? "F18"
                : action === "status"
                  ? "F19"
                  : id
                    ? "F16"
                    : method === "GET"
                      ? "F15"
                      : "F17";
          const ctx = await identity.authorize(ownerToken, "owner", false, true);
          actorId = ctx.owner._id;
          const grant = identity.ownerGrant(ctx, "accounts:manage");
          targetChurchId = objectId(churchId);
          if (id) targetAccountId = objectId(id);
          let body: unknown;
          if (method !== "GET") {
            requireCondition(req.headers.get("origin") === conf.origin, 403, "CSRF_FAILED");
            await identity.csrfSession(ownerToken, "owner", req.headers.get("x-csrf-token"));
            body = await readJson(req);
          }
          if (route !== "F15") requireCondition(!url.search, 400, "INVALID_REQUEST");
          if (method === "GET") {
            const data = id
              ? await accounts.get(grant, churchId, id)
              : await accounts.list(grant, churchId, url.searchParams);
            if (id) headers.set("ETag", `"${(data as { version: number }).version}"`);
            response = json(data);
          } else {
            const key = req.headers.get("idempotency-key"),
              match = req.headers.get("if-match");
            const result =
              action === "permissions"
                ? await accounts.permissions(
                    grant,
                    churchId,
                    id as string,
                    body,
                    key,
                    match,
                    requestId,
                  )
                : action === "status"
                  ? await accounts.status(
                      grant,
                      churchId,
                      id as string,
                      body,
                      key,
                      match,
                      requestId,
                    )
                  : action === "temporary-passwords"
                    ? await accounts.reset(
                        ctx,
                        grant,
                        churchId,
                        id as string,
                        body,
                        key,
                        match,
                        requestId,
                      )
                    : await accounts.create(grant, churchId, body, key, requestId);
            headers.set("ETag", `"${(result.data.account as { version: number }).version}"`);
            response = json(result.data, result.status, { replayed: result.replayed });
          }
        } else if (/^\/api\/v1\/owner\/churches\/[^/]+\/context$/.test(path)) {
          route = "F24";
          requireCondition(req.method === "GET", 405, "METHOD_NOT_ALLOWED");
          requireCondition(!url.search, 400, "INVALID_REQUEST");
          const ctx = await identity.authorize(ownerToken, "owner", false, true);
          actorId = ctx.owner._id;
          identity.ownerGrant(ctx, "churches:manage");
          targetChurchId = objectId(path.split("/")[5] as string);
          const church = await access.byId(targetChurchId);
          requireCondition(church, 404, "NOT_FOUND");
          requireCondition(church.status === "active", 403, "CHURCH_SUSPENDED");
          response = json({
            church: {
              id: church.id.toHexString(),
              code: church.code,
              name: church.name,
              status: church.status,
            },
            principal: identity.me(ctx),
            policyVersion,
            capabilities: ["context:read", ...ownerCapabilities],
            availability: { business: "not_available" },
          });
        } else if (/^\/api\/v1\/churches\/[^/]+\/context$/.test(path)) {
          requestRealm = "church";
          route = "F09";
          requireCondition(req.method === "GET", 405, "METHOD_NOT_ALLOWED");
          requireCondition(!url.search, 400, "INVALID_REQUEST");
          const ctx = await churchIdentity.authorize(churchToken);
          actorId = ctx.account._id;
          actorChurchId = ctx.account.churchId;
          const id = objectId(path.split("/")[4] as string).toHexString();
          response = json(churchIdentity.context(ctx, id));
        } else if (path.startsWith("/api/v1/auth/")) {
          requestRealm = "church";
          const endpoint = path.slice("/api/v1/auth/".length);
          const registry: Record<string, { method: string; id: string }> = {
            login: { method: "POST", id: "F02" },
            me: { method: "GET", id: "F03" },
            logout: { method: "POST", id: "F04" },
            "change-initial-password": { method: "POST", id: "F05" },
            reauth: { method: "POST", id: "F06" },
            activity: { method: "POST", id: "F07" },
          };
          const spec = registry[endpoint];
          requireCondition(Object.hasOwn(registry, endpoint) && spec, 404, "NOT_FOUND");
          route = spec.id;
          requireCondition(req.method === spec.method, 405, "METHOD_NOT_ALLOWED");
          requireCondition(!url.search, 400, "INVALID_REQUEST");
          if (req.method === "POST")
            requireCondition(req.headers.get("origin") === conf.origin, 403, "CSRF_FAILED");
          const body = req.method === "POST" ? await readJson(req) : {};
          if (endpoint === "login") {
            const bootstrap = await identity.csrfSession(
              jar.get(cookieName("church", true)),
              "church",
              req.headers.get("x-csrf-token"),
            );
            const result = await churchIdentity.login(body, bootstrap, info.ip, requestId);
            setSession(result);
            clear("church", true);
            response = json({ sessionState: result.session.kind, csrfToken: result.csrfToken });
          } else {
            if (req.method === "POST")
              await identity.csrfSession(churchToken, "church", req.headers.get("x-csrf-token"));
            const ctx = await churchIdentity.authorize(
              churchToken,
              endpoint === "reauth" || endpoint === "logout",
            );
            actorId = ctx.account._id;
            actorChurchId = ctx.account.churchId;
            if (endpoint === "me") response = json(churchIdentity.me(ctx));
            else if (endpoint === "change-initial-password") {
              await churchIdentity.change(ctx, body, requestId);
              clear("church");
              response = new Response(null, { status: 204, headers });
            } else if (endpoint === "reauth") {
              const result = await churchIdentity.reauth(ctx, body, info.ip, requestId);
              setSession(result);
              response = json({ sessionState: result.session.kind, csrfToken: result.csrfToken });
            } else if (endpoint === "activity") {
              await churchIdentity.activity(ctx);
              response = new Response(null, { status: 204, headers });
            } else {
              await churchIdentity.logout(ctx, requestId);
              clear("church");
              response = new Response(null, { status: 204, headers });
            }
          }
        } else if (
          path === "/api/v1/owner/churches" ||
          /^\/api\/v1\/owner\/churches\/[^/]+(?:\/status)?$/.test(path) ||
          /^\/api\/v1\/owner\/operations\/[^/]+$/.test(path)
        ) {
          const parts = path.split("/"),
            operation = parts[4] === "operations",
            churchId = parts[5],
            status = parts[6] === "status";
          const allowed =
            operation || status
              ? [operation ? "GET" : "PATCH"]
              : churchId
                ? ["GET", "PATCH"]
                : ["GET", "POST"];
          requireCondition(allowed.includes(req.method), 405, "METHOD_NOT_ALLOWED");
          route = operation
            ? "F22"
            : status
              ? "F14"
              : churchId
                ? req.method === "GET"
                  ? "F12"
                  : "F13"
                : req.method === "GET"
                  ? "F10"
                  : "F11";
          const write = req.method !== "GET";
          let body: unknown;
          if (write) {
            requireCondition(req.headers.get("origin") === conf.origin, 403, "CSRF_FAILED");
            await identity.csrfSession(ownerToken, "owner", req.headers.get("x-csrf-token"));
            body = await readJson(req);
          }
          const ctx = await identity.authorize(ownerToken, "owner", false, true);
          actorId = ctx.owner._id;
          const grant = identity.ownerGrant(ctx, "churches:manage");
          if (route !== "F10") requireCondition(url.search === "", 400, "INVALID_REQUEST");
          if (operation) response = json(await operations.get(grant, churchId as string));
          else if (!write) {
            if (churchId) {
              const detail = await tenancy.get(grant, churchId);
              headers.set("ETag", `"${detail.version}"`);
              response = json(detail);
            } else response = json(await tenancy.list(grant, url.searchParams));
          } else {
            const key = req.headers.get("idempotency-key"),
              match = req.headers.get("if-match");
            const result = status
              ? await tenancy.status(grant, churchId as string, body, key, match, requestId)
              : churchId
                ? await tenancy.update(grant, churchId, body, key, match, requestId)
                : await tenancy.create(grant, body, key, requestId);
            const church = result.data.church as { version: number };
            headers.set("ETag", `"${church.version}"`);
            response = json(result.data, result.status, { replayed: result.replayed });
          }
        } else {
          const endpoint = path.replace("/api/v1/owner/auth/", "");
          const registry: Record<string, { method: string; id: string }> = {
            login: { method: "POST", id: "F25" },
            me: { method: "GET", id: "F26" },
            logout: { method: "POST", id: "F27" },
            "change-initial-password": { method: "POST", id: "F28" },
            reauth: { method: "POST", id: "F29" },
            activity: { method: "POST", id: "F30" },
          };
          const spec = registry[endpoint];
          requireCondition(
            path.startsWith("/api/v1/owner/auth/") && Object.hasOwn(registry, endpoint) && spec,
            404,
            "NOT_FOUND",
          );
          route = spec.id;
          requireCondition(req.method === spec.method, 405, "METHOD_NOT_ALLOWED");
          if (req.method === "POST") {
            requireCondition(req.headers.get("origin") === conf.origin, 403, "CSRF_FAILED");
          }
          const body = req.method === "POST" ? await readJson(req) : {};
          if (endpoint === "login") {
            const bootstrap = await identity.csrfSession(
              jar.get(cookieName("owner", true)),
              "owner",
              req.headers.get("x-csrf-token"),
            );
            const result = await identity.login(body, bootstrap, info.ip, requestId);
            setSession(result);
            clear("owner", true);
            response = json({ sessionState: result.session.kind, csrfToken: result.csrfToken });
          } else {
            if (req.method === "POST")
              await identity.csrfSession(ownerToken, "owner", req.headers.get("x-csrf-token"));
            const ctx = await identity.authorize(
              ownerToken,
              "owner",
              endpoint === "reauth" || endpoint === "logout",
            );
            actorId = ctx.owner._id;
            if (endpoint === "me") response = json(identity.me(ctx));
            else if (endpoint === "change-initial-password") {
              await identity.change(ctx, body, requestId);
              clear("owner");
              response = new Response(null, { status: 204, headers });
            } else if (endpoint === "reauth") {
              const result = await identity.reauth(ctx, body, info.ip, requestId);
              setSession(result);
              response = json({ sessionState: result.session.kind, csrfToken: result.csrfToken });
            } else if (endpoint === "activity") {
              await identity.activity(ctx);
              response = new Response(null, { status: 204, headers });
            } else {
              await identity.logout(ctx, requestId);
              clear("owner");
              response = new Response(null, { status: 204, headers });
            }
          }
        }
      } else {
        requireCondition(req.method === "GET" || req.method === "HEAD", 405, "METHOD_NOT_ALLOWED");
        const root = resolve(options.dist ?? "dist");
        const decoded = decodeURIComponent(path);
        const file = resolve(root, `.${decoded}`);
        requireCondition(file === root || file.startsWith(`${root}/`), 404, "NOT_FOUND");
        if (path.startsWith("/assets/")) {
          requireCondition(await Bun.file(file).exists(), 404, "NOT_FOUND");
          response = new Response(req.method === "HEAD" ? null : Bun.file(file), {
            headers: {
              ...Object.fromEntries(headers),
              "Content-Type": Bun.file(file).type,
              "Cache-Control": "public, max-age=31536000, immutable",
            },
          });
        } else {
          requireCondition(
            [
              "/",
              "/owner",
              "/owner/churches",
              "/owner/login",
              "/owner/change-password",
              "/owner/support",
            ].includes(path) ||
              /^\/owner\/churches\/[a-f0-9]{24}(?:\/(?:accounts|manage))?$/i.test(path) ||
              /^\/h\/[a-z0-9-]{1,100}(?:\/(?:login|change-password|support))?$/i.test(path),
            404,
            "NOT_FOUND",
          );
          requireCondition(
            await Bun.file(`${root}/index.html`).exists(),
            503,
            "DEPENDENCY_UNAVAILABLE",
          );
          response = new Response(req.method === "HEAD" ? null : Bun.file(`${root}/index.html`), {
            headers: { ...Object.fromEntries(headers), "Content-Type": "text/html; charset=utf-8" },
          });
        }
      }
    } catch (error) {
      let e = error instanceof AppError ? error : new AppError(503, "DEPENDENCY_UNAVAILABLE");
      if (e.status === 403) {
        try {
          if (requestRealm === "church" || targetChurchId)
            await identity.audit.principal(
              "authorization.denied",
              requestId,
              {
                kind: actorId ? (requestRealm === "church" ? "church_user" : "owner") : "anonymous",
                ...(actorId ? { id: actorId } : {}),
                churchId: actorChurchId,
              },
              {
                id: targetAccountId ?? (requestRealm === "church" ? actorId : undefined),
                churchId: requestRealm === "church" ? actorChurchId : targetChurchId,
              },
              [],
              undefined,
              undefined,
              "denied",
            );
          else
            await identity.audit.record(
              "authorization.denied",
              requestId,
              actorId,
              undefined,
              "denied",
            );
        } catch {
          e = new AppError(503, "DEPENDENCY_UNAVAILABLE");
        }
      }
      if (e.retryAfter) headers.set("Retry-After", String(e.retryAfter));
      response = Response.json(
        {
          error: {
            code: e.code,
            message: messages[e.code] ?? "Không thể thực hiện thao tác.",
            ...(e.fieldErrors ? { fieldErrors: e.fieldErrors } : {}),
            ...(e.resourceId ? { resourceId: e.resourceId } : {}),
          },
          meta: { requestId, ...(e.operationId ? { operationId: e.operationId } : {}) },
        },
        { status: e.status, headers },
      );
    }
    log({
      requestId,
      route,
      method: req.method,
      status: response.status,
      latencyMs: Math.round(performance.now() - started),
    });
    return response;
  };
}
