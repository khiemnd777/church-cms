import type { ReportingWindow } from "../attendance/reporting";
import type { PrepReporting } from "../prep-classes/reporting";
import type { RiteReporting } from "../rites/reporting";
export interface OverviewPerson {
  id: string;
  code: string;
  fullName: string;
  type: "believer" | "visitor";
  birthDate: string | null;
  birthday?: string;
  turnAge?: number;
  firstVisit?: string;
  stage?: string;
  referrer?: string | null;
}
export interface OverviewMetric {
  value: number | null;
  availability: "available" | "not_available";
}
export interface OverviewDto {
  asOf: string;
  day: string;
  timezone: "Asia/Ho_Chi_Minh";
  policyVersion: number;
  church: {
    id: string;
    code: string;
    name: string;
    province: string;
    district: string | null;
    address: string | null;
    status: "active";
  };
  organization: {
    configured: boolean;
    areaLabel: string;
    activeAreas: number;
    boardTerm: string | null;
    secretary: string | null;
    areaLabels: { id: string; name: string; status: "active" | "inactive" }[];
  };
  members: {
    total: number;
    believer: number;
    visitor: number;
    membership: { member: number; preparatory: number; child: number };
    gender: { male: number; female: number; unknown: number };
    baptism: { baptized: number; not_baptized: number; unknown: number };
  };
  families: { believerFamilies: number; believersPerFamily: number | null };
  visitors: {
    total: number;
    new30: number;
    stages: { new: number; exploring: number; believed: number };
    latest: OverviewPerson[];
    convertedYear: number;
  };
  birthdays: {
    from: string;
    to: string;
    total: number;
    items: OverviewPerson[];
    month: { period: string; count: number };
    nextMonth: { period: string; count: number };
  };
  areas: { id: string | null; people: number; families: number }[];
  areaGroupCount: number;
  unassigned: { people: number; families: number };
  attendance: ReportingWindow &
    OverviewMetric & {
      latest: ReportingWindow["days"][number];
      delta: number | null;
      average4: number | null;
      coverage4: number;
      absent3: number;
    };
  rites: Awaited<ReturnType<RiteReporting["read"]>>;
  classes: Awaited<ReturnType<PrepReporting["read"]>>;
}
export type OverviewTarget =
  | { kind: "members"; filters?: Record<string, string>; memberId?: string; create?: boolean }
  | { kind: "families" }
  | { kind: "bans" }
  | { kind: "attendance"; sessionId?: string }
  | { kind: "rites"; tab?: string; riteId?: string; courseId?: string }
  | { kind: "forms" };
