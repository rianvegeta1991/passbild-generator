import { CONFIG } from '../src/config';
import type { CheckInput, EyeRoi, Pt, RawImage, Rect } from '../src/types';

/** Parameter für ein synthetisches Gesicht (alle Maße in Pixeln des Bilds). */
export interface FaceSpec {
  w: number;
  h: number;
  /** Kinn */
  cx: number;
  chinY: number;
  /** Strecke Kinn–Scheitel */
  headH: number;
  /** Neigung (Grad, > 0: im Uhrzeigersinn) */
  tiltDeg?: number;
  /** Lidöffnung, 1 = normal (EAR ≈ 0,30), 0 = geschlossen */
  eyeOpen?: number;
  /** Mundöffnung relativ zur Mundbreite (0 = zu) */
  mouthOpen?: number;
  /** Mundwinkel über der Lippenmitte, relativ zur Mundbreite */
  smile?: number;
}

/** Baut ein 478-Punkte-Netz, in dem nur die von den Prüfungen genutzten Punkte sinnvoll belegt sind. */
export function makeLandmarks(s: FaceSpec): Pt[] {
  const lm: Pt[] = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  const faceLen = s.headH / (1 + CONFIG.head.crownFactor);
  const th = ((s.tiltDeg ?? 0) * Math.PI) / 180;
  // lokal: x nach rechts, y nach oben (vom Kinn); dann um das Kinn im Uhrzeigersinn drehen
  const put = (i: number, lx: number, ly: number) => {
    const x = lx * Math.cos(th) + ly * Math.sin(th);
    const yUp = -lx * Math.sin(th) + ly * Math.cos(th);
    lm[i] = { x: (s.cx + x) / s.w, y: (s.chinY - yUp) / s.h, z: 0 };
  };
  put(152, 0, 0);
  put(10, 0, faceLen);
  const fw = 0.78 * faceLen;
  put(234, -fw / 2, 0.5 * faceLen);
  put(454, fw / 2, 0.5 * faceLen);
  put(168, 0, 0.62 * faceLen);
  put(1, 0, 0.38 * faceLen);

  // Augen
  const ipd = 0.33 * faceLen;
  const eyeY = 0.56 * faceLen;
  const eyeW = 0.2 * faceLen;
  const o = 0.15 * eyeW * (s.eyeOpen ?? 1) + 0.0001;
  const eye = (cx: number, ids: readonly number[], flip: boolean) => {
    const sgn = flip ? -1 : 1;
    // ids: p1(außen), p2, p3 (oben), p4(innen), p5, p6 (unten) – bei der Bildlinken außen = links
    put(ids[0], cx - sgn * (eyeW / 2), eyeY);
    put(ids[3], cx + sgn * (eyeW / 2), eyeY);
    put(ids[1], cx - sgn * (eyeW / 6), eyeY + o);
    put(ids[2], cx + sgn * (eyeW / 6), eyeY + o);
    put(ids[4], cx + sgn * (eyeW / 6), eyeY - o);
    put(ids[5], cx - sgn * (eyeW / 6), eyeY - o);
  };
  eye(-ipd / 2, [33, 160, 158, 133, 153, 144], false);
  eye(ipd / 2, [362, 385, 387, 263, 373, 380], false);
  put(468, -ipd / 2, eyeY);
  put(473, ipd / 2, eyeY);
  const ir = 0.04 * faceLen;
  [[469, 0, 1], [470, 1, 0], [471, 0, -1], [472, -1, 0]].forEach(([i, dx, dy]) => put(i, -ipd / 2 + dx * ir, eyeY + dy * ir));
  [[474, 0, 1], [475, 1, 0], [476, 0, -1], [477, -1, 0]].forEach(([i, dx, dy]) => put(i, ipd / 2 + dx * ir, eyeY + dy * ir));

  // Mund
  const mw = 0.34 * faceLen;
  const my = 0.2 * faceLen;
  const gap = (s.mouthOpen ?? 0) * mw;
  put(13, 0, my + gap / 2);
  put(14, 0, my - gap / 2);
  put(78, -mw / 2, my);
  put(308, mw / 2, my);
  put(61, -mw / 2, my + (s.smile ?? 0) * mw);
  put(291, mw / 2, my + (s.smile ?? 0) * mw);

  // übrige Randpunkte der Gesichtskontur grob auf eine Ellipse legen (für Maske/Lichtprüfung)
  const ring = [
    10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150,
    136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109,
  ];
  ring.forEach((idx, n) => {
    if (idx === 10 || idx === 152 || idx === 234 || idx === 454) return;
    const a = (n / ring.length) * Math.PI * 2 - Math.PI / 2; // 0 = oben (10)
    put(idx, Math.cos(a) * (fw / 2), 0.5 * faceLen + Math.sin(a) * -0.5 * faceLen);
  });
  return lm;
}

