import type { ChurchDto, ChurchPage, ChurchSummary } from "../api/tenancy/models";
import { ownerRequest } from "./api";
export type { ChurchDto, ChurchPage, ChurchSummary };
export interface ChurchInput {
  name: string;
  province: string;
  district?: string | null;
  address?: string | null;
  contact?: { name?: string | null; phone?: string | null; email?: string | null } | null;
}
export type { Intent } from "./api";

import type { Intent } from "./api";
export const churches = (
  q = "",
  status = "",
  cursor?: string,
  signal?: AbortSignal,
  limit = 25,
) => {
  const params = new URLSearchParams({ q, limit: String(limit) });
  if (status) params.set("status", status);
  if (cursor) params.set("cursor", cursor);
  return ownerRequest<ChurchPage>(`owner/churches?${params}`, { signal });
};
export const church = (id: string) =>
  ownerRequest<ChurchSummary>(`owner/churches/${encodeURIComponent(id)}`);
export async function sendIntent(intent: Intent) {
  return ownerRequest<{ church: ChurchDto; operationId: string }>(intent.path, {
    method: intent.method,
    body: intent.body,
    headers: {
      "Idempotency-Key": intent.key,
      ...(intent.version ? { "If-Match": `"${intent.version}"` } : {}),
    },
  });
}
export const operation = (id: string) =>
  ownerRequest<{ safeResult: { church: ChurchDto }; operationId: string }>(
    `owner/operations/${encodeURIComponent(id)}`,
  );
