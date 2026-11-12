import type { ObjectId } from "mongodb";
import type {
  Decision,
  ExportColumn,
  FileFormat,
  ImportField,
  RowOutcome,
  SheetData,
} from "./contracts";
export interface SourceLink {
  _id: ObjectId;
  churchId: ObjectId;
  source: string;
  externalId: string;
  memberId: ObjectId;
  createdAt: Date;
  jobId: ObjectId;
  actorId: ObjectId;
  actorKind: "owner" | "church_user";
  action: "created" | "linked";
  reason: string | null;
  sourceDigest: string;
}
export interface ImportJob {
  _id: ObjectId;
  churchId: ObjectId;
  actorId: ObjectId;
  actorKind: "owner" | "church_user";
  source: string;
  format: FileFormat;
  digest: string;
  sheets: SheetData[];
  selectedSheet: string | null;
  mapping: Partial<Record<ImportField, string>>;
  decisions: Record<string, Decision>;
  state: "review" | "ready" | "partial" | "completed";
  version: number;
  nextBatch: number;
  outcomes: RowOutcome[];
  plan: {
    token: string;
    batches: number[][];
    fingerprints: Record<string, string>;
    context: string;
  } | null;
  counts: Record<string, number>;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
}
export interface ExportJob {
  _id: ObjectId;
  churchId: ObjectId;
  actorId: ObjectId;
  actorKind: "owner" | "church_user";
  format: FileFormat;
  columns: ExportColumn[];
  filters: Record<string, string>;
  rows: string[][];
  count: number;
  digest: string;
  bytes: Uint8Array;
  protectedCells: number;
  createdAt: Date;
  expiresAt: Date;
}
