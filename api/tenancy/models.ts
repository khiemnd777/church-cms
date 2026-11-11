import type { ObjectId } from "mongodb";
export interface Contact {
  name?: string;
  phone?: string;
  email?: string;
}
export interface Church {
  _id: ObjectId;
  code: string;
  name: string;
  nameKey: string;
  province: string;
  district?: string;
  address?: string;
  contact?: Contact;
  status: "active" | "suspended";
  version: number;
  writeFence: number;
  createdAt: Date;
  updatedAt: Date;
  createdBy: ObjectId;
  updatedBy: ObjectId;
}
export interface ChurchDto {
  id: string;
  code: string;
  name: string;
  province: string;
  district?: string;
  address?: string;
  contact?: Contact;
  status: "active" | "suspended";
  version: number;
  createdAt: string;
  updatedAt: string;
}
export interface Counters {
  accounts: { value: number; availability: "available" };
  members: { value: null; availability: "not_available" };
  families: { value: null; availability: "not_available" };
  ministries: { value: null; availability: "not_available" };
  areas: { value: null; availability: "not_available" };
}
export interface ChurchSummary extends ChurchDto {
  counters: Counters;
}
export interface ChurchPage {
  items: ChurchSummary[];
  nextCursor: string | null;
}
export function churchDto(c: Church): ChurchDto {
  return {
    id: c._id.toHexString(),
    code: c.code,
    name: c.name,
    province: c.province,
    ...(c.district !== undefined ? { district: c.district } : {}),
    ...(c.address !== undefined ? { address: c.address } : {}),
    ...(c.contact ? { contact: c.contact } : {}),
    status: c.status,
    version: c.version,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}
