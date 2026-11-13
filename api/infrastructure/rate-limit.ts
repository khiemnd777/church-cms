import { createClient } from "redis";
import { AppError } from "../errors";
import { sign } from "../identity/crypto";
export class RateLimit {
  readonly client;
  constructor(
    url: string,
    private key: string,
  ) {
    this.client = createClient({
      url,
      socket: { connectTimeout: 1500, reconnectStrategy: false },
      disableOfflineQueue: true,
      commandOptions: { timeout: 1500 },
      commandsQueueMaxLength: 100,
    });
    this.client.on("error", () => {});
  }
  async connect() {
    if (!this.client.isOpen) await this.client.connect();
  }
  async ready() {
    if ((await this.client.ping()) !== "PONG") throw new Error("redis unavailable");
  }
  async consume(email: string, ip: string, realm: "owner" | "church" = "owner", churchCode = "") {
    const keys = [
      `qlht:${realm}:email:${sign(this.key, realm === "owner" ? email : `${churchCode}:${email}`)}`,
      `qlht:${realm}:ip:${sign(this.key, ip)}`,
    ];
    try {
      const result = (await this.client.eval(
        "local a=redis.call('INCR',KEYS[1]); if a==1 then redis.call('EXPIRE',KEYS[1],900) end; local b=redis.call('INCR',KEYS[2]); if b==1 then redis.call('EXPIRE',KEYS[2],900) end; return {a,b,redis.call('TTL',KEYS[1]),redis.call('TTL',KEYS[2])}",
        { keys, arguments: [] },
      )) as number[];
      if ((result[0] ?? 0) > 5 || (result[1] ?? 0) > 20)
        throw new AppError(
          429,
          "RATE_LIMITED",
          undefined,
          Math.max(1, (result[0] ?? 0) > 5 ? (result[2] ?? 900) : (result[3] ?? 900)),
        );
      return async () => {
        try {
          await this.client.eval(
            "if redis.call('EXISTS',KEYS[1])==1 then local n=redis.call('DECR',KEYS[1]); if n<=0 then redis.call('DEL',KEYS[1]) end end; return 1",
            { keys: [keys[0] as string], arguments: [] },
          );
        } catch {
          throw new AppError(503, "DEPENDENCY_UNAVAILABLE");
        }
      };
    } catch (e) {
      if (e instanceof AppError) throw e;
      throw new AppError(503, "DEPENDENCY_UNAVAILABLE");
    }
  }
  async qrResolution(churchId: string, actorKind: string, actorId: string) {
    const bucket = `qlht:qr-resolution:${sign(this.key, `${actorKind}:${churchId}:${actorId}`)}`;
    try {
      const r = (await this.client.eval(
        "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],60) end; return {n,redis.call('TTL',KEYS[1])}",
        { keys: [bucket], arguments: [] },
      )) as number[];
      if ((r[0] ?? 0) > 120)
        throw new AppError(429, "RATE_LIMITED", undefined, Math.max(1, r[1] ?? 60));
    } catch (e) {
      if (e instanceof AppError) throw e;
      throw new AppError(503, "DEPENDENCY_UNAVAILABLE");
    }
  }
  async reset(churchId: string, accountId: string, intent: string) {
    const bucket = `qlht:reset:${sign(this.key, `${churchId}:${accountId}`)}`,
      seen = `${bucket}:${sign(this.key, intent)}`;
    try {
      const r = (await this.client.eval(
        "if redis.call('EXISTS',KEYS[2])==1 then return {tonumber(redis.call('GET',KEYS[1]) or '0'),redis.call('TTL',KEYS[1])} end; local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],3600) end; redis.call('SET',KEYS[2],'1','EX',3600); return {n,redis.call('TTL',KEYS[1])}",
        { keys: [bucket, seen], arguments: [] },
      )) as number[];
      if ((r[0] ?? 0) > 5)
        throw new AppError(429, "RATE_LIMITED", undefined, Math.max(1, r[1] ?? 3600));
    } catch (e) {
      if (e instanceof AppError) throw e;
      throw new AppError(503, "DEPENDENCY_UNAVAILABLE");
    }
  }
}
