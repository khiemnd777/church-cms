import { type ClientSession, type Filter, MongoServerError, ObjectId } from "mongodb";
import type { Audit } from "../audit/service";
import type { policyMatrix } from "../authorization/church-policy";
import { AppError, requireCondition } from "../errors";
import { idempotencyKey, objectId, parse, version } from "../http-validation";
import type { Database } from "../infrastructure/database";
import type { Operation, Operations } from "../operations/service";
import { TenantQueries } from "../tenant-queries";
import {
  type FinanceGrant,
  type FinanceHistory,
  type FinanceSettings,
  type Fund,
  fundDto,
  settingsDto,
} from "./models";
import { fundInput, fundStatusInput, normalizeFundName, settingsInput } from "./validation";

export class Finance {
  constructor(
    private db: Database,
    private ops: Operations,
    private audit: Audit,
    private key: string,
    private now: () => Date = () => new Date(),
  ) {}
  private get settings() {
    return this.db.db.collection<FinanceSettings>("finance_settings");
  }
  private get funds() {
    return this.db.db.collection<Fund>("finance_funds");
  }
  private get history() {
    return this.db.db.collection<FinanceHistory>("finance_history");
  }
  private requireRead(g: FinanceGrant) {
    requireCondition(
      g.actorKind === "church_user" && ["pastor", "treasurer"].includes(g.financeRole),
      403,
      "FORBIDDEN",
    );
  }
  private requireWrite(g: FinanceGrant) {
    this.requireRead(g);
    requireCondition(g.financeRole === "pastor" && g.canWrite, 403, "FORBIDDEN");
  }
  async receiptAccess(g: FinanceGrant, op: Operation, tx: ClientSession) {
    this.requireWrite(g);
    requireCondition(op.resourceRefs.length === 1, 403, "FORBIDDEN");
    const ref = op.resourceRefs[0];
    requireCondition(ref, 403, "FORBIDDEN");
    if (ref.type === "finance_settings") {
      requireCondition(ref.id === g.churchId.toHexString(), 403, "FORBIDDEN");
      requireCondition(
        await this.settings.findOne({ _id: g.churchId }, { session: tx }),
        404,
        "NOT_FOUND",
      );
    } else {
      requireCondition(ref.type === "finance_fund", 403, "FORBIDDEN");
      requireCondition(
        await this.funds.findOne({ churchId: g.churchId, _id: objectId(ref.id) }, { session: tx }),
        404,
        "NOT_FOUND",
      );
    }
  }
  async operation(g: FinanceGrant, id: string) {
    this.requireWrite(g);
    return this.ops.getTenant(g, id, "finance", (tx, op) => this.receiptAccess(g, op, tx));
  }
  async getSettings(g: FinanceGrant) {
    this.requireRead(g);
    return this.db.readSnapshot(g.churchId.toHexString(), async (tx) => {
      await g.fence(tx);
      const s = await this.settings.findOne({ _id: g.churchId }, { session: tx });
      return { configured: !!s, settings: s ? settingsDto(s) : null };
    });
  }
  async matrix(g: FinanceGrant, matrix: ReturnType<typeof policyMatrix>) {
    const result = await this.getSettings(g),
      s = result.settings;
    return {
      ...matrix,
      rows: matrix.rows.map((r) => ({
        ...r,
        expense: !s
          ? "Chưa cấu hình; nghiệp vụ chưa mở"
          : [
              s.approverRole === r.role || s.proposerRoles.some((role) => role === r.role)
                ? "Đề xuất: chưa mở"
                : "Đề xuất: không",
              s.approverRole === r.role ? "Duyệt: chưa mở, cấm tự duyệt" : "Duyệt: không",
            ].join("; "),
      })),
    };
  }
  async append(
    g: Pick<FinanceGrant, "actorId" | "actorName" | "churchId">,
    targetType: FinanceHistory["targetType"],
    targetId: ObjectId,
    event: FinanceHistory["event"],
    before: object | null,
    after: object,
    reason: string | null,
    operationId: ObjectId,
    requestId: string,
    tx: ClientSession,
  ) {
    await this.history.insertOne(
      {
        _id: new ObjectId(),
        churchId: g.churchId,
        targetType,
        targetId,
        event,
        before,
        after,
        reason,
        actorId: g.actorId,
        actorName: g.actorName,
        operationId,
        occurredAt: this.now(),
      },
      { session: tx },
    );
    // General audit is visible to provider owners: no names, config values or free-text reasons.
    await this.audit.organization(
      `finance.${targetType}.${event}`,
      requestId,
      { kind: "church_user", id: g.actorId, churchId: g.churchId },
      g.churchId,
      `finance_${targetType}`,
      targetId,
      [event],
      operationId,
      tx,
    );
  }
  async writeSettings(
    g: FinanceGrant,
    raw: unknown,
    initialize: boolean,
    key: string | null,
    match: string | null,
    requestId: string,
  ) {
    this.requireWrite(g);
    const body = parse(settingsInput, raw),
      expected = initialize ? null : version(match);
    idempotencyKey(key);
    try {
      return await this.ops.executeTenant(
        g,
        initialize ? "POST" : "PATCH",
        `finance/${g.churchId}/settings`,
        key,
        body,
        expected,
        async (tx, operationId) => {
          const old = await this.settings.findOne({ _id: g.churchId }, { session: tx });
          requireCondition(
            initialize ? !old : !!old,
            409,
            initialize ? "FINANCE_ALREADY_CONFIGURED" : "FINANCE_NOT_CONFIGURED",
          );
          const s: FinanceSettings = {
            _id: g.churchId,
            ...body,
            version: 1,
            createdAt: this.now(),
            updatedAt: this.now(),
          };
          let saved: FinanceSettings;
          if (initialize) {
            await this.settings.insertOne(s, { session: tx });
            saved = s;
          } else {
            const updated = await this.settings.findOneAndUpdate(
              { _id: g.churchId, version: expected as number },
              { $set: { ...body, updatedAt: this.now() }, $inc: { version: 1 } },
              { session: tx, returnDocument: "after" },
            );
            requireCondition(updated, 412, "VERSION_CONFLICT");
            saved = updated;
          }
          await this.append(
            g,
            "settings",
            g.churchId,
            initialize ? "initialized" : "configured",
            old ? settingsDto(old) : null,
            settingsDto(saved),
            null,
            operationId,
            requestId,
            tx,
          );
          return {
            safeResult: { settingsId: g.churchId.toHexString(), version: saved.version },
            resourceRefs: [{ type: "finance_settings", id: g.churchId.toHexString() }],
          };
        },
        initialize ? 201 : 200,
        (tx, op) => this.receiptAccess(g, op, tx),
      );
    } catch (e) {
      if (e instanceof MongoServerError && e.code === 11000)
        throw new AppError(409, "FINANCE_ALREADY_CONFIGURED");
      throw e;
    }
  }
  async getFund(g: FinanceGrant, id: string) {
    this.requireRead(g);
    const target = objectId(id);
    return this.db.readSnapshot(g.churchId.toHexString(), async (tx) => {
      await g.fence(tx);
      const f = await this.funds.findOne({ churchId: g.churchId, _id: target }, { session: tx });
      requireCondition(f, 404, "NOT_FOUND");
      return fundDto(f);
    });
  }
  async list(g: FinanceGrant, q: URLSearchParams) {
    this.requireRead(g);
    const query = new TenantQueries(this.key, this.now, "finance-funds");
    query.allow(q, ["q", "status", "limit", "cursor"]);
    const name = normalizeFundName(q.get("q") ?? "").toLowerCase(),
      status = q.get("status") ?? "active";
    requireCondition(
      name.length <= 100 && ["active", "inactive", "all"].includes(status),
      400,
      "INVALID_REQUEST",
    );
    const limit = query.limit(q),
      context = query.context(g, "funds", [name, status]),
      after = q.has("cursor") ? query.decode(q.get("cursor") as string, context) : null;
    return this.db.readSnapshot(g.churchId.toHexString(), async (tx) => {
      await g.fence(tx);
      const filter: Filter<Fund> = {
        churchId: g.churchId,
        ...(status !== "all" ? { status: status as Fund["status"] } : {}),
        ...(name ? { nameKey: { $regex: `^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}` } } : {}),
        ...(after
          ? {
              $or: [
                { nameKey: { $gt: after.key } },
                { nameKey: after.key, _id: { $gt: objectId(after.id) } },
              ],
            }
          : {}),
      };
      const rows = await this.funds
        .find(filter, { session: tx, maxTimeMS: 3000 })
        .sort({ nameKey: 1, _id: 1 })
        .limit(limit + 1)
        .toArray();
      const more = rows.length > limit;
      rows.splice(limit);
      const last = rows.at(-1);
      return {
        items: rows.map(fundDto),
        nextCursor:
          more && last ? query.encode(context, last.nameKey, last._id.toHexString()) : null,
      };
    });
  }
  async writeFund(
    g: FinanceGrant,
    id: string | null,
    status: boolean,
    raw: unknown,
    key: string | null,
    match: string | null,
    requestId: string,
  ) {
    this.requireWrite(g);
    const body = status ? parse(fundStatusInput, raw) : parse(fundInput, raw),
      target = id ? objectId(id) : new ObjectId(),
      expected = id ? version(match) : null;
    idempotencyKey(key);
    try {
      return await this.ops.executeTenant(
        g,
        id ? "PATCH" : "POST",
        `finance/${g.churchId}/funds${id ? `/${target}${status ? "/status" : ""}` : ""}`,
        key,
        body,
        expected,
        async (tx, operationId) => {
          const old = id
            ? await this.funds.findOne({ churchId: g.churchId, _id: target }, { session: tx })
            : null;
          if (id) requireCondition(old, 404, "NOT_FOUND");
          let saved: Fund;
          if (!id) {
            requireCondition("name" in body, 422, "VALIDATION_FAILED");
            saved = {
              _id: target,
              churchId: g.churchId,
              name: body.name,
              nameKey: body.name.toLowerCase(),
              status: "active",
              version: 1,
              createdAt: this.now(),
              updatedAt: this.now(),
            };
            await this.funds.insertOne(saved, { session: tx });
          } else {
            if ("status" in body)
              requireCondition(old?.status !== body.status, 409, "FINANCE_STATUS_UNCHANGED");
            const updated = await this.funds.findOneAndUpdate(
              { _id: target, churchId: g.churchId, version: expected as number },
              {
                $set: {
                  ...("name" in body
                    ? { name: body.name, nameKey: body.name.toLowerCase() }
                    : { status: body.status }),
                  updatedAt: this.now(),
                },
                $inc: { version: 1 },
              },
              { session: tx, returnDocument: "after" },
            );
            requireCondition(updated, 412, "VERSION_CONFLICT");
            saved = updated;
          }
          await this.append(
            g,
            "fund",
            target,
            !id ? "created" : status ? "status_changed" : "renamed",
            old ? fundDto(old) : null,
            fundDto(saved),
            "reason" in body ? body.reason : null,
            operationId,
            requestId,
            tx,
          );
          return {
            safeResult: { fundId: target.toHexString(), version: saved.version },
            resourceRefs: [{ type: "finance_fund", id: target.toHexString() }],
          };
        },
        id ? 200 : 201,
        (tx, op) => this.receiptAccess(g, op, tx),
      );
    } catch (e) {
      if (e instanceof MongoServerError && e.code === 11000)
        throw new AppError(409, "FINANCE_FUND_NAME_EXISTS", {
          name: "Tên quỹ đã tồn tại, kể cả quỹ ngừng dùng.",
        });
      throw e;
    }
  }
  async historyPage(g: FinanceGrant, kind: "fund" | "settings", id: string, q: URLSearchParams) {
    this.requireRead(g);
    const query = new TenantQueries(this.key, this.now, "finance-history"),
      target = objectId(id);
    query.allow(q, ["limit", "cursor"]);
    const limit = query.limit(q),
      context = query.context(g, `history/${kind}/${target}`, null),
      after = q.has("cursor") ? query.decode(q.get("cursor") as string, context) : null;
    return this.db.readSnapshot(g.churchId.toHexString(), async (tx) => {
      await g.fence(tx);
      if (kind === "settings") requireCondition(target.equals(g.churchId), 404, "NOT_FOUND");
      else
        requireCondition(
          await this.funds.findOne({ _id: target, churchId: g.churchId }, { session: tx }),
          404,
          "NOT_FOUND",
        );
      const rows = await this.history
        .find(
          {
            churchId: g.churchId,
            targetType: kind,
            targetId: target,
            ...(after ? { _id: { $lt: objectId(after.id) } } : {}),
          },
          { session: tx, maxTimeMS: 3000 },
        )
        .sort({ _id: -1 })
        .limit(limit + 1)
        .toArray();
      const more = rows.length > limit;
      rows.splice(limit);
      const last = rows.at(-1);
      return {
        items: rows.map((h) => ({
          id: h._id.toHexString(),
          event: h.event,
          actorId: h.actorId.toHexString(),
          actorName: h.actorName,
          occurredAt: h.occurredAt.toISOString(),
          reason: h.reason,
          before: h.before,
          after: h.after,
        })),
        nextCursor: more && last ? query.encode(context, "", last._id.toHexString()) : null,
      };
    });
  }
}
