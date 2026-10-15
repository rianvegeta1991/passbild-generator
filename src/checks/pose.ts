import { CONFIG } from '../config';
import type { CheckInput, CheckResult } from '../types';
import { anglesFromMatrix } from '../detection/geometry';
import { grade, nf, rangeText, result, screenSide, unknown, worstStatus } from './common';

export const POSE_LABEL = 'Kopfhaltung';

/** Gesicht frontal: Drehung (Yaw), Nicken (Pitch) und Neigung (Roll) aus der Transformationsmatrix. */
export function checkPose(input: CheckInput): CheckResult {
  const cfg = CONFIG.checks.pose;
  const target = `Dreh ${rangeText(cfg.yaw, (n) => nf(n, 0), '°')} · Nick ${rangeText(cfg.pitch, (n) => nf(n, 0), '°')} · Neig ${rangeText(cfg.roll, (n) => nf(n, 0), '°')}`;
  if (!input.matrix) return unknown('pose', POSE_LABEL, target, 'Keine Posendaten');

  const a = anglesFromMatrix(input.matrix);
  const gy = grade(a.yaw, cfg.yaw);
  const gp = grade(a.pitch, cfg.pitch);
  const gr = grade(a.roll, cfg.roll);
  const status = worstStatus([gy.status, gp.status, gr.status]);
  const score = Math.min(gy.score, gp.score, gr.score);

  // Hinweis zur am stärksten verletzten Achse (im Verhältnis zur gelben Grenze)
  const rel = [
    { g: gy, v: a.yaw, lim: cfg.yaw.ok[1] },
    { g: gp, v: a.pitch, lim: cfg.pitch.ok[1] },
    { g: gr, v: a.roll, lim: cfg.roll.ok[1] },
  ].map((e, i) => ({ ...e, i, ratio: Math.abs(e.v) / e.lim }));
  rel.sort((p, q) => q.ratio - p.ratio);
  const worst = rel[0];
  let hint = '';
  if (worst.g.status !== 'ok') {
    if (worst.i === 0) {
      // Gesicht zeigt zur Bildrechten → zur Bildlinken zurückdrehen
      hint = `Kopf leicht nach ${screenSide(a.yaw > 0 ? 'links' : 'rechts', input.mirrored)} drehen`;
    } else if (worst.i === 1) {
      hint = a.pitch > 0 ? 'Kinn leicht senken' : 'Kinn leicht heben';
    } else {
      hint = `Kopf gerade halten – oben etwas nach ${screenSide(a.roll > 0 ? 'rechts' : 'links', input.mirrored)} neigen`;
    }
  }
  const value = `Dreh ${nf(a.yaw)}° · Nick ${nf(a.pitch)}° · Neig ${nf(a.roll)}°`;
  return result('pose', POSE_LABEL, status, score, value, target, hint);
}
