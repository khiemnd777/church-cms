import type { Ref } from "react";
export function QrVideo({ videoRef }: { videoRef: Ref<HTMLVideoElement> }) {
  return (
    <video ref={videoRef} className="ui-qr-video" muted playsInline aria-label="Khung quét QR" />
  );
}
export interface PrintedCardSnapshot {
  fullName: string;
  memberCode: string;
  churchName: string;
  churchCode: string;
}
export function MemberCardView({ snapshot, svg }: { snapshot: PrintedCardSnapshot; svg: string }) {
  return (
    <article
      className={`ui-member-card${snapshot.fullName.length > 80 || snapshot.churchName.length > 80 ? " ui-member-card-long" : ""}`}
      aria-label="Mẫu thẻ thuộc viên"
    >
      <header>
        <strong>{snapshot.churchName}</strong>
        <span>{snapshot.churchCode}</span>
      </header>
      <div className="ui-member-card-body">
        <div>
          <strong>{snapshot.fullName}</strong>
          <span>{snapshot.memberCode}</span>
          <small>THẺ THUỘC VIÊN</small>
        </div>
        <img
          src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`}
          alt="Mã QR của thẻ"
        />
      </div>
    </article>
  );
}
