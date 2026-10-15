import { CONFIG } from '../config';
import type { CheckInput, CheckResult, RawImage, Rect } from '../types';
import { grade, nf, rangeText, result, unknown, worstStatus, type Graded } from './common';
import { luma } from './lighting';

export const BACKGROUND_LABEL = 'Hintergrund';

export interface BackgroundMeasure {
  /** Anteil der Hintergrundpixel am Ausschnitt */
  fraction: number;
  pixels: number;
  mean: number;
  std: number;
  /** mittlere HSV-Sättigung 0..1 */
  saturation: number;
}

/** Maske um `r` Pixel aufweiten (getrennt in x und y), damit Haarränder nicht als Hintergrund zählen. */
export function dilate(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  if (r <= 0) return mask;
  const tmp = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    let last = -Infinity;
    // Vorwärts: Abstand zum letzten gesetzten Pixel links
    for (let x = 0; x < w; x++) {
      if (mask[y * w + x]) last = x;
      if (x - last <= r) tmp[y * w + x] = 1;
    }
    last = Infinity;
    for (let x = w - 1; x >= 0; x--) {
      if (mask[y * w + x]) last = x;
      if (last - x <= r) tmp[y * w + x] = 1;
    }
  }
  const out = new Uint8Array(w * h);
  for (let x = 0; x < w; x++) {
    let last = -Infinity;
    for (let y = 0; y < h; y++) {
      if (tmp[y * w + x]) last = y;
      if (y - last <= r) out[y * w + x] = 1;
    }
    last = Infinity;
    for (let y = h - 1; y >= 0; y--) {
      if (tmp[y * w + x]) last = y;
      if (last - y <= r) out[y * w + x] = 1;
    }
  }
  return out;
}

/** Mittelwert, Streuung und Sättigung der Hintergrundpixel innerhalb des Ausschnitts. */
export function measureBackground(img: RawImage, person: Uint8Array, region: Rect): BackgroundMeasure {
  const w = img.width;
  const h = img.height;
  const margin = Math.max(2, Math.round(Math.max(w, h) * 0.012));
  const grown = dilate(person, w, h, margin);
  const x0 = Math.max(0, Math.floor(region.x));
  const y0 = Math.max(0, Math.floor(region.y));
  const x1 = Math.min(w, Math.ceil(region.x + region.w));
  const y1 = Math.min(h, Math.ceil(region.y + region.h));
  const total = Math.max(1, (x1 - x0) * (y1 - y0));
  let n = 0;
  let sum = 0;
  let sumSq = 0;
  let sat = 0;
  const d = img.data;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = y * w + x;
      if (grown[i]) continue;
      const k = i * 4;
      const r = d[k];
      const g = d[k + 1];
      const b = d[k + 2];
      const l = luma(r, g, b);
      n++;
      sum += l;
      sumSq += l * l;
      const mx = Math.max(r, g, b);
      const mn = Math.min(r, g, b);
      sat += mx > 0 ? (mx - mn) / mx : 0;
    }
  }
  if (n === 0) return { fraction: 0, pixels: 0, mean: NaN, std: NaN, saturation: NaN };
  const mean = sum / n;
  return {
    fraction: n / total,
    pixels: n,
    mean,
    std: Math.sqrt(Math.max(0, sumSq / n - mean * mean)),
    saturation: sat / n,
  };
}

/** Hintergrund einfarbig und hell, ohne Muster und Schatten. */
export function checkBackground(input: CheckInput): CheckResult {
  const cfg = CONFIG.checks.background;
  const target = `Ø ${rangeText(cfg.meanLuma, (n) => nf(n, 0))} · Streuung ≤ ${nf(cfg.stdLuma.ok[1], 0)} · Sättigung ≤ ${nf(cfg.saturation.ok[1] * 100, 0)} %`;
  if (!input.image || !input.personMask) return unknown('background', BACKGROUND_LABEL, target, 'Keine Personenmaske');

  const m = measureBackground(input.image, input.personMask, input.region);
  if (m.fraction < cfg.minFraction || m.pixels < 200) {
    return result('background', BACKGROUND_LABEL, 'fail', 0, `${nf(m.fraction * 100, 0)} % sichtbar`, target, 'Hintergrund kaum sichtbar – weiter weg oder anderer Ort');
  }
  const subs: { g: Graded; hint: string }[] = [
    { g: grade(m.mean, cfg.meanLuma), hint: m.mean < cfg.meanLuma.ok[0] ? 'Hintergrund zu dunkel – helle Wand wählen' : 'Hintergrund überstrahlt – weniger Licht darauf' },
    { g: grade(m.std, cfg.stdLuma), hint: 'Hintergrund ungleichmäßig – vor einer glatten Wand ohne Schatten stehen' },
    { g: grade(m.saturation, cfg.saturation), hint: 'Hintergrund zu bunt – neutrale weiße oder graue Wand wählen' },
  ];
  const status = worstStatus(subs.map((s) => s.g.status));
  const score = Math.min(...subs.map((s) => s.g.score));
  const hint = subs.filter((s) => s.g.status !== 'ok').map((s) => s.hint).join(' · ');
  const value = `Ø ${nf(m.mean, 0)} · Streuung ${nf(m.std, 1)} · Sättigung ${nf(m.saturation * 100, 0)} %`;
  return result('background', BACKGROUND_LABEL, status, score, value, target, hint);
}