/** Spaltenweise 4×4-Matrix aus Drehung (> 0: zur Bildrechten), Blick nach oben (> 0) und Neigung. */
export function matrixFromAngles(yawDeg: number, pitchUpDeg: number, rollDeg: number, scale = 1): number[] {
  const r = (d: number) => (d * Math.PI) / 180;
  const [cy, sy] = [Math.cos(r(yawDeg)), Math.sin(r(yawDeg))];
  const [cp, sp] = [Math.cos(r(-pitchUpDeg)), Math.sin(r(-pitchUpDeg))];
  const [cr, sr] = [Math.cos(r(rollDeg)), Math.sin(r(rollDeg))];
  // R = Ry · Rx · Rz
  const Ry = [[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]];
  const Rx = [[1, 0, 0], [0, cp, -sp], [0, sp, cp]];
  const Rz = [[cr, -sr, 0], [sr, cr, 0], [0, 0, 1]];
  const mul = (a: number[][], b: number[][]) => a.map((_, i) => b[0].map((__, j) => a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j]));
  const R = mul(mul(Ry, Rx), Rz);
  const m = new Array(16).fill(0);
  for (let c = 0; c < 3; c++) for (let rr = 0; rr < 3; rr++) m[c * 4 + rr] = R[rr][c] * scale;
  m[15] = 1;
  return m;
}

export function solid(w: number, h: number, rgb: [number, number, number]): RawImage {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = rgb[0];
    data[i * 4 + 1] = rgb[1];
    data[i * 4 + 2] = rgb[2];
    data[i * 4 + 3] = 255;
  }
  return { width: w, height: h, data };
}

/** Pseudozufall, damit Tests reproduzierbar bleiben. */
export function rng(seed = 1): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

export function setPixel(img: RawImage, x: number, y: number, rgb: [number, number, number]): void {
  const k = (y * img.width + x) * 4;
  img.data[k] = rgb[0];
  img.data[k + 1] = rgb[1];
  img.data[k + 2] = rgb[2];
}

export function fillRect(img: RawImage, r: Rect, rgb: [number, number, number]): void {
  for (let y = Math.max(0, r.y); y < Math.min(img.height, r.y + r.h); y++) {
    for (let x = Math.max(0, r.x); x < Math.min(img.width, r.x + r.w); x++) setPixel(img, x, y, rgb);
  }
}

/** Ausgangslage für `CheckInput`: ideales Passbild 400×514 px, Kopfhöhe 75,5 %. */
export function idealInput(over: Partial<CheckInput> = {}, spec: Partial<FaceSpec> = {}): CheckInput {
  const w = 400;
  const h = 514;
  const headH = CONFIG.template.headRatio * h;
  const landmarks = makeLandmarks({ w, h, cx: w / 2, chinY: CONFIG.template.chinY * h, headH, ...spec });
  return {
    width: w,
    height: h,
    faceCount: 1,
    landmarks,
    matrix: matrixFromAngles(0, 0, 0),
    blendshapes: { mouthSmileLeft: 0.02, mouthSmileRight: 0.02, jawOpen: 0.01, eyeBlinkLeft: 0.05, eyeBlinkRight: 0.05 },
    region: { x: 0, y: 0, w, h },
    distanceCm: 130,
    mirrored: false,
    ...over,
  };
}

export function eyeRoiOf(img: RawImage): EyeRoi {
  return { ...img, exclude: [] };
}
