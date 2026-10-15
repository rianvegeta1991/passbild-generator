import { CONFIG } from '../config';
import type { CheckInput, CheckResult } from '../types';
import { grade, nf, rangeText, result, unknown } from './common';

export const RESOLUTION_LABEL = 'Auflösung';

/** Wie viele echte Pixel stecken im Ausschnitt? Wird hochgerechnet, wird das Bild weich. */
export function checkResolution(input: CheckInput): CheckResult {
  const cfg = CONFIG.checks.resolution;
  const target = `${rangeText(cfg.cropHeightPx, (n) => nf(n, 0), 'px')} (${CONFIG.output.heightPx} px = 600 dpi)`;
  if (input.cropSourceHeightPx === undefined) return unknown('resolution', RESOLUTION_LABEL, target, '');
  const g = grade(input.cropSourceHeightPx, cfg.cropHeightPx);
  return result(
    'resolution',
    RESOLUTION_LABEL,
    g.status,
    g.score,
    `${nf(input.cropSourceHeightPx, 0)} px`,
    target,
    'Zu wenig Bildpunkte im Ausschnitt – näher ran, hineinzoomen oder höhere Kameraauflösung wählen',
  );
}
