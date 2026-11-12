import { describe, expect, test } from "bun:test";
import ExcelJS from "exceljs";
import { strToU8, zipSync } from "fflate";
import { limits } from "../api/data-exchange/contracts";
import { csvRows, decodeFile, makeFile, parseFile } from "../api/data-exchange/files";

const bytes = (s: string) => Buffer.from(s, "utf8");
async function workbook(setup: (b: ExcelJS.Workbook) => void) {
  const b = new ExcelJS.Workbook();
  setup(b);
  return Buffer.from(await b.xlsx.writeBuffer());
}
describe("P2.5 file boundaries", () => {
  test("CSV Unicode/BOM, commas/quotes/newline/CRLF and empty final cell remain exact", async () => {
    const file = await makeFile(
      ["name", "phone", "note"],
      [
        ["Nguyễn Ánh", "0900123456", 'a, b\n"quoted"'],
        ["Trần", "", ""],
      ],
      "csv",
    );
    expect(csvRows(file.bytes)).toEqual([
      ["name", "phone", "note"],
      ["Nguyễn Ánh", "0900123456", 'a, b\n"quoted"'],
      ["Trần", "", ""],
    ]);
  });
  test("CSV parser rejects unclosed quotes, junk after quoted cell and non UTF-8", () => {
    for (const v of ['a\n"no close', 'a\n"quoted"junk', 'a\na"bad'])
      expect(() => csvRows(bytes(v))).toThrow();
    expect(() => csvRows(new Uint8Array([255, 254, 0]))).toThrow();
  });
  test("duplicate/empty headers and inconsistent fields rejected", async () => {
    for (const v of ["a,a\n1,2", "a,\n1,2", "a,b\n1"])
      await expect(decodeFile(bytes(v), "csv")).rejects.toThrow();
  });
  test("bounds enforce rows, columns, cell length and input bytes before staging", async () => {
    expect(() =>
      csvRows(bytes(`a\n${Array.from({ length: 1001 }, () => "v").join("\n")}`)),
    ).toThrow();
    expect(() => csvRows(bytes(Array.from({ length: 41 }, () => "a").join(",")))).toThrow();
    expect(() => csvRows(bytes(`a\n${"x".repeat(limits.cellChars + 1)}`))).toThrow();
    await expect(decodeFile(new Uint8Array(limits.fileBytes + 1), "csv")).rejects.toThrow();
  });
  test("CSV formula-neutralization includes whitespace/full-width characters and reports changed cells", async () => {
    const values = [
        "=1+2",
        " +cmd",
        "-cmd",
        "@cmd",
        "＝1+2",
        "\t=1+2",
        "\n=1+2",
        "0900123456",
        "Nguyễn Ánh",
      ],
      r = await makeFile(
        ["value"],
        values.map((v) => [v]),
        "csv",
      );
    expect(r.protectedCells).toBe(7);
    const rows = csvRows(r.bytes).slice(1);
    expect(rows.slice(0, 7).every((r) => r[0]?.startsWith("'"))).toBe(true);
    expect(rows[7]?.[0]).toBe("0900123456");
  });
  test("XLSX outputs text cells, no formula objects, exact leading zeros and Unicode", async () => {
    const r = await makeFile(
      ["code", "phone", "name", "literal"],
      [["000123", "0900123456", "Nguyễn Ánh", "=1+2"]],
      "xlsx",
    );
    const b = new ExcelJS.Workbook();
    await b.xlsx.load(r.bytes as never);
    expect(b.worksheets[0]?.getCell("A2").type).toBe(ExcelJS.ValueType.String);
    expect(b.worksheets[0]?.getCell("D2").type).toBe(ExcelJS.ValueType.String);
    const parsed = await decodeFile(r.bytes, "xlsx");
    expect(parsed[0]?.rows[0]).toEqual(["000123", "0900123456", "Nguyễn Ánh", "=1+2"]);
  });
  test("XLSX formula with cached result is rejected rather than imported as a value", async () => {
    const r = await workbook((b) => {
      const s = b.addWorksheet("Members");
      s.addRow(["name"]);
      s.getCell("A2").value = { formula: "1+1", result: 2 };
    });
    await expect(decodeFile(r, "xlsx")).rejects.toThrow("FILE_UNSAFE");
  });
  test("hyperlinks/external relationships rejected without fetching", async () => {
    const r = await workbook((b) => {
      const s = b.addWorksheet("Members");
      s.addRow(["name"]);
      s.getCell("A2").value = { text: "Link", hyperlink: "https://example.invalid/never-fetch" };
    });
    await expect(decodeFile(r, "xlsx")).rejects.toThrow("FILE_UNSAFE");
  });
  test("1900 and 1904 workbook dates produce same ISO business day; time-of-day rejected", async () => {
    for (const date1904 of [false, true]) {
      const r = await workbook((b) => {
        b.properties.date1904 = date1904;
        const s = b.addWorksheet("Members");
        s.addRow(["birthDate"]);
        s.addRow([new Date("2000-01-02T00:00:00.000Z")]);
      });
      expect((await decodeFile(r, "xlsx"))[0]?.rows[0]?.[0]).toBe("2000-01-02");
    }
    const r = await workbook((b) => {
      const s = b.addWorksheet("Members");
      s.addRow(["birthDate"]);
      s.addRow([new Date("2000-01-02T01:00:00.000Z")]);
    });
    await expect(decodeFile(r, "xlsx")).rejects.toThrow("FILE_DATE");
  });
  test("multiple worksheets stay separate for explicit selection", async () => {
    const r = await workbook((b) => {
      for (const name of ["First", "Second"]) {
        const s = b.addWorksheet(name);
        s.addRow(["fullName"]);
        s.addRow([name]);
      }
    });
    const parsed = await decodeFile(r, "xlsx");
    expect(parsed.map((s) => s.name)).toEqual(["First", "Second"]);
    expect(parsed[1]?.rows[0]?.[0]).toBe("Second");
  });
  test("malformed ZIP, macro, DTD and invalid traversal rejected", async () => {
    await expect(decodeFile(bytes("not a zip"), "xlsx")).rejects.toThrow();
    const archives: Record<string, Uint8Array>[] = [
      { "xl/workbook.xml": strToU8("<x/>"), "xl/vbaProject.bin": strToU8("macro") },
      { "xl/workbook.xml": strToU8('<!DOCTYPE x [<!ENTITY e "secret">]><x/>') },
      { "../xl/workbook.xml": strToU8("<x/>") },
    ];
    for (const entries of archives)
      await expect(decodeFile(zipSync(entries), "xlsx")).rejects.toThrow();
  });
  test("actual expanded bytes limited for a small compressed archive", async () => {
    const r = zipSync({
      "xl/workbook.xml": strToU8("<x/>"),
      "bomb.xml": new Uint8Array(limits.expandedBytes + 1),
    });
    expect(r.byteLength).toBeLessThan(limits.fileBytes);
    await expect(parseFile(r, "xlsx")).rejects.toThrow("FILE_LIMIT");
  }, 15000);
  test("worker parses CSV and XLSX on Bun using the same contracts", async () => {
    for (const format of ["csv", "xlsx"] as const) {
      const r = await makeFile(["fullName"], [["Đặng synthetic"]], format);
      expect((await parseFile(r.bytes, format))[0]?.rows[0]?.[0]).toBe("Đặng synthetic");
    }
  });
  test("1900 serial 59 is Feb28, serial60 rejected and serial61 is Mar01", async () => {
    for (const [serial, expected] of [
      [59, "1900-02-28"],
      [60, null],
      [61, "1900-03-01"],
    ] as const) {
      const r = await workbook((b) => {
        const sheet = b.addWorksheet("Members");
        sheet.addRow(["birthDate"]);
        sheet.addRow([serial]);
        sheet.getCell("A2").numFmt = "yyyy-mm-dd";
      });
      if (expected) expect((await decodeFile(r, "xlsx"))[0]?.rows[0]?.[0]).toBe(expected);
      else await expect(decodeFile(r, "xlsx")).rejects.toThrow("FILE_DATE");
    }
  });
  test("reader concurrency bound rejects third parser, then releases capacity", async () => {
    const bytes = Buffer.from("fullName\nNguyễn synthetic\n");
    const results = await Promise.allSettled([
      parseFile(bytes, "csv"),
      parseFile(bytes, "csv"),
      parseFile(bytes, "csv"),
    ]);
    expect(results.filter((r) => r.status === "fulfilled").length).toBe(2);
    expect(
      results.some((r) => r.status === "rejected" && String(r.reason).includes("FILE_BUSY")),
    ).toBe(true);
    expect((await parseFile(bytes, "csv"))[0]?.rows.length).toBe(1);
  });
});
