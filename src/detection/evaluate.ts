import { CONFIG } from '../config';
import type { CheckInput, CheckResult, Rect } from '../types';
import { runChecks } from '../checks';
import type { Analysis } from './analyzer';
import { estimateDistanceCm, ipdPx } from './geometry';

export interface Env {
  /** Ausschnitt (Schablone bzw. fertiges Foto) in Pixeln des Analysebilds */
  region: Rect;
  /** Anzeige gespiegelt? (nur für die Wortwahl bei Links/Rechts) */
  mirrored: boolean;
  facing: 'environment' | 'user';
  /** Gesamtzoom der Kamera (nur Hardware-Zoom verändert den Bildwinkel von Standbildern) */
  zoom: number;
  /** fertig geschätzter Abstand (z. B. aus dem Originalbild); sonst wird er hier berechnet */
  distanceCm?: number;
  cropSourceHeightPx?: number;
}

export function toCheckInput(a: Analysis, env: Env): CheckInput {
  let distanceCm = env.distanceCm;
  if (distanceCm === undefined && a.face) {
    distanceCm = estimateDistanceCm(
      ipdPx(a.face.landmarks, a.width, a.height),
      a.width,
      a.height,
      CONFIG.checks.distance.fovShortSideDeg[env.facing],
      env.zoom,
    );
  }
  return {
    width: a.width,
    height: a.height,
    faceCount: a.faceCount,
    landmarks: a.face?.landmarks,
    matrix: a.face?.matrix,
    blendshapes: a.face?.blendshapes,
    image: a.image,
    personMask: a.personMask,
    eyeRoi: a.eyeRoi,
    region: env.region,
    distanceCm,
    cropSourceHeightPx: env.cropSourceHeightPx,
    mirrored: env.mirrored,
  };
}

export function evaluate(a: Analysis, env: Env): CheckResult[] {
  return runChecks(toCheckInput(a, env));
}

/**
 * Schablone in der Live-Vorschau: 35:45-Rechteck, mittig. Breite als Anteil der Bildbreite,
 * aber nie höher als das Bild.
 */
export function templateRegion(w: number, h: number): Rect {
  const ratio = CONFIG.output.mmWidth / CONFIG.output.mmHeight;
  let tw = w * CONFIG.live.templateWidthFraction;
  let th = tw / ratio;
  const maxH = h * 0.96;
  if (th > maxH) {
    th = maxH;
    tw = th * ratio;
  }
  return { x: (w - tw) / 2, y: (h - th) / 2, w: tw, h: th };
}
