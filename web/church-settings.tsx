import { useEffect, useState } from "react";
import type { ChurchRef } from "./access-context";
import { ApiError } from "./api";
import { FinanceConfiguration } from "./finance";
import { OrganizationManagement } from "./organization-management";
import {
  authErrorCodes,
  type TenantIntent,
  type TenantRealm,
  tenantRequest,
} from "./tenant-mutation";
import { Button, Feedback, Loading } from "./ui/components";
export interface SettingsContext {
  church: ChurchRef;
  capabilities: string[];
  policyVersion: number;
  principal: {
    principalKind: "owner" | "church_user";
    accountId?: string;
    employeeId?: string;
    version?: number;
  };
}
export function ChurchSettingsView(props: {
  realm: TenantRealm;
  churchId: string;
  pending: TenantIntent | null;
  onPending: (p: TenantIntent | null) => void;
  onAuthError: (e: unknown) => void;
  onTitle: (title: string, context?: string) => void;
  onChurch?: (c: ChurchRef) => void;
  onBack?: () => void;
}) {
  const [ctx, setCtx] = useState<SettingsContext | null>(null),
    [error, setError] = useState(""),
    [reload, setReload] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    setCtx(null);
    setError("");
    void tenantRequest<SettingsContext>(
      props.realm,
      `${props.realm === "owner" ? "owner/" : ""}churches/${props.churchId}/context`,
      { signal: abort.signal },
    )
      .then((r) => {
        if (abort.signal.aborted) return;
        setCtx(r.data);
        props.onTitle("Cấu hình Hội Thánh", `${r.data.church.name} · ${r.data.church.code}`);
        props.onChurch?.(r.data.church);
      })
      .catch((e) => {
        if (abort.signal.aborted) return;
        if (
          e instanceof ApiError &&
          [...authErrorCodes, "CHURCH_SUSPENDED", "FORBIDDEN"].includes(e.code)
        )
          props.onAuthError(e);
        setError(e instanceof Error ? e.message : "Không tải được cấu hình.");
      });
    return () => abort.abort();
  }, [props.realm, props.churchId, reload]);
  return (
    <>
      {error && (
        <>
          <Feedback tone="error">{error}</Feedback>
          <Button onClick={() => setReload((n) => n + 1)}>Tải lại</Button>
        </>
      )}
      {!ctx && !error && <Loading />}
      {ctx?.capabilities.includes("organization:read") && <OrganizationManagement {...props} />}
      {ctx && props.realm === "church" && ctx.capabilities.includes("finance:funds:read") && (
        <FinanceConfiguration {...props} context={ctx} />
      )}
      {ctx &&
        !ctx.capabilities.includes("organization:read") &&
        !ctx.capabilities.includes("finance:funds:read") && (
          <Feedback>Không có quyền xem cấu hình.</Feedback>
        )}
    </>
  );
}
