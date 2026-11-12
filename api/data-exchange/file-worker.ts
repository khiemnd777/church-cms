import { AppError } from "../errors";
import { decodeFile } from "./files";

self.onmessage = async (event: MessageEvent) => {
  try {
    self.postMessage({ sheets: await decodeFile(event.data.bytes, event.data.format) });
  } catch (e) {
    self.postMessage({
      error: e instanceof AppError ? e.code : "FILE_INVALID",
      status: e instanceof AppError ? e.status : 422,
    });
  }
};
