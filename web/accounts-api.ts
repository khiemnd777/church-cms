import type { accountDto, Role, Scope } from "../api/identity/accounts-model";
import { type Intent, ownerRequest } from "./api";
export type AccountDto = ReturnType<typeof accountDto>;
export type { Role, Scope };
export const roleLabels: Record<Role, string> = {
  pastor: "Mục sư",
  secretary: "Thư ký Ban Chấp sự",
  treasurer: "Thủ quỹ",
  ministry_lead: "Trưởng ban",
  member: "Tín hữu",
};
export const scopeLabel = (scope: Scope) =>
  scope.kind === "church"
    ? "Toàn Hội Thánh"
    : scope.kind === "self"
      ? "Của mình"
      : "Ban/Khu vực được giao";
export interface CredentialInfo {
  password: string;
  expiresAt: string;
  loginPath: string;
}
export interface AccountMutation {
  account: AccountDto;
  operationId: string;
  temporaryCredential?: CredentialInfo | null;
  credentialReplay?: string;
}
export interface AccountPage {
  items: AccountDto[];
  nextCursor: string | null;
}
export const accountList = (churchId: string, query: URLSearchParams, signal?: AbortSignal) =>
  ownerRequest<AccountPage>(`owner/churches/${churchId}/accounts?${query}`, { signal });
export const account = (churchId: string, id: string) =>
  ownerRequest<AccountDto>(`owner/churches/${churchId}/accounts/${id}`);
export const sendAccountIntent = (intent: Intent) =>
  ownerRequest<AccountMutation>(intent.path, {
    method: intent.method,
    body: intent.body,
    headers: {
      "Idempotency-Key": intent.key,
      ...(intent.version ? { "If-Match": `"${intent.version}"` } : {}),
    },
  });
export const accountOperation = (id: string) =>
  ownerRequest<{ operationId: string; safeResult: AccountMutation }>(`owner/operations/${id}`);
export interface ResumeReset {
  accountId: string;
  supportReference: string;
}
