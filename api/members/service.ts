import { type ClientSession, type Document, MongoServerError, ObjectId } from "mongodb";
import type { z } from "zod";
import type { Audit } from "../audit/service";
import type { TenantGrant } from "../authorization/tenant-grant";
import { AppError, requireCondition } from "../errors";
import type { Families } from "../families/service";
import type { FamilyInput } from "../families/validation";
import { idempotencyKey, objectId, parse, version } from "../http-validation";
import type { Database } from "../infrastructure/database";
import type { Operations } from "../operations/service";
import type { Organization } from "../organization/service";
import { ageOn, businessDay } from "./dates";
import { ExchangeMembers } from "./exchange";
import { FamilyMembers } from "./families";
import {
  type Member,
  type MemberHistory,
  memberSnapshot,
  phoneKey,
  resourceCode,
  searchName,
} from "./models";
import { OrganizationMembers } from "./organization";
import { OverviewMembers } from "./overview";
import { escaped, MemberQueries } from "./queries";
import {
  convertMember,
  createMember,
  participationMember,
  stageMember,
  updateMember,
} from "./validation";
export class Members {
  private queries: MemberQueries;
  constructor(
    private db: Database,
    private ops: Operations,
    private audit: Audit,
    private families: Families,
    private organization: Organization,
    key: string,
    private now: () => Date = () => new Date(),
  ) {
    this.queries = new MemberQueries(key, now);
  }
  overviewPort(key: string) {
    return new OverviewMembers(this.db, this.families, key, this.now);
  }
  organizationPort(key: string) {
    return new OrganizationMembers(this.db, (...args) => this.record(...args), key, this.now);
  }
  familyPort(key: string) {
    return new FamilyMembers(this.db, (...args) => this.record(...args), key, this.now);
  }
  private get rows() {
    return this.db.db.collection<Member>("members");
  }
  private get histories() {
    return this.db.db.collection<MemberHistory>("member_history");
  }
  async options(g: TenantGrant, q: URLSearchParams) {
    return this.organization.memberOptions(g, q);
  }
  private async raw(g: TenantGrant, id: string, tx?: ClientSession) {
    const row = await this.rows.findOne(
      { _id: objectId(id), churchId: g.churchId },
      { session: tx },
    );
    requireCondition(row, 404, "NOT_FOUND");
    return row;
  }
  private async enrich(g: TenantGrant, rows: Member[], detail = false) {
    const fs = await this.families.byIds(g.churchId, [
      ...new Map(rows.map((m) => [m.familyId.toHexString(), m.familyId])).values(),
    ]);
    const ids = [
      ...new Map(
        [
          ...rows.flatMap((m) =>
            detail ? m.assignment.unitIds : m.assignment.unitIds.slice(0, 2),
          ),
          ...fs.flatMap((f) => (f.areaId ? [f.areaId] : [])),
        ].map((id) => [id.toHexString(), id]),
      ).values(),
    ];
    const labels = await this.organization.labels(g.churchId, ids),
      today = businessDay(this.now());
    const caregiverIds = rows.flatMap((m) =>
      m.visitor?.caregiverId ? [m.visitor.caregiverId] : [],
    );
    const caregivers = await this.rows
      .find(
        { churchId: g.churchId, _id: { $in: caregiverIds } },
        { projection: { _id: 1, fullName: 1 } },
      )
      .toArray();
    return rows.map((m) => {
      const f = fs.find((f) => f._id.equals(m.familyId)),
        area = f?.areaId ? labels.find((u) => u.id === f.areaId?.toHexString()) : null;
      return {
        id: m._id.toHexString(),
        churchId: m.churchId.toHexString(),
        ...memberSnapshot(m),
        age: ageOn(m.birthDate, today),
        family: {
          id: m.familyId.toHexString(),
          code: f?.code ?? null,
          areaId: f?.areaId?.toHexString() ?? null,
          areaName: area?.name ?? null,
          areaStatus: area?.status ?? null,
        },
        units: m.assignment.unitIds.flatMap((id) => {
          const label = labels.find((u) => u.id === id.toHexString());
          return label ? [label] : [];
        }),
        caregiverName:
          caregivers.find((c) => c._id.toHexString() === m.visitor?.caregiverId?.toHexString())
            ?.fullName ?? null,
        consent: {
          confirmed: m.consent.confirmed,
          wordingVersion: m.consent.wordingVersion,
          recordedAt: m.consent.recordedAt.toISOString(),
        },
        version: m.version,
        createdAt: m.createdAt.toISOString(),
        updatedAt: m.updatedAt.toISOString(),
        availability: { attendance: "not_available", giving: "not_available", qr: "not_available" },
      };
    });
  }
  async get(g: TenantGrant, id: string) {
    const row = await this.raw(g, id),
      items = await this.enrich(g, [row], true),
      dto = items[0];
    requireCondition(dto, 404, "NOT_FOUND");
    const related = await this.rows
      .find(
        { churchId: g.churchId, familyId: row.familyId, _id: { $ne: row._id } },
        { projection: { _id: 1, code: 1, fullName: 1, householdRole: 1, participation: 1 } },
      )
      .sort({ nameKey: 1, _id: 1 })
      .limit(26)
      .toArray();
    return {
      ...dto,
      familyMembers: {
        items: related.slice(0, 25).map((m) => ({
          id: m._id.toHexString(),
          code: m.code,
          fullName: m.fullName,
          householdRole: m.householdRole,
          participation: m.participation,
        })),
        hasMore: related.length > 25,
      },
    };
  }

