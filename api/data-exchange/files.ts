import { createHash } from "node:crypto";
import ExcelJS from "exceljs";
import { Unzip, UnzipInflate } from "fflate";
import { AppError, requireCondition } from "../errors";
import { type FileFormat, importFields, limits, type SheetData } from "./contracts";

const decoder = new TextDecoder("utf-8", { fatal: true });
export function csvRows(bytes: Uint8Array, maxRows: number = limits.rows): string[][] {
  const text = decoder.decode(bytes).replace(/^\uFEFF/u, "");
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false,
    closed = false;
  const finishCell = () => {
    row.push(cell);
    requireCondition(row.length <= limits.columns, 413, "FILE_LIMIT");
    cell = "";
    closed = false;
  };
  const finishRow = () => {
    finishCell();
    rows.push(row);
    row = [];
    requireCondition(rows.length <= maxRows + 1, 413, "FILE_LIMIT");
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i] as string;
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else cell += c;
    } else if (c === '"') {
      requireCondition(!cell && !closed, 422, "FILE_INVALID");
      quoted = true;
    } else if (c === ",") finishCell();
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      finishRow();
    } else {
      requireCondition(!closed && c !== "\0", 422, "FILE_INVALID");
      cell += c;
    }
    requireCondition(cell.length <= limits.cellChars, 413, "FILE_LIMIT");
  }
  requireCondition(!quoted, 422, "FILE_INVALID");
  if (cell || row.length || closed) finishRow();
  return rows;
}
function table(name: string, values: string[][]): SheetData {
  const headers = values.shift();
  requireCondition(
    headers?.length &&
      headers.every((h) => h.trim() && h.length <= 200) &&
      new Set(headers).size === headers.length,
    422,
    "FILE_HEADERS",
  );
  const rows = values.filter((r) => r.some((c) => c !== ""));
  requireCondition(
    rows.every((r) => r.length === headers.length),
    422,
    "FILE_INVALID",
  );
  return { name, headers, rows };
}
// Count actual expanded bytes before ExcelJS sees the ZIP. Never trust advertised sizes.
function inspectZip(bytes: Uint8Array) {
  let total = 0,
    count = 0,
    finished = 0;
  let violation: AppError | undefined;
  const names = new Set<string>();
  const zip = new Unzip((file) => {
    requireCondition(
      ++count <= limits.zipEntries &&
        !names.has(file.name) &&
        !file.name.includes("..") &&
        !file.name.startsWith("/"),
      413,
      "FILE_LIMIT",
    );
    names.add(file.name);
    requireCondition(
      !/vbaProject|externalLinks|embeddings|activex/i.test(file.name),
      422,
      "FILE_UNSAFE",
    );
    const chunks: Uint8Array[] = [];
    file.ondata = (error, chunk, final) => {
      if (violation) return;
      try {
        requireCondition(!error, 422, "FILE_INVALID");
        total += chunk.byteLength;
        requireCondition(total <= limits.expandedBytes, 413, "FILE_LIMIT");
        if (/\.(xml|rels)$/i.test(file.name)) chunks.push(chunk);
        if (final) {
          finished++;
          if (chunks.length) {
            const xml = decoder.decode(Buffer.concat(chunks));
            requireCondition(
              !/<!DOCTYPE|<!ENTITY|<(?:\w+:)?f(?:\s|>)|TargetMode\s*=\s*["']External["']|macroEnabled/i.test(
                xml,
              ),
              422,
              "FILE_UNSAFE",
            );
          }
        }
      } catch (e) {
        violation = e instanceof AppError ? e : new AppError(422, "FILE_INVALID");
      }
    };
    file.start();
  });
  zip.register(UnzipInflate);
  // Small input chunks bound inflater output before the next limit check.
  for (let i = 0; i < bytes.length; i += 1024) {
    zip.push(bytes.subarray(i, i + 1024), i + 1024 >= bytes.length);
    if (violation) throw violation;
  }
  requireCondition(
    count > 0 && finished === count && names.has("xl/workbook.xml"),
    422,
    "FILE_INVALID",
  );
}
export async function decodeFile(bytes: Uint8Array, format: FileFormat): Promise<SheetData[]> {
  requireCondition(bytes.byteLength > 0 && bytes.byteLength <= limits.fileBytes, 413, "FILE_LIMIT");
  if (format === "csv") return [table("CSV", csvRows(bytes))];
  inspectZip(bytes);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(Buffer.from(bytes) as never);
  requireCondition(book.worksheets.length > 0 && book.worksheets.length <= 20, 413, "FILE_LIMIT");
  let count = 0;
  return book.worksheets.map((sheet) => {
    requireCondition(
      sheet.rowCount <= limits.rows + 1 && sheet.columnCount <= limits.columns,
      413,
      "FILE_LIMIT",
    );
    const rows: string[][] = [];
    for (let ri = 1; ri <= sheet.rowCount; ri++) {
      const row: string[] = [];
      for (let ci = 1; ci <= sheet.columnCount; ci++) {
        const cell = sheet.getCell(ri, ci),
          v = cell.value;
        let text: string;
        if (v === null || v === undefined) text = "";
        else if (v instanceof Date) {
          requireCondition(
            Number.isFinite(v.getTime()) && v.toISOString().slice(11) === "00:00:00.000Z",
            422,
            "FILE_DATE",
          );
          // Excel serial 60 represents a nonexistent 1900-02-29; ExcelJS aliases it to 02-28.
          requireCondition(
            book.properties.date1904 || v.toISOString().slice(0, 10) !== "1900-02-28",
            422,
            "FILE_DATE",
          );
          text =
            !book.properties.date1904 && v.toISOString().slice(0, 10) < "1900-02-28"
              ? new Date(v.getTime() + 86_400_000).toISOString().slice(0, 10)
              : v.toISOString().slice(0, 10);
        } else if (typeof v === "string" || typeof v === "number" || typeof v === "boolean")
          text = String(v);
        else {
          requireCondition("richText" in v, 422, "FILE_UNSAFE");
          text = v.richText.map((t) => t.text).join("");
        }
        requireCondition(
          text.length <= limits.cellChars && !text.includes("\0"),
          413,
          "FILE_LIMIT",
        );
        row.push(text);
      }
      rows.push(row);
    }
    const result = table(sheet.name, rows);
    count += result.rows.length;
    requireCondition(count <= limits.rows, 413, "FILE_LIMIT");
    return result;
  });
}
let readers = 0;
export async function parseFile(bytes: Uint8Array, format: FileFormat): Promise<SheetData[]> {
  requireCondition(readers < 2, 429, "FILE_BUSY");
  readers++;
  try {
    return await new Promise((resolve, reject) => {
      const worker = new Worker(new URL("./file-worker.ts", import.meta.url).href);
      const timer = setTimeout(() => {
        worker.terminate();
        reject(new AppError(413, "FILE_LIMIT"));
      }, 10_000);
      worker.onmessage = (event) => {
        clearTimeout(timer);
        worker.terminate();
        const r = event.data;
        if (r.error) reject(new AppError(r.status, r.error));
        else resolve(r.sheets);
      };
      worker.onerror = () => {
        clearTimeout(timer);
        worker.terminate();
        reject(new AppError(422, "FILE_INVALID"));
      };
      worker.postMessage({ bytes, format });
    });
  } finally {
    readers--;
  }
}
export async function makeFile(headers: readonly string[], rows: string[][], format: FileFormat) {
  let protectedCells = 0;
  if (format === "csv") {
    const csv = `${[Array.from(headers), ...rows]
      .map((row) =>
        row
          .map((value) => {
            // Viewing CSV in a spreadsheet is lossy; report the number of cells given a text prefix.
            const first = Array.from(value).find((c) => c.charCodeAt(0) > 32 && !/\s/u.test(c));
            if (
              (first && "=+-@＝＋－＠".includes(first)) ||
              ["\t", "\r", "\n"].includes(value[0] ?? "")
            ) {
              value = `'${value}`;
              protectedCells++;
            }
            return `"${value.replaceAll('"', '""')}"`;
          })
          .join(","),
      )
      .join("\r\n")}\r\n`;
    const bytes = Buffer.from(`\uFEFF${csv}`, "utf8");
    requireCondition(bytes.length <= limits.fileBytes, 413, "FILE_LIMIT");
    return { bytes, protectedCells };
  }
  const book = new ExcelJS.Workbook(),
    sheet = book.addWorksheet("ThuocVien");
  sheet.addRow(Array.from(headers));
  for (const row of rows) {
    const added = sheet.addRow(row);
    added.eachCell((cell) => {
      cell.numFmt = "@";
    });
  }
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.columns.forEach((col) => {
    col.width = 24;
  });
  const bytes = Buffer.from(await book.xlsx.writeBuffer());
  requireCondition(bytes.length <= limits.fileBytes, 413, "FILE_LIMIT");
  return { bytes, protectedCells };
}
export function templateRows() {
  const values: Partial<Record<(typeof importFields)[number], string>> = {
    externalId: "DEMO-001",
    fullName: "Nguyễn An (synthetic)",
    gender: "unknown",
    birthDate: "2000-01-02",
    phone: "0900000001",
    type: "believer",
    membership: "member",
    participation: "active",
    familyKey: "DEMO-HO-1",
    householdRole: "head",
    assignmentMode: "auto",
    baptismStatus: "unknown",
    consent: "true",
  };
  return [importFields.map((f) => values[f] ?? "")];
}

export const fileDigest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
