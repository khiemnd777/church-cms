import { AppError, requireCondition } from "./errors";
export async function readJson(req: Request): Promise<unknown> {
  requireCondition(Number(req.headers.get("content-length") ?? 0) <= 16384, 413, "INVALID_REQUEST");
  requireCondition(
    req.headers.get("content-type")?.split(";")[0] === "application/json",
    415,
    "INVALID_REQUEST",
  );
  const reader = req.body?.getReader(),
    chunks: Uint8Array[] = [];
  let size = 0;
  if (reader) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 16384) {
        await reader.cancel();
        throw new AppError(413, "INVALID_REQUEST");
      }
      chunks.push(value);
    }
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new AppError(400, "INVALID_REQUEST");
  }
}
