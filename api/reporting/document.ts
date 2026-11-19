import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import { inspectZip } from "../data-exchange/files";
import { AppError, requireCondition } from "../errors";
import {
  type Layout,
  type Metric,
  type ReportDocument,
  reportLimits,
  reportMark,
  reportMetrics,
  reportTime,
  type TemplateCell,
} from "./contracts";

const allowedPart =
  /^(?:\[Content_Types\]\.xml|_rels\/\.rels|docProps\/(?:app|core)\.xml|xl\/(?:workbook\.xml|_rels\/workbook\.xml\.rels|worksheets\/sheet\d+\.xml|styles\.xml|sharedStrings\.xml|theme\/theme\d+\.xml))$/;
const invalidText = (value: string, multiline = false) =>
  Array.from(value).some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return (
      (code < 32 && !(multiline && [9, 10, 13].includes(code))) ||
      (code >= 0xd800 && code <= 0xdfff) ||
      code === 65534 ||
      code === 65535
    );
  });
const marker = /^\{\{([a-z_]+)\}\}$/;

export async function normalizeTemplate(bytes: Uint8Array): Promise<Layout> {
  inspectZip(
    bytes,
    (name) =>
      allowedPart.test(name) ||
      /^(?:_rels|docProps|xl(?:\/(?:worksheets|_rels|theme))?)\/$/.test(name),
  );
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(Buffer.from(bytes) as never);
  requireCondition(book.worksheets.length === 1, 422, "REPORT_ONE_SHEET");
  requireCondition(!book.definedNames.model.length, 422, "FILE_UNSAFE");
  const sheet = book.worksheets[0];
  requireCondition(sheet, 422, "REPORT_ONE_SHEET");
  requireCondition(
    sheet.state === "visible" &&
      sheet.rowCount <= reportLimits.rows &&
      sheet.columnCount >= 1 &&
      sheet.columnCount <= reportLimits.columns,
    422,
    "REPORT_LAYOUT_LIMIT",
  );
  let bindings = 0;
  const rows: TemplateCell[][] = [];
  for (let i = 1; i <= sheet.rowCount; i++) {
    const row = sheet.getRow(i);
    requireCondition(!row.hidden, 422, "FILE_UNSAFE");
    const cells: TemplateCell[] = [];
    for (let j = 1; j <= sheet.columnCount; j++) {
      const cell = row.getCell(j);
      const value = cell.isMerged && cell.master.address !== cell.address ? null : cell.value;
      let text = "";
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean")
        text = String(value).normalize("NFC").trim();
      else if (value && typeof value === "object" && "richText" in value)
        text = value.richText
          .map((part) => part.text)
          .join("")
          .normalize("NFC")
          .trim();
      else if (value !== null && value !== undefined)
        throw new AppError(422, "REPORT_CELL_INVALID", {
          [cell.address]: "Dùng văn bản hoặc mã chỉ tiêu.",
        });
      if (text.length > reportLimits.text || invalidText(text, true))
        throw new AppError(422, "REPORT_CELL_INVALID", {
          [cell.address]: "Nội dung ô quá dài hoặc có ký tự không hợp lệ.",
        });
      const match = marker.exec(text);
      if (text.includes("{{") || text.includes("}}")) {
        if (!match || !Object.hasOwn(reportMetrics, match[1] ?? ""))
          throw new AppError(422, "REPORT_CELL_INVALID", {
            [cell.address]: "Mã chỉ tiêu không hợp lệ hoặc không đứng riêng trong ô.",
          });
        bindings++;
      }
      cells.push({
        text,
        ...(match ? { metric: match[1] as Metric } : {}),
        ...(cell.font?.bold ? { bold: true } : {}),
      });
    }
    rows.push(cells);
  }
  requireCondition(bindings > 0, 422, "REPORT_NO_METRICS");
  const widths = Array.from({ length: sheet.columnCount }, (_, i) => {
    const column = sheet.getColumn(i + 1);
    requireCondition(!column.hidden, 422, "FILE_UNSAFE");
    return Math.max(10, Math.min(65, column.width ?? (i === 0 ? 42 : 20)));
  });
  requireCondition(sheet.name.length <= 31 && !invalidText(sheet.name), 422, "FILE_UNSAFE");
  return { name: sheet.name, rows, widths };
}

export async function starterWorkbook() {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("Thống kê nội bộ");
  sheet.columns = [{ width: 49 }, { width: 27 }];
  sheet.addRow(["THỐNG KÊ HỘI THÁNH"]).font = { bold: true };
  sheet.addRow(["Chỉ tiêu", "Số liệu"]).font = { bold: true };
  for (const [key, label] of Object.entries(reportMetrics)) sheet.addRow([label, `{{${key}}}`]);
  return Buffer.from(await book.xlsx.writeBuffer());
}

