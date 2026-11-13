import { useEffect, useRef, useState } from "react";
import { ApiError, churchRequest, type Intent, ownerRequest } from "./api";
export type TenantRealm = "owner" | "church";
export interface TenantIntent extends Intent {
  churchId: string;
  realm: TenantRealm;
  principalKey: string;
  resource?: { kind: "member_card"; memberId: string };
  upload?: { file: File; format: "csv" | "xlsx"; source: string };
}
export const authErrorCodes = [
  "REAUTH_REQUIRED",
  "SESSION_EXPIRED",
  "SESSION_REVOKED",
  "PASSWORD_CHANGE_REQUIRED",
];
const uncertain = [
  "NETWORK_ERROR",
  "OUTCOME_UNKNOWN",
  "DEPENDENCY_UNAVAILABLE",
  "OPERATION_IN_PROGRESS",
];
export const tenantRequest = <T>(
  realm: TenantRealm,
  path: string,
  options?: Parameters<typeof ownerRequest>[1],
) => (realm === "owner" ? ownerRequest<T> : churchRequest<T>)(path, options);
export function useTenantMutation({
  realm,
  churchId,
  principalKey,
  canWrite,
  pending,
  onPending,
  onAuthError,
  operationPath,
  prefix,
  acceptPath,
  intentResource,
  onSuccess,
}: {
  realm: TenantRealm;
  churchId: string;
  principalKey: string;
  canWrite: boolean;
  pending: TenantIntent | null;
  onPending: (intent: TenantIntent | null) => void;
  onAuthError: (error: unknown) => void;
  operationPath: string;
  prefix: string;
  acceptPath?: (path: string) => boolean;
  intentResource?: TenantIntent["resource"];
  onSuccess: (data: unknown) => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [fields, setFields] = useState<Record<string, string>>({});
  const guard = useRef(false),
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  function fail(e: unknown) {
    if (e instanceof ApiError) {
      if (authErrorCodes.includes(e.code)) {
        onAuthError(e);
        return;
      }
      setFields(e.fieldErrors ?? {});
      setError(e.message);
    } else setError("Không thể kết nối. Vui lòng thử tải lại.");
  }
  async function execute(intent: TenantIntent, checking = false) {
    if (guard.current) return;
    if (
      !canWrite ||
      intent.realm !== realm ||
      intent.churchId !== churchId ||
      intent.principalKey !== principalKey ||
      !(acceptPath
        ? acceptPath(intent.path)
        : intent.path === prefix || intent.path.startsWith(`${prefix}/`))
    ) {
      setError(
        "Phiên hoặc quyền hiện tại không khớp người đã tạo thao tác. Đối soát trước khi tiếp tục.",
      );
      return;
    }
    guard.current = true;
    setBusy(true);
    setError("");
    setFields({});
    setNotice("");
    onPending(intent);
    function finish(data: unknown) {
      if (!mounted.current) return;
      onPending(null);
      setFields({});
      setNotice("Đã lưu.");
      onSuccess(data);
    }
    try {
      if (Date.now() - intent.createdAt >= 24 * 60 * 60_000)
        throw new ApiError(
          "IDEMPOTENCY_EXPIRED",
          "Đã quá thời hạn thử lại. Đối soát danh sách trước thao tác mới.",
        );
      if (checking && intent.operationId) {
        try {
          const r = await tenantRequest<{ safeResult: unknown }>(
            realm,
            `${operationPath}/${intent.operationId}`,
          );
          finish(r.data.safeResult);
          return;
        } catch (e) {
          if (!(e instanceof ApiError && e.code === "NOT_FOUND")) throw e;
        }
      }
      const r = await tenantRequest(realm, intent.path, {
        method: intent.method,
        body: intent.body,
        ...(intent.upload ? { rawBody: intent.upload.file } : {}),
        headers: {
          "Idempotency-Key": intent.key,
          ...(intent.upload
            ? {
                "X-File-Format": intent.upload.format,
                "X-Import-Source": encodeURIComponent(intent.upload.source),
              }
            : {}),
          ...(intent.version ? { "If-Match": `"${intent.version}"` } : {}),
        },
      });
      finish(r.data);
    } catch (e) {
      if (
        e instanceof ApiError &&
        (checking || uncertain.includes(e.code) || authErrorCodes.includes(e.code))
      )
        onPending({ ...intent, ...(e.operationId ? { operationId: e.operationId } : {}) });
      else onPending(null);
      if (mounted.current) fail(e);
    } finally {
      guard.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  function send(path: string, method: "POST" | "PATCH", body: object, version?: number) {
    if (!canWrite || pending || guard.current) return;
    void execute({
      realm,
      churchId,
      principalKey,
      path,
      method,
      body,
      key: crypto.randomUUID(),
      version,
      createdAt: Date.now(),
      ...(intentResource ? { resource: intentResource } : {}),
    });
  }
  return {
    busy,
    setBusy,
    error,
    setError,
    notice,
    setNotice,
    fields,
    setFields,
    fail,
    execute,
    send,
  };
}
