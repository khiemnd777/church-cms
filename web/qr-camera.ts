import QrScanner from "qr-scanner";

// Own the capture lifecycle; the decoder never requests or restarts a camera.
export class QrCamera {
  private epoch = 0;
  private stream: MediaStream | null = null;
  private engine: Awaited<ReturnType<typeof QrScanner.createQrEngine>> | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor(
    private video: HTMLVideoElement,
    private decoded: (code: string) => void,
    private failed: (message: string) => void,
  ) {}
  stop() {
    this.epoch++;
    clearTimeout(this.timer);
    this.stream?.getTracks().forEach((track) => {
      track.stop();
    });
    this.stream = null;
    this.video.pause();
    this.video.srcObject = null;
    if (this.engine instanceof Worker) this.engine.terminate();
    this.engine = null;
  }
  async start(facing: "environment" | "user") {
    this.stop();
    const epoch = this.epoch;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("unavailable");
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: facing } },
      });
      if (epoch !== this.epoch || document.hidden) {
        stream.getTracks().forEach((track) => {
          track.stop();
        });
        return;
      }
      this.stream = stream;
      stream.getVideoTracks().forEach((track) => {
        track.addEventListener(
          "ended",
          () => {
            if (epoch === this.epoch) {
              this.stop();
              this.failed("Camera đã ngắt. Có thể bật lại hoặc dùng điểm danh tay.");
            }
          },
          { once: true },
        );
      });
      this.video.srcObject = stream;
      await this.video.play();
      if (epoch !== this.epoch) return;
      const engine = await QrScanner.createQrEngine();
      if (epoch !== this.epoch) {
        if (engine instanceof Worker) engine.terminate();
        return;
      }
      this.engine = engine;
      const scan = async () => {
        if (epoch !== this.epoch) return;
        try {
          const result = await QrScanner.scanImage(this.video, {
            qrEngine: engine,
            returnDetailedScanResult: true,
          });
          if (epoch === this.epoch) this.decoded(result.data);
        } catch (e) {
          if (String(e) !== QrScanner.NO_QR_CODE_FOUND && epoch === this.epoch) {
            this.stop();
            this.failed("Không đọc được hình camera. Bật lại camera hoặc dùng điểm danh tay.");
            return;
          }
        }
        if (epoch === this.epoch) this.timer = setTimeout(() => void scan(), 250);
      };
      void scan();
    } catch {
      if (epoch === this.epoch) {
        this.stop();
        this.failed("Không mở được camera. Kiểm tra quyền camera hoặc dùng điểm danh tay.");
      }
    }
  }
}
