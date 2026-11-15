import { ObjectId } from "mongodb";
import type { CareAlert } from "../api/care/models";
import type { AlertCommand, SignalCommand } from "../api/care/validation";
import type { Database } from "../api/infrastructure/database";
import { businessDay } from "../api/members/dates";
import { check, type SyntheticClient } from "./p2-fixtures";
import { p44Fixture } from "./p44-fixtures";
export const p45Fixture = (db: Database, owner: SyntheticClient, actor: string, count = 12) =>
  p44Fixture(db, owner, actor, count);
export const careRoot = (c: { id: string }, s: SyntheticClient) =>
  `${s.realm === "owner" ? "owner/" : ""}churches/${c.id}/care/suggestions`;
export const careCommon = { reason: null, preview: null, confirmed: false };
export const signalCreate = (
  id: string,
  kind: "illness" | "new_believer" | "bereavement" = "illness",
  fields: Partial<{ occurredOn: string; summary: string | null }> = {},
): SignalCommand => ({
  action: "create",
  target: { kind: kind === "bereavement" ? "family" : "member", id },
  kind,
  fields: { occurredOn: businessDay(), summary: "Nhu cầu synthetic", ...fields },
  ...careCommon,
});
export async function signalSave(
  s: SyntheticClient,
  c: { id: string },
  b: SignalCommand,
  id?: string,
  version?: number,
  key = crypto.randomUUID(),
) {
  const path = `${careRoot(c, s)}/signals${id ? `/${id}` : ""}`,
    p = await s.call(`${path}/preview`, b, { version });
  check(p.status === 200, `Care signal preview ${p.status} ${p.payload.error?.code ?? ""}`);
  const intent = { ...b, confirmed: true, preview: p.payload.data.context };
  return {
    ...(await s.call(path, intent, { method: id ? "PATCH" : "POST", version, key })),
    key,
    intent,
    preview: p.payload.data,
  };
}
export const careDecision = (
  existing: { id: string; version: number } | null = null,
): AlertCommand => ({
  action: "convert",
  mode: existing ? "link" : "create",
  caseId: existing?.id ?? null,
  caseVersion: existing?.version ?? null,
  fields: {
    description: "Thăm viếng theo nguồn synthetic",
    priority: "normal",
    plannedOn: null,
    assigneeId: null,
  },
  ...careCommon,
  reason: "Đã kiểm tra nguồn synthetic",
});
export async function alertSave(
  s: SyntheticClient,
  c: { id: string },
  id: string,
  version: number,
  b: AlertCommand,
  key = crypto.randomUUID(),
) {
  const path = `${careRoot(c, s)}/${id}`,
    p = await s.call(`${path}/preview`, b, { version });
  check(p.status === 200, `Care alert preview ${p.status} ${p.payload.error?.code ?? ""}`);
  const intent = { ...b, preview: p.payload.data.context, confirmed: true };
  return {
    ...(await s.call(path, intent, { method: "PATCH", version, key })),
    key,
    intent,
    preview: p.payload.data,
  };
}
export async function careScan(s: SyntheticClient, c: { id: string }, limit = 100) {
  let cursor: string | null = null,
    processed = 0,
    pages = 0;
  do {
    const r = await s.call(`${careRoot(c, s)}/evaluate`, { cursor, limit });
    check(r.status === 200, `Care evaluate ${r.status} ${r.payload.error?.code ?? ""}`);
    cursor = r.payload.data.nextCursor;
    processed += r.payload.data.processed;
    pages++;
    check(pages < 1000, "bounded scan");
  } while (cursor);
  return { processed, pages };
}
export async function careOpenAlert(
  db: Database,
  c: { id: string },
  id: string,
  kind: CareAlert["kind"] = "illness",
) {
  const r = await db.db.collection<CareAlert>("care_alerts").findOne({
    churchId: new ObjectId(c.id),
    targetId: new ObjectId(id),
    kind,
    episodeActive: true,
  });
  check(r, "active alert fixture");
  return { ...r, id: r._id.toHexString() };
}
