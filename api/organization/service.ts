import { type ClientSession, type Filter, MongoServerError, ObjectId } from "mongodb";
import { z } from "zod";
import type { Audit } from "../audit/service";
import type { TenantGrant } from "../authorization/tenant-grant";
import { AppError, requireCondition } from "../errors";
import { idempotencyKey, objectId, parse, version } from "../http-validation";
import type { Scope } from "../identity/accounts-model";
import { digest, equal, sign } from "../identity/crypto";
import type { Database } from "../infrastructure/database";
import { ageOn, businessDay } from "../members/dates";
import type { Assignment } from "../members/models";
import type { Operations } from "../operations/service";
import type { OrganizationGrant } from "./grant";
import {
  ageBands,
  kinds,
  normalizeName,
  type Settings,
  settingsDto,
  type Unit,
  unitDto,
} from "./models";
import { createSettings, createUnit, statusUnit, updateSettings, updateUnit } from "./validation";

const cursorSchema = z.strictObject({
  context: z.string(),
  lastName: z.string().max(200),
  lastId: z.string().regex(/^[a-f0-9]{24}$/),
  expiresAt: z.number(),
});
export class Organization {
  constructor(
    private db: Database,
    private ops: Operations,
    private audit: Audit,
    private key: string,
    private now: () => Date = () => new Date(),
  ) {}
  private get settings() {
    return this.db.db.collection<Settings>("church_settings");
  }
  private get units() {
    return this.db.db.collection<Unit>("organization_units");
  }
  async attendanceUnit(churchId: ObjectId, id: ObjectId, tx: ClientSession, active = true) {
    const u = await this.units.findOne(
      {
        _id: id,
        churchId,
        kind: { $in: ["age_ministry", "service_ministry", "area"] },
        ...(active ? { status: "active" as const } : {}),
      },
      { session: tx },
    );
    requireCondition(u, 404, "NOT_FOUND");
    return { id: u._id, name: u.name, kind: u.kind, version: u.version };
  }
  async attendanceUnits(churchId: ObjectId, ids: readonly string[], tx: ClientSession) {
    return this.units
      .find(
        {
          churchId,
          _id: { $in: ids.map(objectId) },
          status: "active",
          kind: { $in: ["age_ministry", "service_ministry", "area"] },
        },
        { session: tx, projection: { _id: 1 } },
      )
      .toArray();
  }
  async attendanceAreaLabels(churchId: ObjectId, ids: ObjectId[], tx: ClientSession) {
    return this.units
      .find(
        { churchId, kind: "area", _id: { $in: ids } },
        { session: tx, projection: { _id: 1, name: 1 } },
      )
      .toArray();
  }
  async validateScope(churchId: ObjectId, scope: Scope, tx: ClientSession) {
    if (scope.kind !== "assigned_units") return;
    for (const id of scope.unitIds) {
      const result = await this.units.updateOne(
        {
          _id: objectId(id),
          churchId,
          status: "active",
          kind: { $in: ["age_ministry", "service_ministry", "area"] },
        },
        { $inc: { writeFence: 1 } },
        { session: tx },
      );
      requireCondition(result.matchedCount, 422, "SCOPE_TARGET_NOT_AVAILABLE");
    }
  }
  async memberOptions(g: TenantGrant, query: URLSearchParams) {
    const config = await this.getSettings(g);
    return { ...config, asOfDate: businessDay(this.now()), units: await this.list(g, query) };
  }
  async overview(g: TenantGrant, tx: ClientSession, areaIds: string[]) {
    const settings = await this.settings.findOne({ _id: g.churchId }, { session: tx }),
      activeAreas = await this.units.countDocuments(
        { churchId: g.churchId, kind: "area", status: "active" },
        { session: tx },
      ),
      labels = await this.units
        .find(
          { churchId: g.churchId, kind: "area", _id: { $in: areaIds.map(objectId) } },
          { session: tx },
        )
        .toArray();
    const areaLabel =
      settings?.unitType === "custom"
        ? (settings.customUnitLabel ?? "Khu vực")
        : settings?.unitType === "cell_group"
          ? "Nhóm tế bào"
          : settings?.unitType === "branch"
            ? "Chi phái"
            : "Khu vực";
    return {
      configured: !!settings,
      areaLabel,
      activeAreas,
      areaLabels: labels.map((u) => ({ id: u._id.toHexString(), name: u.name, status: u.status })),
    };
  }
  async exchangeReferences(churchId: ObjectId, tx: ClientSession) {
    const settings = await this.settings.findOne({ _id: churchId }, { session: tx });
    requireCondition(settings, 422, "SETTINGS_NOT_CONFIGURED");
    const units = await this.units.find({ churchId }, { session: tx }).limit(5001).toArray();
    requireCondition(units.length <= 5000, 413, "FILE_LIMIT");
    return { settings, units };
  }
  async labels(churchId: ObjectId, ids: ObjectId[], tx?: ClientSession) {
    requireCondition(ids.length <= 500, 400, "INVALID_REQUEST");
    const rows = await this.units.find({ churchId, _id: { $in: ids } }, { session: tx }).toArray();
    return rows.map((u) => ({
      id: u._id.toHexString(),
      name: u.name,
      kind: u.kind,
      status: u.status,
    }));
  }
  async fenceArea(churchId: ObjectId, id: ObjectId | null, tx: ClientSession) {
    if (!id) return;
    const r = await this.units.updateOne(
      { _id: id, churchId, kind: "area", status: "active" },
      { $inc: { writeFence: 1 } },
      { session: tx },
    );
    requireCondition(r.matchedCount, 422, "UNIT_NOT_AVAILABLE");
  }
  async assignment(
    churchId: ObjectId,
    input: { mode: "auto" | "manual"; unitIds: string[]; serviceUnitIds?: string[] },
    birthDate: string | null,
    context: { settingsVersion: number; asOfDate: string },
    tx: ClientSession,
    previous?: Assignment,
  ): Promise<Assignment> {
    const today = businessDay(this.now());
    requireCondition(context.asOfDate === today, 412, "ASSIGNMENT_CONTEXT_CHANGED");
    const root = await this.settings.updateOne(
      { _id: churchId, version: context.settingsVersion },
      { $inc: { writeFence: 1 } },
      { session: tx },
    );
    requireCondition(root.matchedCount, 412, "ASSIGNMENT_CONTEXT_CHANGED");
    let ids = input.unitIds.map(objectId);
    const oldServices = previous
      ? await this.units
          .find(
            { churchId, _id: { $in: previous.unitIds }, kind: "service_ministry" },
            { session: tx },
          )
          .toArray()
      : [];
    if (input.mode === "auto") {
      const age = ageOn(birthDate, today),
        band =
          age === null
            ? undefined
            : ageBands.find((b) => age >= b.min && (b.max === null || age <= b.max));
      if (band) {
        const unit = await this.units.findOne(
          { churchId, kind: "age_ministry", systemKey: band.key, status: "active" },
          { session: tx },
        );
        requireCondition(unit, 503, "DEPENDENCY_UNAVAILABLE");
        ids = [unit._id];
      } else ids = [];
      if (!input.serviceUnitIds) ids.push(...oldServices.map((u) => u._id));
    }
    if (input.serviceUnitIds) {
      for (const id of input.serviceUnitIds) {
        requireCondition(
          await this.units.findOne(
            {
              _id: objectId(id),
              churchId,
              kind: "service_ministry",
              ...(oldServices.some((u) => u._id.equals(objectId(id))) ? {} : { status: "active" }),
            },
            { session: tx },
          ),
          422,
          "UNIT_NOT_AVAILABLE",
        );
        if (!ids.some((v) => v.equals(objectId(id)))) ids.push(objectId(id));
      }
    }
    requireCondition(ids.length <= 50, 422, "VALIDATION_FAILED");
    for (const id of ids) {
      const r = await this.units.updateOne(
        {
          _id: id,
          churchId,
          kind: { $in: ["age_ministry", "service_ministry"] },
          ...(oldServices.some((u) => u._id.equals(id)) ? {} : { status: "active" }),
        },
        { $inc: { writeFence: 1 } },
        { session: tx },
      );
      requireCondition(r.matchedCount, 422, "UNIT_NOT_AVAILABLE");
    }
    return { mode: input.mode, unitIds: ids, asOfDate: today };
  }
  private actor(g: OrganizationGrant) {
    return {
      id: g.actorId,
      kind: g.actorKind,
      churchId: g.actorKind === "owner" ? null : g.churchId,
    };
  }
  private stamps(g: OrganizationGrant) {
    const now = this.now();
    return {
      version: 1,
      writeFence: 0,
      createdAt: now,
      updatedAt: now,
      createdBy: g.actorId,
      updatedBy: g.actorId,
      createdByKind: g.actorKind,
      updatedByKind: g.actorKind,
    };
  }
  private async append(
    g: OrganizationGrant,
    eventType: string,
    targetType: string,
    targetId: ObjectId,
    fields: string[],
    requestId: string,
    operationId: ObjectId,
    tx: ClientSession,
    safeSummary = eventType,
  ) {
    await this.audit.organization(
      eventType,
      requestId,
      this.actor(g),
      g.churchId,
      targetType,
      targetId,
      fields,
      operationId,
      tx,
      safeSummary,
    );
  }
  async getSettings(g: OrganizationGrant) {
    const s = await this.settings.findOne({ _id: g.churchId });
    return {
      configured: !!s,
      settings: s ? settingsDto(s) : null,
      defaults: { unitType: "area" as const, defaultAssignmentMode: "auto" as const },
      ageBands,
    };
  }
  private validateConfig(body: {
    unitType: Settings["unitType"];
    customUnitLabel?: string | null;
  }) {
    requireCondition(
      body.unitType === "custom" ? !!body.customUnitLabel : !body.customUnitLabel,
      422,
      "VALIDATION_FAILED",
    );
  }
  async writeSettings(
    g: OrganizationGrant,
    raw: unknown,
    initialize: boolean,
    key: string | null,
    match: string | null,
    requestId: string,
  ) {
    requireCondition(g.canWrite, 403, "FORBIDDEN");
    const body = initialize ? parse(createSettings, raw) : parse(updateSettings, raw),
      expected = initialize ? null : version(match);
    idempotencyKey(key);
    return this.ops.executeOrganization(
      g,
      initialize ? "POST" : "PATCH",
      `organization/${g.churchId}/settings`,
      key,
      body,
      expected,
      async (tx, operationId) => {
        const old = await this.settings.findOne({ _id: g.churchId }, { session: tx });
        if (initialize) requireCondition(!old, 409, "SETTINGS_ALREADY_CONFIGURED");
        else requireCondition(old, 409, "SETTINGS_NOT_CONFIGURED");
        requireCondition(
          !(body.unitType && body.unitType !== "custom" && body.customUnitLabel),
          422,
          "VALIDATION_FAILED",
        );
        const next = { ...old, ...body };
        if (body.unitType && body.unitType !== "custom") delete next.customUnitLabel;
        this.validateConfig(next as Settings);
        if (initialize) {
          const settings: Settings = {
            _id: g.churchId,
            ...this.stamps(g),
            unitType: next.unitType as Settings["unitType"],
            defaultAssignmentMode: next.defaultAssignmentMode as Settings["defaultAssignmentMode"],
            ...(next.customUnitLabel ? { customUnitLabel: next.customUnitLabel } : {}),
          };
          await this.settings.insertOne(settings, { session: tx });
          await this.units.insertMany(
            [
              { key: "board", name: "Ban Chấp sự", kind: "board" as const },
              ...ageBands.map((b) => ({ key: b.key, name: b.name, kind: "age_ministry" as const })),
            ].map((b) => ({
              _id: new ObjectId(),
              churchId: g.churchId,
              kind: b.kind,
              namespace: "ministry" as const,
              systemKey: b.key,
              name: b.name,
              nameKey: normalizeName(b.name).toLowerCase(),
              status: "active" as const,
              ...this.stamps(g),
            })),
            { session: tx },
          );
          await this.append(
            g,
            "organization.initialized",
            "church_settings",
            g.churchId,
            ["unitType", "defaultAssignmentMode", "systemUnits"],
            requestId,
            operationId,
            tx,
          );
          return {
            safeResult: { configured: true, settings: settingsDto(settings) },
            resourceRefs: [{ type: "church_settings", id: g.churchId.toHexString() }],
          };
        }
        const updated = await this.settings.findOneAndUpdate(
          { _id: g.churchId, version: expected as number },
          {
            $set: {
              unitType: next.unitType as Settings["unitType"],
              defaultAssignmentMode:
                next.defaultAssignmentMode as Settings["defaultAssignmentMode"],
              ...(next.customUnitLabel ? { customUnitLabel: next.customUnitLabel } : {}),
              updatedAt: this.now(),
              updatedBy: g.actorId,
              updatedByKind: g.actorKind,
            },
            ...(!next.customUnitLabel ? { $unset: { customUnitLabel: "" as const } } : {}),
            $inc: { version: 1, writeFence: 1 },
          },
          { session: tx, returnDocument: "after" },
        );
        requireCondition(updated, 412, "VERSION_CONFLICT");
        await this.append(
          g,
          "organization.settings_updated",
          "church_settings",
          g.churchId,
          Object.keys(body),
          requestId,
          operationId,
          tx,
        );
        return {
          safeResult: { configured: true, settings: settingsDto(updated) },
          resourceRefs: [{ type: "church_settings", id: g.churchId.toHexString() }],
        };
      },
      initialize ? 201 : 200,
    );
  }
  async list(g: OrganizationGrant, query: URLSearchParams) {
    const allowed = ["kind", "status", "q", "limit", "cursor"];
    requireCondition(
      [...query.keys()].every((k) => allowed.includes(k) && query.getAll(k).length === 1),
      400,
      "INVALID_REQUEST",
    );
    const kind = query.get("kind"),
      status = query.get("status") ?? "active",
      q = normalizeName(query.get("q") ?? "").toLowerCase(),
      limitText = query.get("limit") ?? "25",
      limit = Number(limitText);
    requireCondition(
      (!kind || kinds.includes(kind as Unit["kind"])) &&
        ["active", "inactive", "all"].includes(status) &&
        q.length <= 100 &&
        /^\d+$/.test(limitText) &&
        limit >= 1 &&
        limit <= 100,
      400,
      "INVALID_REQUEST",
    );
    const filter: Filter<Unit> = {
      churchId: g.churchId,
      ...(kind ? { kind: kind as Unit["kind"] } : {}),
      ...(status === "all" ? {} : { status: status as Unit["status"] }),
      ...(q ? { nameKey: { $regex: `^${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}` } } : {}),
    };
    const context = digest(
      JSON.stringify([
        g.actorKind,
        g.actorId,
        g.churchId,
        g.policyContext,
        kind,
        status,
        q,
        "nameKey+id:asc",
      ]),
    );
    if (query.has("cursor")) {
      const value = query.get("cursor") as string;
      requireCondition(value.length <= 4096, 400, "INVALID_CURSOR");
      const [payload, signature, ...rest] = value.split(".");
      requireCondition(
        payload &&
          signature &&
          !rest.length &&
          equal(signature, sign(this.key, `organization:${payload}`)),
        400,
        "INVALID_CURSOR",
      );
      let decoded: unknown;
      try {
        decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
      } catch {
        throw new AppError(400, "INVALID_CURSOR");
      }
      const c = cursorSchema.safeParse(decoded);
      requireCondition(c.success, 400, "INVALID_CURSOR");
      requireCondition(c.data.context === context, 400, "CURSOR_CONTEXT_MISMATCH");
      requireCondition(c.data.expiresAt > this.now().getTime(), 400, "CURSOR_EXPIRED");
      filter.$or = [
        { nameKey: { $gt: c.data.lastName } },
        { nameKey: c.data.lastName, _id: { $gt: objectId(c.data.lastId) } },
      ];
    }
    const rows = await this.units
      .find(filter)
      .sort({ nameKey: 1, _id: 1 })
      .limit(limit + 1)
      .toArray();
    const more = rows.length > limit;
    if (more) rows.pop();
    const last = rows.at(-1);
    let nextCursor: string | null = null;
    if (more && last) {
      const payload = Buffer.from(
        JSON.stringify({
          context,
          lastName: last.nameKey,
          lastId: last._id.toHexString(),
          expiresAt: this.now().getTime() + 15 * 60_000,
        }),
      ).toString("base64url");
      nextCursor = `${payload}.${sign(this.key, `organization:${payload}`)}`;
    }
    return {
      items: rows.map(unitDto),
      nextCursor,
      configured: !!(await this.settings.findOne({ _id: g.churchId }, { projection: { _id: 1 } })),
    };
  }
  async get(g: OrganizationGrant, id: string) {
    const u = await this.units.findOne({ _id: objectId(id), churchId: g.churchId });
    requireCondition(u, 404, "NOT_FOUND");
    return unitDto(u);
  }
  async writeUnit(
    g: OrganizationGrant,
    id: string | null,
    status: boolean,
    raw: unknown,
    key: string | null,
    match: string | null,
    requestId: string,
  ) {
    requireCondition(g.canWrite, 403, "FORBIDDEN");
    const body = id
      ? status
        ? parse(statusUnit, raw)
        : parse(updateUnit, raw)
      : parse(createUnit, raw);
    const expected = id ? version(match) : null,
      targetId = id ? objectId(id) : new ObjectId();
    idempotencyKey(key);
    try {
      return await this.ops.executeOrganization(
        g,
        id ? "PATCH" : "POST",
        `organization/${g.churchId}/units${id ? `/${targetId}${status ? "/status" : ""}` : ""}`,
        key,
        body,
        expected,
        async (tx, operationId) => {
          const root = await this.settings.updateOne(
            { _id: g.churchId },
            { $inc: { writeFence: 1 } },
            { session: tx },
          );
          requireCondition(root.matchedCount, 409, "SETTINGS_NOT_CONFIGURED");
          let u: Unit;
          if (!id) {
            const b = body as z.infer<typeof createUnit>;
            u = {
              _id: targetId,
              churchId: g.churchId,
              kind: b.kind,
              namespace: b.kind === "area" ? "area" : "ministry",
              name: b.name,
              nameKey: b.name.toLowerCase(),
              status: "active",
              ...this.stamps(g),
            };
            await this.units.insertOne(u, { session: tx });
          } else {
            const old = await this.units.findOne(
              { _id: targetId, churchId: g.churchId },
              { session: tx },
            );
            requireCondition(old, 404, "NOT_FOUND");
            requireCondition(!old.systemKey, 409, "SYSTEM_UNIT_IMMUTABLE");
            const updated = await this.units.findOneAndUpdate(
              { _id: targetId, churchId: g.churchId, version: expected as number },
              {
                $set: {
                  ...(status
                    ? { status: (body as z.infer<typeof statusUnit>).status }
                    : {
                        name: (body as { name: string }).name,
                        nameKey: (body as { name: string }).name.toLowerCase(),
                      }),
                  updatedAt: this.now(),
                  updatedBy: g.actorId,
                  updatedByKind: g.actorKind,
                },
                $inc: { version: 1, writeFence: 1 },
              },
              { session: tx, returnDocument: "after" },
            );
            requireCondition(updated, 412, "VERSION_CONFLICT");
            u = updated;
          }
          await this.append(
            g,
            !id
              ? "organization.unit_created"
              : status
                ? "organization.unit_status_changed"
                : "organization.unit_renamed",
            "organization_unit",
            targetId,
            status ? ["status"] : ["name"],
            requestId,
            operationId,
            tx,
            status
              ? `organization.unit_status_changed: ${(body as z.infer<typeof statusUnit>).reason}`
              : undefined,
          );
          return {
            safeResult: { unit: unitDto(u) },
            resourceRefs: [{ type: "organization_unit", id: targetId.toHexString() }],
          };
        },
        id ? 200 : 201,
      );
    } catch (e) {
      if (e instanceof MongoServerError && e.code === 11000 && e.keyPattern?.nameKey)
        throw new AppError(409, "UNIT_NAME_EXISTS", {
          name: "Tên đã được sử dụng trong nhóm này, kể cả mục đã ngừng sử dụng.",
        });
      throw e;
    }
  }
}
