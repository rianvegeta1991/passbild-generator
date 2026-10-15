import { CONFIG } from '../config';
import type { CheckInput, CheckResult, RawImage } from '../types';
import { FACE_OVAL, LM, px, rasterizePolygon } from '../detection/geometry';
import { grade, nf, pct, rangeText, result, screenSide, unknown, worstStatus, type Graded } from './common';

export const LIGHTING_LABEL = 'Licht';

export interface LightingMeasure {
  pixels: number;
  mean: number;
  /** Mittel der linken / rechten Bildhälfte des Gesichts */
  leftMean: number;
  rightMean: number;
  /** (links − rechts) / Mittel; > 0: links heller */
  asymmetry: number;
  /** Anteil überstrahlter bzw. abgesoffener Pixel */
  clipped: number;
  clippedHigh: number;
  /** Perzentil 95 − Perzentil 5 */
  contrast: number;
}

export const luma = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** Helligkeitsstatistik über die maskierten Pixel; `axisX` trennt linke und rechte Gesichtshälfte. */
export function measureLighting(img: RawImage, mask: Uint8Array, axisX: number): LightingMeasure {
  const hist = new Uint32Array(256);
  let n = 0;
  let sum = 0;
  let nL = 0;
  let sumL = 0;
  let nR = 0;
  let sumR = 0;
  let hi = 0;
  let lo = 0;
  const d = img.data;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const i = y * img.width + x;
      if (!mask[i]) continue;
      const k = i * 4;
      const l = luma(d[k], d[k + 1], d[k + 2]);
      hist[Math.min(255, Math.round(l))]++;
      n++;
      sum += l;
      if (x < axisX) {
        nL++;
        sumL += l;
      } else {
        nR++;
        sumR += l;
      }
      if (l >= 250) hi++;
      else if (l <= 8) lo++;
    }
  }
  if (n === 0) {
    return { pixels: 0, mean: NaN, leftMean: NaN, rightMean: NaN, asymmetry: NaN, clipped: NaN, clippedHigh: NaN, contrast: NaN };
  }
  const mean = sum / n;
  const leftMean = nL ? sumL / nL : mean;
  const rightMean = nR ? sumR / nR : mean;
  const pctile = (p: number) => {
    let acc = 0;
    const target = p * n;
    for (let v = 0; v < 256; v++) {
      acc += hist[v];
      if (acc >= target) return v;
    }
    return 255;
  };
  return {
    pixels: n,
    mean,
    leftMean,
    rightMean,
    asymmetry: (leftMean - rightMean) / Math.max(mean, 1),
    clipped: (hi + lo) / n,
    clippedHigh: hi / n,
    contrast: pctile(0.95) - pctile(0.05),
  };
}

/** Gleichmäßige Ausleuchtung, keine Schlagschatten, keine überstrahlten Stellen. */
export function checkLighting(input: CheckInput): CheckResult {
  const cfg = CONFIG.checks.lighting;
  const target = `Ø ${rangeText(cfg.meanLuma, (n) => nf(n, 0))} · L/R ≤ ${nf(cfg.asymmetry.ok[1] * 100, 0)} % · Clip ≤ ${nf(cfg.clipped.ok[1] * 100, 0)} %`;
  if (!input.landmarks || !input.image) return unknown('lighting', LIGHTING_LABEL, target, 'Kein Gesicht');

  const { width: w, height: h, landmarks: lm } = input;
  const poly = FACE_OVAL.map((i) => px(lm, i, w, h));
  const mask = rasterizePolygon(poly, w, h);
  const axisX = px(lm, LM.noseBridge, w, h).x;
  const m = measureLighting(input.image, mask, axisX);
  if (m.pixels < 50) return unknown('lighting', LIGHTING_LABEL, target, 'Gesicht zu klein für die Lichtprüfung');

  const subs: { g: Graded; hint: string }[] = [
    {
      g: grade(m.mean, cfg.meanLuma),
      hint: m.mean < cfg.meanLuma.ok[0] ? 'Zu dunkel – mehr Licht aufs Gesicht' : 'Zu hell – Licht dämpfen',
    },
    {
      g: grade(Math.abs(m.asymmetry), cfg.asymmetry),
      // links heller → Licht kommt von der (Bild-)Linken
      hint: `Licht von ${screenSide(m.asymmetry > 0 ? 'links' : 'rechts', input.mirrored)} zu stark`,
    },
    { g: grade(m.clipped, cfg.clipped), hint: m.clippedHigh > 0 ? 'Überstrahlte Stellen – weicheres Licht, nicht direkt anblitzen' : 'Tiefe Schatten – mehr Licht' },
    { g: grade(m.contrast, cfg.contrast), hint: 'Zu flaues Licht – etwas mehr Kontrast' },
  ];
  const status = worstStatus(subs.map((s) => s.g.status));
  const score = Math.min(...subs.map((s) => s.g.score));
  const bad = subs.filter((s) => s.g.status !== 'ok').map((s) => s.hint);
  const value = `Ø ${nf(m.mean, 0)} · L/R ${m.asymmetry >= 0 ? '+' : '−'}${nf(Math.abs(m.asymmetry) * 100, 0)} % · Clip ${pct(m.clipped, 1)} · Kontrast ${nf(m.contrast, 0)}`;
  return result('lighting', LIGHTING_LABEL, status, score, value, target, bad.join(' · '));
}
