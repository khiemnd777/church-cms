import { type ClientSession, type Filter, ObjectId } from "mongodb";
import type { TenantGrant } from "../authorization/tenant-grant";
import { requireCondition } from "../errors";
import { objectId } from "../http-validation";
import type { Database } from "../infrastructure/database";
import { searchName } from "../members/models";
import { escaped } from "../members/queries";
import { TenantQueries } from "../tenant-queries";
import type { VisitCase } from "./models";

const projection = {
  code: 1,
  state: 1,
  version: 1,
  targetKind: 1,
  targetId: 1,
  "targetSnapshot.name": 1,
  plannedOn: 1,
  "assigneeSnapshot.fullName": 1,
} as const;

const fields = (c: VisitCase) => ({
  id: c._id.toHexString(),
  code: c.code,
  target: { kind: c.targetKind, id: c.targetId.toHexString(), name: c.targetSnapshot.name },
  plannedOn: c.plannedOn,
  assignee: c.assigneeSnapshot?.fullName ?? null,
});

export class CertificateVisits {
  private query: TenantQueries;
  constructor(
    private db: Database,
    key: string,
    now: () => Date,
  ) {
    this.query = new TenantQueries(key, now, "certificate-visits");
  }
  private get cases() {
    return this.db.db.collection<VisitCase>("visitation_cases");
  }
  async options(g: TenantGrant, q: URLSearchParams) {
    this.query.allow(q, ["q", "cursor", "limit"]);
    const term = searchName(q.get("q") ?? ""),
      limit = this.query.limit(q);
    requireCondition(term.length <= 100, 400, "INVALID_REQUEST");
    const context = this.query.context(g, "open", term),
      cursor = q.get("cursor"),
      after = cursor ? this.query.decode(cursor, context) : null;
    const filter: Filter<VisitCase> = {
      churchId: g.churchId,
      state: "open",
      ...(after ? { _id: { $lt: objectId(after.id) } } : {}),
      ...(term
        ? {
            $or: [
              { targetNameKey: { $regex: `^${escaped(term)}` } },
              { code: { $regex: `^${escaped(term.toUpperCase())}` } },
            ],
          }
        : {}),
    };
    return this.db.readSnapshot(g.churchId.toHexString(), async (tx) => {
      await g.fence(tx);
      const rows = await this.cases
        .find(filter, { session: tx, projection, maxTimeMS: 3000 })
        .sort({ _id: -1 })
        .limit(limit + 1)
        .toArray();
      const more = rows.length > limit;
      if (more) rows.pop();
      const last = rows.at(-1);
      return {
        items: rows.map(fields),
        nextCursor: more && last ? this.query.encode(context, "", last._id.toHexString()) : null,
      };
    });
  }
  async read(g: TenantGrant, id: string, tx: ClientSession, fence: boolean) {
    const filter = { churchId: g.churchId, _id: new ObjectId(id) };
    const row = await this.cases.findOne(filter, { session: tx, projection });
    requireCondition(row, 404, "NOT_FOUND");
    requireCondition(row.state === "open", 422, "CERT_VISIT_NOT_OPEN");
    if (fence) {
      const result = await this.cases.updateOne(
        { ...filter, state: "open", version: row.version },
        { $inc: { writeFence: 1 } },
        { session: tx },
      );
      requireCondition(result.matchedCount, 412, "CERT_PREVIEW_STALE");
    }
    return { ...fields(row), version: row.version };
  }
}
