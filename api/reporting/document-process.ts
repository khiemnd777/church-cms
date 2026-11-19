import { AppError } from "../errors";
import type { ReportDocument } from "./contracts";
import { normalizeTemplate, renderReport, starterWorkbook } from "./document";

try {
  const input = (await Bun.stdin.json()) as
    | { upload: string }
    | { document: ReportDocument }
    | { starter: true };
  if ("upload" in input) {
    console.log(
      JSON.stringify({ layout: await normalizeTemplate(Buffer.from(input.upload, "base64")) }),
    );
  } else if ("starter" in input) {
    console.log(JSON.stringify({ xlsx: (await starterWorkbook()).toString("base64") }));
  } else {
    const { xlsx, pdf } = await renderReport(input.document);
    console.log(JSON.stringify({ xlsx: xlsx.toString("base64"), pdf: pdf.toString("base64") }));
  }
} catch (error) {
  console.log(
    JSON.stringify(
      error instanceof AppError
        ? { code: error.code, status: error.status, fields: error.fieldErrors }
        : { code: "REPORT_FILE_INVALID", status: 422 },
    ),
  );
}
