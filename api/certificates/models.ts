import type { Binary, ObjectId } from "mongodb";
import type { TenantGrant } from "../authorization/tenant-grant";
import type { CertificateInput, CertificateKind } from "./validation";
export interface CertificateGrant extends TenantGrant {
  canManageCertificates: boolean;
}
export const templateVersion = "internal-r1";
export const watermark = "MẪU KIỂM THỬ — KHÔNG DÙNG THỰC TẾ";
export const titles = {
  baptism: "GIẤY CHỨNG NHẬN BÁP-TÊM",
  dedication: "GIẤY CHỨNG NHẬN DÂNG CON",
  marriage: "CHỨNG THƯ THÀNH HÔN",
  application: "ĐƠN XIN CHỊU BÁP-TÊM",
};
export interface Line {
  text: string;
  style: "header" | "title" | "name" | "body" | "small";
  gap: number;
}
export interface Signature {
  label: string;
  name: string | null;
}
export interface DocumentContent {
  reference: string;
  title: string;
  churchName: string;
  affiliation: string | null;
  paragraphs: Omit<Line, "gap">[];
  signatures: Signature[];
  issuedOn: string;
  kind: CertificateKind;
}
export interface DocumentPage {
  lines: Line[];
  signatures: Signature[];
}
export interface CertificateSnapshot {
  templateVersion: string;
  templateFingerprint: string;
  input: CertificateInput;
  content: DocumentContent;
  sources: Record<string, unknown>;
  supplements: Record<string, string>;
  missing: string[];
  conflicts: string[];
  differences: string[];
}
export interface Draft {
  _id: ObjectId;
  churchId: ObjectId;
  input: CertificateInput;
  previousEditionId: ObjectId | null;
  reason: string | null;
  version: number;
  state: "draft" | "issued";
  editionId: ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}
export interface Edition {
  _id: ObjectId;
  churchId: ObjectId;
  draftId: ObjectId;
  lineageId: ObjectId;
  revision: number;
  version: number;
  state: "issued" | "superseded" | "revoked";
  snapshot: CertificateSnapshot;
  pages: DocumentPage[];
  memberIds: ObjectId[];
  pdf: Binary;
  docx: Binary;
  pdfHash: string;
  docxHash: string;
  faithConfirmed: boolean;
  issuedAt: Date;
  actorId: ObjectId;
  actorKind: string;
}
export interface Preview {
  _id: ObjectId;
  churchId: ObjectId;
  draftId: ObjectId;
  draftVersion: number;
  actorId: ObjectId;
  actorKind: string;
  context: string;
  snapshot: CertificateSnapshot;
  pages: DocumentPage[];
  pdf: Binary;
  docx: Binary;
  pdfHash: string;
  docxHash: string;
  createdAt: Date;
  expiresAt: Date;
}
export interface CertificateHistory {
  _id: ObjectId;
  churchId: ObjectId;
  draftId: ObjectId;
  editionId: ObjectId | null;
  event: string;
  reason: string | null;
  actorId: ObjectId;
  actorKind: string;
  operationId: ObjectId;
  occurredAt: Date;
  before: Record<string, unknown> | null;
  after: Record<string, unknown>;
}
export const draftDto = (d: Draft) => ({
  id: d._id.toHexString(),
  input: d.input,
  previousEditionId: d.previousEditionId?.toHexString() ?? null,
  reason: d.reason,
  version: d.version,
  state: d.state,
  editionId: d.editionId?.toHexString() ?? null,
  updatedAt: d.updatedAt.toISOString(),
});
export const editionDto = (d: Edition) => ({
  id: d._id.toHexString(),
  draftId: d.draftId.toHexString(),
  lineageId: d.lineageId.toHexString(),
  revision: d.revision,
  version: d.version,
  state: d.state,
  snapshot: d.snapshot,
  pages: d.pages,
  pdfHash: d.pdfHash,
  docxHash: d.docxHash,
  issuedAt: d.issuedAt.toISOString(),
});
export const previewDto = (p: Preview) => ({
  id: p._id.toHexString(),
  draftId: p.draftId.toHexString(),
  draftVersion: p.draftVersion,
  context: p.context,
  snapshot: p.snapshot,
  pages: p.pages,
  pdfHash: p.pdfHash,
  docxHash: p.docxHash,
  expiresAt: p.expiresAt.toISOString(),
});

export const editionListDto = (d: Edition) => ({
  id: d._id.toHexString(),
  draftId: d.draftId.toHexString(),
  revision: d.revision,
  version: d.version,
  state: d.state,
  kind: d.snapshot.input.kind,
  names: d.snapshot.content.paragraphs.filter((p) => p.style === "name").map((p) => p.text),
  issuedAt: d.issuedAt.toISOString(),
});
