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
export const riteCertificateKinds = ["baptism", "dedication", "marriage"] as const;
export const kindSchema = z.enum([
  ...riteCertificateKinds,
  "transfer",
  "membership",
  "application",
  "visit",
]);
export const inputSchema = z
  .strictObject({
    kind: kindSchema,
    riteId: idSchema.nullable(),
    memberId: idSchema.nullable(),
    courseId: idSchema.nullable(),
    visitId: idSchema.optional(),
    destination: text(300).nullable().optional(),
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
  .refine((i) => {
    if (i.kind === "application")
      return !!i.memberId && !i.riteId && i.visitId === undefined && i.destination === undefined;
    if (i.kind === "baptism" || i.kind === "dedication" || i.kind === "marriage")
      return (
        !!i.riteId &&
        !i.memberId &&
        !i.courseId &&
        i.visitId === undefined &&
        i.destination === undefined
      );
    if (
      i.riteId ||
      i.courseId ||
      i.requestedOn ||
      Object.values(i.supplements).some(Boolean) ||
      i.supplementReason ||
      i.signers.applicant ||
      i.signers.guide
    )
      return false;
    if (i.kind === "visit") return !!i.visitId && !i.memberId && i.destination === undefined;
    return (
      !!i.memberId &&
      i.visitId === undefined &&
      (i.kind === "transfer" || i.destination === undefined)
    );
  });
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
