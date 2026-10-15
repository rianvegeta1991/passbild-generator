import { CONFIG } from '../config';
import type { CheckInput, CheckResult, Status } from '../types';
import { LM, eyeMid, measureHead, px } from '../detection/geometry';
import { grade, nf, pct, result, screenSide, unknown, type Graded } from './common';

export const POSITION_LABEL = 'Position';

/**
 * Kopf mittig, Augenlinie im Sollbereich, genug Rand über Scheitel und unter Kinn.
 * (Die Augenlinie liegt bei Kopfhöhe 71–80 % physikalisch nie im oberen Drittel,
 * sondern knapp über der Bildmitte – siehe config.ts.)
 */
export function checkPosition(input: CheckInput): CheckResult {
  const cfg = CONFIG.checks.position;
  const target = `mittig ±${nf(cfg.centerOffset.ok[1] * 100, 0)} % · Augen ${nf(cfg.eyeLine.ok[0] * 100, 0)}–${nf(cfg.eyeLine.ok[1] * 100, 0)} % von oben`;
  if (!input.landmarks) return unknown('position', POSITION_LABEL, target, 'Kein Gesicht');

  const { width: w, height: h, region, landmarks: lm } = input;
  const head = measureHead(lm, w, h, input.personMask);
  const eyes = eyeMid(lm, w, h);
  const axisX = (head.chin.x + px(lm, LM.noseBridge, w, h).x + px(lm, LM.foreheadTop, w, h).x) / 3;

  const offset = (axisX - (region.x + region.w / 2)) / region.w; // > 0: Kopf rechts der Mitte
  const eyeLine = (eyes.y - region.y) / region.h;
  const top = (Math.min(head.crown.y, head.chin.y) - region.y) / region.h;
  const bottom = (region.y + region.h - Math.max(head.chin.y, head.crown.y)) / region.h;

  const subs: { g: Graded; hint: string }[] = [
    {
      g: grade(Math.abs(offset), cfg.centerOffset),
      hint: `Kopf etwas nach ${screenSide(offset > 0 ? 'links' : 'rechts', input.mirrored)} bewegen`,
    },
    { g: grade(eyeLine, cfg.eyeLine), hint: eyeLine < cfg.eyeLine.ok[0] ? 'Kopf etwas tiefer im Bild' : 'Kopf etwas höher im Bild' },
    { g: grade(top, cfg.topMargin), hint: 'Mehr Platz über dem Kopf – Kopf tiefer im Bild' },
    { g: grade(bottom, cfg.bottomMargin), hint: 'Mehr Platz unter dem Kinn – Kopf höher im Bild' },
  ];
  const rank: Record<Status, number> = { ok: 0, unknown: 1, warn: 2, fail: 3 };
  let worst = subs[0];
  for (const s of subs) if (rank[s.g.status] > rank[worst.g.status]) worst = s;
  const score = Math.min(...subs.map((s) => s.g.score));
  const value = `Mitte ${offset >= 0 ? '+' : '−'}${nf(Math.abs(offset) * 100, 1)} % · Augen ${pct(eyeLine, 0)} · Rand oben ${pct(top, 0)}`;
  return result('position', POSITION_LABEL, worst.g.status, score, value, target, worst.hint);
}
