import { z } from "zod";
import { daySchema, idSchema } from "../members/validation";

export const isDocumentText = (s: string) =>
  Array.from(s).every((c) => {
    const n = c.codePointAt(0) ?? 0;
    return (
      (n >= 32 || n === 9 || n === 10 || n === 13) &&
      !(n >= 0xd800 && n <= 0xdfff) &&
      n !== 0xfffe &&
      n !== 0xffff
    );
  });
const text = (n: number) => z.string().normalize("NFC").trim().min(1).max(n).refine(isDocumentText);
export const kindSchema = z.enum(["baptism", "dedication", "marriage", "application"]);
export const inputSchema = z
  .strictObject({
    kind: kindSchema,
    riteId: idSchema.nullable(),
    memberId: idSchema.nullable(),
    courseId: idSchema.nullable(),
    affiliation: text(300).nullable(),
    issuedOn: daySchema,
    requestedOn: daySchema.nullable(),
    supplements: z.strictObject({
      birthDate: daySchema.nullable(),
      eventDate: daySchema.nullable(),
      place: text(200).nullable(),
      parents: text(2000).nullable(),
      group: text(300).nullable(),
    }),
    supplementReason: text(500).nullable(),
    signers: z.strictObject({
      secretary: text(200).nullable(),
      pastor: text(200).nullable(),
      applicant: text(200).nullable(),
      guide: text(200).nullable(),
    }),
  })
  .refine((i) =>
    i.kind === "application" ? !!i.memberId && !i.riteId : !!i.riteId && !i.memberId && !i.courseId,
  );
export const draftInput = z.strictObject({ input: inputSchema, reason: text(500).nullable() });
export const issueInput = z.strictObject({
  previewId: idSchema,
  context: z.string().length(64),
  confirm: z.literal(true),
  faithConfirmed: z.boolean(),
  reason: text(500).nullable(),
});
export const reasonInput = z.strictObject({ reason: text(500) });
export type CertificateInput = z.infer<typeof inputSchema>;
export type CertificateKind = z.infer<typeof kindSchema>;
