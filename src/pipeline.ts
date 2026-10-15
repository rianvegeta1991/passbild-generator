import { CONFIG } from './config';
import type { CheckResult } from './types';
import { summarize, type Summary } from './checks';
import { Analyzer, type Analysis } from './detection/analyzer';
import { evaluate, type Env } from './detection/evaluate';
import { estimateDistanceCm, eyeLineAngleDeg, ipdPx, measureHead } from './detection/geometry';
import { planCrop, renderCrop, type CropPlan } from './export/crop';

/** Was über die Aufnahme bekannt ist (für die Abstandsschätzung). */
export interface CaptureMeta {
  facing: 'environment' | 'user';
  /** Hardware-Zoom, der im Standbild steckt */
  hwZoom: number;
  /** false bei importierten Fotos: Bildwinkel unbekannt, Abstand nicht schätzbar */
  estimateDistance: boolean;
}

export interface StillEval {
  blob: Blob;
  /** kleine Vorschau (die Originale sind bis zu 12 MP groß und sollen nicht mehrfach dekodiert werden) */
  thumb: Blob | null;
  results: CheckResult[];
  summary: Summary;
  hasFace: boolean;
}

export interface FinalResult {
  canvas: HTMLCanvasElement;
  plan: CropPlan;
  results: CheckResult[];
  summary: Summary;
  /** Bild des Burst, aus dem das Foto stammt (0-basiert) und wie viele es gab */
  pick: { index: number; of: number; scores: number[] };
}

export async function decode(blob: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(blob, { imageOrientation: 'from-image' });
  } catch {
    return await createImageBitmap(blob);
  }
}

async function makeThumb(bmp: ImageBitmap): Promise<Blob | null> {
  const k = Math.min(1, 240 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bmp.width * k));
  c.height = Math.max(1, Math.round(bmp.height * k));
  c.getContext('2d')?.drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((r) => c.toBlob((b) => r(b), 'image/jpeg', 0.8));
}

/** Kopfmaße im Originalbild und der daraus geplante Zuschnitt. */
function planFor(a: Analysis, srcW: number, srcH: number): CropPlan | null {
  if (!a.face) return null;
  const lm = a.face.landmarks;
  const head = measureHead(lm, a.width, a.height, a.personMask);
  const k = 1 / a.scale;
  // Begradigung: Mittel aus Augenlinie und Kopfachse (beide in Analysepixeln, Seitenverhältnis unverzerrt)
  const eyeDeg = eyeLineAngleDeg(lm, a.width, a.height);
  const axisDeg = (Math.atan2(head.axis.x, -head.axis.y) * 180) / Math.PI;
  const level = (eyeDeg + axisDeg) / 2;
  return planCrop({ x: head.chin.x * k, y: head.chin.y * k }, head.heightPx * k, level, srcW, srcH);
}

function analysisFor(an: Analyzer, bmp: ImageBitmap): Analysis {
  return an.analyze({ image: bmp, sx: 0, sy: 0, sw: bmp.width, sh: bmp.height }, { maxSide: CONFIG.live.stillMaxSide, eyeRoi: true });
}

/** Vorab-Auswertung eines Standbilds (für die Auswahl des besten Burst-Bildes). */
export async function evaluateStill(an: Analyzer, blob: Blob, meta: CaptureMeta): Promise<StillEval> {
  const bmp = await decode(blob);
  try {
    const a = analysisFor(an, bmp);
    const p = planFor(a, bmp.width, bmp.height);
    const env: Env = {
      region: p
        ? { x: p.aabb.x * a.scale, y: p.aabb.y * a.scale, w: p.aabb.w * a.scale, h: p.aabb.h * a.scale }
        : { x: 0, y: 0, w: a.width, h: a.height },
      mirrored: false,
      facing: meta.facing,
      zoom: meta.hwZoom,
      cropSourceHeightPx: p?.srcHeightPx,
      distanceCm: meta.estimateDistance ? undefined : NaN,
    };
    const results = evaluate(a, env);
    return { blob, thumb: await makeThumb(bmp), results, summary: summarize(results, true), hasFace: !!a.face };
  } finally {
    bmp.close();
  }
}

/** Zuschnitt auf 827 × 1063 und Prüfbericht am fertigen Bild. */
export async function buildFinal(
  an: Analyzer,
  blob: Blob,
  meta: CaptureMeta,
  pick: FinalResult['pick'],
): Promise<FinalResult | null> {
  const bmp = await decode(blob);
  try {
    const a = analysisFor(an, bmp);
    const p = planFor(a, bmp.width, bmp.height);
    if (!p) return null;
    const canvas = renderCrop(bmp, p);

    // Abstand stammt vom Originalbild (im Zuschnitt ist der Bildwinkel nicht mehr bekannt)
    const distanceCm = meta.estimateDistance
      ? estimateDistanceCm(
          ipdPx(a.face!.landmarks, a.width, a.height),
          a.width,
          a.height,
          CONFIG.checks.distance.fovShortSideDeg[meta.facing],
          meta.hwZoom,
        )
      : NaN;
    const fa = an.analyze(
      { image: canvas, sx: 0, sy: 0, sw: canvas.width, sh: canvas.height },
      { maxSide: Math.max(canvas.width, canvas.height), eyeRoi: true },
    );
    const results = evaluate(fa, {
      region: { x: 0, y: 0, w: fa.width, h: fa.height },
      mirrored: false,
      facing: meta.facing,
      zoom: meta.hwZoom,
      distanceCm,
      cropSourceHeightPx: p.srcHeightPx,
    });
    return { canvas, plan: p, results, summary: summarize(results, true), pick };
  } finally {
    bmp.close();
  }
}
