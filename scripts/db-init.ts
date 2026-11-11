import { config } from "../api/config";
import { Database, initialize } from "../api/infrastructure/database";

const conf = config();
if (
  !["127.0.0.1", "localhost"].includes(new URL(conf.mongoUrl).hostname) ||
  !conf.database.startsWith("church_cms_")
)
  throw new Error("Local Church CMS database only");
const db = new Database(conf);
try {
  await db.client.connect();
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      const hello = await db.db.admin().command({ hello: 1 });
      if (hello.isWritablePrimary) break;
    } catch {}
    if (attempt === 29) throw new Error("Replica set primary not ready");
    await Bun.sleep(500);
  }
  await initialize(db.db);
  await db.ready();
  console.info("Local validators/indexes/replica set ready.");
} finally {
  await db.client.close();
}
