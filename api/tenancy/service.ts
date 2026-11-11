import { randomBytes } from "node:crypto";
import { type ClientSession, type Filter, MongoServerError, ObjectId } from "mongodb";
import type { Audit } from "../audit/service";
import type { OwnerGrant } from "../authorization/owner-grant";
import { requireCondition } from "../errors";
import type { Database } from "../infrastructure/database";
import type { Operations } from "../operations/service";
import type { ChurchAccess, ChurchAccessInfo } from "./access";
import { Cursors } from "./cursor";
import {
  type Church,
  type ChurchPage,
  type ChurchSummary,
  type Counters,
  churchDto,
} from "./models";
import { createChurch, objectId, parse, statusChurch, updateChurch, version } from "./validation";

const escaped = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const code = () =>
  `HT-${Array.from(randomBytes(10), (b) => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[b & 31]).join("")}`;
export class Tenancy {
  private cursors: Cursors;
  constructor(
    private db: Database,
    private operations: Operations,
    private audit: Audit,
    private counts: (ids: ObjectId[]) => Promise<Map<string, number>>,
    key: string,
    private revokeChurchSessions: (id: ObjectId, tx: ClientSession) => Promise<void>,
    private now: () => Date = () => new Date(),
  ) {
    this.cursors = new Cursors(key, now);
  }
  private get churches() {
    return this.db.db.collection<Church>("churches");
  }
  access(): ChurchAccess {
    const dto = (c: Church): ChurchAccessInfo => ({
      id: c._id,
      code: c.code,
      name: c.name,
      status: c.status,
      version: c.version,
    });
    return {
      byCode: async (code) => {
        const c = await this.churches.findOne({ code });
        return c ? dto(c) : null;
      },
      byId: async (id) => {
        const c = await this.churches.findOne({ _id: id });
        return c ? dto(c) : null;
      },
      fence: async (id, tx, activeOnly) => {
        const changed = await this.churches.updateOne(
          { _id: id, ...(activeOnly ? { status: "active" as const } : {}) },
          { $inc: { writeFence: 1 } },
          { session: tx },
        );
        requireCondition(
          changed.matchedCount,
          activeOnly ? 403 : 404,
          activeOnly ? "CHURCH_SUSPENDED" : "NOT_FOUND",
        );
      },
    };
  }
  private async enrich(churches: Church[]): Promise<ChurchSummary[]> {
    const counts = await this.counts(churches.map((c) => c._id));
    return churches.map((c) => ({
      ...churchDto(c),
      counters: {
        accounts: { value: counts.get(c._id.toHexString()) ?? 0, availability: "available" },
        ...Object.fromEntries(
          ["members", "families", "ministries", "areas"].map((k) => [
            k,
            { value: null, availability: "not_available" },
          ]),
        ),
      } as Counters,
    }));
  }
  async list(grant: OwnerGrant, params: URLSearchParams): Promise<ChurchPage> {
    for (const key of params.keys())
      requireCondition(
        ["q", "status", "limit", "cursor"].includes(key) && params.getAll(key).length === 1,
        400,
        "INVALID_REQUEST",
      );
    const q = (params.get("q") ?? "").trim().toLowerCase(),
      status = params.get("status") ?? undefined,
      limitText = params.get("limit") ?? "25";
    requireCondition(
      [...q].length <= 100 &&
        (!status || ["active", "suspended"].includes(status)) &&
        /^[1-9]\d{0,2}$/.test(limitText) &&
        Number(limitText) <= 100,
      400,
      "INVALID_REQUEST",
    );
    const limit = Number(limitText);
    const filterHash = this.cursors.filters(q, status),
      encoded = params.get("cursor");
    const after = encoded
      ? this.cursors.decode(encoded, grant.actorId.toHexString(), filterHash)
      : null;
    const statusFilter: Filter<Church> = status ? { status: status as Church["status"] } : {};
    const exact: Filter<Church> = {
      $or: [
        { code: q.toUpperCase() },
        { "contact.email": { $regex: `^${escaped(q)}$`, $options: "i" } },
      ],
    };
    const mode =
      after?.mode ??
      (!q
        ? "all"
        : (await this.churches.findOne({ $and: [statusFilter, exact] }, { projection: { _id: 1 } }))
          ? "exact"
          : "prefix");
    const search: Filter<Church> =
      mode === "all"
        ? {}
        : mode === "exact"
          ? exact
          : {
              $or: [
                { nameKey: { $regex: `^${escaped(q)}` } },
                { province: { $regex: `^${escaped(q)}`, $options: "i" } },
                { district: { $regex: `^${escaped(q)}`, $options: "i" } },
                { "contact.email": { $regex: `^${escaped(q)}`, $options: "i" } },
              ],
            };
    const keyset: Filter<Church> = after
      ? {
          $or: [
            { nameKey: { $gt: after.lastName } },
            { nameKey: after.lastName, _id: { $gt: new ObjectId(after.lastId) } },
          ],
        }
      : {};
    const rows = await this.churches
      .find({ $and: [statusFilter, search, keyset] })
      .sort({ nameKey: 1, _id: 1 })
      .limit(limit + 1)
      .maxTimeMS(3000)
      .toArray();
    const page = rows.slice(0, limit),
      last = page.at(-1);
    return {
      items: await this.enrich(page),
      nextCursor:
        rows.length > limit && last
          ? this.cursors.encode({
              actor: grant.actorId.toHexString(),
              filterHash,
              mode,
              lastName: last.nameKey,
              lastId: last._id.toHexString(),
            })
          : null,
    };
  }
  async get(_grant: OwnerGrant, id: string) {
    const church = await this.churches.findOne({ _id: objectId(id) });
    requireCondition(church, 404, "NOT_FOUND");
    return (await this.enrich([church]))[0] as ChurchSummary;
  }
  async create(grant: OwnerGrant, body: unknown, key: string | null, requestId: string) {
    const input = parse(createChurch, body),
      id = new ObjectId();
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.operations.execute(
          grant,
          "POST",
          "/owner/churches",
          key,
          input,
          null,
          async (tx, opId) => {
            const now = this.now(),
              church: Church = {
                _id: id,
                code: code(),
                name: input.name,
                nameKey: input.name.toLowerCase(),
                province: input.province,
                ...(input.district != null ? { district: input.district } : {}),
                ...(input.address != null ? { address: input.address } : {}),
                ...(input.contact != null ? { contact: input.contact } : {}),
                status: "active",
                version: 1,
                writeFence: 0,
                createdAt: now,
                updatedAt: now,
                createdBy: grant.actorId,
                updatedBy: grant.actorId,
              };
            await this.churches.insertOne(church, { session: tx });
            await this.audit.church(
              "church.created",
              requestId,
              grant.actorId,
              id,
              opId,
              ["name", "province", "district", "address", "contact"],
              tx,
            );
            return {
              safeResult: { church: churchDto(church) },
              resourceRefs: [{ type: "church", id: id.toHexString() }],
            };
          },
          201,
        );
      } catch (error) {
        if (
          error instanceof MongoServerError &&
          error.code === 11000 &&
          error.keyPattern?.code &&
          attempt < 2
        )
          continue;
        throw error;
      }
    }
    throw new Error("Code allocation failed");
  }
  async update(
    grant: OwnerGrant,
    id: string,
    body: unknown,
    key: string | null,
    ifMatch: string | null,
    requestId: string,
  ) {
    const input = parse(updateChurch, body),
      churchId = objectId(id),
      expected = version(ifMatch);
    return this.operations.execute(
      grant,
      "PATCH",
      `/owner/churches/${churchId}`,
      key,
      input,
      expected,
      async (tx, opId) => {
        const set: Record<string, unknown> = { updatedAt: this.now(), updatedBy: grant.actorId },
          unset: Record<string, ""> = {};
        for (const [field, value] of Object.entries(input)) {
          if (field === "contact" && value !== null && typeof value === "object") {
            for (const [key, nested] of Object.entries(value))
              if (nested === null) unset[`contact.${key}`] = "";
              else if (nested !== undefined) set[`contact.${key}`] = nested;
          } else if (value === null) unset[field] = "";
          else if (value !== undefined) set[field] = value;
        }
        if (input.name !== undefined) set.nameKey = input.name.toLowerCase();
        const church = await this.churches.findOneAndUpdate(
          { _id: churchId, version: expected },
          {
            $set: set,
            $inc: { version: 1, writeFence: 1 },
            ...(Object.keys(unset).length ? { $unset: unset } : {}),
          },
          { session: tx, returnDocument: "after" },
        );
        if (!church) await this.missingOrConflict(churchId, tx);
        requireCondition(church, 412, "VERSION_CONFLICT");
        await this.audit.church(
          "church.updated",
          requestId,
          grant.actorId,
          churchId,
          opId,
          Object.keys(input),
          tx,
        );
        return {
          safeResult: { church: churchDto(church) },
          resourceRefs: [{ type: "church", id: churchId.toHexString() }],
        };
      },
    );
  }
  async status(
    grant: OwnerGrant,
    id: string,
    body: unknown,
    key: string | null,
    ifMatch: string | null,
    requestId: string,
  ) {
    const input = parse(statusChurch, body),
      churchId = objectId(id),
      expected = version(ifMatch);
    return this.operations.execute(
      grant,
      "PATCH",
      `/owner/churches/${churchId}/status`,
      key,
      input,
      expected,
      async (tx, opId) => {
        const current = await this.churches.findOne({ _id: churchId }, { session: tx });
        requireCondition(current, 404, "NOT_FOUND");
        requireCondition(current.version === expected, 412, "VERSION_CONFLICT");
        let church = current;
        if (current.status !== input.status) {
          const updated = await this.churches.findOneAndUpdate(
            { _id: churchId, version: expected },
            {
              $set: { status: input.status, updatedAt: this.now(), updatedBy: grant.actorId },
              $inc: { version: 1, writeFence: 1 },
            },
            { session: tx, returnDocument: "after" },
          );
          requireCondition(updated, 412, "VERSION_CONFLICT");
          church = updated;
          if (input.status === "suspended") await this.revokeChurchSessions(churchId, tx);
          await this.audit.church(
            "church.status_changed",
            requestId,
            grant.actorId,
            churchId,
            opId,
            ["status"],
            tx,
            `${input.status}: ${input.reason}`,
          );
        }
        return {
          safeResult: { church: churchDto(church) },
          resourceRefs: [{ type: "church", id: churchId.toHexString() }],
        };
      },
    );
  }
  private async missingOrConflict(id: ObjectId, tx: ClientSession) {
    requireCondition(
      await this.churches.findOne({ _id: id }, { session: tx, projection: { _id: 1 } }),
      404,
      "NOT_FOUND",
    );
  }
}
