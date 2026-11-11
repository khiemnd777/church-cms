export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public retryAfter?: number,
    public fieldErrors?: Record<string, string>,
    public operationId?: string,
    public resourceId?: string,
  ) {
    super(message);
  }
}
export interface ApiReply<T> {
  data: T;
  meta: { requestId: string; replayed?: boolean };
  etag: string | null;
}
export interface RequestOptions {
  method?: "GET" | "POST" | "PATCH";
  body?: object;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}
export interface Intent {
  path: string;
  method: "POST" | "PATCH";
  body: object;
  key: string;
  version?: number;
  createdAt: number;
  operationId?: string;
}
type Realm = "owner" | "church";
const tokens: Partial<Record<Realm, string>> = {};
async function request<T>(
  realm: Realm,
  path: string,
  options: RequestOptions = {},
): Promise<ApiReply<T>> {
  const method = options.method ?? "GET";
  if (method !== "GET" && !tokens[realm]) await refreshRealmCsrf(realm);
  let response: Response;
  try {
    response = await fetch(`/api/v1/${path}`, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      signal: options.signal,
      headers: {
        ...(method !== "GET"
          ? { "Content-Type": "application/json", "X-CSRF-Token": tokens[realm] as string }
          : {}),
        ...options.headers,
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
  } catch {
    throw new ApiError(
      "NETWORK_ERROR",
      "Không kết nối được. Giữ nguyên thao tác và kiểm tra kết quả trước khi thử lại.",
    );
  }
  if (response.status === 204)
    return {
      data: undefined as T,
      meta: { requestId: response.headers.get("x-request-id") ?? "" },
      etag: null,
    };
  let result: {
    data: T;
    meta: ApiReply<T>["meta"] & { operationId?: string };
    error?: {
      code: string;
      message: string;
      fieldErrors?: Record<string, string>;
      resourceId?: string;
    };
  };
  try {
    result = await response.json();
  } catch {
    throw new ApiError("NETWORK_ERROR", "Chưa đọc được kết quả. Kiểm tra trước khi thử lại.");
  }
  if (!response.ok)
    throw new ApiError(
      result.error?.code ?? "DEPENDENCY_UNAVAILABLE",
      result.error?.message ?? "Dịch vụ tạm thời không khả dụng.",
      Number(response.headers.get("retry-after") ?? 0),
      result.error?.fieldErrors,
      result.meta?.operationId,
      result.error?.resourceId,
    );
  return { data: result.data, meta: result.meta, etag: response.headers.get("etag") };
}
async function refreshRealmCsrf(realm: Realm) {
  const r = await request<{ csrfToken: string }>(realm, `auth/csrf?realm=${realm}`);
  tokens[realm] = r.data.csrfToken;
}
async function auth<T>(realm: Realm, path: string, body?: object): Promise<T> {
  const result = await request<T & { csrfToken?: string }>(
    realm,
    `${realm === "owner" ? "owner/auth" : "auth"}/${path}`,
    { method: body === undefined ? "GET" : "POST", body },
  );
  if (result.data?.csrfToken) tokens[realm] = result.data.csrfToken;
  if (path === "logout" || path === "change-initial-password") delete tokens[realm];
  return result.data as T;
}
export const ownerRequest = <T>(path: string, options?: RequestOptions) =>
  request<T>("owner", path, options);
export const churchRequest = <T>(path: string, options?: RequestOptions) =>
  request<T>("church", path, options);
export const refreshCsrf = () => refreshRealmCsrf("owner");
export const refreshChurchCsrf = () => refreshRealmCsrf("church");
export const api = <T>(path: string, body?: object) => auth<T>("owner", path, body);
export const churchAuth = <T>(path: string, body?: object) => auth<T>("church", path, body);
