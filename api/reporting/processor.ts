import { fileURLToPath } from "node:url";
import { AppError, requireCondition } from "../errors";
import type { Layout } from "./contracts";

let running = 0;
export async function reportProcess(input: object) {
  requireCondition(running < 2, 429, "REPORT_PROCESS_BUSY");
  running++;
  let child: ReturnType<typeof Bun.spawn> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const job = Bun.spawn(
      [process.execPath, fileURLToPath(new URL("./document-process.ts", import.meta.url))],
      {
        stdin: new Blob([JSON.stringify(input)]),
        stdout: "pipe",
        stderr: "ignore",
        env: {},
      },
    );
    child = job;
    const work = async () => {
      const reader = job.stdout.getReader(),
        parts: Uint8Array[] = [];
      let length = 0;
      try {
        for (;;) {
          const item = await reader.read();
          if (item.done) break;
          length += item.value.byteLength;
          requireCondition(length <= 4 * 1024 * 1024, 422, "REPORT_LAYOUT_LIMIT");
          parts.push(item.value);
        }
      } finally {
        reader.releaseLock();
      }
      requireCondition((await job.exited) === 0, 503, "REPORT_PROCESS_FAILED");
      const result = JSON.parse(Buffer.concat(parts).toString("utf8")) as {
        layout?: Layout;
        xlsx?: string;
        pdf?: string;
        code?: string;
        status?: number;
        fields?: Record<string, string>;
      };
      if (result.code) throw new AppError(result.status ?? 422, result.code, result.fields);
      return result;
    };
    return await Promise.race([
      work(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new AppError(503, "REPORT_PROCESS_TIMEOUT")), 12000);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    if (child && child.exitCode === null) child.kill();
    if (child) await child.exited;
    running--;
  }
}
