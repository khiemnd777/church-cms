import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { ObjectId } from "mongodb";
import { createApp } from "../../api/app";
import type { TenantGrant } from "../../api/authorization/tenant-grant";
import { config } from "../../api/config";
import { decodeFile } from "../../api/data-exchange/files";
import { Families } from "../../api/families/service";
import { Identity } from "../../api/identity/service";
import { Database, initialize } from "../../api/infrastructure/database";
import { RateLimit } from "../../api/infrastructure/rate-limit";
import { businessDay, shiftDay } from "../../api/members/dates";
import { OverviewMembers } from "../../api/members/overview";
import type { OverviewDto } from "../../api/overview/contracts";
import { Overview } from "../../api/overview/service";
import {
  localOnly,
  SyntheticClient,
  seedP2,
  syntheticChurch,
  syntheticOwner,
  syntheticUser,
} from "../../scripts/p2-fixtures";

const conf = {
  ...config(),
  origin: "https://localhost:3459",
  database: `church_cms_test_overview_${crypto.randomUUID().replaceAll("-", "")}`,
  csrfKey: crypto.randomUUID() + crypto.randomUUID(),
};
localOnly(conf);
const db = new Database(conf),
  rate = new RateLimit(conf.redisUrl, conf.csrfKey);
let app: ReturnType<typeof createApp>,
  identity: Identity,
  owner: SyntheticClient,
  actor: { id: string; email: string; password: string };
const client = (realm: "owner" | "church" = "owner") =>
  new SyntheticClient(realm, conf.origin, (req) => app(req, { ip: "overview-test" }));
const path = (id: string, who = owner) => `${who.realm === "owner" ? "owner/" : ""}churches/${id}`;
const overview = async (c: { id: string }, who = owner) =>
  await who.call(`${path(c.id, who)}/overview`);
