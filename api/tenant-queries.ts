import { z } from "zod";
import type { TenantGrant } from "./authorization/tenant-grant";
import { AppError, requireCondition } from "./errors";
import { digest, equal, sign } from "./identity/crypto";

const cursor = z.strictObject({
  context: z.string(),
  key: z.string().max(400),
  id: z.string().regex(/^[a-f0-9]{24}$/),
  expires: z.number(),
});
export class TenantQueries {
  constructor(
    private key: string,
    protected now: () => Date,
    private domain = "members",
  ) {}
  context(g: TenantGrant, route: string, filters: unknown) {
    return digest(
      JSON.stringify([g.actorKind, g.actorId, g.churchId, g.policyContext, route, filters]),
    );
  }
  encode(context: string, key: string, id: string) {
    const payload = Buffer.from(
      JSON.stringify({ context, key, id, expires: this.now().getTime() + 15 * 60_000 }),
    ).toString("base64url");
    return `${payload}.${sign(this.key, `${this.domain}:${payload}`)}`;
  }
  decode(token: string, context: string) {
    requireCondition(token.length <= 4096, 400, "INVALID_CURSOR");
    const [payload, sig, ...rest] = token.split(".");
    requireCondition(
      payload && sig && !rest.length && equal(sig, sign(this.key, `${this.domain}:${payload}`)),
      400,
      "INVALID_CURSOR",
    );
    let raw: unknown;
    try {
      raw = JSON.parse(Buffer.from(payload, "base64url").toString());
    } catch {
      throw new AppError(400, "INVALID_CURSOR");
    }
    const v = cursor.safeParse(raw);
    requireCondition(v.success, 400, "INVALID_CURSOR");
    requireCondition(v.data.context === context, 400, "CURSOR_CONTEXT_MISMATCH");
    requireCondition(v.data.expires > this.now().getTime(), 400, "CURSOR_EXPIRED");
    return v.data;
  }
  limit(query: URLSearchParams) {
    const value = query.get("limit") ?? "25";
    requireCondition(
      /^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= 100,
      400,
      "INVALID_REQUEST",
    );
    return Number(value);
  }
  allow(query: URLSearchParams, fields: string[]) {
    requireCondition(
      [...query.keys()].every((k) => fields.includes(k) && query.getAll(k).length === 1),
      400,
      "INVALID_REQUEST",
    );
  }
}
