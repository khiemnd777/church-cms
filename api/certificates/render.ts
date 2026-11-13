import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  LineRuleType,
  Packer,
  PageBorderOffsetFrom,
  PageNumber,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import PDFDocument from "pdfkit";
import { type DocumentContent, type DocumentPage, type Line, watermark } from "./models";

const directory = new URL("./fonts/", import.meta.url);
const provenance = JSON.parse(readFileSync(new URL("sources.json", directory), "utf8")) as {
  files: { path: string; sha256: string }[];
};
const hash = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const fonts = Object.fromEntries(
  provenance.files.map((f) => {
    const data = readFileSync(new URL(f.path, directory));
    if (hash(data) !== f.sha256) throw Error("Certificate font integrity mismatch");
    return [f.path, data];
  }),
);
const bodyFont = fonts["BeVietnamPro-Regular.ttf"] as Buffer,
  boldFont = fonts["BeVietnamPro-Bold.ttf"] as Buffer,
  titleFont = fonts["Lora-SemiBold.ttf"] as Buffer,
  nameFont = fonts["Lora-SemiBoldItalic.ttf"] as Buffer;
export const layoutPolicy = {
  version: "a4-internal-r1",
  fonts: provenance.files,
  docx: "9.15.3",
  pdfkit: "0.20.2",
  maxPages: 10,
  maxBytes: 5 * 1024 * 1024,
};
const styles = {
  header: { size: 10, height: 15, font: "bold" },
  title: { size: 22, height: 29, font: "title" },
  name: { size: 18, height: 24, font: "name" },
  body: { size: 11, height: 18, font: "body" },
  small: { size: 9, height: 14, font: "body" },
} as const;
const width = 487.28,
  top = 54,
  bottom = 756;
