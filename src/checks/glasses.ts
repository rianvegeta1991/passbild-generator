import { CONFIG } from '../config';
import type { CheckInput, CheckResult, EyeRoi } from '../types';
import { grade, nf, pct, result, unknown } from './common';
import { luma } from './lighting';

export const GLASSES_LABEL = 'Brille / Reflexe';

export interface ReflexMeasure {
  /** Anteil sehr heller Pixel (ohne Iriskreise) */
  brightFraction: number;
  /** Anzahl kleiner heller Flecken */
  blobs: number;
}

/** Sucht sehr helle, kleine Flecken im Augenbereich – Hinweis auf Brillenreflexe. */
export function measureReflexes(roi: EyeRoi): ReflexMeasure {
  const cfg = CONFIG.checks.glasses;
  const { width: w, height: h, data } = roi;
  const bright = new Uint8Array(w * h);
  let valid = 0;
  let nBright = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (roi.exclude.some((c) => (x - c.cx) ** 2 + (y - c.cy) ** 2 <= c.r * c.r)) continue;
      valid++;
      const k = (y * w + x) * 4;
      if (luma(data[k], data[k + 1], data[k + 2]) >= cfg.brightLuma) {
        bright[y * w + x] = 1;
        nBright++;
      }
    }
  }
  // Zusammenhängende Flecken zählen (4er-Nachbarschaft, iterativ)
  const seen = new Uint8Array(w * h);
  const maxArea = cfg.maxBlobFraction * w * h;
  let blobs = 0;
  const stack: number[] = [];
  for (let s = 0; s < w * h; s++) {
    if (!bright[s] || seen[s]) continue;
    let area = 0;
    stack.push(s);
    seen[s] = 1;
    while (stack.length) {
      const p = stack.pop() as number;
      area++;
      const px = p % w;
      const py = (p - px) / w;
      const nb = [px > 0 ? p - 1 : -1, px < w - 1 ? p + 1 : -1, py > 0 ? p - w : -1, py < h - 1 ? p + w : -1];
      for (const q of nb) {
        if (q >= 0 && bright[q] && !seen[q]) {
          seen[q] = 1;
          stack.push(q);
        }
      }
    }
    if (area >= cfg.minBlobPixels && area <= maxArea) blobs++;
  }
  return { brightFraction: valid ? nBright / valid : 0, blobs };
}

/** Nur ein Hinweis (nie „rot“): möglicher Reflex in Brillengläsern. */
export function checkGlasses(input: CheckInput): CheckResult {
  const cfg = CONFIG.checks.glasses;
  const target = `helle Pixel ≤ ${nf(cfg.brightFraction.ok[1] * 100, 1)} %`;
  if (!input.eyeRoi) return unknown('glasses', GLASSES_LABEL, target, 'Augenbereich nicht verfügbar');
  const m = measureReflexes(input.eyeRoi);
  const g = grade(m.brightFraction, cfg.brightFraction);
  const status = g.status === 'fail' ? 'warn' : g.status; // nur Hinweis
  const score = Math.max(g.score, 0.5);
  const value = `${pct(m.brightFraction, 1)} hell · ${m.blobs} ${m.blobs === 1 ? 'Fleck' : 'Flecken'}`;
  return result('glasses', GLASSES_LABEL, status, score, value, target, 'Möglicher Reflex in den Brillengläsern – Brille abnehmen oder Kopf/Licht leicht ändern');
}
