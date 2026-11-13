import type { Cards } from "./service";

const html = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
export function printDocument(
  render: Awaited<ReturnType<Cards["render"]>>,
  css: string[],
  scriptPath: string,
) {
  const c = render.card;
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Thẻ thuộc viên</title>${css.map((href) => `<link rel="stylesheet" href="${html(href)}">`).join("")}</head>
<body class="ui-card-print-page"><main><article class="ui-member-card${c.snapshot.fullName.length > 80 || c.snapshot.churchName.length > 80 ? " ui-member-card-long" : ""}" aria-label="Thẻ thuộc viên"><header><strong>${html(c.snapshot.churchName)}</strong><span>${html(c.snapshot.churchCode)}</span></header><div class="ui-member-card-body"><div><strong>${html(c.snapshot.fullName)}</strong><span>${html(c.snapshot.memberCode)}</span><small>THẺ THUỘC VIÊN</small></div><img alt="QR thẻ thuộc viên" src="data:image/svg+xml;base64,${Buffer.from(render.svg).toString("base64")}"></div></article><div class="ui-card-print-controls"><p>Thẻ 86 × 54 mm. In ở tỷ lệ 100%, tắt đầu/chân trang trong hộp thoại in.</p><button class="btn pri" id="print-card" type="button">In thẻ</button></div></main><script src="${html(scriptPath)}" defer></script></body></html>`;
}
export const printScript =
  'document.getElementById("print-card")?.addEventListener("click",async()=>{await document.fonts.ready;window.print();});';
export function printError(message: string) {
  return `<!doctype html><html lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Chưa thể in thẻ</title><h1>Chưa thể in thẻ</h1><p>${html(message)}</p><p>Đóng tab này và quay lại ứng dụng để kiểm tra quyền hoặc xác thực lại.</p></html>`;
}
