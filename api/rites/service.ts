import { type ClientSession, type Filter, MongoServerError, ObjectId } from "mongodb";
import type { Audit } from "../audit/service";
import type { TenantGrant } from "../authorization/tenant-grant";
import { AppError, requireCondition } from "../errors";
import { objectId, parse, version } from "../http-validation";
import { digest } from "../identity/crypto";
import type { Database } from "../infrastructure/database";
import { businessDay } from "../members/dates";
import { searchName } from "../members/models";
import { escaped } from "../members/queries";
import type { BaptismChange, RiteMembers } from "../members/rites";
import { canonical, type Operations } from "../operations/service";
import { TenantQueries } from "../tenant-queries";
import { CertificateRites } from "./certificates";
import {
  type PersonSnapshot,
  participants,
  type RiteGrant,
  type RiteHistory,
  type RiteRecord,
  riteDto,
} from "./models";
import { commandInput, type RecordInput, type RiteCommand } from "./validation";
export class Rites {
  private query: TenantQueries;
  certificatePort() {
    return new CertificateRites(this.db);
  }
  constructor(
    private db: Database,
    private members: RiteMembers,
    private ops: Operations,
    private audit: Audit,
    key: string,
    private now: () => Date,
  ) {
    this.query = new TenantQueries(key, now, "rites");
  }
  private get rows() {
    return this.db.db.collection<RiteRecord>("rite_records");
  }
  private get histories() {
    return this.db.db.collection<RiteHistory>("rite_history");
  }
  private staff(g: RiteGrant, write = false) {
    requireCondition(
      !g.unitScope && !g.receiptScope && (!write || g.canManageRites),
      403,
      "FORBIDDEN",
    );
  }
  private async raw(g: TenantGrant, id: string, tx: ClientSession) {
    const r = await this.rows.findOne({ _id: objectId(id), churchId: g.churchId }, { session: tx });
    requireCondition(r, 404, "NOT_FOUND");
    return r;
  }
  private async history(
    g: TenantGrant,
    r: RiteRecord,
    event: string,
    before: Record<string, unknown> | null,
    after: Record<string, unknown>,
    reason: string | null,
    tx: ClientSession,
    op: ObjectId,
    requestId: string,
  ) {
    await this.histories.insertOne(
      {
        _id: new ObjectId(),
        churchId: g.churchId,
        riteId: r._id,
        event,
        before,
        after,
        reason,
        actorId: g.actorId,
        actorKind: g.actorKind,
        operationId: op,
        occurredAt: this.now(),
      },
      { session: tx },
    );
    await this.audit.organization(
      `rites.${event}`,
      requestId,
      { kind: g.actorKind, id: g.actorId, churchId: g.actorKind === "owner" ? null : g.churchId },
      g.churchId,
      "rite",
      r._id,
      [event],
      op,
      tx,
    );
  }
  // Members invokes this public handler in its own transaction, including create/import/profile.
  // The confirmed ceremony snapshot stays intact. Its version/history observes a changed current fact.
  readonly baptismChanged: BaptismChange = async (
    g,
    id,
    before,
    after,
    tx,
    op,
    requestId,
    origin,
  ) => {
    const r = await this.rows.findOne(
      { churchId: g.churchId, kind: "baptism", subjectMemberId: id, state: "recorded" },
      { session: tx },
    );
    if (!r || (origin && r._id.equals(origin))) return;
    const saved = await this.rows.updateOne(
      { _id: r._id, churchId: g.churchId, version: r.version },
      { $inc: { version: 1 }, $set: { updatedAt: this.now() } },
      { session: tx },
    );
    requireCondition(saved.matchedCount, 412, "VERSION_CONFLICT");
    await this.history(
      g,
      r,
      "profile_baptism_changed",
      { baptism: before },
      { baptism: after },
      "Thông tin hiện hành thay đổi qua hồ sơ; snapshot lễ giữ nguyên.",
      tx,
      op,
      requestId,
    );
  };
  private async capture(
    g: RiteGrant,
    input: RecordInput,
    old: RiteRecord | null,
    tx: ClientSession,
  ) {
    const refs = participants(input),
      people: PersonSnapshot[] = [],
      current = new Map<string, Awaited<ReturnType<RiteMembers["identity"]>>>();
    for (const ref of refs) {
      if (ref.source === "member") {
        const id = ref.memberId.toLowerCase();
        let m = current.get(id);
        if (!m) {
          m = await this.members.identity(g, id, tx);
          current.set(id, m);
        }
        people.push({
          source: "member",
          memberId: id,
          fullName: m.fullName,
          birthDate: m.birthDate,
          code: m.code,
          version: m.version,
        });
      } else {
        requireCondition(
          !ref.birthDate || ref.birthDate <= businessDay(this.now()),
          422,
          "VALIDATION_FAILED",
        );
        people.push({
          source: "external",
          memberId: null,
          fullName: ref.fullName,
          birthDate: ref.birthDate,
          code: null,
          version: null,
        });
      }
    }
    if (old?.recordedAt) {
      const priorRefs = participants(old.input);
      for (let i = 0; i < refs.length; i++) {
        const at = priorRefs.findIndex((r) => canonical(r) === canonical(refs[i]));
        if (at >= 0 && old.people[at]) people[i] = old.people[at] as PersonSnapshot;
      }
    }
    return { people, current };
  }
  private validate(command: RiteCommand, old: RiteRecord | null, people: PersonSnapshot[]) {
    const { record: r, state } = command,
      p = r.payload,
      today = businessDay(this.now());
    requireCondition(!old || old.kind === p.kind, 422, "RITE_KIND_IMMUTABLE");
    requireCondition(old || state !== "void", 422, "VALIDATION_FAILED");
    if (old && (old.recordedAt || state === "void" || state !== old.state))
      requireCondition(command.reason, 422, "RITE_REASON_REQUIRED");
    requireCondition(state !== "planned" || !!r.date, 422, "VALIDATION_FAILED");
    requireCondition(
      state !== "recorded" || ((!!r.date || r.historical) && (!r.date || r.date <= today)),
      422,
      "RITE_DATE_INVALID",
    );
    if (p.kind === "marriage") {
      requireCondition(
        p.groom.source === "member" || p.bride.source === "member",
        422,
        "RITE_MEMBER_REQUIRED",
      );
      requireCondition(
        !(
          p.groom.source === "member" &&
          p.bride.source === "member" &&
          p.groom.memberId.toLowerCase() === p.bride.memberId.toLowerCase()
        ),
        422,
        "RITE_SAME_PERSON",
      );
      requireCondition(
        p.announcements.every((a) => a.state !== "announced" || a.date <= today),
        422,
        "RITE_DATE_INVALID",
      );
    }
    if (p.kind === "baptism" || p.kind === "dedication" || p.kind === "funeral") {
      const birth = people[0]?.birthDate;
      requireCondition(!birth || !r.date || r.date >= birth, 422, "RITE_DATE_INVALID");
      if (p.kind === "funeral")
        requireCondition(
          !p.deathOn ||
            (p.deathOn <= today &&
              (!birth || p.deathOn >= birth) &&
              (!r.date || p.deathOn <= r.date)),
          422,
          "RITE_DATE_INVALID",
        );
    }
    if (old?.recordedAt && p.kind === "baptism")
      requireCondition(
        old.subjectMemberId?.toHexString() === p.person.memberId.toLowerCase(),
        422,
        "RITE_SUBJECT_IMMUTABLE",
      );
    if (p.kind !== "baptism")
      requireCondition(command.baptismAfter === null, 422, "VALIDATION_FAILED");
    else if (state !== "recorded" && old?.state !== "recorded")
      requireCondition(command.baptismAfter === null, 422, "VALIDATION_FAILED");
  }
  private async proposal(
    g: RiteGrant,
    body: RiteCommand,
    old: RiteRecord | null,
    tx: ClientSession,
  ) {
    const { people, current } = await this.capture(g, body.record, old, tx);
    this.validate(body, old, people);
    const payload = body.record.payload;
    const subject =
      payload.kind === "baptism" ? current.get(payload.person.memberId.toLowerCase()) : null;
    const before = subject?.baptism ?? null,
      after = body.baptismAfter ?? before;
    if (payload.kind === "baptism" && body.state === "recorded")
      requireCondition(
        canonical(after) ===
          canonical({ status: "baptized", date: body.record.date, place: payload.place }),
        422,
        "RITE_BAPTISM_DECISION",
      );
    const context = digest(
      canonical({
        old: old ? riteDto(old) : null,
        body: { ...body, preview: null },
        people,
        current: [...current.values()],
      }),
    );
    return { people, current, before, after, context };
  }
  async preview(g: RiteGrant, id: string | null, raw: unknown, match: string | null) {
    this.staff(g, true);
    const body = parse(commandInput, raw),
      expected = id ? version(match) : null;
    return this.db.readSnapshot(g.churchId.toHexString(), async (tx) => {
      await g.fence(tx);
      const old = id ? await this.raw(g, id, tx) : null;
      requireCondition(!old || old.version === expected, 412, "VERSION_CONFLICT");
      const p = await this.proposal(g, body, old, tx);
      return {
        context: p.context,
        before: old ? riteDto(old) : null,
        after: { record: body.record, state: body.state, people: p.people },
        baptismBefore: p.before,
        baptismAfter: p.after,
      };
    });
  }
  async save(
    g: RiteGrant,
    id: string | null,
    raw: unknown,
    key: string | null,
    match: string | null,
    requestId: string,
  ) {
    this.staff(g, true);
    const body = parse(commandInput, raw),
      expected = id ? version(match) : null;
    const guarded = {
      ...g,
      fence: async (tx: ClientSession) => {
        this.staff(g, true);
        await g.fence(tx);
        if (id) await this.raw(g, id, tx);
      },
    };
    try {
      return await this.ops.executeTenant(
        guarded,
        id ? "PATCH" : "POST",
        `rites/${g.churchId}/records${id ? `/${objectId(id)}` : ""}`,
        key,
        body,
        expected,
        async (tx, op) => {
          const old = id ? await this.raw(g, id, tx) : null;
          requireCondition(!old || old.version === expected, 412, "VERSION_CONFLICT");
          const p = await this.proposal(g, body, old, tx);
          if (body.state === "recorded" || body.state === "void" || old?.recordedAt)
            requireCondition(body.preview === p.context, 412, "RITE_PREVIEW_STALE");
          for (const m of p.current.values()) await this.members.fence(g, m.id, m.version, tx);
          const now = this.now(),
            r: RiteRecord = {
              _id: old ? old._id : new ObjectId(),
              writeFence: old?.writeFence ?? 0,
              churchId: g.churchId,
              kind: body.record.payload.kind,
              input: body.record,
              people: p.people,
              memberIds: [...p.current.keys()].map((id) => new ObjectId(id)),
              subjectMemberId:
                body.record.payload.kind === "baptism"
                  ? objectId(body.record.payload.person.memberId)
                  : null,
              searchTokens: p.people.flatMap((p) => [
                searchName(p.fullName),
                ...searchName(p.fullName).split(" "),
                ...(p.code ? [p.code.toLowerCase()] : []),
              ]),
              state: body.state,
              version: (old?.version ?? 0) + 1,
              recordedAt: old?.recordedAt ?? (body.state === "recorded" ? now : null),
              createdAt: old?.createdAt ?? now,
              updatedAt: now,
            };
          if (r.kind === "baptism" && canonical(p.before) !== canonical(p.after)) {
            const m = p.current.get(r.subjectMemberId?.toHexString() ?? "");
            requireCondition(m && p.after, 422, "VALIDATION_FAILED");
            await this.members.setBaptism(
              g,
              objectId(m.id),
              m.version,
              p.after,
              body.reason ?? "Ghi nhận Báp-têm",
              tx,
              op,
              requestId,
              r._id,
            );
          }
          if (old) {
            const saved = await this.rows.replaceOne(
              { _id: old._id, churchId: g.churchId, version: expected as number },
              r,
              { session: tx },
            );
            requireCondition(saved.matchedCount, 412, "VERSION_CONFLICT");
          } else await this.rows.insertOne(r, { session: tx });
          await this.history(
            g,
            r,
            old ? "corrected" : "created",
            old ? riteDto(old) : null,
            { ...riteDto(r), baptismBefore: p.before, baptismAfter: p.after },
            body.reason,
            tx,
            op,
            requestId,
          );
          return {
            safeResult: { riteId: r._id.toHexString(), version: r.version },
            resourceRefs: [{ type: "rite", id: r._id.toHexString() }],
          };
        },
        id ? 200 : 201,
      );
    } catch (e) {
      if (e instanceof MongoServerError && e.code === 11000 && e.keyPattern?.subjectMemberId)
        throw new AppError(409, "RITE_BAPTISM_EXISTS");
      throw e;
    }
  }
  async get(g: RiteGrant, id: string) {
    this.staff(g);
    return this.db.readSnapshot(g.churchId.toHexString(), async (tx) => {
      await g.fence(tx);
      const r = await this.raw(g, id, tx);
      const current = r.subjectMemberId
        ? await this.members.identity(g, r.subjectMemberId.toHexString(), tx)
        : null;
      return { ...riteDto(r), currentBaptism: current?.baptism ?? null };
    });
  }
  async list(g: RiteGrant, q: URLSearchParams, memberId?: string) {
    this.staff(g);
    this.query.allow(q, ["kind", "state", "year", "q", "limit", "cursor"]);
    const kind = q.get("kind"),
      state = q.get("state"),
      year = q.get("year"),
      term = (q.get("q") ?? "").trim().normalize("NFC");
    requireCondition(
      (!kind || ["baptism", "dedication", "marriage", "funeral", "communion"].includes(kind)) &&
        (!state || ["draft", "planned", "recorded", "void"].includes(state)) &&
        (!year || /^\d{4}$/.test(year)) &&
        term.length <= 100,
      400,
      "INVALID_REQUEST",
    );
    const limit = this.query.limit(q),
      context = this.query.context(g, "list", [kind, state, year, term, memberId ?? null]);
    return this.db.readSnapshot(g.churchId.toHexString(), async (tx) => {
      await g.fence(tx);
      if (memberId) await this.members.identity(g, objectId(memberId).toHexString(), tx);
      const filter: Filter<RiteRecord> = {
        churchId: g.churchId,
        ...(kind ? { kind: kind as RiteRecord["kind"] } : {}),
        ...(state ? { state: state as RiteRecord["state"] } : {}),
        ...(memberId ? { memberIds: objectId(memberId) } : {}),
        ...(year ? { "input.date": { $gte: `${year}-01-01`, $lte: `${year}-12-31` } } : {}),
        ...(term ? { searchTokens: { $regex: `^${escaped(searchName(term))}` } } : {}),
      };
      if (q.has("cursor")) {
        const c = this.query.decode(q.get("cursor") as string, context),
          date = c.key || null;
        filter.$or = date
          ? [
              { "input.date": { $lt: date } },
              { "input.date": null },
              { "input.date": date, _id: { $lt: objectId(c.id) } },
            ]
          : [{ "input.date": null, _id: { $lt: objectId(c.id) } }];
      }
      const rows = await this.rows
          .find(filter, { session: tx })
          .sort({ "input.date": -1, _id: -1 })
          .limit(limit + 1)
          .toArray(),
        more = rows.length > limit;
      if (more) rows.pop();
      const last = rows.at(-1);
      const next =
        kind === "communion"
          ? await this.rows.findOne(
              {
                churchId: g.churchId,
                kind: "communion",
                state: "planned",
                "input.date": { $gte: businessDay(this.now()) },
              },
              { session: tx, sort: { "input.date": 1, _id: 1 } },
            )
          : null;
      return {
        items: rows.map(riteDto),
        nextCursor:
          more && last
            ? this.query.encode(context, last.input.date ?? "", last._id.toHexString())
            : null,
        nextPlanned: next ? riteDto(next) : null,
      };
    });
  }
  async peoplePage(g: RiteGrant, q: URLSearchParams, onlyBaptized = false) {
    this.staff(g);
    this.query.allow(q, ["q", "limit", "cursor"]);
    const term = (q.get("q") ?? "").trim().normalize("NFC");
    requireCondition(term.length <= 100, 400, "INVALID_REQUEST");
    const limit = this.query.limit(q),
      context = this.query.context(g, onlyBaptized ? "facts" : "people", term),
      after = q.has("cursor") ? this.query.decode(q.get("cursor") as string, context) : null;
    return this.db.readSnapshot(g.churchId.toHexString(), async (tx) => {
      await g.fence(tx);
      const rows = await this.members.page(g, term, after, limit + 1, onlyBaptized, tx),
        more = rows.length > limit;
      if (more) rows.pop();
      const last = rows.at(-1);
      const active = onlyBaptized
        ? await this.rows
            .find(
              {
                churchId: g.churchId,
                kind: "baptism",
                state: "recorded",
                subjectMemberId: { $in: rows.map((m) => objectId(m.id)) },
              },
              { session: tx },
            )
            .toArray()
        : [];
      return {
        items: rows.map(({ nameKey, ...m }) => ({
          ...m,
          rite: active.find((r) => r.subjectMemberId?.toHexString() === m.id)
            ? riteDto(active.find((r) => r.subjectMemberId?.toHexString() === m.id) as RiteRecord)
            : null,
        })),
        nextCursor: more && last ? this.query.encode(context, last.nameKey, last.id) : null,
      };
    });
  }
  async historyPage(g: RiteGrant, id: string, q: URLSearchParams) {
    this.staff(g);
    this.query.allow(q, ["limit", "cursor"]);
    const limit = this.query.limit(q),
      context = this.query.context(g, "history", id.toLowerCase());
    return this.db.readSnapshot(g.churchId.toHexString(), async (tx) => {
      await g.fence(tx);
      await this.raw(g, id, tx);
      const filter: Filter<RiteHistory> = { churchId: g.churchId, riteId: objectId(id) };
      if (q.has("cursor")) {
        const c = this.query.decode(q.get("cursor") as string, context),
          d = new Date(c.key);
        requireCondition(Number.isFinite(d.getTime()), 400, "INVALID_CURSOR");
        filter.$or = [{ occurredAt: { $lt: d } }, { occurredAt: d, _id: { $lt: objectId(c.id) } }];
      }
      const rows = await this.histories
          .find(filter, { session: tx })
          .sort({ occurredAt: -1, _id: -1 })
          .limit(limit + 1)
          .toArray(),
        more = rows.length > limit;
      if (more) rows.pop();
      const last = rows.at(-1);
      return {
        items: rows.map((h) => ({
          ...h,
          id: h._id.toHexString(),
          occurredAt: h.occurredAt.toISOString(),
          actorId: h.actorId.toHexString(),
          operationId: h.operationId.toHexString(),
          churchId: undefined,
          _id: undefined,
          riteId: undefined,
        })),
        nextCursor:
          more && last
            ? this.query.encode(context, last.occurredAt.toISOString(), last._id.toHexString())
            : null,
      };
    });
  }
  async operation(g: RiteGrant, id: string) {
    this.staff(g, true);
    return this.ops.getTenant(g, id, "rites", async (tx, op) => {
      const ref = op.resourceRefs.find((r) => r.type === "rite");
      requireCondition(ref, 404, "NOT_FOUND");
      await this.raw(g, ref.id, tx);
    });
  }
}
