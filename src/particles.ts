// yuklenen foto parcalara ayrilir, dagilir ve secilen fotonun pikseliyle yeniden dizilir.
// cizim tek bir ImageData buffer'i uzerinden, hizli olsun diye.

export type Phase = "idle" | "intro" | "scatter" | "converge" | "reveal";

export interface MorphTimings {
  intro: number;
  scatter: number;
  converge: number;
  revealHold: number;
}

const DEFAULT_TIMINGS: MorphTimings = {
  intro: 1300,
  scatter: 2200,
  converge: 3800,
  revealHold: 2500,
};

const STAGGER = 0.4;
const SCATTER_MIX = 0.62; // 0 = yerinde, 1 = tam dagilim
const FADE = 0.82; // trail

const easeInOutCubic = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);
const lum = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;

function sampleImage(
  img: CanvasImageSource,
  iw: number,
  ih: number,
  grid: number,
  fit: "cover" | "contain" = "cover"
): Uint8ClampedArray {
  const c = document.createElement("canvas");
  c.width = grid;
  c.height = grid;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = true;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, grid, grid);
  // cover doldurur (tasani kirpar), contain hepsini sigdirir
  const scale = fit === "cover" ? Math.max(grid / iw, grid / ih) : Math.min(grid / iw, grid / ih);
  const dw = iw * scale;
  const dh = ih * scale;
  ctx.drawImage(img, (grid - dw) / 2, (grid - dh) / 2, dw, dh);
  return ctx.getImageData(0, 0, grid, grid).data;
}

export class PixelMorph {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private image: ImageData;
  private buf: Uint8ClampedArray;
  private RES = 768;
  private grid = 200;
  private cell = 0;
  private block = 1;
  private N = 0;

  private homeX!: Float32Array;
  private homeY!: Float32Array;
  private scatX!: Float32Array;
  private scatY!: Float32Array;
  private targX!: Float32Array;
  private targY!: Float32Array;
  private sr!: Uint8ClampedArray;
  private sg!: Uint8ClampedArray;
  private sb!: Uint8ClampedArray;
  private fr!: Uint8ClampedArray;
  private fg!: Uint8ClampedArray;
  private fb!: Uint8ClampedArray;
  private delay!: Float32Array;

  private sourceSample: Uint8ClampedArray | null = null;
  private targetSample: Uint8ClampedArray | null = null;

  private timings = DEFAULT_TIMINGS;
  private startT = 0;
  private raf = 0;
  private playing = false;
  private phase: Phase = "idle";

