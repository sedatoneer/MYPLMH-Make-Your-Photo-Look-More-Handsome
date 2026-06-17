import "./style.css";
import { PixelMorph, type Phase } from "./particles.ts";
import { ShowRecorder } from "./recorder.ts";
import { randomQuote } from "./quotes.ts";

const GRID = 200;

// Atam klasorundeki tum fotograflar (kendi fotonu eklemek istersen oraya at)
const images = Object.values(
  import.meta.glob("/Atam/*.{png,jpg,jpeg,webp,gif,bmp}", { eager: true, query: "?url", import: "default" })
) as string[];

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $("scene") as HTMLCanvasElement;
const dropzone = $("dropzone");
const fileInput = $("fileInput") as HTMLInputElement;
const pickBtn = $("pickBtn");
const replayBtn = $("replayBtn") as HTMLButtonElement;
const shuffleBtn = $("shuffleBtn") as HTMLButtonElement;
const newImgBtn = $("newImgBtn") as HTMLButtonElement;
const recordBtn = $("recordBtn") as HTMLButtonElement;
const statusEl = $("status");
const quoteEl = $("quote");
const quoteText = $("quoteText");
const recDot = $("recDot");

interface LoadedImage {
  img: HTMLImageElement;
  w: number;
  h: number;
}

const morph = new PixelMorph(canvas);
const recorder = new ShowRecorder();

let source: LoadedImage | null = null;
let target: LoadedImage | null = null;
let lastTarget = "";
let recording = false;

const setStatus = (msg: string) => (statusEl.textContent = msg);

function loadImage(src: string): Promise<LoadedImage> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ img, w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => reject(new Error(src));
    img.src = src;
  });
}

function randomImage(): string | null {
  if (!images.length) return null;
  if (images.length === 1) return images[0];
  let url = lastTarget;
  while (url === lastTarget) url = images[(Math.random() * images.length) | 0];
  return url;
}

async function pickTarget(): Promise<LoadedImage | null> {
  const url = randomImage();
  if (!url) return null;
  lastTarget = url;
  target = await loadImage(url);
  return target;
}

function rebuild() {
  if (!source || !target) return;
  morph.setQuality(GRID);
  morph.setSource(source.img, source.w, source.h);
  morph.setTarget(target.img, target.w, target.h);
  morph.build();
}

function enableControls(on: boolean) {
  replayBtn.disabled = !on;
  shuffleBtn.disabled = !on;
  newImgBtn.disabled = !on;
  recordBtn.disabled = !on || !ShowRecorder.supported;
}

const hideQuote = () => quoteEl.classList.remove("show");

morph.onPhase = (phase: Phase) => {
  if (phase === "reveal") {
    quoteText.textContent = randomQuote();
    quoteEl.classList.add("show");
  }
};

morph.onComplete = async () => {
  if (recording) await finishRecording();
};

async function runShow() {
  hideQuote();
  enableControls(false);
  setStatus("");
  rebuild();
  morph.play();
  if (!recording) setTimeout(() => enableControls(true), morph.totalDuration);
}

async function startFromUpload(file: File) {
  const url = URL.createObjectURL(file);
  try {
    source = await loadImage(url);
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  await pickTarget();
  if (!target) {
    setStatus("Atam klasörüne fotoğraf ekle");
    return;
  }
  dropzone.classList.add("hidden");
  runShow();
}

async function startRecording() {
  if (!source || !target || recording) return;
  recording = true;
  recordBtn.classList.add("recording");
  recordBtn.textContent = "kaydediliyor…";
  recDot.hidden = false;
  enableControls(false);
  recordBtn.disabled = true;
  hideQuote();
  rebuild();
  recorder.start(canvas, 60);
  morph.play();
}

async function finishRecording() {
  const blob = await recorder.stop();
  recording = false;
  recordBtn.classList.remove("recording");
  recordBtn.textContent = "kaydet";
  recDot.hidden = true;
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  ShowRecorder.download(blob, `myplmh-${stamp}.webm`);
  enableControls(true);
  setStatus("video kaydedildi");
}

pickBtn.addEventListener("click", () => fileInput.click());
newImgBtn.addEventListener("click", () => fileInput.click());

fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (file) startFromUpload(file);
  fileInput.value = "";
});

replayBtn.addEventListener("click", () => {
  if (source && target) runShow();
});

shuffleBtn.addEventListener("click", async () => {
  if (!source) return;
  await pickTarget();
  runShow();
});

recordBtn.addEventListener("click", () => {
  if (!recording) startRecording();
});

["dragenter", "dragover"].forEach((ev) =>
  dropzone.addEventListener(ev, (e) => {
    e.preventDefault();
    dropzone.classList.add("dragover");
  })
);
["dragleave", "drop"].forEach((ev) =>
  dropzone.addEventListener(ev, (e) => {
    e.preventDefault();
    dropzone.classList.remove("dragover");
  })
);
dropzone.addEventListener("drop", (e) => {
  const file = (e as DragEvent).dataTransfer?.files?.[0];
  if (file && file.type.startsWith("image/")) startFromUpload(file);
});

window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => e.preventDefault());

if (!ShowRecorder.supported) recordBtn.title = "bu tarayıcı video kaydını desteklemiyor";
if (!images.length) setStatus("Atam klasörüne fotoğraf ekle");
