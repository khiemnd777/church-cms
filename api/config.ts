export interface Config {
  origin: string;
  port: number;
  mongoUrl: string;
  database: string;
  redisUrl: string;
  csrfKey: string;
  cert: string;
  key: string;
}
export function config(): Config {
  const origin = process.env.APP_ORIGIN ?? "https://localhost:3443";
  const url = new URL(origin);
  const csrfKey = process.env.CSRF_KEY ?? "";
  if (url.protocol !== "https:" || url.origin !== origin || csrfKey.length < 64)
    throw new Error("HTTPS origin / CSRF_KEY configuration required");
  return {
    origin,
    port: Number(process.env.APP_PORT ?? 3443),
    mongoUrl:
      process.env.MONGO_URL ??
      "mongodb://127.0.0.1:27119/?replicaSet=church-local&directConnection=true",
    database: process.env.MONGO_DB ?? "church_cms_local",
    redisUrl: process.env.REDIS_URL ?? "redis://127.0.0.1:6391",
    csrfKey,
    cert: process.env.TLS_CERT ?? ".local/localhost.pem",
    key: process.env.TLS_KEY ?? ".local/localhost-key.pem",
  };
}
