import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { AppError } from "../errors";
export const digest = (value: string) => createHash("sha256").update(value).digest("hex");
export const opaque = () => randomBytes(32).toString("base64url");
export const sign = (key: string, value: string) =>
  createHmac("sha256", key).update(value).digest("hex");
export function equal(a: string, b: string) {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
export const csrf = (key: string, realm: string, tokenHash: string) =>
  sign(key, `v1:${realm}:${tokenHash}:csrf`);
export function temporaryPassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from(randomBytes(20), (b) => alphabet[b & 31]).join("");
}
// Versioned small local blocklist; deliberately no remote password lookup.
export const BLOCKLIST_VERSION = "local-common-v1";
const blocked = new Set([
  "password",
  "password1",
  "password123",
  "12345678",
  "123456789",
  "1234567890",
  "qwerty123",
  "abcdefgh",
  "iloveyou",
  "admin123",
  "matkhau123",
]);
export function validatePassword(value: unknown): string {
  if (
    typeof value !== "string" ||
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value) ||
    [...value].length < 8 ||
    [...value].length > 128 ||
    Buffer.byteLength(value) > 512 ||
    blocked.has(value.toLowerCase())
  )
    throw new AppError(422, "VALIDATION_FAILED", {
      newPassword: "Dùng 8–128 ký tự và tránh mật khẩu phổ biến.",
    });
  return value;
}
let hashing = 0;
async function bounded<T>(fn: () => Promise<T>): Promise<T> {
  if (hashing >= 4) throw new AppError(503, "DEPENDENCY_UNAVAILABLE", undefined, 1);
  hashing++;
  try {
    return await fn();
  } finally {
    hashing--;
  }
}
export const hashPassword = (password: string) =>
  bounded(() =>
    Bun.password.hash(password, { algorithm: "argon2id", memoryCost: 65536, timeCost: 3 }),
  );
export const verifyPassword = (password: string, hash: string) =>
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(password)
    ? Promise.resolve(false)
    : bounded(() => Bun.password.verify(password, hash));
