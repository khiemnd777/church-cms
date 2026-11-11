import { z } from "zod";
import { AppError, requireCondition } from "../errors";
import { digest, equal, sign } from "../identity/crypto";

const cursor = z.strictObject({
  v: z.literal(1),
  actor: z.string().regex(/^[a-f0-9]{24}$/),
  route: z.literal("F10"),
  filterHash: z.string(),
  mode: z.enum(["all", "exact", "prefix"]),
  lastName: z.string().max(400),
  lastId: z.string().regex(/^[a-f0-9]{24}$/),
  expiresAt: z.number().int(),
});
export type ChurchCursor = z.infer<typeof cursor>;
export class Cursors {
  constructor(
    private key: string,
    private now: () => Date = () => new Date(),
  ) {}
  filters(q: string, status: string | undefined) {
    return digest(JSON.stringify([q, status ?? null, "nameKey+id:asc"]));
  }
  encode(data: Omit<ChurchCursor, "v" | "route" | "expiresAt">) {
    const value = Buffer.from(
      JSON.stringify({
        ...data,
        v: 1,
        route: "F10",
        expiresAt: this.now().getTime() + 15 * 60_000,
      }),
    ).toString("base64url");
    return `${value}.${sign(this.key, `cursor:F10:${value}`)}`;
  }
  decode(value: string, actor: string, filterHash: string) {
    requireCondition(value.length <= 4096, 400, "INVALID_CURSOR");
    const pieces = value.split("."),
      payload = pieces[0],
      signature = pieces[1];
    requireCondition(
      pieces.length === 2 &&
        payload &&
        signature &&
        equal(signature, sign(this.key, `cursor:F10:${payload}`)),
      400,
      "INVALID_CURSOR",
    );
    let decoded: unknown;
    try {
      decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    } catch {
      throw new AppError(400, "INVALID_CURSOR");
    }
    const result = cursor.safeParse(decoded);
    requireCondition(result.success, 400, "INVALID_CURSOR");
    requireCondition(
      result.data.actor === actor && result.data.filterHash === filterHash,
      400,
      "CURSOR_CONTEXT_MISMATCH",
    );
    requireCondition(result.data.expiresAt > this.now().getTime(), 400, "CURSOR_EXPIRED");
    return result.data;
  }
}
