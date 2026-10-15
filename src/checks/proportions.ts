import { CONFIG } from '../config';
import type { CheckInput, CheckResult } from '../types';
import { measureHead } from '../detection/geometry';
import { grade, nf, pct, rangeText, result, unknown } from './common';

export const PROPORTIONS_LABEL = 'Kopfgröße';

/** Kinn bis Scheitel im Verhältnis zur Höhe des Ausschnitts (32–36 mm von 45 mm). */
export function checkProportions(input: CheckInput): CheckResult {
  const cfg = CONFIG.checks.proportions;
  const mmH = CONFIG.output.mmHeight;
  const target = `${rangeText(cfg.headRatio, (n) => nf(n * 100, 0), '%')} (${nf(cfg.headRatio.ok[0] * mmH, 0)}–${nf(cfg.headRatio.ok[1] * mmH, 0)} mm)`;
  if (!input.landmarks) return unknown('proportions', PROPORTIONS_LABEL, target, 'Kein Gesicht');

  const head = measureHead(input.landmarks, input.width, input.height, input.personMask);
  const ratio = head.heightPx / input.region.h;
  const g = grade(ratio, cfg.headRatio);
  const hint = g.side === 'low' ? 'Näher ran oder hineinzoomen' : 'Weiter weg oder herauszoomen';
  const value = `${pct(ratio, 1)} (${nf(ratio * mmH, 1)} mm)`;
  return result('proportions', PROPORTIONS_LABEL, g.status, g.score, value, target, hint);
}
