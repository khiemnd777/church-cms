import { createApp } from "./app";
import { config } from "./config";
import { Identity } from "./identity/service";
import { Database } from "./infrastructure/database";
import { RateLimit } from "./infrastructure/rate-limit";

const conf = config(),
  db = new Database(conf),
  rate = new RateLimit(conf.redisUrl, conf.csrfKey);
try {
  await db.client.connect();
  await rate.connect();
  await db.ready();
  await rate.ready();
} catch {
  console.error("Required local dependencies unavailable; run local setup/db:init.");
  process.exit(1);
}
const identity = new Identity(db, rate, conf);
await identity.initialize();
const app = createApp(identity, conf);
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: conf.port,
  tls: { cert: Bun.file(conf.cert), key: Bun.file(conf.key) },
  maxRequestBodySize: 16384,
  idleTimeout: 15,
  fetch: (req, server) => app(req, { ip: server.requestIP(req)?.address ?? "unknown" }),
});
console.info(`Church CMS listening at ${conf.origin}`);
async function stop() {
  await server.stop(true);
  await db.client.close();
  rate.client.destroy();
  process.exit(0);
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
