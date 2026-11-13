import { useEffect, useState } from "react";
import { type Role, roleLabels, type Scope, scopeLabel } from "./accounts-api";
import { ApiError, churchRequest, ownerRequest } from "./api";
import { Button, Card, Feedback, KeyValueList, Loading, SectionHeader } from "./ui/components";
export interface ChurchRef {
  id: string;
  name: string;
  code: string;
  status: "active" | "suspended";
}
interface AccessContext {
  church: ChurchRef;
  principal: {
    principalKind: "owner" | "church_user";
    displayName: string;
    email: string;
    role?: Role;
    scope?: Scope;
  };
  policyVersion: number;
  capabilities: string[];
  subjectLinked?: boolean;
}
export function AccessContextView({
  realm,
  churchId,
  onTitle,
  onAuthError,
  onChurch,
  onBack,
}: {
  realm: "owner" | "church";
  churchId: string;
  onTitle: (title: string, context?: string) => void;
  onAuthError: (e: unknown) => void;
  onChurch?: (church: ChurchRef) => void;
  onBack?: () => void;
}) {
  const [value, setValue] = useState<AccessContext | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setValue(null);
    setError("");
    const load = realm === "owner" ? ownerRequest : churchRequest;
    void load<AccessContext>(`${realm === "owner" ? "owner/" : ""}churches/${churchId}/context`, {
      signal: controller.signal,
    })
      .then((r) => {
        if (controller.signal.aborted) return;
        setValue(r.data);
        onTitle("Thông tin truy cập", `${r.data.church.name} · ${r.data.church.code}`);
        onChurch?.(r.data.church);
      })
      .catch((e) => {
        if (controller.signal.aborted) return;
        if (
          e instanceof ApiError &&
          [
            "SESSION_EXPIRED",
            "SESSION_REVOKED",
            "REAUTH_REQUIRED",
            "PASSWORD_CHANGE_REQUIRED",
          ].includes(e.code)
        )
          onAuthError(e);
        else setError(e instanceof Error ? e.message : "Không tải được thông tin.");
      });
    return () => controller.abort();
  }, [realm, churchId]);
  return (
    <>
      {onBack && (
        <Button variant="link" onClick={onBack}>
          ← Chi tiết Hội Thánh
        </Button>
      )}
      {error && <Feedback tone="error">{error}</Feedback>}
      {!value && !error && <Loading />}
      {value && (
        <>
          <Card>
            <SectionHeader title="Thông tin truy cập" />
            <KeyValueList
              items={[
                { label: "Hội Thánh", value: value.church.name },
                { label: "Mã Hội Thánh", value: value.church.code },
                { label: "Họ tên", value: value.principal.displayName },
                { label: "Email", value: value.principal.email },
                {
                  label: "Vai trò",
                  value:
                    value.principal.principalKind === "owner"
                      ? "Quản trị nhà cung cấp"
                      : roleLabels[value.principal.role as Role],
                },
                {
                  label: "Phạm vi",
                  value: value.principal.scope
                    ? scopeLabel(value.principal.scope)
                    : "Hội Thánh đang xem",
                },
                ...(value.principal.role === "member"
                  ? [
                      {
                        label: "Hồ sơ thuộc viên",
                        value: value.subjectLinked ? "Đã liên kết" : "Chưa liên kết",
                      },
                    ]
                  : []),
              ]}
            />
          </Card>
          <Feedback>
            {value.capabilities.includes("attendance:read")
              ? "Điểm danh tay và quét QR đã khả dụng trong menu theo quyền hiện tại. Camera cần quyền truy cập trên thiết bị."
              : value.capabilities.includes("organization:read")
                ? "Cấu hình và hồ sơ thuộc viên Hội Thánh đã khả dụng trong menu. Các chức năng nghiệp vụ khác chưa khả dụng."
                : "Chức năng nghiệp vụ chưa khả dụng."}
          </Feedback>
        </>
      )}
    </>
  );
}
