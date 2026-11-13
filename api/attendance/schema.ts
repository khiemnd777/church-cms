const oid = { bsonType: "objectId" },
  date = { bsonType: "date" },
  integer = { bsonType: ["int", "long", "double"], minimum: 0, multipleOf: 1 },
  version = { ...integer, minimum: 1 },
  nullableText = { bsonType: ["string", "null"] };
export const attendanceSchemas = {
  attendance_sessions: {
    additionalProperties: false,
    required: [
      "_id",
      "churchId",
      "label",
      "heldOn",
      "location",
      "scope",
      "unitId",
      "unitName",
      "state",
      "version",
      "generation",
      "rowCount",
      "includedCount",
      "presentCount",
      "capturedAt",
      "createdAt",
      "updatedAt",
    ],
    properties: {
      _id: oid,
      churchId: oid,
      reportingKind: { enum: ["general", "sunday_reference"] },
      label: { bsonType: "string", minLength: 1, maxLength: 200 },
      heldOn: { bsonType: "string", pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$" },
      location: nullableText,
      scope: { enum: ["church", "unit"] },
      unitId: { bsonType: ["objectId", "null"] },
      unitName: nullableText,
      prepClass: {
        bsonType: "object",
        additionalProperties: false,
        required: ["courseId", "meetingId", "lessonId", "kind"],
        properties: {
          courseId: oid,
          meetingId: oid,
          lessonId: oid,
          kind: { enum: ["regular", "makeup"] },
        },
      },
      state: { enum: ["draft", "open", "closed"] },
      version,
      generation: version,
      rowCount: { ...integer, maximum: 2000 },
      includedCount: { ...integer, maximum: 2000 },
      presentCount: { ...integer, maximum: 2000 },
      capturedAt: { bsonType: ["date", "null"] },
      createdAt: date,
      updatedAt: date,
    },
    not: {
      anyOf: [
        { required: ["prepClass"], properties: { scope: { enum: ["unit"] } } },
        {
          required: ["prepClass", "reportingKind"],
          properties: { reportingKind: { enum: ["sunday_reference"] } },
        },
      ],
    },
    oneOf: [
      {
        properties: {
          scope: { enum: ["church"] },
          unitId: { bsonType: "null" },
          unitName: { bsonType: "null" },
        },
      },
      {
        properties: {
          scope: { enum: ["unit"] },
          reportingKind: { enum: ["general"] },
          unitId: oid,
          unitName: { bsonType: "string" },
        },
      },
    ],
  },
  attendance_participants: {
    additionalProperties: false,
    required: [
      "_id",
      "churchId",
      "sessionId",
      "memberId",
      "code",
      "fullName",
      "nameKey",
      "nameTokens",
      "type",
      "areaName",
      "included",
      "present",
      "version",
      "capturedAt",
    ],
    properties: {
      _id: oid,
      churchId: oid,
      sessionId: oid,
      memberId: oid,
      code: { bsonType: "string" },
      fullName: { bsonType: "string" },
      nameKey: { bsonType: "string" },
      nameTokens: { bsonType: "array", items: { bsonType: "string" } },
      type: { enum: ["believer", "visitor"] },
      areaName: nullableText,
      included: { bsonType: "bool" },
      present: { bsonType: "bool" },
      version,
      capturedAt: date,
    },
    not: { properties: { included: { enum: [false] }, present: { enum: [true] } } },
  },
  attendance_history: {
    additionalProperties: false,
    required: [
      "_id",
      "churchId",
      "sessionId",
      "event",
      "before",
      "after",
      "reason",
      "actorKind",
      "actorId",
      "operationId",
      "occurredAt",
    ],
    properties: {
      _id: oid,
      churchId: oid,
      sessionId: oid,
      event: { bsonType: "string" },
      before: { bsonType: ["object", "null"] },
      after: { bsonType: "object" },
      reason: nullableText,
      actorKind: { enum: ["owner", "church_user"] },
      actorId: oid,
      operationId: oid,
      occurredAt: date,
    },
  },
};
export const attendanceIndexes: Record<
  string,
  {
    key: Record<string, 1 | -1>;
    name: string;
    unique?: boolean;
    partialFilterExpression?: object;
  }[]
> = {
  attendance_sessions: [
    {
      key: { churchId: 1, heldOn: 1 },
      name: "attendance_sunday_reference_unique",
      unique: true,
      partialFilterExpression: { reportingKind: "sunday_reference" },
    },
    {
      key: { churchId: 1, "prepClass.courseId": 1, state: 1, "prepClass.lessonId": 1 },
      name: "attendance_prep_progress",
    },
    {
      key: { churchId: 1 as const, heldOn: -1 as const, _id: -1 as const },
      name: "attendance_date",
    },
    {
      key: { churchId: 1 as const, unitId: 1 as const, heldOn: -1 as const, _id: -1 as const },
      name: "attendance_unit_date",
    },
  ],
  attendance_participants: [
    {
      key: { churchId: 1 as const, sessionId: 1 as const, memberId: 1 as const },
      name: "attendance_member_unique",
      unique: true,
    },
    {
      key: {
        churchId: 1 as const,
        sessionId: 1 as const,
        included: 1 as const,
        nameKey: 1 as const,
        memberId: 1 as const,
      },
      name: "attendance_roster",
    },
  ],
  attendance_history: [
    {
      key: {
        churchId: 1 as const,
        sessionId: 1 as const,
        occurredAt: -1 as const,
        _id: -1 as const,
      },
      name: "attendance_history_page",
    },
  ],
};
