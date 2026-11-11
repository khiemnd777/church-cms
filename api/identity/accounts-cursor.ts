import { z } from "zod";
import { requireCondition } from "../errors";
import { digest, equal, sign } from "./crypto";

const schema = z.strictObject({
  v: z.literal(1),
  route: z.literal("F15"),
  actor: z.string().regex(/^[a-f0-9]{24}$/),
  church: z.string().regex(/^[a-f0-9]{24}$/),
  filter: z.string(),
  mode: z.enum(["exact", "prefix", "all"]),
  lastName: z.string().max(400),
  lastId: z.string().regex(/^[a-f0-9]{24}$/),
  expiresAt: z.number(),
});
export type AccountCursor = z.infer<typeof schema>;
export class AccountCursors {
  constructor(
    private key: string,
    private now: () => Date,
  ) {}
  filter(q: string, role: string, status: string) {
    return digest(JSON.stringify([q, role, status, "displayNameKey+id:asc"]));
  }
  encode(value: Omit<AccountCursor, "v" | "route" | "expiresAt">) {
    const data = Buffer.from(
      JSON.stringify({
        ...value,
        v: 1,
        route: "F15",
        expiresAt: this.now().getTime() + 15 * 60_000,
      }),
    ).toString("base64url");
    return `${data}.${sign(this.key, `cursor:F15:${data}`)}`;
  }
  decode(encoded: string, actor: string, church: string, filter: string) {
    requireCondition(encoded.length <= 4096, 400, "INVALID_CURSOR");
    const [data, sig, ...extra] = encoded.split(".");
    requireCondition(
      data && sig && !extra.length && equal(sig, sign(this.key, `cursor:F15:${data}`)),
      400,
      "INVALID_CURSOR",
    );
    let value: unknown;
    try {
      value = JSON.parse(Buffer.from(data, "base64url").toString("utf8"));
    } catch {
      requireCondition(false, 400, "INVALID_CURSOR");
    }
    const parsed = schema.safeParse(value);
    requireCondition(parsed.success, 400, "INVALID_CURSOR");
    const c = parsed.data;
    requireCondition(
      c.actor === actor && c.church === church && c.filter === filter,
      400,
      "CURSOR_CONTEXT_MISMATCH",
    );
    requireCondition(c.expiresAt > this.now().getTime(), 400, "CURSOR_EXPIRED");
    return c;
  }
}
