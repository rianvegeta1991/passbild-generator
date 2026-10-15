import { CONFIG } from '../config';
import type { Pt, Rect } from '../types';

export interface CropPlan {
  /** Zielpixel je Quellpixel */
  scale: number;
  /** Begradigung in Grad (> 0: die Augenlinie war im Uhrzeigersinn geneigt, es wird dagegen gedreht) */
  levelDeg: number;
  /** Mittelpunkt des Ausschnitts in Quellpixeln */
  center: Pt;
  destW: number;
  destH: number;
  /** Quelle → Ziel, Argumente für `ctx.setTransform(a, b, c, d, e, f)` */
  matrix: [number, number, number, number, number, number];
  /** Höhe des Ausschnitts in Quellpixeln (= echte Bildpunkte, die darin stecken) */
  srcHeightPx: number;
  /** Umschließendes Rechteck des (gedrehten) Ausschnitts in Quellpixeln */
  aabb: Rect;
  adjusted: 'none' | 'shifted' | 'tightened';
}

/**
 * Plant den Zuschnitt: Kopfhöhe auf den Sollanteil skalieren, Kinn auf die Sollhöhe,
 * Kopfachse mittig, Augenlinie waagrecht. Reicht der Ausschnitt über das Bild hinaus,
 * wird er zuerst verschoben und erst dann enger gezogen (Kopf wird dabei größer als Soll) –
 * es werden nie Pixel erfunden.
 */
export function planCrop(
  chin: Pt,
  headHeightPx: number,
  levelDeg: number,
  srcW: number,
  srcH: number,
  destW = CONFIG.output.widthPx,
  destH = CONFIG.output.heightPx,
): CropPlan {
  const t = CONFIG.template;
  const phiDeg = Math.abs(levelDeg) <= CONFIG.crop.maxLevelDeg ? levelDeg : 0;
  const phi = (phiDeg * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  let s = (t.headRatio * destH) / headHeightPx;

  const halfExtents = (sc: number) => ({
    hx: (Math.abs(cos) * destW / 2 + Math.abs(sin) * destH / 2) / sc,
    hy: (Math.abs(sin) * destW / 2 + Math.abs(cos) * destH / 2) / sc,
  });
  const centerFor = (sc: number): Pt => {
    const v = ((t.chinY - 0.5) * destH) / sc;
    // R(φ)·(0, v) = (−sinφ·v, cosφ·v)
    return { x: chin.x + sin * v, y: chin.y - cos * v };
  };

  let adjusted: CropPlan['adjusted'] = 'none';
  let { hx, hy } = halfExtents(s);
  if (2 * hx > srcW || 2 * hy > srcH) {
    s *= Math.max((2 * hx) / srcW, (2 * hy) / srcH); // Fenster kleiner = stärker hineinzoomen
    ({ hx, hy } = halfExtents(s));
    adjusted = 'tightened';
  }
  const c = centerFor(s);
  const nx = Math.min(Math.max(c.x, hx), srcW - hx);
  const ny = Math.min(Math.max(c.y, hy), srcH - hy);
  if (Math.abs(nx - c.x) > 1e-6 || Math.abs(ny - c.y) > 1e-6) {
    if (adjusted === 'none') adjusted = 'shifted';
  }
  const center = { x: nx, y: ny };

  const a = s * cos;
  const b = -s * sin;
  const cc = s * sin;
  const d = s * cos;
  const e = destW / 2 - (a * center.x + cc * center.y);
  const f = destH / 2 - (b * center.x + d * center.y);
  return {
    scale: s,
    levelDeg: phiDeg,
    center,
    destW,
    destH,
    matrix: [a, b, cc, d, e, f],
    srcHeightPx: destH / s,
    aabb: { x: center.x - hx, y: center.y - hy, w: 2 * hx, h: 2 * hy },
    adjusted,
  };
}

/** Wendet die Matrix auf einen Quellpunkt an. */
export function applyPlan(plan: CropPlan, p: Pt): Pt {
  const [a, b, c, d, e, f] = plan.matrix;
  return { x: a * p.x + c * p.y + e, y: b * p.x + d * p.y + f };
}

type Drawable = CanvasImageSource & { width: number; height: number };

/**
 * Zeichnet den Ausschnitt. Bei starker Verkleinerung wird die Quelle vorher schrittweise
 * halbiert – so bleibt das Ergebnis scharf und ohne Treppen (Browser filtern sonst grob).
 */
export function renderCrop(src: Drawable, plan: CropPlan): HTMLCanvasElement {
  let img: Drawable = src;
  let p = 1;
  while (plan.scale / p < 0.5) {
    const half = document.createElement('canvas');
    half.width = Math.max(1, Math.round(img.width / 2));
    half.height = Math.max(1, Math.round(img.height / 2));
    const hctx = half.getContext('2d') as CanvasRenderingContext2D;
    hctx.imageSmoothingEnabled = true;
    hctx.imageSmoothingQuality = 'high';
    hctx.drawImage(img, 0, 0, half.width, half.height);
    img = half;
    p /= 2;
  }
  const out = document.createElement('canvas');
  out.width = plan.destW;
  out.height = plan.destH;
  const ctx = out.getContext('2d') as CanvasRenderingContext2D;
  ctx.fillStyle = '#ffffff'; // nur falls Randpixel halb im Bild liegen; der Plan hält den Ausschnitt im Bild
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  const [a, b, c, d, e, f] = plan.matrix;
  ctx.setTransform(a / p, b / p, c / p, d / p, e, f);
  ctx.drawImage(img, 0, 0);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return out;
}