beforeAll(async () => {
  await db.client.connect();
  await initialize(db.db);
  await rate.connect();
  identity = new Identity(db, rate, conf);
  await identity.initialize();
  app = createApp(identity, conf, { log: () => {} });
  owner = client();
  actor = await syntheticOwner(db, owner);
});
afterAll(async () => {
  if (db.db.databaseName === conf.database) await db.db.dropDatabase();
  await db.client.close();
  if (rate.client.isOpen) rate.client.destroy();
});
const grant = (id: string): TenantGrant => ({
  actorKind: "owner",
  actorId: new ObjectId(actor.id),
  churchId: new ObjectId(id),
  canWrite: false,
  policyContext: "7:owner",
  fence: async () => {},
});
describe("P2.6 snapshot dashboard and filter contracts", () => {
  test("AC01 empty/unconfigured has real zeros, unavailable null and no business writes", async () => {
    const c = await syntheticChurch(owner, "Empty synthetic", false),
      auditBefore = await db.db.collection("audit_events").countDocuments(),
      r = await overview(c);
    expect(r.status).toBe(200);
    const d = r.payload.data as OverviewDto;
    expect(d.members.total).toBe(0);
    expect(d.organization.configured).toBe(false);
    expect(d.families.believerFamilies).toBe(0);
    expect(d.families.believersPerFamily).toBeNull();
    expect(d.birthdays.items).toEqual([]);
    expect(d.visitors.latest).toEqual([]);
    expect(d.attendance.value).toBeNull();
    expect(d.attendance.days).toHaveLength(12);
    expect(d.attendance.coverage4).toBe(0);
    expect(d.rites.value).toBe(0);
    expect(d.rites.availability).toBe("available");
    expect(d.organization.secretary).toBeNull();
    expect(d.church.address).toBe("Địa chỉ synthetic");
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(await db.db.collection("audit_events").countDocuments()).toBe(auditBefore);
  });
  test("AC02 independent counts preserve unknown gender/baptism and distinct believer households", async () => {
    const c = await syntheticChurch(owner),
      seed = await seedP2(db, c.id, actor.id, 8);
    for (const m of seed.members)
      await db.db
        .collection("members")
        .updateOne(
          { _id: m._id },
          { $set: { participation: "active", gender: "unknown", "baptism.status": "unknown" } },
        );
    const excluded = seed.members[0];
    expect(excluded).toBeTruthy();
    await db.db
      .collection("members")
      .updateOne({ _id: excluded?._id }, { $set: { participation: "deceased" } });
    const d = (await overview(c)).payload.data as OverviewDto;
    expect(d.members.total).toBe(7);
    expect(d.members.believer).toBe(6);
    expect(d.members.visitor).toBe(1);
    expect(d.members.gender).toEqual({ male: 0, female: 0, unknown: 7 });
    expect(d.members.baptism).toEqual({ baptized: 0, not_baptized: 0, unknown: 7 });
    expect(d.families.believerFamilies).toBe(2);
    expect(d.families.believersPerFamily).toBe(3);
    expect(d.unassigned.people).toBe(7);
    expect(d.unassigned.families).toBe(2);
  });
  test("AC03 birthdays cross year/29Feb/unknown and next month use a single business day", async () => {
    const c = await syntheticChurch(owner),
      seed = await seedP2(db, c.id, actor.id, 4),
      dates = ["2000-12-31", "2000-01-01", "2000-02-29", null];
    for (let i = 0; i < 4; i++)
      await db.db
        .collection("members")
        .updateOne(
          { _id: seed.members[i]?._id },
          { $set: { birthDate: dates[i], participation: "active" } },
        );
    const p = new OverviewMembers(
        db,
        new Families(db, () => new Date(), identity.audit),
        conf.csrfKey,
        () => new Date(),
      ),
      g = grant(c.id);
    const atYear = await db.transaction((tx) => p.read(g, tx, "2027-01-01"));
    expect(atYear.birthdays.from).toBe("2026-12-27");
    expect(atYear.birthdays.to).toBe("2027-01-02");
    expect(atYear.birthdays.total).toBe(2);
    expect(atYear.birthdays.items.map((m) => m.turnAge)).toEqual([26, 27]);
    const atDecember = await db.transaction((tx) => p.read(g, tx, "2026-12-31"));
    expect(atDecember.birthdays.nextMonth.period).toBe("2027-01");
    expect(atDecember.birthdays.nextMonth.count).toBe(1);
    const atLeap = await db.transaction((tx) => p.read(g, tx, "2027-03-01"));
    expect(
      atLeap.birthdays.items.some(
        (p) => p.birthDate === "2000-02-29" && p.birthday === "2027-03-01",
      ),
    ).toBe(true);
    expect(atLeap.birthdays.items.some((p) => p.birthDate === null)).toBe(false);
  });
  test("AC04 visitors30 excludes null/old dates, latest has old known dates, conversion differs from believed stage", async () => {
    const c = await syntheticChurch(owner),
      seed = await seedP2(db, c.id, actor.id, 5),
      day = businessDay();
    for (let i = 0; i < 5; i++)
      await db.db.collection("members").updateOne(
        { _id: seed.members[i]?._id },
        {
          $set: {
            participation: "active",
            type: i === 4 ? "believer" : "visitor",
            membership: i === 4 ? "member" : null,
            visitor:
              i === 4
                ? null
                : {
                    stage: i === 3 ? "believed" : "new",
                    firstVisit:
                      i === 0
                        ? null
                        : i === 1
                          ? shiftDay(day, -29)
                          : i === 2
                            ? shiftDay(day, -30)
                            : shiftDay(day, -70),
                    believedOn: null,
                    referrer: null,
                    caregiverId: null,
                  },
            ...(i === 4 ? { convertedOn: day } : {}),
          },
        },
      );
    const d = (await overview(c)).payload.data as OverviewDto;
    expect(d.visitors.total).toBe(4);
    expect(d.visitors.new30).toBe(1);
    expect(d.visitors.convertedYear).toBe(1);
    expect(d.visitors.stages.believed).toBe(1);
    expect(d.visitors.latest.length).toBe(3);
    expect(d.visitors.latest.map((p) => p.id)).not.toContain(seed.members[0]?._id.toHexString());
  });
  test("AC05 new filters compose through list/count/cursors and protected XLSX export", async () => {
    const c = await syntheticChurch(owner);
    await seedP2(db, c.id, actor.id, 180);
    const b = path(c.id),
      filter = {
        type: "visitor",
        participation: "current",
        firstVisit: "last30",
        visitorStage: "new",
      };
    const q = new URLSearchParams(filter),
      list = await owner.call(`${b}/members?${q}&limit=2`);
    expect(list.status).toBe(200);
    expect(
      list.payload.data.items.every(
        (m: { type: string; visitor: { stage: string; firstVisit: string } }) =>
          m.type === "visitor" &&
          m.visitor.stage === "new" &&
          m.visitor.firstVisit >= shiftDay(businessDay(), -29),
      ),
    ).toBe(true);
    const sq = new URLSearchParams(filter);
    sq.delete("type");
    const count = await owner.call(`${b}/members/summary?${sq}`);
    expect(count.status).toBe(200);
    expect(count.payload.data.believer).toBe(0);
    if (list.payload.data.nextCursor) {
      const next = await owner.call(
        `${b}/members?${q}&limit=2&cursor=${encodeURIComponent(list.payload.data.nextCursor)}`,
      );
      expect(next.status).toBe(200);
      expect(next.payload.data.items[0].id).not.toBe(list.payload.data.items[0].id);
      expect(
        (
          await owner.call(
            `${b}/members?type=visitor&visitorStage=exploring&firstVisit=last30&cursor=${encodeURIComponent(list.payload.data.nextCursor)}`,
          )
        ).status,
      ).toBe(400);
    }
    const payload = { filters: filter, columns: ["code", "fullName"], format: "xlsx" },
      preview = await owner.call(`${b}/data-exchange/exports/preview`, payload);
    expect(preview.status).toBe(200);
    expect(preview.payload.data.count).toBe(count.payload.data.all);
    const file = await owner.call(`${b}/data-exchange/exports`, {
      ...payload,
      previewToken: preview.payload.data.previewToken,
    });
    expect(file.status).toBe(201);
    const download = await owner.call(
      `${b}/data-exchange/exports/${file.payload.data.export.id}/download`,
    );
    expect(download.status).toBe(200);
    expect((await decodeFile(download.bytes as Uint8Array, "xlsx"))[0]?.rows.length).toBe(
      count.payload.data.all,
    );
    for (const bad of [
      "firstVisit=all",
      "visitorStage=bad",
      "birthday=month:0000-01",
      "birthday=month:2027-13",
      "type=believer&firstVisit=last30",
    ]) {
      expect((await owner.call(`${b}/members?${bad}`)).status).toBe(400);
    }
  });
  test("AC06 cross-tenant/realm and denied roles cannot read overview metadata/counts", async () => {
    const a = await syntheticChurch(owner),
      b = await syntheticChurch(owner);
    await seedP2(db, b.id, actor.id, 7);
    const area = await owner.call(`${path(a.id)}/organization/units`, {
      kind: "area",
      name: "Scope synthetic",
    });
    for (const role of ["pastor", "secretary", "treasurer", "member", "ministry_lead"]) {
      const user = client("church");
      await syntheticUser(
        owner,
        user,
        a,
        role,
        role === "ministry_lead" ? [area.payload.data.unit.id] : [],
      );
      const r = await overview(a, user);
      expect(r.status).toBe(["pastor", "secretary"].includes(role) ? 200 : 403);
      expect((await overview(b, user)).status).toBe(403);
      if (r.status === 403) expect(r.payload.data).toBeUndefined();
    }
    const onlyOwner = client("church");
    onlyOwner.jar = new Map(owner.jar);
    expect((await overview(a, onlyOwner)).status).toBe(401);
    expect((await owner.call(`${path(a.id)}/overview?churchId=${b.id}`)).status).toBe(400);
    expect((await owner.call(`${path(a.id)}/overview`, {})).status).toBe(405);
  });
  test("AC07 role or church change inside snapshot fence rejects response", async () => {
    for (const action of ["permissions", "suspend"]) {
      const c = await syntheticChurch(owner),
        u = client("church"),
        account = await syntheticUser(owner, u, c);
      let enter = () => {},
        release = () => {},
        attempts = 0;
      const entered = new Promise<void>((r) => {
          enter = r;
        }),
        released = new Promise<void>((r) => {
          release = r;
        }),
        original = Overview.prototype.get;
      const spy = spyOn(Overview.prototype, "get").mockImplementation(async function (
        this: Overview,
        g: TenantGrant,
      ) {
        const fence = g.fence;
        return original.call(this, {
          ...g,
          fence: async (tx) => {
            await db.db
              .collection("accounts")
              .findOne({ _id: new ObjectId(account.id) }, { session: tx });
            if (++attempts === 1) {
              enter();
              await released;
            }
            await fence(tx);
          },
        });
      });
      const request = overview(c, u);
      await entered;
      spy.mockRestore();
      try {
        if (action === "permissions")
          await db.db
            .collection("accounts")
            .updateOne(
              { _id: new ObjectId(account.id) },
              { $set: { role: "treasurer" }, $inc: { version: 1 } },
            );
        else
          await db.db
            .collection("churches")
            .updateOne(
              { _id: new ObjectId(c.id) },
              { $set: { status: "suspended" }, $inc: { version: 1 } },
            );
      } finally {
        release();
      }
      expect([401, 403]).toContain((await request).status);
      expect(attempts).toBeGreaterThanOrEqual(2);
    }
  });
  test("AC08 public module reads share the same snapshot across a concurrent catalogue edit", async () => {
    const c = await syntheticChurch(owner),
      area = await owner.call(`${path(c.id)}/organization/units`, {
        kind: "area",
        name: "Tên cũ synthetic",
      });
    await seedP2(db, c.id, actor.id, 8);
    let enter = () => {},
      release = () => {};
    const entered = new Promise<void>((r) => {
        enter = r;
      }),
      released = new Promise<void>((r) => {
        release = r;
      }),
      original = OverviewMembers.prototype.read;
    const spy = spyOn(OverviewMembers.prototype, "read").mockImplementation(async function (
      this: OverviewMembers,
      ...args: Parameters<OverviewMembers["read"]>
    ) {
      const result = await original.apply(this, args);
      enter();
      await released;
      return result;
    });
    const request = overview(c);
    await entered;
    spy.mockRestore();
    try {
      await db.db.collection("organization_units").updateOne(
        { _id: new ObjectId(area.payload.data.unit.id) },
        {
          $set: { name: "Tên mới synthetic", nameKey: "tên mới synthetic" },
          $inc: { version: 1 },
        },
      );
    } finally {
      release();
    }
    const first = (await request).payload.data as OverviewDto;
    expect(first.organization.areaLabels[0]?.name).toBe("Tên cũ synthetic");
    expect(((await overview(c)).payload.data as OverviewDto).organization.areaLabels[0]?.name).toBe(
      "Tên mới synthetic",
    );
  });
  test("AC09 bounded area groups include inactive references and unassigned without double-counting", async () => {
    const c = await syntheticChurch(owner);
    for (let i = 0; i < 9; i++)
      expect(
        (
          await owner.call(`${path(c.id)}/organization/units`, {
            kind: "area",
            name: `Khu ${i} synthetic`,
          })
        ).status,
      ).toBe(201);
    await seedP2(db, c.id, actor.id, 120);
    await db.db
      .collection("organization_units")
      .updateOne(
        { churchId: new ObjectId(c.id), kind: "area", name: "Khu 0 synthetic" },
        { $set: { status: "inactive" }, $inc: { version: 1 } },
      );
    const d = (await overview(c)).payload.data as OverviewDto;
    expect(d.areas.length).toBe(6);
    expect(d.areaGroupCount).toBe(9);
    expect(d.unassigned.people).toBeGreaterThan(0);
    expect(d.organization.activeAreas).toBe(8);
    expect(new Set(d.areas.map((a) => a.id)).size).toBe(6);
  });
  test("AC10 ten simultaneous fenced overview reads preserve authorization and consistent counts", async () => {
    const c = await syntheticChurch(owner);
    await seedP2(db, c.id, actor.id, 1000);
    const results = await Promise.all(Array.from({ length: 10 }, () => overview(c)));
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(new Set(results.map((r) => r.payload.data.members.total)).size).toBe(1);
  }, 30000);
  test("AC11 snapshot admission is tenant-scoped, bounded and releases after failure", async () => {
    let release!: () => void, entered!: () => void;
    const held = new Promise<void>((r) => {
      release = r;
    });
    const started = new Promise<void>((r) => {
      entered = r;
    });
    const first = db.readSnapshot("queue-a", async () => {
      entered();
      await held;
      return 1;
    });
    await started;
    const waiting = Array.from({ length: 31 }, () => db.readSnapshot("queue-a", async () => 2));
    try {
      await expect(db.readSnapshot("queue-a", async () => 0)).rejects.toMatchObject({
        code: "DEPENDENCY_UNAVAILABLE",
      });
      expect(await db.readSnapshot("queue-b", async () => 3)).toBe(3);
    } finally {
      release();
    }
    expect(await first).toBe(1);
    expect(await Promise.all(waiting)).toEqual(Array(31).fill(2));
    await expect(
      db.readSnapshot("queue-a", async () => {
        throw new Error("Synthetic failure");
      }),
    ).rejects.toThrow("Synthetic failure");
    expect(await db.readSnapshot("queue-a", async () => 4)).toBe(4);
  });
});
