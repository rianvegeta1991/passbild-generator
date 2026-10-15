import { CONFIG } from '../config';
import type { Pt, Rect } from '../types';

/** Indizes im 478-Punkte-Netz des MediaPipe Face Landmarkers. */
export const LM = {
  chin: 152,
  foreheadTop: 10,
  noseTip: 1,
  noseBridge: 168,
  /** äußerster Wangenpunkt auf der Bildlinken / Bildrechten (unverspiegeltes Bild) */
  faceLeft: 234,
  faceRight: 454,
  /** Iriszentren: 468 = Auge auf der Bildlinken, 473 = auf der Bildrechten */
  irisLeft: 468,
  irisRight: 473,
  irisLeftRing: [469, 470, 471, 472],
  irisRightRing: [474, 475, 476, 477],
  mouthUpperInner: 13,
  mouthLowerInner: 14,
  mouthCornerLeftInner: 78,
  mouthCornerRightInner: 308,
  mouthCornerLeft: 61,
  mouthCornerRight: 291,
} as const;

/** Lidpunkte für den Eye Aspect Ratio: p1 (außen), p2, p3 (oben), p4 (innen), p5, p6 (unten). */
export const EAR_LEFT = [33, 160, 158, 133, 153, 144] as const;
export const EAR_RIGHT = [362, 385, 387, 263, 373, 380] as const;

export const FACE_OVAL = [
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150,
  136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109,
];

export const EYE_CONTOUR_LEFT = [33, 7, 163, 144, 145, 153, 154, 155, 133, 246, 161, 160, 159, 158, 157, 173];
export const EYE_CONTOUR_RIGHT = [362, 382, 381, 380, 374, 373, 390, 249, 263, 466, 388, 387, 386, 385, 384, 398];

export const deg = (r: number) => (r * 180) / Math.PI;
export const rad = (d: number) => (d * Math.PI) / 180;

export const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

/** Landmark in Pixelkoordinaten. */
export function px(lm: Pt[], i: number, w: number, h: number): Pt {
  const p = lm[i];
  return { x: p.x * w, y: p.y * h };
}

export interface Angles {
  /** > 0: Gesicht zeigt zur Bildrechten */
  yaw: number;
  /** > 0: Blick nach oben */
  pitch: number;
  /** > 0: Kopf oben zur Bildlinken geneigt (im Bild gegen den Uhrzeigersinn) */
  roll: number;
}

/**
 * Euler-Winkel (Grad) aus der 4×4-Transformationsmatrix (spaltenweise).
 * Zerlegung R = Ry(yaw) · Rx(pitch) · Rz(roll) nach Normierung der Spalten.
 */
export function anglesFromMatrix(m: ArrayLike<number>): Angles {
  const col = (c: number) => {
    const v = [m[c * 4], m[c * 4 + 1], m[c * 4 + 2]];
    const n = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / n, v[1] / n, v[2] / n];
  };
  const c0 = col(0);
  const c1 = col(1);
  const c2 = col(2);
  const clamp = (v: number) => Math.max(-1, Math.min(1, v));
  return {
    yaw: deg(Math.atan2(c2[0], c2[2])),
    pitch: deg(Math.asin(clamp(c2[1]))) - CONFIG.checks.pose.pitchOffsetDeg,
    roll: deg(Math.atan2(c0[1], c1[1])),
  };
}

/** Neigung der Augenlinie im Bild in Grad (> 0: Auge auf der Bildrechten liegt tiefer). */
export function eyeLineAngleDeg(lm: Pt[], w: number, h: number): number {
  const a = px(lm, LM.irisLeft, w, h);
  const b = px(lm, LM.irisRight, w, h);
  return deg(Math.atan2(b.y - a.y, b.x - a.x));
}

export interface HeadMeasure {
  chin: Pt;
  crown: Pt;
  /** Strecke Kinn–Scheitel in Pixeln */
  heightPx: number;
  /** Einheitsvektor Kinn → Scheitel */
  axis: Pt;
  /** Strecke Kinn–Stirnpunkt (Landmark 10) in Pixeln */
  faceLenPx: number;
  /** Breite des Gesichts (Wange–Wange) in Pixeln */
  faceWidthPx: number;
  source: 'schaetzung' | 'maske';
}

/**
 * Misst die Kopfhöhe (Kinn bis Scheitel) in Pixeln.
 * Der Scheitel wird aus Landmark 10 plus Faktor geschätzt und – wenn eine
 * Personenmaske vorliegt – am oberen Maskenrand entlang der Kopfachse verfeinert.
 */
