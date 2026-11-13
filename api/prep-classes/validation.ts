import { z } from "zod";
import { daySchema, idSchema } from "../members/validation";

const text = (max: number) => z.string().normalize("NFC").trim().min(1).max(max);
export const reason = text(500);
export const courseInput = z
  .strictObject({
    name: text(200),
    startOn: daySchema,
    teacher: text(200).nullable(),
    baptismOn: daySchema.nullable(),
    lessons: z.array(text(200)).min(1).max(200),
  })
  .refine((v) => !v.baptismOn || v.baptismOn >= v.startOn);
export const coursePatch = courseInput
  .safeExtend({ reason })
  .refine((v) => !v.baptismOn || v.baptismOn >= v.startOn);
export const enrollmentInput = z.strictObject({
  memberId: idSchema,
  confirmUnknown: z.boolean(),
  reason: reason.nullable(),
});
export const stateInput = z.strictObject({
  state: z.enum(["studying", "withdrawn"]),
  confirmUnknown: z.boolean(),
  reason,
});
export const interviewInput = z.strictObject({ heldOn: daySchema, interviewer: text(200), reason });
export const meetingInput = z
  .strictObject({
    lessonId: idSchema,
    kind: z.enum(["regular", "makeup"]),
    heldOn: daySchema,
    location: text(500).nullable(),
    memberIds: z.array(idSchema).max(2000).nullable(),
  })
  .refine((v) =>
    v.kind === "regular"
      ? v.memberIds === null
      : !!v.memberIds?.length &&
        new Set(v.memberIds.map((id) => id.toLowerCase())).size === v.memberIds.length,
  );