  async list(g: TenantGrant, q: URLSearchParams) {
    const query = this.queries.pipeline(g, q, this.families),
      limit = this.queries.limit(q),
      rows = await this.rows.aggregate<Member & { birthdayKey?: string }>(query.stages).toArray();
    const more = rows.length > limit;
    if (more) rows.pop();
    const last = rows.at(-1);
    return {
      items: await this.enrich(g, rows),
      nextCursor:
        more && last
          ? this.queries.encode(
              query.context,
              query.birthday ? (last.birthdayKey as string) : last.nameKey,
              last._id.toHexString(),
            )
          : null,
    };
  }
  async summary(g: TenantGrant, q: URLSearchParams) {
    const query = this.queries.pipeline(g, q, this.families, true),
      counts = await this.rows
        .aggregate<{ _id: string; n: number }>([
          ...query.stages,
          { $group: { _id: "$type", n: { $sum: 1 } } },
        ])
        .toArray();
    const believers = counts.find((c) => c._id === "believer")?.n ?? 0,
      visitors = counts.find((c) => c._id === "visitor")?.n ?? 0;
    return { all: believers + visitors, believer: believers, visitor: visitors };
  }
  async familyPicker(g: TenantGrant, q: URLSearchParams) {
    this.queries.allow(q, ["q", "limit", "cursor"]);
    const term = searchName(q.get("q") ?? "").toUpperCase();
    requireCondition(term.length <= 100, 400, "INVALID_REQUEST");
    const filter: Document = term ? { code: { $regex: `^${escaped(term)}` } } : {},
      context = this.queries.context(g, "families", term),
      limit = this.queries.limit(q);
    if (q.has("cursor")) {
      const last = this.queries.decode(q.get("cursor") as string, context);
      filter.$or = [
        { code: { $gt: last.key } },
        { code: last.key, _id: { $gt: objectId(last.id) } },
      ];
    }
    const rows = await this.families.page(g.churchId, filter, limit + 1),
      more = rows.length > limit;
    if (more) rows.pop();
    const heads = await this.rows
      .find(
        { churchId: g.churchId, familyId: { $in: rows.map((f) => f._id) }, householdRole: "head" },
        { projection: { familyId: 1, fullName: 1 } },
      )
      .toArray();
    const areas = await this.organization.labels(
        g.churchId,
        rows.flatMap((f) => (f.areaId ? [f.areaId] : [])),
      ),
      last = rows.at(-1);
    return {
      items: rows.map((f) => ({
        id: f._id.toHexString(),
        code: f.code,
        areaId: f.areaId?.toHexString() ?? null,
        areaName: areas.find((a) => a.id === f.areaId?.toHexString())?.name ?? null,
        headName: heads.find((h) => h.familyId.equals(f._id))?.fullName ?? null,
      })),
      nextCursor:
        more && last ? this.queries.encode(context, last.code, last._id.toHexString()) : null,
    };
  }
  async history(g: TenantGrant, id: string, q: URLSearchParams) {
    await this.raw(g, id);
    this.queries.allow(q, ["limit", "cursor"]);
    const context = this.queries.context(g, "history", id.toLowerCase()),
      filter: Document = { churchId: g.churchId, memberId: objectId(id) },
      limit = this.queries.limit(q);
    if (q.has("cursor")) {
      const last = this.queries.decode(q.get("cursor") as string, context),
        time = new Date(last.key);
      requireCondition(Number.isFinite(time.getTime()), 400, "INVALID_CURSOR");
      filter.$or = [
        { occurredAt: { $lt: time } },
        { occurredAt: time, _id: { $lt: objectId(last.id) } },
      ];
    }
    const rows = await this.histories
        .find(filter)
        .sort({ occurredAt: -1, _id: -1 })
        .limit(limit + 1)
        .toArray(),
      more = rows.length > limit;
    if (more) rows.pop();
    const last = rows.at(-1);
    return {
      items: rows.map((h) => ({
        id: h._id.toHexString(),
        event: h.event,
        effectiveOn: h.effectiveOn,
        eventDate: h.eventDate,
        reason: h.reason,
        actorKind: h.actorKind,
        actorId: h.actorId.toHexString(),
        occurredAt: h.occurredAt.toISOString(),
        version: h.version,
        changedFields: h.changedFields,
        before: h.before,
        after: h.after,
      })),
      nextCursor:
        more && last
          ? this.queries.encode(context, last.occurredAt.toISOString(), last._id.toHexString())
          : null,
    };
  }
  private validateDates(
    m: Pick<Member, "birthDate" | "baptism" | "visitor">,
    dates: (string | null)[] = [],
  ) {
    const today = businessDay(this.now());
    requireCondition(!m.birthDate || m.birthDate <= today, 422, "VALIDATION_FAILED");
    for (const day of [
      m.baptism.date,
      m.visitor?.firstVisit ?? null,
      m.visitor?.believedOn ?? null,
      ...dates,
    ])
      requireCondition(
        !day || (day <= today && (!m.birthDate || day >= m.birthDate)),
        422,
        "VALIDATION_FAILED",
      );
  }
  private async caregiver(g: TenantGrant, id: ObjectId | null, tx: ClientSession) {
    if (!id) return;
    const r = await this.rows.updateOne(
      { _id: id, churchId: g.churchId, participation: { $in: ["active", "long_absent"] } },
      { $inc: { writeFence: 1 } },
      { session: tx },
    );
    requireCondition(r.matchedCount, 422, "CAREGIVER_NOT_AVAILABLE");
  }
  private async record(
    g: TenantGrant,
    old: Member | null,
    m: Member,
    event: string,
    changedFields: string[],
    effectiveOn: string,
    eventDate: string | null,
    reason: string | null,
    tx: ClientSession,
    operationId: ObjectId,
    requestId: string,
  ) {
    await this.histories.insertOne(
      {
        _id: new ObjectId(),
        churchId: g.churchId,
        memberId: m._id,
        event,
        effectiveOn,
        eventDate,
        reason,
        actorKind: g.actorKind,
        actorId: g.actorId,
        occurredAt: this.now(),
        version: m.version,
        before: old ? memberSnapshot(old) : null,
        after: memberSnapshot(m),
        changedFields,
      },
      { session: tx },
    );
    await this.audit.organization(
      `members.${event}`,
      requestId,
      { id: g.actorId, kind: g.actorKind, churchId: g.actorKind === "owner" ? null : g.churchId },
      g.churchId,
      "member",
      m._id,
      changedFields,
      operationId,
      tx,
    );
    return {
      safeResult: { member: { id: m._id.toHexString(), code: m.code, version: m.version } },
      resourceRefs: [{ type: "member", id: m._id.toHexString() }],
    };
  }
  exchangePort(key: string) {
    return new ExchangeMembers(
      this.db,
      this.families,
      this.organization,
      key,
      this.now,
      (g, raw, tx, op, requestId, meta) =>
        this.createInTransaction(g, parse(createMember, raw), tx, op, requestId, meta),
      (m) => this.validateDates(m),
    );
  }
  private async createInTransaction(
    g: TenantGrant,
    body: z.infer<typeof createMember>,
    tx: ClientSession,
    op: ObjectId,
    requestId: string,
    meta?: FamilyInput,
  ) {
    const assignment = await this.organization.assignment(
      g.churchId,
      body.assignment,
      body.birthDate,
      body.assignmentContext,
      tx,
    );
    const family =
      body.family.kind === "new"
        ? await this.families.create(
            g,
            body.family.areaId ? objectId(body.family.areaId) : null,
            tx,
            meta,
          )
        : await this.families.attach(g, objectId(body.family.id), tx);
    await this.organization.fenceArea(g.churchId, family.areaId, tx);
    const visitor = body.visitor
      ? {
          ...body.visitor,
          caregiverId: body.visitor.caregiverId ? objectId(body.visitor.caregiverId) : null,
        }
      : null;
    await this.caregiver(g, visitor?.caregiverId ?? null, tx);
    const now = this.now(),
      m: Member = {
        _id: new ObjectId(),
        churchId: g.churchId,
        code: resourceCode("TH"),
        fullName: body.fullName,
        nameKey: searchName(body.fullName),
        nameTokens: this.tokens(body.fullName),
        gender: body.gender,
        birthDate: body.birthDate,
        phone: body.phone,
        phoneKey: phoneKey(body.phone),
        type: body.type,
        membership: body.membership,
        participation: "active",
        familyId: family._id,
        householdRole: body.householdRole,
        assignment,
        baptism: body.baptism,
        visitor,
        consent: {
          confirmed: true,
          wordingVersion: "member-consent-r1",
          recordedAt: now,
          actorId: g.actorId,
          actorKind: g.actorKind,
        },
        version: 1,
        writeFence: 0,
        createdAt: now,
        updatedAt: now,
        createdBy: g.actorId,
        updatedBy: g.actorId,
      };
    this.validateDates(m);
    await this.rows.insertOne(m, { session: tx });
    const result = await this.record(
      g,
      null,
      m,
      "created",
      Object.keys(memberSnapshot(m)),
      businessDay(now),
      null,
      null,
      tx,
      op,
      requestId,
    );
    await this.families.record(
      g,
      body.family.kind === "new" ? null : { ...family, version: family.version - 1 },
      family,
      body.family.kind === "new" ? "created" : "member_joined",
      op,
      requestId,
      tx,
      [
        {
          id: m._id.toHexString(),
          fullName: m.fullName,
          fromCode: family.code,
          toCode: family.code,
          fromFamilyId: family._id.toHexString(),
          toFamilyId: family._id.toHexString(),
          fromRole: m.householdRole,
          toRole: m.householdRole,
        },
      ],
    );
    result.resourceRefs.push({ type: "family", id: family._id.toHexString() });
    return result;
  }
  async create(g: TenantGrant, raw: unknown, key: string | null, requestId: string) {
    requireCondition(g.canWrite, 403, "FORBIDDEN");
    const body = parse(createMember, raw);
    idempotencyKey(key);
    for (let attempt = 0; attempt < 3; attempt++)
      try {
        return await this.ops.executeTenant(
          g,
          "POST",
          `members/${g.churchId}/members`,
          key,
          body,
          null,
          async (tx, op) => {
            return this.createInTransaction(g, body, tx, op, requestId);
          },
          201,
        );
      } catch (error) {
        if (error instanceof MongoServerError && error.code === 11000) {
          if (error.keyPattern?.householdRole)
            throw new AppError(409, "FAMILY_HEAD_EXISTS", {
              householdRole: "Hộ đã có chủ hộ. Chọn vai trò khác.",
            });
          if (error.keyPattern?.code && attempt < 2) continue;
        }
        throw error;
      }
    throw new AppError(503, "DEPENDENCY_UNAVAILABLE");
  }
  private tokens(name: string) {
    const words = searchName(name).split(" ");
    return words.map((_, i) => words.slice(i).join(" "));
  }
  async mutate(
    g: TenantGrant,
    id: string,
    action: "profile" | "visitor-stage" | "conversion" | "participation",
    raw: unknown,
    key: string | null,
    match: string | null,
    requestId: string,
  ) {
    requireCondition(g.canWrite, 403, "FORBIDDEN");
    const expected = version(match);
    objectId(id);
    idempotencyKey(key);
    const body =
      action === "profile"
        ? parse(updateMember, raw)
        : action === "visitor-stage"
          ? parse(stageMember, raw)
          : action === "conversion"
            ? parse(convertMember, raw)
            : parse(participationMember, raw);
    try {
      return await this.ops.executeTenant(
        g,
        action === "conversion" ? "POST" : "PATCH",
        `members/${g.churchId}/members/${id.toLowerCase()}${action === "profile" ? "" : `/${action}`}`,
        key,
        body,
        expected,
        async (tx, op) => {
          const old = await this.raw(g, id, tx);
          requireCondition(old.version === expected, 412, "VERSION_CONFLICT");
          const m: Member = {
            ...old,
            version: old.version + 1,
            writeFence: old.writeFence + 1,
            updatedAt: this.now(),
            updatedBy: g.actorId,
          };
          let effectiveOn = businessDay(this.now()),
            eventDate: string | null = null,
            reason: string | null = null;
          if (action === "profile") {
            const p = body as z.infer<typeof updateMember>;
            for (const field of [
              "fullName",
              "gender",
              "birthDate",
              "phone",
              "membership",
              "householdRole",
              "baptism",
            ] as const)
              if (p[field] !== undefined) Object.assign(m, { [field]: p[field] });
            requireCondition(
              m.type === "visitor" ? m.membership === null : !!m.membership,
              422,
              "VALIDATION_FAILED",
            );
            m.nameKey = searchName(m.fullName);
            m.nameTokens = this.tokens(m.fullName);
            m.phoneKey = phoneKey(m.phone);
            if (p.visitor) {
              requireCondition(old.type === "visitor" && old.visitor, 422, "VALIDATION_FAILED");
              m.visitor = {
                ...old.visitor,
                ...p.visitor,
                caregiverId: p.visitor.caregiverId ? objectId(p.visitor.caregiverId) : null,
              };
              if (m.visitor.caregiverId?.toHexString() !== old.visitor.caregiverId?.toHexString())
                await this.caregiver(g, m.visitor.caregiverId, tx);
            }
            if (p.householdRole !== undefined && p.householdRole !== old.householdRole) {
              if (p.householdRole === "head")
                requireCondition(
                  ["active", "long_absent"].includes(old.participation),
                  422,
                  "MEMBER_NOT_CURRENT",
                );
              const f = await this.families.attach(g, m.familyId, tx);
              await this.families.record(
                g,
                { ...f, version: f.version - 1 },
                f,
                "roles_changed",
                op,
                requestId,
                tx,
                [
                  {
                    id: m._id.toHexString(),
                    fullName: m.fullName,
                    fromCode: f.code,
                    toCode: f.code,
                    fromFamilyId: m.familyId.toHexString(),
                    toFamilyId: m.familyId.toHexString(),
                    fromRole: old.householdRole,
                    toRole: m.householdRole,
                  },
                ],
              );
            }
            if (
              p.assignment ||
              (p.birthDate !== undefined &&
                p.birthDate !== old.birthDate &&
                old.assignment.mode === "auto")
            ) {
              requireCondition(p.assignmentContext, 422, "ASSIGNMENT_CONTEXT_REQUIRED");
              m.assignment = await this.organization.assignment(
                g.churchId,
                p.assignment ?? { mode: "auto", unitIds: [] },
                m.birthDate,
                p.assignmentContext,
                tx,
                old.assignment,
              );
            }
          } else if (action === "visitor-stage") {
            requireCondition(old.type === "visitor" && old.visitor, 409, "NOT_A_VISITOR");
            const p = body as z.infer<typeof stageMember>;
            m.visitor = { ...old.visitor, stage: p.stage, believedOn: p.believedOn };
            reason = p.reason;
          } else if (action === "conversion") {
            requireCondition(old.type === "visitor" && old.visitor, 409, "NOT_A_VISITOR");
            requireCondition(
              ["active", "long_absent"].includes(old.participation),
              409,
              "MEMBER_NOT_CURRENT",
            );
            const p = body as z.infer<typeof convertMember>;
            m.type = "believer";
            m.membership = "preparatory";
            m.visitor = { ...old.visitor, stage: "believed", believedOn: p.believedOn };
            m.convertedOn = p.effectiveOn;
            effectiveOn = p.effectiveOn;
            reason = p.reason;
          } else {
            const p = body as z.infer<typeof participationMember>;
            m.participation = p.status;
            effectiveOn = p.effectiveOn;
            eventDate = p.eventDate;
            reason = p.reason;
          }
          this.validateDates(m, [m.convertedOn ?? null, effectiveOn, eventDate]);
          const updated = await this.rows.replaceOne(
            { _id: old._id, churchId: g.churchId, version: expected },
            m,
            { session: tx },
          );
          requireCondition(updated.matchedCount, 412, "VERSION_CONFLICT");
          return this.record(
            g,
            old,
            m,
            action === "profile" ? "profile_updated" : `${action.replaceAll("-", "_")}_changed`,
            Object.keys(memberSnapshot(m)).filter(
              (k) =>
                JSON.stringify((memberSnapshot(old) as Record<string, unknown>)[k]) !==
                JSON.stringify((memberSnapshot(m) as Record<string, unknown>)[k]),
            ),
            effectiveOn,
            eventDate,
            reason,
            tx,
            op,
            requestId,
          );
        },
      );
    } catch (error) {
      if (
        error instanceof MongoServerError &&
        error.code === 11000 &&
        error.keyPattern?.householdRole
      )
        throw new AppError(409, "FAMILY_HEAD_EXISTS", { householdRole: "Hộ đã có chủ hộ." });
      throw error;
    }
  }
}