function wrap(doc: PDFKit.PDFDocument, text: string, style: Line["style"], lineWidth = width) {
  const s = styles[style];
  doc.font(s.font).fontSize(s.size);
  const result: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/u)) {
      if (!word) continue;
      const next = line ? `${line} ${word}` : word;
      if (doc.widthOfString(next) <= lineWidth) {
        line = next;
        continue;
      }
      if (line) {
        result.push(line);
        line = "";
      }
      let part = "";
      for (const character of word) {
        if (part && doc.widthOfString(part + character) > lineWidth) {
          result.push(part);
          part = "";
        }
        part += character;
      }
      line = part;
    }
    result.push(line);
  }
  return result;
}
function makeLines(doc: PDFKit.PDFDocument, text: string, style: Line["style"], gap = 8) {
  const lines = wrap(doc, text, style).map((text) => ({ text, style, gap: 0 }));
  const last = lines.at(-1);
  if (last) last.gap = gap;
  return lines;
}
function signaturesHeight(doc: PDFKit.PDFDocument, content: DocumentContent) {
  return (
    62 +
    Math.max(
      1,
      ...content.signatures.map((s) => wrap(doc, s.name ?? "", "header", width / 2 - 12).length),
    ) *
      15
  );
}
export function renderDocuments(content: DocumentContent): Promise<{
  pdf: Buffer;
  docx: Buffer;
  pages: DocumentPage[];
  pdfHash: string;
  docxHash: string;
}> {
  return new Promise((resolve, reject) => {
    void (async () => {
      const doc = new PDFDocument({
        size: "A4",
        // All page breaks are decided by the shared bounded layout. Reserve the
        // footer below its body area without PDFKit flowing it onto another page.
        margins: { top: 54, left: 54, right: 54, bottom: 0 },
        bufferPages: true,
        info: {
          Title: content.title,
          Author: "Church CMS · mẫu nội bộ",
          CreationDate: new Date(`${content.issuedOn}T00:00:00Z`),
        },
      });
      doc
        .registerFont("body", bodyFont)
        .registerFont("bold", boldFont)
        .registerFont("title", titleFont)
        .registerFont("name", nameFont);
      const chunks: Buffer[] = [];
      let length = 0;
      doc.on("data", (b: Buffer) => {
        length += b.length;
        if (length > layoutPolicy.maxBytes) doc.destroy(Error("CERT_FILE_LIMIT"));
        else chunks.push(b);
      });
      doc.on("error", reject);
      const prologue = [
        ...makeLines(doc, watermark, "small", 8),
        ...(content.affiliation ? makeLines(doc, content.affiliation, "header", 4) : []),
        ...makeLines(doc, content.churchName, "header", 12),
        ...makeLines(doc, content.title, "title", 16),
      ];
      const height = (lines: Line[]) =>
        lines.reduce((n, l) => n + styles[l.style].height + l.gap, 0);
      if (height(prologue) > 350) throw Error("CERT_PAGE_LIMIT");
      const pages: DocumentPage[] = [{ lines: [...prologue], signatures: [] }];
      let page = pages[0] as DocumentPage,
        y = top + height(prologue);
      const addPage = () => {
        if (pages.length >= layoutPolicy.maxPages) throw Error("CERT_PAGE_LIMIT");
        page = { lines: [...prologue], signatures: [] };
        pages.push(page);
        y = top + height(prologue);
      };
      for (const p of content.paragraphs) {
        const lines = makeLines(doc, p.text, p.style);
        for (const line of lines) {
          if (y + styles[line.style].height + line.gap > bottom) addPage();
          page.lines.push(line);
          y += styles[line.style].height + line.gap;
        }
      }
      const signatureHeight = signaturesHeight(doc, content);
      if (y + signatureHeight > bottom) addPage();
      page.signatures = content.signatures;
      for (let index = 0; index < pages.length; index++) {
        if (index) doc.addPage();
        const p = pages[index] as DocumentPage;
        let at = top;
        // Gold and ink follow the approved light certificate palette, not the app theme.
        doc.lineWidth(1).strokeColor("#a86c12").rect(36, 36, 523.28, 769.89).stroke();
        for (const line of p.lines) {
          const s = styles[line.style];
          doc
            .font(s.font)
            .fontSize(s.size)
            .fillColor(line.style === "title" || line.text === watermark ? "#a86c12" : "#14222a")
            .text(line.text, 54, at, { width, align: "center", lineBreak: false });
          at += s.height + line.gap;
        }
        if (p.signatures.length) {
          doc
            .font("body")
            .fontSize(10)
            .fillColor("#14222a")
            .text(`Ngày ${content.issuedOn.split("-").reverse().join("/")}`, 54, at + 8, {
              width,
              align: "right",
              lineBreak: false,
            });
          at += 28;
          p.signatures.forEach((signature, i) => {
            const x = 54 + (i * width) / p.signatures.length,
              col = width / p.signatures.length;
            doc
              .font("body")
              .fontSize(10)
              .text(signature.label, x, at, { width: col, align: "center", lineBreak: false });
            const names = wrap(
              doc,
              signature.name ?? "................................",
              "header",
              col - 12,
            );
            names.forEach((name, j) => {
              doc
                .font("bold")
                .fontSize(10)
                .text(name, x + 6, at + 34 + j * 15, {
                  width: col - 12,
                  align: "center",
                  lineBreak: false,
                });
            });
          });
        }
        doc
          .font("body")
          .fontSize(8)
          .fillColor("#14222a")
          .text(`${content.reference} · ${index + 1}/${pages.length}`, 54, 786, {
            width,
            align: "center",
            lineBreak: false,
          });
      }
      const pdfDone = new Promise<Buffer>((r, e) => {
        doc.once("end", () => r(Buffer.concat(chunks)));
        doc.once("error", e);
      });
      doc.end();
      const paragraph = (line: Line, pageBreakBefore = false) =>
        new Paragraph({
          pageBreakBefore,
          alignment: AlignmentType.CENTER,
          spacing: {
            before: 0,
            after: Math.round(line.gap * 20),
            line: styles[line.style].height * 20,
            lineRule: LineRuleType.EXACT,
          },
          children: [
            new TextRun({
              text: line.text,
              font: line.style === "title" || line.style === "name" ? "Lora" : "Be Vietnam Pro",
              size: styles[line.style].size * 2,
              bold: line.style === "header",
              italics: line.style === "name",
              color: line.style === "title" || line.text === watermark ? "A86C12" : "14222A",
            }),
          ],
        });
      const children: (Paragraph | Table)[] = [];
      pages.forEach((p, i) => {
        children.push(...p.lines.map((line, j) => paragraph(line, i > 0 && j === 0)));
        if (p.signatures.length) {
          children.push(
            new Paragraph({
              alignment: AlignmentType.RIGHT,
              spacing: { before: 160, after: 120 },
              children: [
                new TextRun({
                  text: `Ngày ${content.issuedOn.split("-").reverse().join("/")}`,
                  font: "Be Vietnam Pro",
                  size: 20,
                }),
              ],
            }),
          );
          children.push(
            new Table({
              width: { size: 100, type: WidthType.PERCENTAGE },
              borders: {
                top: { style: BorderStyle.NONE },
                bottom: { style: BorderStyle.NONE },
                left: { style: BorderStyle.NONE },
                right: { style: BorderStyle.NONE },
                insideHorizontal: { style: BorderStyle.NONE },
                insideVertical: { style: BorderStyle.NONE },
              },
              rows: [
                new TableRow({
                  cantSplit: true,
                  children: p.signatures.map(
                    (s) =>
                      new TableCell({
                        width: { size: 50, type: WidthType.PERCENTAGE },
                        children: [
                          new Paragraph({
                            alignment: AlignmentType.CENTER,
                            children: [
                              new TextRun({ text: s.label, font: "Be Vietnam Pro", size: 20 }),
                            ],
                          }),
                          new Paragraph({
                            spacing: { before: 680 },
                            alignment: AlignmentType.CENTER,
                            children: [
                              new TextRun({
                                text: s.name ?? "................................",
                                font: "Be Vietnam Pro",
                                size: 20,
                                bold: true,
                              }),
                            ],
                          }),
                        ],
                      }),
                  ),
                }),
              ],
            }),
          );
        }
      });
      const word = new Document({
        creator: "Church CMS",
        title: content.title,
        description: watermark,
        fonts: [
          { name: "Be Vietnam Pro", data: bodyFont, bold: boldFont },
          { name: "Lora", data: titleFont, italic: nameFont },
        ],
        styles: {
          default: {
            document: {
              run: { font: "Be Vietnam Pro", size: 22 },
              paragraph: { spacing: { after: 0, before: 0 } },
            },
          },
        },
        sections: [
          {
            footers: {
              default: new Footer({
                children: [
                  new Paragraph({
                    alignment: AlignmentType.CENTER,
                    children: [
                      new TextRun({
                        text: `${content.reference} · `,
                        font: "Be Vietnam Pro",
                        size: 16,
                      }),
                      new TextRun({
                        children: [PageNumber.CURRENT, "/", PageNumber.TOTAL_PAGES],
                        font: "Be Vietnam Pro",
                        size: 16,
                      }),
                    ],
                  }),
                ],
              }),
            },
            properties: {
              page: {
                size: { width: 11906, height: 16838 },
                margin: { top: 1080, bottom: 1080, left: 1080, right: 1080, footer: 840 },
                borders: {
                  pageBorders: { offsetFrom: PageBorderOffsetFrom.TEXT },
                  pageBorderTop: { style: BorderStyle.SINGLE, size: 8, color: "A86C12", space: 18 },
                  pageBorderBottom: {
                    style: BorderStyle.SINGLE,
                    size: 8,
                    color: "A86C12",
                    space: 18,
                  },
                  pageBorderLeft: {
                    style: BorderStyle.SINGLE,
                    size: 8,
                    color: "A86C12",
                    space: 18,
                  },
                  pageBorderRight: {
                    style: BorderStyle.SINGLE,
                    size: 8,
                    color: "A86C12",
                    space: 18,
                  },
                },
              },
            },
            children,
          },
        ],
      });
      const [pdf, docx] = await Promise.all([pdfDone, Packer.toBuffer(word)]);
      if (pdf.length + docx.length > layoutPolicy.maxBytes) throw Error("CERT_FILE_LIMIT");
      resolve({ pdf, docx, pages, pdfHash: hash(pdf), docxHash: hash(docx) });
    })().catch(reject);
  });
}
