import { CONFIG } from '../config';
import type { CheckInput, CheckResult, Pt } from '../types';
import { EAR_LEFT, EAR_RIGHT, LM, dist, px } from '../detection/geometry';
import { grade, nf, result, unknown, worstStatus, type Graded } from './common';

export const EXPRESSION_LABEL = 'Ausdruck';

/** Eye Aspect Ratio eines Auges (Soper/Cech): offen ≈ 0,25–0,35, geschlossen < 0,15. */
export function eyeAspectRatio(lm: Pt[], idx: readonly number[], w: number, h: number): number {
  const p = idx.map((i) => px(lm, i, w, h));
  const horizontal = dist(p[0], p[3]);
  if (horizontal === 0) return NaN;
  return (dist(p[1], p[5]) + dist(p[2], p[4])) / (2 * horizontal);
}

/** Mouth Aspect Ratio an den Innenlippen: geschlossen ≈ 0–0,05. */
export function mouthAspectRatio(lm: Pt[], w: number, h: number): number {
  const up = px(lm, LM.mouthUpperInner, w, h);
  const lo = px(lm, LM.mouthLowerInner, w, h);
  const l = px(lm, LM.mouthCornerLeftInner, w, h);
  const r = px(lm, LM.mouthCornerRightInner, w, h);
  const width = dist(l, r);
  return width === 0 ? NaN : dist(up, lo) / width;
}

/** Mundwinkel über der Lippenmitte (Lächeln > 0), relativ zur Mundbreite. */
export function cornerLift(lm: Pt[], w: number, h: number): number {
  const cl = px(lm, LM.mouthCornerLeft, w, h);
  const cr = px(lm, LM.mouthCornerRight, w, h);
  const up = px(lm, LM.mouthUpperInner, w, h);
  const lo = px(lm, LM.mouthLowerInner, w, h);
  const width = dist(cl, cr);
  if (width === 0) return NaN;
  const midY = (up.y + lo.y) / 2;
  const cornerY = (cl.y + cr.y) / 2;
  return (midY - cornerY) / width;
}

/**
 * Neutraler Ausdruck, Mund zu, Augen offen.
 * Primär aus den Blendshapes; fehlen sie, greifen EAR/MAR aus den Landmarks.
 */
export function checkExpression(input: CheckInput): CheckResult {
  const cfg = CONFIG.checks.expression;
  const target = `Lächeln ≤ ${nf(cfg.smile.ok[1], 2)} · Mund ≤ ${nf(cfg.jawOpen.ok[1], 2)} · Blinzeln ≤ ${nf(cfg.blink.ok[1], 2)}`;
  if (!input.landmarks) return unknown('expression', EXPRESSION_LABEL, target, 'Kein Gesicht');

  const bs = input.blendshapes;
  const parts: { g: Graded; hint: string }[] = [];
  let value: string;

  if (bs && ('jawOpen' in bs || 'mouthSmileLeft' in bs)) {
    const smile = Math.max(bs.mouthSmileLeft ?? 0, bs.mouthSmileRight ?? 0);
    const jaw = bs.jawOpen ?? 0;
    const blink = Math.max(bs.eyeBlinkLeft ?? 0, bs.eyeBlinkRight ?? 0);
    parts.push({ g: grade(smile, cfg.smile), hint: 'Nicht lächeln – Mundwinkel entspannen' });
    parts.push({ g: grade(jaw, cfg.jawOpen), hint: 'Mund schließen' });
    parts.push({ g: grade(blink, cfg.blink), hint: 'Augen weit öffnen' });
    value = `Lächeln ${nf(smile, 2)} · Mund ${nf(jaw, 2)} · Blinzeln ${nf(blink, 2)}`;
  } else {
    const { width: w, height: h, landmarks: lm } = input;
    const ear = Math.min(eyeAspectRatio(lm, EAR_LEFT, w, h), eyeAspectRatio(lm, EAR_RIGHT, w, h));
    const mar = mouthAspectRatio(lm, w, h);
    const lift = cornerLift(lm, w, h);
    parts.push({ g: grade(ear, cfg.ear), hint: 'Augen weit öffnen' });
    parts.push({ g: grade(mar, cfg.mar), hint: 'Mund schließen' });
    parts.push({ g: grade(lift, cfg.cornerLift), hint: 'Nicht lächeln – Mundwinkel entspannen' });
    value = `Augen ${nf(ear, 2)} · Mund ${nf(mar, 2)} · Mundwinkel ${nf(lift, 2)} (Näherung)`;
  }

  const status = worstStatus(parts.map((p) => p.g.status));
  const score = Math.min(...parts.map((p) => p.g.score));
  const hints = parts.filter((p) => p.g.status !== 'ok').map((p) => p.hint);
  return result('expression', EXPRESSION_LABEL, status, score, value, target, hints.join(' · '));
}
