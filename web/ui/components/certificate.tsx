import type { DocumentContent, DocumentPage } from "../../../api/certificates/models";
export function CertificatePage({
  content,
  page,
  index,
  total,
}: {
  content: DocumentContent;
  page: DocumentPage;
  index: number;
  total: number;
}) {
  return (
    <article className="ui-certificate-page" aria-label={`Trang ${index + 1}/${total}`}>
      <div className="cert ui-certificate-frame">
        {page.lines.map((line, i) => (
          <p
            key={`${i}:${line.text}`}
            className={`ui-certificate-line ui-certificate-${line.style} ui-certificate-gap-${line.gap}`}
          >
            {line.text}
          </p>
        ))}
        {page.signatures.length > 0 && (
          <>
            <div className="ui-certificate-date">
              Ngày {content.issuedOn.split("-").reverse().join("/")}
            </div>
            <div className="ui-certificate-signatures">
              {page.signatures.map((s) => (
                <div key={s.label}>
                  <span>{s.label}</span>
                  <b>{s.name ?? "................................"}</b>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
      <footer>
        {content.reference} · {index + 1}/{total}
      </footer>
    </article>
  );
}

import { Icon } from "../icons";
export function CertificateTile({
  label,
  disabled,
  unopened,
  report,
  onClick,
}: {
  label: string;
  disabled: boolean;
  unopened: boolean;
  report: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="card feature ui-certificate-tile"
      disabled={disabled}
      onClick={onClick}
    >
      <span className="ic">
        <Icon name={report ? "chart" : "file"} />
      </span>
      <div>
        <b>{label}</b>
        {unopened && <p>Chưa mở</p>}
      </div>
    </button>
  );
}

import type { ReactNode } from "react";
export function CertificateViewport({ children }: { children: ReactNode }) {
  return (
    // biome-ignore lint/a11y/noNoninteractiveTabindex: bounded A4 preview must be keyboard-scrollable independently of the page
    <section className="ui-certificate-scroll" aria-label="Trang chứng nhận cuộn" tabIndex={0}>
      {children}
    </section>
  );
}
