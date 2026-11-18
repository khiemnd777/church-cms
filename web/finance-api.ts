import type { fundDto, settingsDto } from "../api/finance/models";
import type { Finance } from "../api/finance/service";
import type { FinanceSettingsInput } from "../api/finance/validation";
export type FundDto = ReturnType<typeof fundDto>;
export type FinanceSettingsDto = ReturnType<typeof settingsDto>;
export type FinanceSettingsBody = FinanceSettingsInput;
export type FundPage = Awaited<ReturnType<Finance["list"]>>;
export type FinanceHistoryPage = Awaited<ReturnType<Finance["historyPage"]>>;
export type SettingsReply = Awaited<ReturnType<Finance["getSettings"]>>;
export const historyLabels: Record<string, string> = {
  initialized: "Thiết lập",
  configured: "Đổi cấu hình",
  created: "Thêm quỹ",
  renamed: "Đổi tên",
  status_changed: "Đổi trạng thái",
};
