import type { Certificates } from "../api/certificates/service";
export type CertificateDraft = Awaited<ReturnType<Certificates["getDraft"]>>;
export type CertificateEdition = Awaited<ReturnType<Certificates["getEdition"]>>;
export type CertificatePreview = Awaited<ReturnType<Certificates["prepare"]>>;
export type CertificateList = Awaited<ReturnType<Certificates["list"]>>;
export type CertificateDraftList = Awaited<ReturnType<Certificates["draftList"]>>;
export type CertificateHistory = Awaited<ReturnType<Certificates["historyPage"]>>;
export const certificateNames = {
  baptism: "GCN Báp-têm",
  dedication: "GCN Dâng con",
  marriage: "Chứng thư Thành hôn",
  application: "Đơn xin chịu Báp-têm",
};
export const certificateStates = {
  issued: "Đã chốt bản",
  superseded: "Đã thay thế",
  revoked: "Đã thu hồi",
};