  onPhase?: (phase: Phase) => void;
  onComplete?: () => void;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    canvas.width = this.RES;
    canvas.height = this.RES;
    this.ctx = canvas.getContext("2d", { willReadFrequently: false, alpha: false })!;
    this.image = this.ctx.createImageData(this.RES, this.RES);
    this.buf = this.image.data;
    for (let i = 3; i < this.buf.length; i += 4) this.buf[i] = 255;
    this.clearBuffer();
  }

  get canvasEl() {
    return this.canvas;
  }

  get totalDuration() {
    const t = this.timings;
    return t.intro + t.scatter + t.converge + t.revealHold;
  }

  setQuality(grid: number) {
    this.grid = grid;
    this.sourceSample = null;
    this.targetSample = null;
  }

  setSource(img: HTMLImageElement | ImageBitmap, w: number, h: number) {
    this.sourceSample = sampleImage(img, w, h, this.grid);
  }

  setTarget(img: HTMLImageElement | ImageBitmap, w: number, h: number) {
    // hedefi kirpmadan sigdir, yoksa bazi fotolarda kafa kesiliyor
    this.targetSample = sampleImage(img, w, h, this.grid, "contain");
  }

  build() {
    if (!this.sourceSample || !this.targetSample) throw new Error("once setSource/setTarget");
    const g = this.grid;
    const N = g * g;
    this.N = N;
    this.cell = this.RES / g;
    this.block = Math.max(1, Math.ceil(this.cell));

    this.homeX = new Float32Array(N);
    this.homeY = new Float32Array(N);
    this.scatX = new Float32Array(N);
    this.scatY = new Float32Array(N);
    this.targX = new Float32Array(N);
    this.targY = new Float32Array(N);
    this.sr = new Uint8ClampedArray(N);
    this.sg = new Uint8ClampedArray(N);
    this.sb = new Uint8ClampedArray(N);
    this.fr = new Uint8ClampedArray(N);
    this.fg = new Uint8ClampedArray(N);
    this.fb = new Uint8ClampedArray(N);
    this.delay = new Float32Array(N);

    const src = this.sourceSample;
    const tgt = this.targetSample;

    const bs = new Float32Array(N);
    const bt = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const si = i * 4;
      this.sr[i] = src[si];
      this.sg[i] = src[si + 1];
      this.sb[i] = src[si + 2];
      bs[i] = lum(src[si], src[si + 1], src[si + 2]);
      bt[i] = lum(tgt[si], tgt[si + 1], tgt[si + 2]);
    }

    // parlakliga gore sirala, ranklari eslestir: kaynagin koyu pikselleri portrenin
    // koyu yerlerine gider. boyle hangi pikselin nereye gidecegini buluyoruz.
    const srcOrder = Array.from({ length: N }, (_, i) => i).sort((a, b) => bs[a] - bs[b]);
    const tgtOrder = Array.from({ length: N }, (_, i) => i).sort((a, b) => bt[a] - bt[b]);
    const targetCellOf = new Int32Array(N);
    for (let k = 0; k < N; k++) targetCellOf[srcOrder[k]] = tgtOrder[k];

    const center = this.RES / 2;
    const half = this.cell / 2;

    for (let i = 0; i < N; i++) {
      const gx = i % g;
      const gy = (i / g) | 0;
      const hx = gx * this.cell + half;
      const hy = gy * this.cell + half;
      this.homeX[i] = hx;
      this.homeY[i] = hy;

      const t = targetCellOf[i];
      this.targX[i] = (t % g) * this.cell + half;
      this.targY[i] = ((t / g) | 0) * this.cell + half;

      // rengi tut, parlakligi hedefe kaydir. lum dogrusal oldugu icin renk+d tam
      // hedef parlakligini verir, portre her fotoda net cikar. d genelde kucuk.
      const d = bt[t] - bs[i];
      this.fr[i] = this.sr[i] + d;
      this.fg[i] = this.sg[i] + d;
      this.fb[i] = this.sb[i] + d;

      const ang = Math.random() * Math.PI * 2;
      const rad = center * Math.sqrt(Math.random()) * 0.98;
      this.scatX[i] = hx + (center + Math.cos(ang) * rad - hx) * SCATTER_MIX;
      this.scatY[i] = hy + (center + Math.sin(ang) * rad - hy) * SCATTER_MIX;

      this.delay[i] = Math.random();
    }
  }

  play() {
    if (this.N === 0) return;
    this.stop();
    this.startT = performance.now();
    this.playing = true;
    this.setPhase("intro");
    this.loop();
  }

  stop() {
    this.playing = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  // perde/onizleme: portreyi tek karede dolu goster
  renderTargetStatic() {
    this.clearBuffer();
    for (let i = 0; i < this.N; i++) {
      this.plot(this.buf, this.RES, this.targX[i], this.targY[i], this.fr[i], this.fg[i], this.fb[i], this.block);
    }
    this.ctx.putImageData(this.image, 0, 0);
  }

  private setPhase(p: Phase) {
    if (this.phase !== p) {
      this.phase = p;
      this.onPhase?.(p);
    }
  }

  private loop = () => {
    if (!this.playing) return;
    const t = performance.now() - this.startT;
    this.renderFrame(t);
    if (t >= this.totalDuration) {
      this.playing = false;
      this.onComplete?.();
      return;
    }
    this.raf = requestAnimationFrame(this.loop);
  };

  private renderFrame(t: number) {
    const { intro, scatter, converge } = this.timings;
    const b = this.buf;
    const W = this.RES;
    const blk = this.block;

    this.fade();

    const tScatterEnd = intro + scatter;
    const tConvergeEnd = tScatterEnd + converge;

    if (t < intro) {
      // yuklenen foto duruyor
      this.setPhase("intro");
      for (let i = 0; i < this.N; i++) {
        this.plot(b, W, this.homeX[i], this.homeY[i], this.sr[i], this.sg[i], this.sb[i], blk);
      }
    } else if (t < tScatterEnd) {
      // dagiliyor
      this.setPhase("scatter");
      const s = easeOutCubic((t - intro) / scatter);
      for (let i = 0; i < this.N; i++) {
        const x = this.homeX[i] + (this.scatX[i] - this.homeX[i]) * s;
        const y = this.homeY[i] + (this.scatY[i] - this.homeY[i]) * s;
        this.plot(b, W, x, y, this.sr[i], this.sg[i], this.sb[i], blk);
      }
    } else if (t < tConvergeEnd) {
      // hedef konuma gidiyor, renk yavasca hedef parlakligina kayiyor
      this.setPhase("converge");
      const c = (t - tScatterEnd) / converge;
      for (let i = 0; i < this.N; i++) {
        const local = clamp01((c - this.delay[i] * STAGGER) / (1 - STAGGER));
        const e = easeInOutCubic(local);
        const x = this.scatX[i] + (this.targX[i] - this.scatX[i]) * e;
        const y = this.scatY[i] + (this.targY[i] - this.scatY[i]) * e;
        const r = this.sr[i] + (this.fr[i] - this.sr[i]) * e;
        const gg = this.sg[i] + (this.fg[i] - this.sg[i]) * e;
        const bb = this.sb[i] + (this.fb[i] - this.sb[i]) * e;
        this.plot(b, W, x, y, r, gg, bb, blk);
      }
    } else {
      this.setPhase("reveal");
      for (let i = 0; i < this.N; i++) {
        this.plot(b, W, this.targX[i], this.targY[i], this.fr[i], this.fg[i], this.fb[i], blk);
      }
    }

    this.ctx.putImageData(this.image, 0, 0);
  }

  private plot(b: Uint8ClampedArray, W: number, fx: number, fy: number, r: number, g: number, bl: number, blk: number) {
    const x0 = fx | 0;
    const y0 = fy | 0;
    for (let dy = 0; dy < blk; dy++) {
      const yy = y0 + dy;
      if (yy < 0 || yy >= W) continue;
      let idx = (yy * W + x0) * 4;
      for (let dx = 0; dx < blk; dx++) {
        const xx = x0 + dx;
        if (xx >= 0 && xx < W) {
          b[idx] = r;
          b[idx + 1] = g;
          b[idx + 2] = bl;
        }
        idx += 4;
      }
    }
  }

  private fade() {
    const b = this.buf;
    for (let i = 0; i < b.length; i += 4) {
      b[i] *= FADE;
      b[i + 1] *= FADE;
      b[i + 2] *= FADE;
    }
  }

  private clearBuffer() {
    const b = this.buf;
    for (let i = 0; i < b.length; i += 4) {
      b[i] = 4;
      b[i + 1] = 5;
      b[i + 2] = 10;
    }
    this.ctx.putImageData(this.image, 0, 0);
  }
}
