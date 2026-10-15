import { CONFIG } from '../config';
import type { CheckInput, CheckResult } from '../types';
import { grade, nf, rangeText, result, unknown } from './common';

export const DISTANCE_LABEL = 'Abstand';

/**
 * Abstand Kamera–Gesicht (aus dem Augenabstand geschätzt). Zu nah heißt:
 * Weitwinkel-Verzerrung (große Nase, kleine Ohren) – lieber weit weg und zoomen.
 */
export function checkDistance(input: CheckInput): CheckResult {
  const cfg = CONFIG.checks.distance;
  const target = rangeText(cfg.cm, (n) => nf(n, 0), 'cm');
  if (input.distanceCm === undefined || !Number.isFinite(input.distanceCm)) {
    return unknown('distance', DISTANCE_LABEL, target, 'Abstand nicht schätzbar');
  }
  const g = grade(input.distanceCm, cfg.cm);
  const hint = 'Mindestens 1–1,5 m Abstand halten, ggf. Zoom nutzen';
  return result('distance', DISTANCE_LABEL, g.status, g.score, `≈ ${nf(input.distanceCm, 0)} cm`, target, hint);
}
