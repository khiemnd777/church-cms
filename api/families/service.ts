import { type ClientSession, type Document, type Filter, ObjectId } from "mongodb";
import type { Audit } from "../audit/service";
import type { TenantGrant } from "../authorization/tenant-grant";
import { requireCondition } from "../errors";
import type { Database } from "../infrastructure/database";
import { businessDay } from "../members/dates";
import { resourceCode } from "../resource-code";
import { type Family, type FamilyHistory, familySnapshot, type LinkChange } from "./models";
import type { FamilyInput } from "./validation";

export type { Family } from "./models";
export class Families {
  constructor(
    private db: Database,
    private now: () => Date,
    private audit: Audit,
  ) {}
  private get rows() {
    return this.db.db.collection<Family>("families");
  }
  async get(churchId: ObjectId, id: ObjectId, tx?: ClientSession) {
    const row = await this.rows.findOne({ _id: id, churchId }, { session: tx });
    requireCondition(row, 404, "FAMILY_NOT_FOUND");
    return row;
  }
  active(f: Family) {
    requireCondition(f.status === "active", 409, "FAMILY_MERGED");
  }
  async create(g: TenantGrant, areaId: ObjectId | null, tx: ClientSession, meta?: FamilyInput) {
    const now = this.now(),
      f: Family = {
        _id: new ObjectId(),
        churchId: g.churchId,
        code: resourceCode("GD"),
        areaId,
        name: meta?.name ?? null,
        address: meta?.address ?? null,
        notes: meta?.notes ?? null,
        sinceYear: meta?.sinceYear ?? null,
        status: "active",
        mergedIntoId: null,
        version: 1,
        writeFence: 0,
        createdAt: now,
        updatedAt: now,
        createdBy: g.actorId,
      };
    await this.rows.insertOne(f, { session: tx });
    return f;
  }
  async attach(g: TenantGrant, id: ObjectId, tx: ClientSession) {
    const before = await this.get(g.churchId, id, tx);
    this.active(before);
    const f = await this.rows.findOneAndUpdate(
      { _id: id, churchId: g.churchId, version: before.version, status: "active" },
      { $inc: { version: 1, writeFence: 1 }, $set: { updatedAt: this.now() } },
      { session: tx, returnDocument: "after" },
    );
    requireCondition(f, 412, "VERSION_CONFLICT");
    return f;
  }
  async replace(g: TenantGrant, before: Family, after: Family, tx: ClientSession) {
    const r = await this.rows.replaceOne(
      { _id: before._id, churchId: g.churchId, version: before.version, status: "active" },
      after,
      { session: tx },
    );
    requireCondition(r.matchedCount, 412, "VERSION_CONFLICT");
  }
  async record(
    g: TenantGrant,
    before: Family | null,
    after: Family,
    event: string,
    op: ObjectId,
    requestId: string,
    tx: ClientSession,
    changes: LinkChange[] = [],
    related: ObjectId[] = [],
    effectiveOn = businessDay(this.now()),
    reason: string | null = null,
  ) {
    const beforeState = before ? familySnapshot(before) : null,
      afterState = familySnapshot(after);
    await this.db.db.collection<FamilyHistory>("family_history").insertOne(
      {
        _id: new ObjectId(),
        churchId: g.churchId,
        familyId: after._id,
        event,
        operationId: op,
        version: after.version,
        effectiveOn,
        reason,
        actorId: g.actorId,
        actorKind: g.actorKind,
        occurredAt: this.now(),
        before: beforeState,
        after: afterState,
        relatedFamilyIds: related,
        changes,
      },
      { session: tx },
    );
    await this.audit.organization(
      `families.${event}`,
      requestId,
      { id: g.actorId, kind: g.actorKind, churchId: g.actorKind === "owner" ? null : g.churchId },
      g.churchId,
      "family",
      after._id,
      [
        ...Object.keys(afterState).filter(
          (key) =>
            key !== "version" &&
            JSON.stringify(beforeState?.[key as keyof typeof afterState]) !==
              JSON.stringify(afterState[key as keyof typeof afterState]),
        ),
        ...(changes.length ? ["members"] : []),
      ],
      op,
      tx,
    );
  }
  // Public read-model join, scoped to active households in the same church.
  overviewLookup(churchId: ObjectId): Document[] {
    return [
      {
        $lookup: {
          from: "families",
          let: { family: "$familyId" },
          pipeline: [
            { $match: { churchId, status: "active", $expr: { $eq: ["$_id", "$$family"] } } },
            { $project: { _id: 1, areaId: 1 } },
          ],
          as: "household",
        },
      },
    ];
  }
  async byCodes(churchId: ObjectId, codes: string[], tx: ClientSession) {
    requireCondition(codes.length <= 1000, 400, "INVALID_REQUEST");
    return this.rows.find({ churchId, code: { $in: codes } }, { session: tx }).toArray();
  }
  async byIds(churchId: ObjectId, ids: ObjectId[], tx?: ClientSession) {
    requireCondition(ids.length <= 100, 400, "INVALID_REQUEST");
    return this.rows.find({ churchId, _id: { $in: ids } }, { session: tx }).toArray();
  }
  async countInArea(churchId: ObjectId, areaId: ObjectId, tx: ClientSession) {
    return this.db.db
      .collection<Family>("families")
      .countDocuments({ churchId, areaId, status: "active" }, { session: tx });
  }
  memberAreaFilter(churchId: ObjectId, areaId: ObjectId): Document[] {
    return [
      {
        $lookup: {
          from: "families",
          let: { family: "$familyId" },
          pipeline: [
            { $match: { churchId, areaId, $expr: { $eq: ["$_id", "$$family"] } } },
            { $project: { _id: 1 } },
          ],
          as: "matchedFamily",
        },
      },
      { $match: { "matchedFamily.0": { $exists: true } } },
      { $unset: "matchedFamily" },
    ];
  }
  async page(churchId: ObjectId, filter: Filter<Family>, limit: number) {
    return this.rows
      .find({ ...filter, churchId, status: "active" })
      .sort({ code: 1, _id: 1 })
      .limit(limit)
      .toArray();
  }
  async cards(pipeline: Document[]) {
    return this.rows.aggregate<Family>(pipeline).toArray();
  }
  async history(churchId: ObjectId, filter: Document, limit: number) {
    return this.db.db
      .collection<FamilyHistory>("family_history")
      .find({ ...filter, churchId })
      .sort({ occurredAt: -1, _id: -1 })
      .limit(limit)
      .toArray();
  }
}
