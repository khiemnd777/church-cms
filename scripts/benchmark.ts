import { cpus } from "node:os";
import { hashPassword, verifyPassword } from "../api/identity/crypto";

const rows = [];
for (const concurrency of [1, 2, 4]) {
  const start = performance.now(),
    before = process.memoryUsage().rss;
  const values = Array.from({ length: concurrency }, () => crypto.randomUUID());
  let peak = before;
  const sampler = setInterval(() => {
    peak = Math.max(peak, process.memoryUsage().rss);
  }, 5);
  const hashes = await Promise.all(values.map(hashPassword));
  const hashMs = performance.now() - start,
    verifyStart = performance.now();
  const valid = await Promise.all(
    hashes.map((hash, i) => verifyPassword(values[i] as string, hash)),
  );
  clearInterval(sampler);
  peak = Math.max(peak, process.memoryUsage().rss);
  rows.push({
    concurrency,
    hashBatchMs: Math.round(hashMs),
    verifyBatchMs: Math.round(performance.now() - verifyStart),
    rssPeakMiB: Math.round(peak / 1048576),
    rssBeforeMiB: Math.round(before / 1048576),
    rssAfterMiB: Math.round(process.memoryUsage().rss / 1048576),
    allVerified: valid.every(Boolean),
  });
}
console.info(
  JSON.stringify(
    {
      bun: Bun.version,
      platform: process.platform,
      cpu: cpus()[0]?.model,
      logicalCpus: cpus().length,
      arch: process.arch,
      algorithm: "argon2id",
      memoryKiB: 65536,
      timeCost: 3,
      parallelism: "encoded in hash; asserted in tests",
      rows,
    },
    null,
    2,
  ),
);
