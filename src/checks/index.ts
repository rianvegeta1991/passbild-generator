import { CONFIG } from '../config';
import type { CheckId, CheckInput, CheckResult, Status } from '../types';
import { unknown } from './common';
import { checkFace, FACE_LABEL } from './face';
import { checkPose, POSE_LABEL } from './pose';
import { checkProportions, PROPORTIONS_LABEL } from './proportions';
import { checkPosition, POSITION_LABEL } from './position';
import { checkDistance, DISTANCE_LABEL } from './distance';
import { checkExpression, EXPRESSION_LABEL } from './expression';
import { checkLighting, LIGHTING_LABEL } from './lighting';
import { checkBackground, BACKGROUND_LABEL } from './background';
import { checkSharpness, SHARPNESS_LABEL } from './sharpness';
import { checkGlasses, GLASSES_LABEL } from './glasses';
import { checkResolution, RESOLUTION_LABEL } from './resolution';

export * from './common';
export {
  checkFace,
  checkPose,
  checkProportions,
  checkPosition,
  checkDistance,
  checkExpression,
  checkLighting,
  checkBackground,
  checkSharpness,
  checkGlasses,
  checkResolution,
};

/** Reihenfolge der Anzeige. */
export const CHECK_ORDER: { id: CheckId; label: string }[] = [
  { id: 'face', label: FACE_LABEL },
  { id: 'pose', label: POSE_LABEL },
  { id: 'expression', label: EXPRESSION_LABEL },
  { id: 'proportions', label: PROPORTIONS_LABEL },
  { id: 'position', label: POSITION_LABEL },
  { id: 'distance', label: DISTANCE_LABEL },
  { id: 'lighting', label: LIGHTING_LABEL },
  { id: 'background', label: BACKGROUND_LABEL },
  { id: 'sharpness', label: SHARPNESS_LABEL },
  { id: 'glasses', label: GLASSES_LABEL },
  { id: 'resolution', label: RESOLUTION_LABEL },
];

/** Prüfungen, die nur Hinweise geben und die automatische Auslösung nicht blockieren. */
export const HINT_ONLY: CheckId[] = ['glasses'];

/** Führt alle Prüfungen aus. Ohne genau ein Gesicht bleiben die übrigen „unbekannt“. */
export function runChecks(input: CheckInput): CheckResult[] {
  const face = checkFace(input);
  if (face.status !== 'ok') {
    return CHECK_ORDER.filter((c) => c.id !== 'resolution' || input.cropSourceHeightPx !== undefined).map((c) =>
      c.id === 'face' ? face : unknown(c.id, c.label, '', ''),
    );
  }
  const all: Record<CheckId, CheckResult> = {
    face,
    pose: checkPose(input),
    expression: checkExpression(input),
    proportions: checkProportions(input),
    position: checkPosition(input),
    distance: checkDistance(input),
    lighting: checkLighting(input),
    background: checkBackground(input),
    sharpness: checkSharpness(input),
    glasses: checkGlasses(input),
    resolution: checkResolution(input),
  };
  return CHECK_ORDER.filter((c) => !(c.id === 'resolution' && input.cropSourceHeightPx === undefined)).map((c) => all[c.id]);
}

export interface Summary {
  status: Status;
  /** gewichteter Mittelwert 0..1, hart abgewertet je roter Prüfung */
  score: number;
  /** alle Pflichtprüfungen grün (bzw. gelb, wenn `allowWarn`) */
  passed: boolean;
}

export function summarize(results: CheckResult[], allowWarn = false): Summary {
  let wSum = 0;
  let sSum = 0;
  let fails = 0;
  let warns = 0;
  let blocked = false;
  for (const r of results) {
    const weight = CONFIG.weights[r.id] ?? 1;
    wSum += weight;
    sSum += weight * (r.status === 'unknown' ? 0 : r.score);
    if (r.status === 'fail') fails++;
    if (r.status === 'warn') warns++;
    if (!HINT_ONLY.includes(r.id)) {
      if (r.status === 'fail' || r.status === 'unknown') blocked = true;
      if (r.status === 'warn' && !allowWarn) blocked = true;
    }
  }
  const base = wSum ? sSum / wSum : 0;
  const score = Math.max(0, base - 0.08 * fails);
  const status: Status = fails ? 'fail' : warns ? 'warn' : results.some((r) => r.status === 'unknown') ? 'unknown' : 'ok';
  return { status, score, passed: !blocked };
}

/** Wichtigste Hinweise: erst rot, dann gelb, nach Gewicht sortiert. */
export function topHints(results: CheckResult[], max = 2): string[] {
  const rank: Record<Status, number> = { fail: 0, warn: 1, unknown: 2, ok: 3 };
  return results
    .filter((r) => (r.status === 'fail' || r.status === 'warn') && r.hint)
    .sort((a, b) => rank[a.status] - rank[b.status] || (CONFIG.weights[b.id] ?? 1) - (CONFIG.weights[a.id] ?? 1))
    .slice(0, max)
    .map((r) => r.hint);
}
