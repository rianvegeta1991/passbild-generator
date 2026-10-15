import { CONFIG } from '../config';
import type { CheckInput, CheckResult, RawImage } from '../types';
import { grade, nf, rangeText, result, unknown } from './common';
import { luma } from './lighting';

export const SHARPNESS_LABEL = 'Schärfe';

/** Varianz des Laplace-Filters (3×3, 4er-Nachbarschaft) über das Graustufenbild. */
export function laplacianVariance(img: RawImage): number {
  const { width: w, height: h, data } = img;
  if (w < 3 || h < 3) return NaN;
  const gray = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) gray[i] = luma(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
  let n = 0;
  let sum = 0;
  let sumSq = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const v = gray[i - w] + gray[i + w] + gray[i - 1] + gray[i + 1] - 4 * gray[i];
      n++;
      sum += v;
      sumSq += v * v;
    }
  }
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

/** Mittlere Helligkeit des Bilds. */
export function meanLuma(img: RawImage): number {
  const { width: w, height: h, data } = img;
  let sum = 0;
  for (let i = 0; i < w * h; i++) sum += luma(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
  return sum / Math.max(1, w * h);
}

/**
 * Schärfemaß, vom Belichtungsniveau befreit: die Laplace-Varianz wächst mit dem Quadrat der
 * Helligkeit, ein dunkles Bild würde sonst „unscharf“ wirken. Bezugspunkt ist mittleres Grau (128).
 */
export function normalizedSharpness(img: RawImage): number {
  const v = laplacianVariance(img);
  const m = Math.max(meanLuma(img), 24);
  return v * (128 / m) ** 2;
}

/** Scharf im Augenbereich (der Bereich ist auf feste Breite normiert, damit die Schwelle vergleichbar bleibt). */
export function checkSharpness(input: CheckInput): CheckResult {
  const cfg = CONFIG.checks.sharpness;
  const target = rangeText(cfg.laplacianVar, (n) => nf(n, 0));
  if (!input.eyeRoi) return unknown('sharpness', SHARPNESS_LABEL, target, 'Augenbereich nicht verfügbar');
  const v = normalizedSharpness(input.eyeRoi);
  const g = grade(v, cfg.laplacianVar);
  return result('sharpness', SHARPNESS_LABEL, g.status, g.score, nf(v, 0), target, 'Unscharf – Handy ruhig halten, Fokus abwarten, mehr Licht');
}
