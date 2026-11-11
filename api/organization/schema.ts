const oid = { bsonType: "objectId" },
  date = { bsonType: "date" },
  integer = { bsonType: ["int", "long", "double"], minimum: 0 };
const stamps = {
  version: { ...integer, minimum: 1 },
  writeFence: integer,
  createdAt: date,
  updatedAt: date,
  createdBy: oid,
  updatedBy: oid,
  createdByKind: { enum: ["owner", "church_user"] },
  updatedByKind: { enum: ["owner", "church_user"] },
};
const required = Object.keys(stamps);
export const organizationSchemas = {
  church_settings: {
    required: ["_id", ...required, "unitType", "defaultAssignmentMode"],
    additionalProperties: false,
    properties: {
      _id: oid,
      ...stamps,
      unitType: { enum: ["area", "cell_group", "branch", "custom"] },
      customUnitLabel: { bsonType: "string", minLength: 1, maxLength: 40 },
      defaultAssignmentMode: { enum: ["auto", "manual"] },
    },
    oneOf: [
      { required: ["customUnitLabel"], properties: { unitType: { enum: ["custom"] } } },
      {
        properties: { unitType: { enum: ["area", "cell_group", "branch"] } },
        not: { required: ["customUnitLabel"] },
      },
    ],
  },
  organization_units: {
    required: ["_id", ...required, "churchId", "kind", "namespace", "name", "nameKey", "status"],
    additionalProperties: false,
    properties: {
      _id: oid,
      ...stamps,
      churchId: oid,
      kind: { enum: ["board", "age_ministry", "service_ministry", "area"] },
      namespace: { enum: ["ministry", "area"] },
      systemKey: { enum: ["board", "children", "teens", "youth", "adults", "seniors"] },
      name: { bsonType: "string", minLength: 1, maxLength: 100 },
      nameKey: { bsonType: "string", minLength: 1, maxLength: 200 },
      status: { enum: ["active", "inactive"] },
    },
    oneOf: [
      {
        required: ["systemKey"],
        properties: {
          kind: { enum: ["board", "age_ministry"] },
          namespace: { enum: ["ministry"] },
          status: { enum: ["active"] },
        },
      },
      {
        properties: { kind: { enum: ["service_ministry"] }, namespace: { enum: ["ministry"] } },
        not: { required: ["systemKey"] },
      },
      {
        properties: { kind: { enum: ["area"] }, namespace: { enum: ["area"] } },
        not: { required: ["systemKey"] },
      },
    ],
  },
};
