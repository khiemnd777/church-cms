import type { Document } from "mongodb";
import type { TenantGrant } from "../authorization/tenant-grant";
import { requireCondition } from "../errors";
import type { Families } from "../families/service";
import { objectId } from "../http-validation";
import { TenantQueries } from "../tenant-queries";
import { birthdayFilterValid, birthdayWindow, businessDay, shiftDay, validDay } from "./dates";
import { searchName } from "./models";
export const escaped = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export class MemberQueries extends TenantQueries {
  pipeline(
    g: TenantGrant,
    q: URLSearchParams,
    families: Families,
    summary = false,
    reporting?: { stages: Document[]; fingerprint: string },
  ) {
    this.allow(
      q,
      summary
        ? [
            "q",
            "participation",
            "membership",
            "familyId",
            "areaId",
            "unitId",
            "baptism",
            "birthday",
            "firstVisit",
            "visitorStage",
            "attendance",
            "attendanceUntil",
          ]
        : [
            "q",
            "type",
            "participation",
            "membership",
            "familyId",
            "areaId",
            "unitId",
            "baptism",
            "birthday",
            "firstVisit",
            "visitorStage",
            "attendance",
            "attendanceUntil",
            "limit",
            "cursor",
          ],
    );
    requireCondition(
      !q.has("attendance") || (q.get("attendance") === "absent3" && !!reporting),
      400,
      "INVALID_REQUEST",
    );
    requireCondition(!q.has("attendanceUntil") || !!reporting, 400, "INVALID_REQUEST");
    const text = searchName(q.get("q") ?? ""),
      type = q.get("type"),
      participation = q.get("participation") ?? "current",
      membership = q.get("membership"),
      baptism = q.get("baptism"),
      birthday = q.get("birthday"),
      firstVisit = q.get("firstVisit"),
      visitorStage = q.get("visitorStage");
    requireCondition(
      text.length <= 100 &&
        (!type || ["believer", "visitor"].includes(type)) &&
        ["current", "active", "long_absent", "transferred", "deceased", "all"].includes(
          participation,
        ) &&
        (!membership || ["preparatory", "member", "child"].includes(membership)) &&
        (!baptism || ["unknown", "not_baptized", "baptized"].includes(baptism)) &&
        (!birthday || birthdayFilterValid(birthday)) &&
        (!firstVisit || firstVisit === "last30") &&
        (!visitorStage || ["new", "exploring", "believed"].includes(visitorStage)) &&
        (!(firstVisit || visitorStage) || !type || type === "visitor"),
      400,
      "INVALID_REQUEST",
    );
    const match: Document = {
      churchId: g.churchId,
      ...(type ? { type } : {}),
      ...(membership ? { membership } : {}),
      ...(baptism ? { "baptism.status": baptism } : {}),
    };
    if (participation !== "all")
      match.participation =
        participation === "current" ? { $in: ["active", "long_absent"] } : participation;
    if (q.has("familyId")) match.familyId = objectId(q.get("familyId") as string);
    if (q.has("unitId")) match["assignment.unitIds"] = objectId(q.get("unitId") as string);
    if (text) {
      if (/^th-/i.test(text)) match.code = { $regex: `^${escaped(text.toUpperCase())}` };
      else if (/^[+\d\s().-]+$/.test(text) && text.replace(/\D/g, "").length)
        match.phoneKey = { $regex: `^${escaped(text.replace(/\D/g, ""))}` };
      else match.nameTokens = { $regex: `^${escaped(text)}` };
    }
    const stages: Document[] = [{ $match: match }];
    if (q.has("areaId"))
      stages.push(...families.memberAreaFilter(g.churchId, objectId(q.get("areaId") as string)));
    const today = businessDay(this.now());
    if (firstVisit || visitorStage) {
      match.type = "visitor";
      if (firstVisit) match["visitor.firstVisit"] = { $gte: shiftDay(today, -29), $lte: today };
      if (visitorStage) match["visitor.stage"] = visitorStage;
    }
    if (birthday) {
      const range = birthdayWindow(today, birthday),
        years = Array.from(new Set([Number(range.from.slice(0, 4)), Number(range.to.slice(0, 4))]));
      const dates = years.map((year) => ({
        $concat: [
          String(year),
          "-",
          {
            $cond: [
              {
                $and: [
                  {
                    $eq: [
                      { $substrBytes: [{ $ifNull: ["$birthDate", "0000-00-00"] }, 5, 5] },
                      "02-29",
                    ],
                  },
                  !validDay(`${year}-02-29`),
                ],
              },
              "03-01",
              { $substrBytes: [{ $ifNull: ["$birthDate", "0000-00-00"] }, 5, 5] },
            ],
          },
        ],
      }));
      stages.push(
        {
          $addFields: {
            birthdayKey: {
              $min: {
                $filter: {
                  input: dates,
                  as: "anniversary",
                  cond: {
                    $and: [
                      { $ne: ["$birthDate", null] },
                      { $gte: ["$$anniversary", range.from] },
                      { $lte: ["$$anniversary", range.to] },
                      { $gte: ["$$anniversary", "$birthDate"] },
                    ],
                  },
                },
              },
            },
          },
        },
        { $match: { birthdayKey: { $ne: null } } },
      );
    }
    if (q.has("attendance")) stages.push(...(reporting?.stages ?? []));
    const context = this.context(g, "members", [
      text,
      type ?? null,
      participation,
      membership ?? null,
      baptism ?? null,
      q.get("areaId"),
      q.get("familyId"),
      q.get("unitId"),
      birthday ?? null,
      birthday || firstVisit ? today : null,
      firstVisit ?? null,
      visitorStage ?? null,
      q.get("attendance"),
      q.get("attendanceUntil"),
      reporting?.fingerprint ?? null,
    ]);
    if (!summary && q.has("cursor")) {
      const last = this.decode(q.get("cursor") as string, context),
        field = birthday ? "birthdayKey" : "nameKey";
      stages.push({
        $match: {
          $or: [
            { [field]: { $gt: last.key } },
            { [field]: last.key, _id: { $gt: objectId(last.id) } },
          ],
        },
      });
    }
    if (!summary)
      stages.push(
        { $sort: { [birthday ? "birthdayKey" : "nameKey"]: 1, _id: 1 } },
        { $limit: this.limit(q) + 1 },
      );
    return { stages, context, birthday: !!birthday };
  }
}
