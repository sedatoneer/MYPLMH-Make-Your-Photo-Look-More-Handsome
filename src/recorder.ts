// Canvas uzerindeki sovu WebM video olarak kaydeder (MediaRecorder API).

export class ShowRecorder {
  private rec: MediaRecorder | null = null;
  private chunks: Blob[] = [];

  static get supported(): boolean {
    return typeof MediaRecorder !== "undefined" && "captureStream" in HTMLCanvasElement.prototype;
  }

  private pickMime(): string {
    const candidates = [
      "video/webm;codecs=vp9",
      "video/webm;codecs=vp8",
      "video/webm",
    ];
    for (const m of candidates) {
      if (MediaRecorder.isTypeSupported(m)) return m;
    }
    return "video/webm";
  }

  start(canvas: HTMLCanvasElement, fps = 60) {
    const stream = canvas.captureStream(fps);
    this.chunks = [];
    this.rec = new MediaRecorder(stream, {
      mimeType: this.pickMime(),
      videoBitsPerSecond: 12_000_000,
    });
    this.rec.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };
    this.rec.start();
  }

  stop(): Promise<Blob> {
    return new Promise((resolve) => {
      if (!this.rec) return resolve(new Blob());
      this.rec.onstop = () => resolve(new Blob(this.chunks, { type: "video/webm" }));
      this.rec.stop();
    });
  }

  static download(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
}
