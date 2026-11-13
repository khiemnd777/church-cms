import { type ClientSession, type Filter, ObjectId } from "mongodb";
import QRCode from "qrcode";
import { z } from "zod";
import type { Audit } from "../audit/service";
import { requireCondition } from "../errors";
import { objectId, parse, version } from "../http-validation";
import { opaque } from "../identity/crypto";
import type { Database } from "../infrastructure/database";
import type { CardMembers } from "../members/cards";
import type { Operations } from "../operations/service";
import type { Tenancy } from "../tenancy/service";
import { TenantQueries } from "../tenant-queries";
import {
  type CardGrant,
  type CardHistory,
  type CardResolver,
  cardDto,
  type MemberCard,
} from "./models";
import { qrPayload } from "./validation";

const empty = z.strictObject({}),
  reasonInput = z.strictObject({ reason: z.string().normalize("NFC").trim().min(1).max(500) });

export class Cards implements CardResolver {
  private query: TenantQueries;
  constructor(
    private db: Database,
    private members: CardMembers,
    private tenancy: Pick<Tenancy, "cardIdentity">,
    private ops: Operations,
    private audit: Audit,
    key: string,
    private now: () => Date,
  ) {
    this.query = new TenantQueries(key, now, "cards");
  }
  private get rows() {
    return this.db.db.collection<MemberCard>("member_cards");
  }
  private get histories() {
    return this.db.db.collection<CardHistory>("member_card_history");
  }
  private staff(g: CardGrant) {
    requireCondition(g.canManageCards && !g.unitScope && !g.receiptScope, 403, "FORBIDDEN");
  }
  private async raw(g: CardGrant, id: string, tx: ClientSession) {
    const c = await this.rows.findOne({ _id: objectId(id), churchId: g.churchId }, { session: tx });
    requireCondition(c, 404, "NOT_FOUND");
    return c;
  }
  async current(g: CardGrant, memberId: string) {
    this.staff(g);
    const mid = objectId(memberId);
    return this.db.readSnapshot(g.churchId.toHexString(), async (tx) => {
      await g.fence(tx);
      const m = await this.members.identity(g.churchId, mid, tx),
        church = await this.tenancy.cardIdentity(g.churchId, tx);
      const c = await this.rows.findOne({ churchId: g.churchId, memberId: mid }, { session: tx });
      return {
        card: c ? cardDto(c) : null,
        eligible: m.current,
        profileChanged:
          !!c &&
          (c.snapshot.fullName !== m.fullName ||
            c.snapshot.memberCode !== m.code ||
            c.snapshot.churchName !== church.name ||
            c.snapshot.churchCode !== church.code),
      };
    });
  }
  async render(g: CardGrant, cardId: string, expected?: number) {
    this.staff(g);
    const c = await this.db.readSnapshot(g.churchId.toHexString(), async (tx) => {
      await g.fence(tx);
      const card = await this.raw(g, cardId, tx);
      requireCondition(
        card.state === "active" && (await this.members.current(g.churchId, card.memberId, tx)),
        409,
        "CARD_NOT_USABLE",
      );
      if (expected !== undefined)
        requireCondition(card.version === expected, 412, "VERSION_CONFLICT");
      return card;
    });
    const payload = `QLHT1:${c.publicId}`;
    const svg = await QRCode.toString(payload, {
      type: "svg",
      errorCorrectionLevel: "M",
      margin: 4,
      width: 256,
    });
    return { card: cardDto(c), payload, svg };
  }
  private async history(
    g: CardGrant,
    c: MemberCard,
    event: CardHistory["event"],
    before: MemberCard | null,
    reason: string | null,
    tx: ClientSession,
    op: ObjectId,
    requestId: string,
  ) {
    await this.histories.insertOne(
      {
        _id: new ObjectId(),
        churchId: g.churchId,
        memberId: c.memberId,
        cardId: c._id,
        event,
        before: before
          ? {
              ...cardDto(before),
              ...(event === "replaced"
                ? { state: "revoked", revokedAt: this.now().toISOString() }
                : {}),
            }
          : null,
        after: cardDto(c),
        reason,
        actorId: g.actorId,
        actorKind: g.actorKind,
        operationId: op,
        occurredAt: this.now(),
      },
      { session: tx },
    );
    await this.audit.organization(
      `cards.${event}`,
      requestId,
      { kind: g.actorKind, id: g.actorId, churchId: g.actorKind === "owner" ? null : g.churchId },
      g.churchId,
      "member_card",
      c._id,
      [event],
      op,
      tx,
    );
  }
  async issue(g: CardGrant, memberId: string, raw: unknown, key: string | null, requestId: string) {
    this.staff(g);
    const body = parse(empty, raw),
      mid = objectId(memberId),
      id = new ObjectId(),
      publicId = opaque();
    const guarded = {
      ...g,
      fence: async (tx: ClientSession) => {
        this.staff(g);
        await g.fence(tx);
        await this.members.identity(g.churchId, mid, tx);
      },
    };
    return this.ops.executeTenant(
      guarded,
      "POST",
      `cards/${g.churchId}/members/${mid}/cards`,
      key,
      body,
      null,
      async (tx, op) => {
        const old = await this.rows.findOne(
          { churchId: g.churchId, memberId: mid },
          { session: tx },
        );
        requireCondition(!old || old.state === "revoked", 409, "CARD_ALREADY_ACTIVE");
        const m = await this.members.identity(g.churchId, mid, tx);
        requireCondition(m.current, 422, "MEMBER_NOT_CURRENT");
        const church = await this.tenancy.cardIdentity(g.churchId, tx),
          now = this.now();
        const c: MemberCard = {
          _id: old?._id ?? id,
          churchId: g.churchId,
          memberId: mid,
          publicId,
          state: "active",
          version: (old?.version ?? 0) + 1,
          snapshot: {
            fullName: m.fullName,
            memberCode: m.code,
            churchName: church.name,
            churchCode: church.code,
          },
          issuedAt: now,
          issuedBy: g.actorId,
          issuedByKind: g.actorKind,
          revokedAt: null,
          createdAt: old?.createdAt ?? now,
          updatedAt: now,
        };
        if (old)
          await this.rows.replaceOne({ _id: old._id, version: old.version }, c, { session: tx });
        else await this.rows.insertOne(c, { session: tx });
        await this.history(g, c, "issued", old, null, tx, op, requestId);
        return {
          safeResult: { cardId: c._id.toHexString(), memberId, version: c.version },
          resourceRefs: [{ type: "member_card", id: c._id.toHexString() }],
        };
      },
      201,
    );
  }
  async change(
    g: CardGrant,
    id: string,
    action: "replace" | "revoke",
    raw: unknown,
    key: string | null,
    match: string | null,
    requestId: string,
  ) {
    this.staff(g);
    const body = parse(reasonInput, raw),
      expected = version(match),
      publicId = opaque();
    const guarded = {
      ...g,
      fence: async (tx: ClientSession) => {
        this.staff(g);
        await g.fence(tx);
        await this.raw(g, id, tx);
      },
    };
    return this.ops.executeTenant(
      guarded,
      "POST",
      `cards/${g.churchId}/cards/${objectId(id)}/${action}`,
      key,
      body,
      expected,
      async (tx, op) => {
        const old = await this.raw(g, id, tx);
        requireCondition(old.version === expected, 412, "VERSION_CONFLICT");
        requireCondition(old.state === "active", 409, "CARD_NOT_USABLE");
        const c = { ...old, version: old.version + 1, updatedAt: this.now() };
        if (action === "replace") {
          const m = await this.members.identity(g.churchId, old.memberId, tx);
          requireCondition(m.current, 422, "MEMBER_NOT_CURRENT");
          const church = await this.tenancy.cardIdentity(g.churchId, tx);
          c.publicId = publicId;
          c.snapshot = {
            fullName: m.fullName,
            memberCode: m.code,
            churchName: church.name,
            churchCode: church.code,
          };
          c.issuedAt = this.now();
          c.issuedBy = g.actorId;
          c.issuedByKind = g.actorKind;
        } else {
          c.state = "revoked";
          c.revokedAt = this.now();
        }
        const changed = await this.rows.replaceOne(
          { _id: old._id, churchId: g.churchId, version: expected },
          c,
          { session: tx },
        );
        requireCondition(changed.matchedCount, 412, "VERSION_CONFLICT");
        await this.history(
          g,
          c,
          action === "replace" ? "replaced" : "revoked",
          old,
          body.reason,
          tx,
          op,
          requestId,
        );
        return {
          safeResult: {
            cardId: c._id.toHexString(),
            memberId: c.memberId.toHexString(),
            version: c.version,
          },
          resourceRefs: [{ type: "member_card", id: c._id.toHexString() }],
        };
      },
    );
  }
  async historyPage(g: CardGrant, id: string, q: URLSearchParams) {
    this.staff(g);
    this.query.allow(q, ["limit", "cursor"]);
    const limit = this.query.limit(q);
    return this.db.readSnapshot(g.churchId.toHexString(), async (tx) => {
      await g.fence(tx);
      const c = await this.raw(g, id, tx),
        context = this.query.context(g, `history/${id}`, []);
      const filter: Filter<CardHistory> = { churchId: g.churchId, memberId: c.memberId };
      if (q.has("cursor")) {
        const v = this.query.decode(q.get("cursor") as string, context),
          t = new Date(v.key);
        requireCondition(Number.isFinite(t.getTime()), 400, "INVALID_CURSOR");
        filter.$or = [{ occurredAt: { $lt: t } }, { occurredAt: t, _id: { $lt: objectId(v.id) } }];
      }
      const rows = await this.histories
        .find(filter, { session: tx })
        .sort({ occurredAt: -1, _id: -1 })
        .limit(limit + 1)
        .toArray();
      const more = rows.length > limit;
      if (more) rows.pop();
      const last = rows.at(-1);
      return {
        items: rows.map((h) => ({
          id: h._id.toHexString(),
          event: h.event,
          reason: h.reason,
          before: h.before,
          after: h.after,
          actorKind: h.actorKind,
          actorId: h.actorId.toHexString(),
          occurredAt: h.occurredAt.toISOString(),
        })),
        nextCursor:
          more && last
            ? this.query.encode(context, last.occurredAt.toISOString(), last._id.toHexString())
            : null,
      };
    });
  }
  async operation(g: CardGrant, id: string) {
    this.staff(g);
    return this.ops.getTenant(g, id, "cards", async (tx, op) => {
      this.staff(g);
      const ref = op.resourceRefs.find((r) => r.type === "member_card");
      requireCondition(ref, 404, "NOT_FOUND");
      await this.raw(g, ref.id, tx);
    });
  }
  async resolve(churchId: ObjectId, payload: string, tx: ClientSession) {
    const valid = qrPayload.safeParse(payload);
    requireCondition(valid.success, 404, "QR_NOT_AVAILABLE");
    const c = await this.rows.findOne(
      { churchId, publicId: payload.slice(6), state: "active" },
      { session: tx },
    );
    requireCondition(
      c && (await this.members.current(churchId, c.memberId, tx)),
      404,
      "QR_NOT_AVAILABLE",
    );
    return { cardId: c._id, memberId: c.memberId, version: c.version };
  }
  async verify(
    churchId: ObjectId,
    cardId: ObjectId,
    memberId: ObjectId,
    expected: number,
    tx: ClientSession,
  ) {
    const c = await this.rows.findOne(
      { _id: cardId, churchId, memberId, version: expected, state: "active" },
      { session: tx },
    );
    requireCondition(
      c && (await this.members.current(churchId, memberId, tx)),
      404,
      "QR_NOT_AVAILABLE",
    );
  }
}
