import { config } from "../api/config";
import { AppError } from "../api/errors";
import { OwnerOperations } from "../api/identity/owner-operations";
import { Database } from "../api/infrastructure/database";

const conf = config();
if (
  !["localhost", "127.0.0.1"].includes(new URL(conf.mongoUrl).hostname) ||
  conf.database !== "church_cms_local"
)
  throw new Error("Local synthetic owner operations only");
const db = new Database(conf);
const [command, ...args] = process.argv.slice(2);
try {
  await db.client.connect();
  await db.ready();
  const ops = new OwnerOperations(db);
  if (command === "create" && args.length === 2) {
    if (!process.stdout.isTTY)
      throw new Error(
        "Use an interactive terminal: temporary password is shown once, never redirect to a file/log.",
      );
    const result = await ops.create({ email: args[0], displayName: args[1] });
    console.info(JSON.stringify({ ...result, loginUrl: `${conf.origin}/owner/login` }, null, 2));
  } else if (
    command === "status" &&
    args.length === 3 &&
    (args[2] === "active" || args[2] === "locked")
  ) {
    await ops.status(args[0] as string, args[1] as string, args[2]);
    console.info("Owner status updated; sessions revoked.");
  } else
    throw new Error(
      "Usage: bun run owner create <synthetic-email> <name> | status <actor-owner-id> <target-owner-id> active|locked",
    );
} catch (e) {
  console.error(
    e instanceof AppError
      ? e.code
      : e instanceof Error &&
          (e.message.startsWith("Usage:") || e.message.startsWith("Use an interactive terminal:"))
        ? e.message
        : "Owner operation failed; check local configuration and dependencies",
  );
  process.exitCode = 1;
} finally {
  await db.client.close();
}
