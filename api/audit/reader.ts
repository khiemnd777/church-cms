import { type Filter, ObjectId } from "mongodb";
import { z } from "zod";
import type { OwnerGrant } from "../authorization/owner-grant";
import { AppError, requireCondition } from "../errors";
import { objectId } from "../http-validation";
import { digest, equal, sign } from "../identity/crypto";
import type { AuditEvent } from "../identity/models";
import type { Database } from "../infrastructure/database";

const cursorSchema = z.strictObject({
  v: z.literal(1),
  route: z.literal("F23"),
  actor: z.string().regex(/^[a-f0-9]{24}$/),
  filter: z.string().length(64),
  time: z.string().datetime(),
  id: z.string().regex(/^[a-f0-9]{24}$/),
  expires: z.number().int(),
});
const instant = z.string().datetime({ offset: true });
export function auditDto(e: AuditEvent) {
  return {
    id: e._id.toHexString(),
    occurredAt: e.occurredAt.toISOString(),
    actorKind: e.actorKind,
    ...(e.actorId ? { actorId: e.actorId.toHexString() } : {}),
    actorChurchId: e.actorChurchId?.toHexString() ?? null,
    targetChurchId: e.targetChurchId?.toHexString() ?? null,
    eventType: e.eventType,
    targetType: e.targetType,
    ...(e.targetId ? { targetId: e.targetId.toHexString() } : {}),
    outcome: e.outcome,
    changedFields: e.changedFields,
    safeSummary: e.safeSummary,
    requestId: e.requestId,
    ...(e.operationId ? { operationId: e.operationId.toHexString() } : {}),
  };
}
export class AuditReader {
  constructor(
    private db: Database,
    private key: string,
    private now: () => Date = () => new Date(),
  ) {}
  private encode(actor: string, filter: string, time: Date, id: ObjectId) {
    const payload = Buffer.from(
      JSON.stringify({
        v: 1,
        route: "F23",
        actor,
        filter,
        time: time.toISOString(),
        id: id.toHexString(),
        expires: this.now().getTime() + 15 * 60_000,
      }),
    ).toString("base64url");
    return `${payload}.${sign(this.key, `cursor:F23:${payload}`)}`;
  }
  private decode(value: string, actor: string, filter: string) {
    requireCondition(value.length <= 4096, 400, "INVALID_CURSOR");
    const [payload, signature, ...rest] = value.split(".");
    requireCondition(
      payload &&
        signature &&
        !rest.length &&
        equal(signature, sign(this.key, `cursor:F23:${payload}`)),
      400,
      "INVALID_CURSOR",
    );
    let raw: unknown;
    try {
      raw = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    } catch {
      throw new AppError(400, "INVALID_CURSOR");
    }
    const parsed = cursorSchema.safeParse(raw);
    requireCondition(parsed.success, 400, "INVALID_CURSOR");
    requireCondition(
      parsed.data.actor === actor && parsed.data.filter === filter,
      400,
      "CURSOR_CONTEXT_MISMATCH",
    );
    requireCondition(parsed.data.expires > this.now().getTime(), 400, "CURSOR_EXPIRED");
    return parsed.data;
  }
  async list(grant: OwnerGrant, query: URLSearchParams) {
    const allowed = ["churchId", "eventType", "from", "to", "limit", "cursor"];
    requireCondition(
      [...query.keys()].every((k) => allowed.includes(k) && query.getAll(k).length === 1),
      400,
      "INVALID_REQUEST",
    );
    const churchId = query.has("churchId")
      ? objectId(query.get("churchId") as string).toHexString()
      : null;
    const eventType = query.get("eventType");
    requireCondition(
      eventType === null || /^[a-z][a-z0-9_.]{0,99}$/.test(eventType),
      400,
      "INVALID_REQUEST",
    );
    function date(key: string) {
      const value = query.get(key);
      if (value === null) return null;
      const parsed = instant.safeParse(value);
      requireCondition(parsed.success, 400, "INVALID_REQUEST");
      const d = new Date(parsed.data);
      requireCondition(Number.isFinite(d.getTime()), 400, "INVALID_REQUEST");
      return d;
    }
    const from = date("from"),
      to = date("to"),
      limit = query.get("limit") ?? "25";
    requireCondition(!from || !to || from < to, 400, "INVALID_REQUEST");
    requireCondition(/^[1-9]\d{0,2}$/.test(limit) && Number(limit) <= 100, 400, "INVALID_REQUEST");
    const filter = digest(
      JSON.stringify([
        churchId,
        eventType,
        from?.toISOString() ?? null,
        to?.toISOString() ?? null,
        "occurredAt+id:desc",
      ]),
    );
    const after = query.has("cursor")
      ? this.decode(query.get("cursor") as string, grant.actorId.toHexString(), filter)
      : null;
    const base: Filter<AuditEvent> = {
      ...(churchId ? { targetChurchId: new ObjectId(churchId) } : {}),
      ...(eventType ? { eventType } : {}),
      ...(from || to
        ? { occurredAt: { ...(from ? { $gte: from } : {}), ...(to ? { $lt: to } : {}) } }
        : {}),
    };
    const condition: Filter<AuditEvent> = after
      ? {
          $and: [
            base,
            {
              $or: [
                { occurredAt: { $lt: new Date(after.time) } },
                { occurredAt: new Date(after.time), _id: { $lt: new ObjectId(after.id) } },
              ],
            },
          ],
        }
      : base;
    const rows = await this.db.audits
      .find(condition, {
        maxTimeMS: 3000,
        projection: {
          _id: 1,
          occurredAt: 1,
          actorKind: 1,
          actorId: 1,
          actorChurchId: 1,
          targetChurchId: 1,
          eventType: 1,
          targetType: 1,
          targetId: 1,
          outcome: 1,
          changedFields: 1,
          safeSummary: 1,
          requestId: 1,
          operationId: 1,
        },
      })
      .sort({ occurredAt: -1, _id: -1 })
      .limit(Number(limit) + 1)
      .toArray();
    const more = rows.length > Number(limit);
    if (more) rows.pop();
    const last = rows.at(-1);
    return {
      items: rows.map(auditDto),
      nextCursor:
        more && last
          ? this.encode(grant.actorId.toHexString(), filter, last.occurredAt, last._id)
          : null,
    };
  }
}
