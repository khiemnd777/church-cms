import type { Programs } from "../api/programs/service";
export type Program = Awaited<ReturnType<Programs["get"]>>;
export type ProgramPage = Awaited<ReturnType<Programs["list"]>>;
export type ProgramPreview = Awaited<ReturnType<Programs["preview"]>>;
export type ProgramEditions = Awaited<ReturnType<Programs["editionsPage"]>>;
export type ProgramHistory = Awaited<ReturnType<Programs["historyPage"]>>;
export type ProgramUnits = Awaited<ReturnType<Programs["units"]>>;
export type ProgramOccurrences = Awaited<ReturnType<Programs["occurrences"]>>;
export type ProgramPeople = Awaited<ReturnType<Programs["people"]>>;
export const programEvents = {
  create: "Tạo bản nháp",
  save: "Lưu bản nháp",
  regenerate: "Sinh lại bản nháp",
  amend: "Tạo nháp đính chính",
  finalize: "Chốt phiên bản",
};
