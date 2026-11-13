import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { AppError, requireCondition } from "../errors";
import { digest } from "../identity/crypto";
import type { DocumentContent, DocumentPage } from "./models";
import { templateVersion } from "./models";
import { CertificateSources } from "./source";
import { isDocumentText } from "./validation";

let active = 0;
export const renderFingerprint = () =>
  digest(
    JSON.stringify([
      templateVersion,
      CertificateSources.prototype.capture.toString(),
      readFileSync(new URL("./render.ts", import.meta.url), "utf8"),
      readFileSync(new URL("./render-process.ts", import.meta.url), "utf8"),
      readFileSync(new URL("./fonts/sources.json", import.meta.url), "utf8"),
    ]),
  );
export async function renderCertificate(content: DocumentContent): Promise<{
  pdf: Buffer;
  docx: Buffer;
  pages: DocumentPage[];
  pdfHash: string;
  docxHash: string;
}> {
  // Source snapshots predate this module's input validation. Fail closed rather
  // than silently dropping XML-invalid text from a document that could be issued.
  requireCondition(
    [
      content.reference,
      content.title,
      content.churchName,
      content.affiliation ?? "",
      ...content.paragraphs.map((p) => p.text),
      ...content.signatures.flatMap((s) => [s.label, s.name ?? ""]),
    ].every(isDocumentText),
    422,
    "CERT_SOURCE_TEXT_INVALID",
  );
  requireCondition(active < 2, 429, "CERT_RENDER_BUSY");
  active++;
  let child: ReturnType<typeof Bun.spawn> | undefined,
    timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // A disposable process contains renderer crashes and avoids Bun 1.3.1's
    // observed repeated-Worker teardown crash. No source text is passed in argv.
    const processJob = Bun.spawn(
      [process.execPath, fileURLToPath(new URL("./render-process.ts", import.meta.url))],
      {
        stdin: new Blob([JSON.stringify(content)]),
        stdout: "pipe",
        stderr: "ignore",
        env: {},
      },
    );
    child = processJob;
    const job = (async () => {
      const reader = processJob.stdout.getReader(),
        chunks: Uint8Array[] = [];
      let length = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          length += value.length;
          requireCondition(length <= 8 * 1024 * 1024, 422, "CERT_FILE_LIMIT");
          chunks.push(value);
        }
      } finally {
        reader.releaseLock();
      }
      requireCondition((await processJob.exited) === 0, 503, "CERT_RENDER_FAILED");
      const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (!data.ok) throw new AppError(422, data.error);
      return {
        pages: data.pages as DocumentPage[],
        pdf: Buffer.from(data.pdf, "base64"),
        docx: Buffer.from(data.docx, "base64"),
        pdfHash: data.pdfHash as string,
        docxHash: data.docxHash as string,
      };
    })();
    return await Promise.race([
      job,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new AppError(503, "CERT_RENDER_TIMEOUT")), 15000);
      }),
    ]);
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError(503, "CERT_RENDER_FAILED");
  } finally {
    if (timer) clearTimeout(timer);
    if (child && child.exitCode === null) child.kill("SIGKILL");
    active--;
  }
}
