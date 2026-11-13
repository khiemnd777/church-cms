import type { DocumentContent, DocumentPage } from "./models";

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
export function printCertificate(
  content: DocumentContent,
  pages: DocumentPage[],
  css: string[],
  scriptPath: string,
) {
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(content.title)}</title>${css.map((p) => `<link rel="stylesheet" href="${esc(p)}">`).join("")}</head><body class="ui-certificate-print"><main>${pages.map((p, index) => `<article class="ui-certificate-page"><div class="cert ui-certificate-frame">${p.lines.map((l) => `<p class="ui-certificate-line ui-certificate-${l.style} ui-certificate-gap-${l.gap}">${esc(l.text)}</p>`).join("")}${p.signatures.length ? `<div class="ui-certificate-date">Ngày ${esc(content.issuedOn.split("-").reverse().join("/"))}</div><div class="ui-certificate-signatures">${p.signatures.map((s) => `<div><span>${esc(s.label)}</span><b>${esc(s.name ?? "................................")}</b></div>`).join("")}</div>` : ""}</div><footer>${esc(content.reference)} · ${index + 1}/${pages.length}</footer></article>`).join("")}<div class="ui-card-print-controls"><p>A4 · tỷ lệ100% · tắt đầu/chân trang. Mẫu kiểm thử; chưa xác minh bản giấy thật.</p><button class="btn pri" id="print-certificate" type="button">In</button></div></main><script src="${esc(scriptPath)}" defer></script></body></html>`;
}
export const certificatePrintScript =
  'document.getElementById("print-certificate")?.addEventListener("click",async()=>{await document.fonts.ready;window.print();});';
export const certificatePrintError = (s: string) =>
  `<!doctype html><html lang="vi"><meta charset="utf-8"><title>Chưa thể in chứng nhận</title><h1>Chưa thể in chứng nhận</h1><p>${esc(s)}</p><p>Đóng tab này và quay lại để kiểm tra quyền hoặc xác thực lại.</p></html>`;
