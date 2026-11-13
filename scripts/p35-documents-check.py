"""Local P3.5 artifact QA. Run using the bundled Python (pypdf/Pillow/Poppler/LibreOffice)."""
import hashlib
import json
import pathlib
import re
import subprocess
import sys
import unicodedata
import zipfile

import pypdf

root = pathlib.Path("output/p3.5")
rendered = root / "rendered-p35-r1"
script = pathlib.Path("/Users/khiemnguyen/.codex/plugins/cache/openai-primary-runtime/documents/26.1110.11258/skills/documents/render_docx.py")


def normalize(value):
    return re.sub(r"\s+", " ", unicodedata.normalize("NFC", value)).strip()


results = []
for kind in ["baptism", "dedication", "marriage", "application", "long-dedication"]:
    base = root / "documents" / kind
    edition = json.loads(base.with_suffix(".json").read_text())
    content = edition["snapshot"]["content"]
    pages = edition["pages"]
    pdf_dir = rendered / f"{kind}-pdf"
    pdf_dir.mkdir(parents=True, exist_ok=True)
    subprocess.run(["pdftoppm", "-scale-to", "1200", "-png", str(base.with_suffix(".pdf")), str(pdf_dir / "page")], check=True)
    docx_dir = rendered / f"{kind}-docx"
    subprocess.run([sys.executable, str(script), str(base.with_suffix(".docx")), "--output_dir", str(docx_dir), "--emit_pdf", "--dpi", "120"], check=True)
    with zipfile.ZipFile(base.with_suffix(".docx")) as archive:
        fonts = [n for n in archive.namelist() if n.startswith("word/fonts/")]
        assert len(fonts) >= 4
    for format, path in [("pdf", base.with_suffix(".pdf")), ("docx-LibreOffice", docx_dir / f"{kind}.pdf")]:
        reader = pypdf.PdfReader(path)
        assert len(reader.pages) == len(pages), (kind, format, "page count", len(reader.pages), len(pages))
        text = normalize(" ".join(p.extract_text() for p in reader.pages))
        assert "\ufffd" not in text and "\0" not in text
        for index, page in enumerate(reader.pages):
            actual = normalize(page.extract_text())
            assert 595 <= float(page.mediabox.width) <= 596
            assert 841 <= float(page.mediabox.height) <= 843
            assert "MẪU KIỂM THỬ — KHÔNG DÙNG THỰC TẾ" in actual
            assert content["reference"] in actual
            assert f"{index + 1}/{len(pages)}" in actual
            for line in pages[index]["lines"]:
                assert normalize(line["text"]) in actual, (kind, format, index, line["text"])
        for signature in content["signatures"]:
            assert normalize(signature["label"]) in normalize(reader.pages[-1].extract_text())
            assert normalize(signature["name"] or "................................") in normalize(reader.pages[-1].extract_text())
        results.append({"kind": kind, "format": format, "status": "PASS", "pages": len(reader.pages), "a4": True, "all_model_lines_present": True, "signature_group_on_last_page": True, "sha256": hashlib.sha256(path.read_bytes()).hexdigest()})
result = {"status": "PASS", "checks": results, "renderer": subprocess.check_output(["soffice", "--version"], text=True).strip(), "python": sys.version.split()[0], "pypdf": pypdf.__version__, "limits": ["DOCX rendered by LibreOfficeDev; native Microsoft Word NOT_RUN", "Visual inspection of each PNG recorded separately; text checks do not establish visual quality", "Physical paper/real camera NOT_RUN"]}
(root / "documents-check.json").write_text(json.dumps(result, ensure_ascii=False, indent=2))
print(json.dumps({"status": "PASS", "documents": len(results), "pages": sum(r["pages"] for r in results)}))
