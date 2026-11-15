import type { Programs } from "./service";

const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
export const programPrintScript =
  'document.getElementById("print-program")?.addEventListener("click",async()=>{await document.fonts.ready;window.print();});';
export function printProgram(
  data: Awaited<ReturnType<Programs["printable"]>>,
  css: string[],
  script: string,
) {
  const r = data.record,
    s = r.snapshot,
    date = (x: string) =>
      new Intl.DateTimeFormat("vi-VN", {
        timeZone: "Asia/Ho_Chi_Minh",
        dateStyle: "short",
        timeStyle: "short",
      }).format(new Date(x));
  return `<!doctype html><html lang="vi" data-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Chương trình sinh hoạt ban</title>${css.map((u) => `<link rel="stylesheet" href="${escapeHtml(u)}">`).join("")}</head><body class="program-print-page"><main><article class="program-print-sheet" aria-label="Chương trình sinh hoạt ban"><header><strong>${escapeHtml(s.churchName)}</strong><h1>CHƯƠNG TRÌNH SINH HOẠT BAN</h1><h2>${escapeHtml(s.unitName)}</h2><p>${escapeHtml(s.label)} · ${escapeHtml(date(s.startAt))} — ${escapeHtml(date(s.endAt))}</p><p>${escapeHtml(s.location ?? "Chưa có địa điểm")}</p><p>${data.draft ? "BẢN NHÁP" : `Bản chốt r${data.revision}`}</p>${data.warning ? `<p class="program-print-warning">${escapeHtml(data.warning)}</p>` : ""}</header><table><thead><tr><th>STT</th><th>Tiết mục</th><th>Người phụ trách</th><th>Nội dung</th></tr></thead><tbody>${r.rows.map((row, index) => `<tr><td>${index + 1}</td><td>${escapeHtml(row.title)}</td><td>${row.assignment.mode === "member" ? escapeHtml(r.people.find((p) => p.id === (row.assignment.mode === "member" ? row.assignment.memberId : ""))?.fullName ?? "Chưa xác định") : row.assignment.mode === "not_applicable" ? "Không áp dụng" : "Chưa phân công"}</td><td>${escapeHtml(row.detail)}</td></tr>`).join("")}</tbody></table></article><div class="program-print-controls"><p>In A4. Kiểm tra khổ giấy và lề trong hộp thoại in.</p><button class="btn pri" id="print-program" type="button">In chương trình</button></div></main><script src="${escapeHtml(script)}" defer></script></body></html>`;
}
export function programPrintError(message: string) {
  return `<!doctype html><html lang="vi"><meta charset="utf-8"><title>Chưa thể in chương trình</title><h1>Chưa thể in chương trình</h1><p>${escapeHtml(message)}</p><p>Quay lại ứng dụng để kiểm tra quyền hoặc xác thực lại.</p></html>`;
}