const metadata = (r: ReportDocument) => [
  `Hội Thánh: ${r.church}`,
  `Mẫu: ${r.template}`,
  `Hiện trạng lúc tổng hợp: ${reportTime(r.capturedAt)} (giờ Việt Nam)`,
  `Sự kiện trong kỳ: ${r.from} – ${r.to}`,
  ...r.warnings,
];
export async function renderReport(r: ReportDocument) {
  const book = new ExcelJS.Workbook(),
    sheet = book.addWorksheet("Báo cáo nội bộ");
  sheet.columns = r.widths.map((width) => ({ width }));
  const addLine = (text: string, bold = false) => {
    const row = sheet.addRow([text]);
    if (r.widths.length > 1) sheet.mergeCells(row.number, 1, row.number, r.widths.length);
    row.font = { bold };
    row.alignment = { wrapText: true, vertical: "middle" };
    row.height =
      17 *
      Math.max(1, Math.ceil(text.length / Math.max(12, r.widths.reduce((a, b) => a + b, 0) - 4)));
  };
  addLine(reportMark, true);
  for (const line of metadata(r)) addLine(line);
  for (const cells of r.rows) {
    const first = cells[0];
    if (
      first &&
      typeof first.value === "string" &&
      first.value &&
      cells.slice(1).every((cell) => cell.value === "")
    ) {
      addLine(first.value, first.bold);
      continue;
    }
    const row = sheet.addRow(cells.map((cell) => cell.value));
    let lines = 1;
    cells.forEach((value, i) => {
      const cell = row.getCell(i + 1);
      cell.font = { bold: value.bold === true };
      cell.alignment = { wrapText: true, vertical: "middle" };
      if (typeof value.value === "string") cell.numFmt = "@";
      lines = Math.max(
        lines,
        String(value.value)
          .split("\n")
          .reduce(
            (max, v) =>
              max + Math.max(1, Math.ceil(v.length / Math.max(8, (r.widths[i] ?? 10) - 2))),
            0,
          ),
      );
    });
    row.height = Math.min(400, 16 * lines);
  }
  sheet.pageSetup = {
    paperSize: 9,
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    printTitlesRow: "1:1",
  };
  const xlsx = Buffer.from(await book.xlsx.writeBuffer());
  const pdf = await renderPdf(r);
  return { xlsx, pdf };
}
async function renderPdf(r: ReportDocument): Promise<Buffer> {
  const doc = new PDFDocument({ autoFirstPage: false, size: "A4", margin: 40 });
  const result = new Promise<Buffer>((resolve, reject) => {
    const parts: Buffer[] = [];
    doc.on("data", (part: Buffer) => parts.push(part));
    doc.on("end", () => resolve(Buffer.concat(parts)));
    doc.on("error", reject);
  });
  for (const [alias, filename] of [
    ["Regular", "BeVietnamPro-Regular.ttf"],
    ["Bold", "BeVietnamPro-Bold.ttf"],
  ] as const)
    doc.registerFont(
      alias,
      fileURLToPath(new URL(`../certificates/fonts/${filename}`, import.meta.url)),
    );
  let count = 0,
    y = 0;
  const page = () => {
    requireCondition(++count <= 25, 422, "REPORT_LAYOUT_LIMIT");
    doc.addPage();
    doc.font("Bold").fontSize(12).text(reportMark, 40, 38, { lineBreak: false });
    doc.font("Regular").fontSize(9).text(`Trang ${count}`, 480, 38, { lineBreak: false });
    y = 64;
  };
  page();
  const width = doc.page.width - 80,
    end = doc.page.height - 42;
  const total = r.widths.reduce((a, b) => a + b, 0);
  for (const line of metadata(r)) {
    doc.font("Regular").fontSize(10);
    const height = doc.heightOfString(line, { width });
    if (y + height > end) page();
    doc.font("Regular").fontSize(10).text(line, 40, y, { width, lineBreak: true });
    y += height + 3;
  }
  y += 10;
  for (const row of r.rows) {
    const full = row.slice(1).every((cell) => cell.value === "");
    const cells = full ? row.slice(0, 1) : row;
    const sizes = full ? [width] : cells.map((_, i) => (width * (r.widths[i] ?? 10)) / total);
    const height =
      Math.max(
        15,
        ...cells.map((cell, i) =>
          doc
            .font(cell.bold ? "Bold" : "Regular")
            .fontSize(10)
            .heightOfString(String(cell.value), { width: (sizes[i] ?? width) - 8 }),
        ),
      ) + 9;
    requireCondition(height < end - 64, 422, "REPORT_LAYOUT_LIMIT");
    if (y + height > end) page();
    let x = 40;
    cells.forEach((cell, i) => {
      doc
        .font(cell.bold ? "Bold" : "Regular")
        .fontSize(10)
        .text(String(cell.value), x + 4, y + 3, {
          width: (sizes[i] ?? width) - 8,
          align: typeof cell.value === "number" ? "right" : "left",
        });
      x += sizes[i] ?? width;
    });
    doc
      .strokeColor("#d1d5db")
      .moveTo(40, y + height)
      .lineTo(40 + width, y + height)
      .stroke();
    y += height;
  }
  doc.end();
  return result;
}
