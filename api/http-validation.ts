import { ObjectId } from "mongodb";
import type { z } from "zod";
import { AppError, requireCondition } from "./errors";
export function objectId(id: string) {
  requireCondition(/^[a-f0-9]{24}$/i.test(id), 400, "INVALID_REQUEST");
  return new ObjectId(id);
}
export function version(header: string | null) {
  requireCondition(header !== null, 428, "PRECONDITION_REQUIRED");
  requireCondition(/^"[1-9][0-9]*"$/.test(header), 400, "INVALID_REQUEST");
  const n = Number(header.slice(1, -1));
  requireCondition(Number.isSafeInteger(n), 400, "INVALID_REQUEST");
  return n;
}
export function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body);
  if (!r.success) {
    const fields: Record<string, string> = {};
    for (const issue of r.error.issues)
      fields[issue.path.join(".") || "_form"] = "Kiểm tra thông tin đã nhập.";
    throw new AppError(422, "VALIDATION_FAILED", fields);
  }
  return r.data;
}
export function idempotencyKey(key: string | null): string {
  requireCondition(
    key && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key),
    400,
    "INVALID_REQUEST",
  );
  return key.toLowerCase();
}