export function measureHead(lm: Pt[], w: number, h: number, mask?: Uint8Array): HeadMeasure {
  const cfg = CONFIG.head;
  const chin = px(lm, LM.chin, w, h);
  const top = px(lm, LM.foreheadTop, w, h);
  const dx = top.x - chin.x;
  const dy = top.y - chin.y;
  const faceLenPx = Math.hypot(dx, dy) || 1;
  const axis = { x: dx / faceLenPx, y: dy / faceLenPx };
  const faceWidthPx = dist(px(lm, LM.faceLeft, w, h), px(lm, LM.faceRight, w, h));

  let heightPx = faceLenPx * (1 + cfg.crownFactor);
  let source: HeadMeasure['source'] = 'schaetzung';

  if (mask) {
    const est = heightPx;
    const tStart = faceLenPx * 0.85;
    const tLimit = faceLenPx * (1 + cfg.crownFactor + cfg.maskSearchExtra);
    const normal = { x: -axis.y, y: axis.x };
    let best = -1;
    let hitLimit = false;
    for (const lateral of [-0.15, -0.07, 0, 0.07, 0.15]) {
      const off = lateral * faceWidthPx;
      const at = (t: number) => {
        const x = Math.round(chin.x + axis.x * t + normal.x * off);
        const y = Math.round(chin.y + axis.y * t + normal.y * off);
        if (x < 0 || y < 0 || x >= w || y >= h) return -1;
        return mask[y * w + x];
      };
      if (at(tStart) !== 1) continue; // dieser Strahl startet nicht in der Person
      let t = tStart;
      while (t < tLimit && at(t + 1) === 1) t += 1;
      if (t >= tLimit - 1) hitLimit = true;
      if (t > best) best = t;
    }
    // Maske nur nehmen, wenn sie plausibel ist (nicht mit dem Hintergrund verschmolzen, nicht weit vom Schätzwert)
    if (best > 0 && !hitLimit && Math.abs(best - est) <= faceLenPx * cfg.maskMaxDeviation && best > faceLenPx * 0.95) {
      heightPx = best;
      source = 'maske';
    }
  }

  return {
    chin,
    crown: { x: chin.x + axis.x * heightPx, y: chin.y + axis.y * heightPx },
    heightPx,
    axis,
    faceLenPx,
    faceWidthPx,
    source,
  };
}

/** Mittelpunkt der beiden Iriszentren in Pixeln. */
export function eyeMid(lm: Pt[], w: number, h: number): Pt {
  const a = px(lm, LM.irisLeft, w, h);
  const b = px(lm, LM.irisRight, w, h);
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** Augenabstand (Iris zu Iris) in Pixeln. */
export function ipdPx(lm: Pt[], w: number, h: number): number {
  return dist(px(lm, LM.irisLeft, w, h), px(lm, LM.irisRight, w, h));
}

/** Grobe Abstandsschätzung aus dem Augenabstand (Lochkameramodell). */
export function estimateDistanceCm(
  ipdPixels: number,
  imgW: number,
  imgH: number,
  fovShortSideDeg: number,
  zoom: number,
): number {
  if (!(ipdPixels > 0)) return NaN;
  const shortSide = Math.min(imgW, imgH);
  const focalPx = (shortSide / 2 / Math.tan(rad(fovShortSideDeg) / 2)) * Math.max(zoom, 0.01);
  return (focalPx * CONFIG.checks.distance.ipdMm) / ipdPixels / 10;
}

/** Füllt ein Polygon (Pixelkoordinaten) in eine 0/1-Maske. */
export function rasterizePolygon(poly: Pt[], w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);
  if (poly.length < 3) return out;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of poly) {
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  const y0 = Math.max(0, Math.floor(minY));
  const y1 = Math.min(h - 1, Math.ceil(maxY));
  for (let y = y0; y <= y1; y++) {
    const yc = y + 0.5;
    const xs: number[] = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      if ((a.y <= yc && b.y > yc) || (b.y <= yc && a.y > yc)) {
        xs.push(a.x + ((yc - a.y) / (b.y - a.y)) * (b.x - a.x));
      }
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xa = Math.max(0, Math.round(xs[k]));
      const xb = Math.min(w, Math.round(xs[k + 1]));
      for (let x = xa; x < xb; x++) out[y * w + x] = 1;
    }
  }
  return out;
}

/** Umschließendes Rechteck einer Landmark-Gruppe in Pixeln. */
export function bbox(lm: Pt[], idx: number[], w: number, h: number): Rect {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const i of idx) {
    const p = px(lm, i, w, h);
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
