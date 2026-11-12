import { type ClientSession, type Document, MongoServerError, ObjectId } from "mongodb";
import type { TenantGrant } from "../authorization/tenant-grant";
import { AppError, requireCondition } from "../errors";
import { idempotencyKey, objectId, parse, version } from "../http-validation";
import { businessDay } from "../members/dates";
import type { FamilyMembers } from "../members/families";
import { searchName } from "../members/models";
import { escaped } from "../members/queries";
import type { Operations } from "../operations/service";
import type { Organization } from "../organization/service";
import { TenantQueries } from "../tenant-queries";
import { type Family, familySnapshot } from "./models";
import type { Families } from "./service";
import {
  type FamilyCommand,
  type FamilyInput,
  familyCommand,
  familyCreate,
  familyPatch,
} from "./validation";
export class FamilyApplication {
  private query: TenantQueries;
  constructor(
    private repo: Families,
    private people: FamilyMembers,
    private ops: Operations,
    private org: Organization,
    key: string,
    private now: () => Date,
  ) {
    this.query = new TenantQueries(key, now, "families");
  }
  private dates(day: string, year?: number | null) {
    requireCondition(
      day <= businessDay(this.now()) &&
        (!year || year <= Number(businessDay(this.now()).slice(0, 4))),
      422,
      "VALIDATION_FAILED",
    );
  }
  private async metadata(g: TenantGrant, f: Family) {
    const area = f.areaId ? (await this.org.labels(g.churchId, [f.areaId]))[0] : null;
    return {
      ...familySnapshot(f),
      churchId: f.churchId.toHexString(),
      areaName: area?.name ?? null,
      areaStatus: area?.status ?? null,
      createdAt: f.createdAt.toISOString(),
      updatedAt: f.updatedAt.toISOString(),
    };
  }
  async get(g: TenantGrant, id: string) {
    const f = await this.repo.get(g.churchId, objectId(id)),
      sum = (await this.people.summary(g.churchId, [f._id]))[0];
    const into = f.mergedIntoId ? await this.repo.get(g.churchId, f.mergedIntoId) : null;
    return {
      ...(await this.metadata(g, f)),
      count: sum?.count ?? 0,
      head: sum?.head ?? null,
      mergedInto: into
        ? { id: into._id.toHexString(), code: into.code, status: into.status }
        : null,
    };
  }
  async list(g: TenantGrant, q: URLSearchParams) {
    this.query.allow(q, ["view", "q", "status", "areaId", "cursor", "limit"]);
    requireCondition(q.get("view") === "cards", 400, "INVALID_REQUEST");
    const limit = Number(q.get("limit") ?? 12),
      status = q.get("status") ?? "active",
      text = searchName(q.get("q") ?? "");
    requireCondition(
      /^\d+$/.test(q.get("limit") ?? "12") &&
        Number.isInteger(limit) &&
        limit > 0 &&
        limit <= 50 &&
        ["active", "merged", "all"].includes(status) &&
        text.length <= 100,
      400,
      "INVALID_REQUEST",
    );
    const filter: Document = {
      churchId: g.churchId,
      ...(status === "all" ? {} : { status }),
      ...(q.has("areaId") ? { areaId: objectId(q.get("areaId") as string) } : {}),
    };
    const stages: Document[] = [{ $match: filter }];
    if (text) {
      if (text.startsWith("gd-"))
        stages.push({ $match: { code: { $regex: `^${escaped(text.toUpperCase())}` } } });
      else
        stages.push(
          ...this.people.searchStages(g.churchId, text, [
            { name: { $regex: `^${escaped(text)}`, $options: "i" } },
          ]),
        );
    }
    const context = this.query.context(g, "cards", [text, status, q.get("areaId")]);
    if (q.has("cursor")) {
      const c = this.query.decode(q.get("cursor") as string, context);
      stages.push({
        $match: { $or: [{ code: { $gt: c.key } }, { code: c.key, _id: { $gt: objectId(c.id) } }] },
      });
    }
    stages.push({ $sort: { code: 1, _id: 1 } }, { $limit: limit + 1 });
    const rows = await this.repo.cards(stages),
      more = rows.length > limit;
    if (more) rows.pop();
    const sums = await this.people.summary(
        g.churchId,
        rows.map((f) => f._id),
      ),
      areas = await this.org.labels(
        g.churchId,
        rows.flatMap((f) => (f.areaId ? [f.areaId] : [])),
      ),
      last = rows.at(-1);
    return {
      items: rows.map((f) => ({
        ...familySnapshot(f),
        areaName: areas.find((a) => a.id === f.areaId?.toHexString())?.name ?? null,
        ...sums.find((s) => s.id === f._id.toHexString()),
      })),
      nextCursor:
        more && last ? this.query.encode(context, last.code, last._id.toHexString()) : null,
    };
  }
  async members(g: TenantGrant, id: string, q: URLSearchParams) {
    const f = await this.repo.get(g.churchId, objectId(id));
    return this.people.page(g, f._id, q);
  }
  async history(g: TenantGrant, id: string, q: URLSearchParams) {
    await this.repo.get(g.churchId, objectId(id));
    this.query.allow(q, ["limit", "cursor"]);
    const limit = this.query.limit(q),
      context = this.query.context(g, "history", id.toLowerCase()),
      filter: Document = { familyId: objectId(id) };
    if (q.has("cursor")) {
      const c = this.query.decode(q.get("cursor") as string, context),
        time = new Date(c.key);
      requireCondition(Number.isFinite(time.getTime()), 400, "INVALID_CURSOR");
      filter.$or = [
        { occurredAt: { $lt: time } },
        { occurredAt: time, _id: { $lt: objectId(c.id) } },
      ];
    }
    const rows = await this.repo.history(g.churchId, filter, limit + 1),
      more = rows.length > limit;
    if (more) rows.pop();
    const related = await this.repo.byIds(g.churchId, [
        ...new Map(
          rows.flatMap((r) => r.relatedFamilyIds).map((id) => [id.toHexString(), id]),
        ).values(),
      ]),
      last = rows.at(-1);
    return {
      items: rows.map((h) => ({
        id: h._id.toHexString(),
        event: h.event,
        operationId: h.operationId.toHexString(),
        version: h.version,
        effectiveOn: h.effectiveOn,
        reason: h.reason,
        actorKind: h.actorKind,
        actorId: h.actorId.toHexString(),
        occurredAt: h.occurredAt.toISOString(),
        before: h.before,
        after: h.after,
        changes: h.changes,
        related: h.relatedFamilyIds.flatMap((id) => {
          const f = related.find((f) => f._id.equals(id));
          return f ? [{ id: id.toHexString(), code: f.code }] : [];
        }),
      })),
      nextCursor:
        more && last
          ? this.query.encode(context, last.occurredAt.toISOString(), last._id.toHexString())
          : null,
    };
  }
  private result(f: Family) {
    return {
      safeResult: { family: { id: f._id.toHexString(), code: f.code, version: f.version } },
      resourceRefs: [{ type: "family", id: f._id.toHexString() }],
    };
  }
  async create(g: TenantGrant, raw: unknown, key: string | null, requestId: string) {
    requireCondition(g.canWrite, 403, "FORBIDDEN");
    const body = parse(familyCreate, raw);
    this.dates(businessDay(this.now()), body.sinceYear);
    return this.writeErrors(() =>
      this.ops.executeTenant(
        g,
        "POST",
        `families/${g.churchId}/families`,
        key,
        body,
        null,
        async (tx, op) => {
          await this.org.fenceArea(g.churchId, body.areaId ? objectId(body.areaId) : null, tx);
          const f = await this.repo.create(g, body.areaId ? objectId(body.areaId) : null, tx, body);
          await this.repo.record(g, null, f, "created", op, requestId, tx);
          return this.result(f);
        },
        201,
      ),
    );
  }
  async patch(
    g: TenantGrant,
    id: string,
    raw: unknown,
    key: string | null,
    match: string | null,
    requestId: string,
  ) {
    const body = parse(familyPatch, raw),
      expected = version(match);
    return this.writeErrors(() =>
      this.ops.executeTenant(
        g,
        "PATCH",
        `families/${g.churchId}/families/${id.toLowerCase()}`,
        key,
        body,
        expected,
        async (tx, op) => {
          const old = await this.source(g, id, expected, tx),
            f = {
              ...old,
              version: old.version + 1,
              writeFence: old.writeFence + 1,
              updatedAt: this.now(),
            };
          for (const k of ["name", "address", "notes", "sinceYear"] as const)
            if (body[k] !== undefined) Object.assign(f, { [k]: body[k] });
          const areaChanged =
            body.areaId !== undefined && body.areaId !== (old.areaId?.toHexString() ?? null);
          if (areaChanged) {
            requireCondition(body.reason && body.effectiveOn, 422, "FAMILY_REASON_REQUIRED");
            await this.org.fenceArea(g.churchId, body.areaId ? objectId(body.areaId) : null, tx);
            f.areaId = body.areaId ? objectId(body.areaId) : null;
          }
          this.dates(body.effectiveOn ?? businessDay(this.now()), f.sinceYear);
          await this.repo.replace(g, old, f, tx);
          await this.repo.record(
            g,
            old,
            f,
            areaChanged ? "area_changed" : "updated",
            op,
            requestId,
            tx,
            [],
            [],
            body.effectiveOn,
            body.reason ?? null,
          );
          return this.result(f);
        },
      ),
    );
  }
  private async source(g: TenantGrant, id: string, expected: number, tx?: ClientSession) {
    const f = await this.repo.get(g.churchId, objectId(id), tx);
    requireCondition(f.version === expected, 412, "VERSION_CONFLICT");
    this.repo.active(f);
    return f;
  }
  private async target(g: TenantGrant, source: Family, c: FamilyCommand, tx?: ClientSession) {
    if ("targetFamilyId" in c) {
      requireCondition(
        c.targetFamilyId.toLowerCase() !== source._id.toHexString(),
        422,
        "FAMILY_MEMBER_MISMATCH",
      );
      return this.source(g, c.targetFamilyId, c.targetVersion, tx);
    }
    return null;
  }
  private virtual(g: TenantGrant, input: FamilyInput): Family {
    return {
      _id: new ObjectId(),
      churchId: g.churchId,
      code: "Mã cấp khi lưu",
      ...input,
      areaId: input.areaId ? objectId(input.areaId) : null,
      status: "active",
      mergedIntoId: null,
      version: 1,
      writeFence: 0,
      createdAt: this.now(),
      updatedAt: this.now(),
      createdBy: g.actorId,
    };
  }
  private async areaAvailable(g: TenantGrant, id: ObjectId | null) {
    if (!id) return;
    const area = (await this.org.labels(g.churchId, [id]))[0];
    requireCondition(area?.kind === "area" && area.status === "active", 422, "UNIT_NOT_AVAILABLE");
  }
  async preview(g: TenantGrant, id: string, raw: unknown, match: string | null) {
    requireCondition(g.canWrite, 403, "FORBIDDEN");
    const c = parse(familyCommand, raw);
    this.dates(c.effectiveOn, "newFamily" in c ? c.newFamily.sinceYear : null);
    const s = await this.source(g, id, version(match)),
      t = c.kind === "split" ? this.virtual(g, c.newFamily) : await this.target(g, s, c);
    if (c.kind === "area") {
      await this.areaAvailable(g, c.areaId ? objectId(c.areaId) : null);
      const sum = (await this.people.summary(g.churchId, [s._id]))[0];
      return {
        kind: c.kind,
        source: await this.metadata(g, s),
        target: null,
        changes: [],
        sourceBefore: { count: sum?.count ?? 0, head: sum?.head?.fullName ?? null },
        targetBefore: null,
        sourceAfter: { count: sum?.count ?? 0, head: sum?.head?.fullName ?? null },
        targetAfter: null,
        areaAfter: c.areaId
          ? ((await this.org.labels(g.churchId, [objectId(c.areaId)]))[0]?.name ?? null)
          : null,
        command: c,
      };
    }
    if (t) await this.areaAvailable(g, t.areaId);
    const plan = await this.people.prepare(g, s, t, c);
    return {
      kind: c.kind,
      source: await this.metadata(g, s),
      target: t ? await this.metadata(g, t) : null,
      changes: plan.changes,
      sourceBefore: plan.sourceBefore,
      targetBefore: plan.targetBefore,
      sourceAfter: plan.source,
      targetAfter: plan.target,
      areaAfter: null,
      command: c,
    };
  }
  async command(
    g: TenantGrant,
    id: string,
    raw: unknown,
    kind: "roles" | "transfer" | "split" | "merge",
    key: string | null,
    match: string | null,
    requestId: string,
  ) {
    requireCondition(g.canWrite, 403, "FORBIDDEN");
    const c = parse(familyCommand, raw),
      expected = version(match);
    requireCondition(c.kind === kind, 422, "VALIDATION_FAILED");
    this.dates(c.effectiveOn, "newFamily" in c ? c.newFamily.sinceYear : null);
    idempotencyKey(key);
    return this.writeErrors(() =>
      this.ops.executeTenant(
        g,
        kind === "roles" ? "PATCH" : "POST",
        `families/${g.churchId}/families/${id.toLowerCase()}/${{ roles: "roles", transfer: "transfers", split: "splits", merge: "merges" }[kind]}`,
        key,
        c,
        expected,
        async (tx, op) => {
          const s = await this.source(g, id, expected, tx);
          let t = await this.target(g, s, c, tx);
          if (c.kind === "split")
            t = await this.repo.create(
              g,
              c.newFamily.areaId ? objectId(c.newFamily.areaId) : null,
              tx,
              c.newFamily,
            );
          if (t) await this.org.fenceArea(g.churchId, t.areaId, tx);
          const plan = await this.people.prepare(g, s, t, c, tx);
          await plan.apply(tx, op, requestId);
          const after: Family = {
            ...s,
            version: s.version + 1,
            writeFence: s.writeFence + 1,
            updatedAt: this.now(),
            ...(c.kind === "merge" ? { status: "merged", mergedIntoId: (t as Family)._id } : {}),
          };
          await this.repo.replace(g, s, after, tx);
          await this.repo.record(
            g,
            s,
            after,
            c.kind,
            op,
            requestId,
            tx,
            plan.links,
            t ? [t._id] : [],
            c.effectiveOn,
            c.reason,
          );
          if (t) {
            const targetAfter =
              c.kind === "split"
                ? t
                : {
                    ...t,
                    version: t.version + 1,
                    writeFence: t.writeFence + 1,
                    updatedAt: this.now(),
                  };
            if (c.kind !== "split") await this.repo.replace(g, t, targetAfter, tx);
            await this.repo.record(
              g,
              c.kind === "split" ? null : t,
              targetAfter,
              c.kind === "split" ? "split_created" : `${c.kind}_received`,
              op,
              requestId,
              tx,
              plan.links,
              [s._id],
              c.effectiveOn,
              c.reason,
            );
            return this.result(targetAfter);
          }
          return this.result(after);
        },
      ),
    );
  }
  private async writeErrors<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (e) {
      if (e instanceof MongoServerError && e.code === 11000) {
        if (e.keyPattern?.householdRole) throw new AppError(409, "FAMILY_HEAD_EXISTS");
        if (e.keyPattern?.code) throw new AppError(503, "DEPENDENCY_UNAVAILABLE");
      }
      throw e;
    }
  }
}
