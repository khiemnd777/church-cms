import { renderDocuments } from "./render";

try {
  const content = await Bun.stdin.json();
  const result = await renderDocuments(content);
  await Bun.write(
    Bun.stdout,
    JSON.stringify({
      ok: true,
      pages: result.pages,
      pdf: result.pdf.toString("base64"),
      docx: result.docx.toString("base64"),
      pdfHash: result.pdfHash,
      docxHash: result.docxHash,
    }),
  );
} catch (e) {
  await Bun.write(
    Bun.stdout,
    JSON.stringify({
      ok: false,
      error:
        e instanceof Error && ["CERT_PAGE_LIMIT", "CERT_FILE_LIMIT"].includes(e.message)
          ? e.message
          : "CERT_RENDER_FAILED",
    }),
  );
}
