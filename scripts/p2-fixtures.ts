// Synthetic fixtures and transport shared by P2 qualification and regression only.
import { ObjectId } from "mongodb";
import type { Config } from "../api/config";
import type { Family } from "../api/families/models";
import { OwnerOperations } from "../api/identity/owner-operations";
import type { Database } from "../api/infrastructure/database";
import { ageOn, businessDay, shiftDay } from "../api/members/dates";
import type { Member } from "../api/members/models";
import { memberSnapshot, searchName } from "../api/members/models";
import { ageBands, type Unit } from "../api/organization/models";
import { resourceCode } from "../api/resource-code";
export class SyntheticClient {
  jar = new Map<string, string>();
  csrf = "";
  constructor(
    public realm: "owner" | "church",
    private origin: string,
    private transport: (req: Request) => Promise<Response>,
  ) {}
  async call(
    path: string,
    body?: object | Uint8Array,
    options: {
      method?: string;
      headers?: Record<string, string>;
      version?: number;
      key?: string;
    } = {},
  ) {
    const response = await this.transport(
      new Request(`${this.origin}/api/v1/${path}`, {
        method: options.method ?? (body ? "POST" : "GET"),
        headers: {
          cookie: [...this.jar].map(([k, v]) => `${k}=${v}`).join(";"),
          ...(body
            ? {
                "content-type":
                  body instanceof Uint8Array ? "application/octet-stream" : "application/json",
                origin: this.origin,
                "x-csrf-token": this.csrf,
                "idempotency-key": options.key ?? crypto.randomUUID(),
              }
            : {}),
          ...(options.version ? { "if-match": `"${options.version}"` } : {}),
          ...options.headers,
        },
        ...(body
          ? { body: body instanceof Uint8Array ? (body as BodyInit) : JSON.stringify(body) }
          : {}),
      }),
    );
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(";")[0] as string,
        i = pair.indexOf("=");
      if (pair.slice(i + 1)) this.jar.set(pair.slice(0, i), pair.slice(i + 1));
      else this.jar.delete(pair.slice(0, i));
    }
    const binary = /text\/csv|spreadsheetml/.test(response.headers.get("content-type") ?? ""),
      bytes = binary ? new Uint8Array(await response.arrayBuffer()) : null,
      payload = response.status === 204 || binary ? null : await response.json();
    if (payload?.data?.csrfToken) this.csrf = payload.data.csrfToken;
    return { status: response.status, payload, headers: response.headers, bytes };
  }
  async login(email: string, password: string, churchCode?: string) {
    await this.call(`auth/csrf?realm=${this.realm}`);
    return this.call(`${this.realm === "owner" ? "owner/" : ""}auth/login`, {
      email,
      password,
      ...(churchCode ? { churchCode } : {}),
    });
  }
  cookie() {
    return [...this.jar].map(([k, v]) => `${k}=${v}`).join(";");
  }
}
export function check(condition: unknown, label: string): asserts condition {
  if (!condition) throw new Error(label);
}
export async function syntheticOwner(db: Database, client: SyntheticClient) {
  const fixture = await new OwnerOperations(db).create({
      email: `owner-${crypto.randomUUID()}@example.test`,
      displayName: "Owner qualification synthetic",
    }),
    password = `Owner 🌿 ${crypto.randomUUID()}`;
  check(
    (await client.login(fixture.email, fixture.temporaryPassword)).status === 200,
    "Owner initial login",
  );
  check(
    (
      await client.call("owner/auth/change-initial-password", {
        newPassword: password,
        confirmation: password,
      })
    ).status === 204,
    "Owner change initial password",
  );
  check((await client.login(fixture.email, password)).status === 200, "Owner full login");
  const me = await client.call("owner/auth/me");
  return { email: fixture.email, password, id: me.payload.data.employeeId as string };
}
export async function syntheticChurch(
  owner: SyntheticClient,
  name = "Hội Thánh synthetic P2",
  configure = true,
) {
  const made = await owner.call("owner/churches", {
    name,
    province: "Đà Nẵng",
    address: "Địa chỉ synthetic",
  });
  check(made.status === 201, "Create synthetic church");
  const church = made.payload.data.church as { id: string; code: string; name: string };
  if (configure)
    check(
      (
        await owner.call(`owner/churches/${church.id}/organization/settings`, {
          unitType: "area",
          defaultAssignmentMode: "auto",
        })
      ).status === 201,
      "Configure synthetic church",
    );
  return church;
}
export async function syntheticUser(
  owner: SyntheticClient,
  client: SyntheticClient,
  church: { id: string; code: string },
  role = "secretary",
  unitIds: string[] = [],
) {
  const email = `user-${crypto.randomUUID()}@example.test`,
    password = `User 🕊 ${crypto.randomUUID()}`,
    made = await owner.call(`owner/churches/${church.id}/accounts`, {
      email,
      displayName: "User qualification synthetic",
      role,
      scope:
        role === "member"
          ? { kind: "self" }
          : role === "ministry_lead"
            ? { kind: "assigned_units", unitIds }
            : { kind: "church" },
    });
  check(made.status === 201, "Create synthetic user");
  check(
    (await client.login(email, made.payload.data.temporaryCredential.password, church.code))
      .status === 200,
    "User initial login",
  );
  check(
    (
      await client.call("auth/change-initial-password", {
        newPassword: password,
        confirmation: password,
      })
    ).status === 204,
    "User change initial password",
  );
  check((await client.login(email, password, church.code)).status === 200, "User full login");
  return { email, password, id: made.payload.data.account.id as string };
}
export async function seedP2(
  db: Database,
  churchId: string,
  actorId: string,
  count: number,
  day = businessDay(),
) {
  const church = new ObjectId(churchId),
    actor = new ObjectId(actorId),
    now = new Date(),
    families: Family[] = Array.from({ length: Math.ceil(count / 4) }, () => ({
      _id: new ObjectId(),
      churchId: church,
      code: resourceCode("GD"),
      name: null,
      address: null,
      notes: null,
      sinceYear: null,
      areaId: null,
      status: "active",
      mergedIntoId: null,
      version: 1,
      writeFence: 0,
      createdAt: now,
      updatedAt: now,
      createdBy: actor,
    }));
  if (families.length) await db.db.collection<Family>("families").insertMany(families);
  const ageUnits = await db.db
      .collection<Unit>("organization_units")
      .find({ churchId: church, kind: "age_ministry" })
      .toArray(),
    areas = await db.db
      .collection<Unit>("organization_units")
      .find({ churchId: church, kind: "area" })
      .toArray();
  if (areas.length) {
    for (let i = 0; i < families.length; i++) {
      const f = families[i] as Family;
      f.areaId = i % 5 === 0 ? null : (areas[i % areas.length] as Unit)._id;
      await db.db.collection("families").updateOne({ _id: f._id }, { $set: { areaId: f.areaId } });
    }
  }
  const members: Member[] = Array.from({ length: count }, (_, i) => {
    const type = i % 5 === 0 ? "visitor" : "believer",
      fullName = `Nguyễn synthetic ${String(i).padStart(5, "0")}`;
    const birthDate =
        i % 7 === 0
          ? null
          : i % 11 === 0
            ? "2000-02-29"
            : `${day.slice(5) === "02-29" ? "1992" : "1990"}-${day.slice(5)}`,
      age = ageOn(birthDate, day),
      band =
        age === null
          ? null
          : ageBands.find((b) => age >= b.min && (b.max === null || age <= b.max)),
      ageUnit = ageUnits.find((u) => u.systemKey === band?.key);
    return {
      _id: new ObjectId(),
      churchId: church,
      code: resourceCode("TH"),
      fullName,
      nameKey: searchName(fullName),
      nameTokens: ["nguyễn", "synthetic", String(i).padStart(5, "0")],
      gender: i % 3 === 0 ? "unknown" : i % 3 === 1 ? "male" : "female",
      birthDate,
      phone: i % 3 === 0 ? null : "0900000000",
      phoneKey: i % 3 === 0 ? null : "0900000000",
      type,
      membership:
        type === "visitor" ? null : i % 3 === 0 ? "child" : i % 3 === 1 ? "preparatory" : "member",
      participation:
        i % 19 === 0
          ? "deceased"
          : i % 17 === 0
            ? "transferred"
            : i % 13 === 0
              ? "long_absent"
              : "active",
      familyId: (families[Math.floor(i / 4)] as Family)._id,
      householdRole: i % 4 === 0 ? "head" : "child",
      assignment: { mode: "auto", unitIds: ageUnit ? [ageUnit._id] : [], asOfDate: day },
      baptism: {
        status: i % 3 === 0 ? "baptized" : i % 3 === 1 ? "not_baptized" : "unknown",
        date: null,
        place: null,
      },
      visitor:
        type === "visitor"
          ? {
              stage: i % 3 === 0 ? "new" : i % 3 === 1 ? "exploring" : "believed",
              firstVisit: i % 7 === 0 ? null : shiftDay(day, -(i % 65)),
              believedOn: null,
              referrer: null,
              caregiverId: null,
            }
          : null,
      consent: {
        confirmed: true,
        wordingVersion: "member-consent-r1",
        recordedAt: now,
        actorId: actor,
        actorKind: "owner",
      },
      version: 1,
      writeFence: 0,
      createdAt: now,
      updatedAt: now,
      createdBy: actor,
      updatedBy: actor,
    };
  });
  for (let i = 0; i < members.length; i += 500) {
    const batch = members.slice(i, i + 500);
    await db.db.collection<Member>("members").insertMany(batch);
    await db.db.collection("member_history").insertMany(
      batch.map((m) => ({
        _id: new ObjectId(),
        churchId: church,
        memberId: m._id,
        event: "synthetic_fixture",
        effectiveOn: day,
        eventDate: null,
        reason: "Qualification fixture; not application-created",
        actorKind: "owner",
        actorId: actor,
        occurredAt: now,
        version: 1,
        before: null,
        after: memberSnapshot(m),
        changedFields: Object.keys(memberSnapshot(m)),
      })),
    );
  }
  if (families.length)
    await db.db.collection("family_history").insertMany(
      families.map((f) => ({
        _id: new ObjectId(),
        churchId: church,
        familyId: f._id,
        event: "synthetic_fixture",
        operationId: new ObjectId(),
        version: 1,
        effectiveOn: day,
        reason: "Qualification fixture",
        actorId: actor,
        actorKind: "owner",
        occurredAt: now,
        before: null,
        after: { code: f.code },
        relatedFamilyIds: [],
        changes: [],
      })),
    );
  return { families, members };
}
export function localOnly(conf: Config) {
  for (const url of [conf.mongoUrl, conf.redisUrl])
    check(
      ["localhost", "127.0.0.1"].includes(new URL(url).hostname),
      "Local synthetic dependencies only",
    );
}
