import type { CheckId, CheckResult, Status } from '../types';
import type { Range } from '../config';

export interface Graded {
  status: Status;
  score: number;
  /** Abstand zum grünen Bereich (0 = innerhalb) */
  excess: number;
  /** auf welcher Seite der Wert zu weit liegt */
  side: 'low' | 'high' | 'in';
}

/**
 * Bewertet einen Wert gegen einen Bereich.
 * Score: 1 im grünen Bereich, von dort linear bis 0,5 am Rand des gelben Bereichs,
 * dahinter weiter bis 0 (nach nochmals derselben Toleranzbreite).
 */
export function grade(value: number, range: Range): Graded {
  const [okLo, okHi] = range.ok;
  const [wLo, wHi] = range.warn;
  if (!Number.isFinite(value)) return { status: 'unknown', score: 0, excess: 0, side: 'in' };
  if (value >= okLo && value <= okHi) return { status: 'ok', score: 1, excess: 0, side: 'in' };
  const low = value < okLo;
  const excess = low ? okLo - value : value - okHi;
  const tol = low ? okLo - wLo : wHi - okHi; // Breite des gelben Bereichs auf dieser Seite
  const side = low ? 'low' : 'high';
  if (value >= wLo && value <= wHi) {
    const t = Number.isFinite(tol) && tol > 0 ? excess / tol : 1;
    return { status: 'warn', score: 1 - 0.5 * Math.min(1, t), excess, side };
  }
  const beyond = excess - (Number.isFinite(tol) ? tol : 0);
  const t = Number.isFinite(tol) && tol > 0 ? beyond / tol : 1;
  return { status: 'fail', score: Math.max(0, 0.5 - 0.5 * Math.min(1, t)), excess, side };
}

const RANK: Record<Status, number> = { ok: 0, unknown: 1, warn: 2, fail: 3 };

/** Der schlechteste von mehreren Status. */
export function worstStatus(list: Status[]): Status {
  let w: Status = 'ok';
  for (const s of list) if (RANK[s] > RANK[w]) w = s;
  return w;
}

export function nf(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return '–';
  return value
    .toLocaleString('de-DE', { minimumFractionDigits: digits, maximumFractionDigits: digits })
    .replace('-', '−');
}

export const pct = (v: number, digits = 0) => `${nf(v * 100, digits)} %`;

/** Bereich als Text, z. B. „71–80 %“ oder „≤ 5 °“. */
export function rangeText(range: Range, fmt: (n: number) => string, unit = ''): string {
  const [lo, hi] = range.ok;
  const u = unit ? ` ${unit}` : '';
  if (!Number.isFinite(lo)) return `≤ ${fmt(hi)}${u}`;
  if (!Number.isFinite(hi)) return `≥ ${fmt(lo)}${u}`;
  if (Math.abs(lo) === Math.abs(hi) && lo < 0) return `±${fmt(hi)}${u}`;
  return `${fmt(lo)}–${fmt(hi)}${u}`;
}

/** Links/Rechts aus Bildsicht in die Sicht auf dem Bildschirm umrechnen. */
export function screenSide(imageSide: 'links' | 'rechts', mirrored: boolean): 'links' | 'rechts' {
  if (!mirrored) return imageSide;
  return imageSide === 'links' ? 'rechts' : 'links';
}

export function result(
  id: CheckId,
  label: string,
  status: Status,
  score: number,
  value: string,
  target: string,
  hint: string,
): CheckResult {
  return { id, label, status, score, value, target, hint: status === 'ok' ? '' : hint };
}

/** Ergebnis für „nicht beurteilbar“. */
export function unknown(id: CheckId, label: string, target: string, why: string): CheckResult {
  return { id, label, status: 'unknown', score: 0, value: '–', target, hint: why };
}
