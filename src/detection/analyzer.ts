import { FaceLandmarker, FilesetResolver, ImageSegmenter } from '@mediapipe/tasks-vision';
import { CONFIG } from '../config';
import type { EyeRoi, FaceData, RawImage } from '../types';
import { EYE_CONTOUR_LEFT, EYE_CONTOUR_RIGHT, LM, bbox, dist, px } from './geometry';

/** Ein Ausschnitt einer Bildquelle (Video, Bitmap, Canvas) in deren Originalpixeln. */
export interface FrameSource {
  image: CanvasImageSource;
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

export interface Analysis {
  /** Größe des Analysebilds */
  width: number;
  height: number;
  /** Analysepixel je Quellpixel */
  scale: number;
  faceCount: number;
  face?: FaceData;
  image: RawImage;
  personMask?: Uint8Array;
  eyeRoi?: EyeRoi;
}

export interface AnalyzeOptions {
  /** längste Kante des Analysebilds */
  maxSide: number;
  /** Augenbereich in voller Quellauflösung ausschneiden */
  eyeRoi: boolean;
}

export type Progress = (text: string) => void;

type Delegate = 'GPU' | 'CPU';

/** Gesichts- und Personenerkennung (MediaPipe Tasks Vision, läuft komplett im Browser). */
export class Analyzer {
  private canvas = document.createElement('canvas');
  private ctx = this.canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
  private roiCanvas = document.createElement('canvas');
  private roiCtx = this.roiCanvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
  delegate: Delegate = 'GPU';

  private constructor(
    private landmarker: FaceLandmarker,
    private segmenter: ImageSegmenter | null,
  ) {}

  static async create(progress?: Progress): Promise<Analyzer> {
    progress?.('Lade Erkennungs-Engine …');
    const fileset = await FilesetResolver.forVisionTasks(CONFIG.models.wasmBase);

    let delegate: Delegate = 'GPU';
    const makeLandmarker = (d: Delegate) =>
      FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: CONFIG.models.faceLandmarker, delegate: d },
        runningMode: 'IMAGE',
        numFaces: 2, // zweites Gesicht nur, um „mehrere Personen“ zu melden
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: true,
      });
    progress?.('Lade Gesichtsmodell …');
    let landmarker: FaceLandmarker;
    try {
      landmarker = await makeLandmarker('GPU');
    } catch (e) {
      console.warn('GPU-Delegate nicht verfügbar, wechsle auf CPU', e);
      delegate = 'CPU';
      landmarker = await makeLandmarker('CPU');
    }

    progress?.('Lade Personenmodell …');
    let segmenter: ImageSegmenter | null = null;
    try {
      segmenter = await ImageSegmenter.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: CONFIG.models.segmenter, delegate },
        runningMode: 'IMAGE',
        outputCategoryMask: true,
        outputConfidenceMasks: false,
      });
    } catch (e) {
      console.warn('Segmentierung mit', delegate, 'fehlgeschlagen, versuche CPU', e);
      try {
        segmenter = await ImageSegmenter.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: CONFIG.models.segmenter, delegate: 'CPU' },
          runningMode: 'IMAGE',
          outputCategoryMask: true,
          outputConfidenceMasks: false,
        });
      } catch (e2) {
        console.error('Segmentierung nicht verfügbar – Hintergrundprüfung entfällt', e2);
      }
    }
    const a = new Analyzer(landmarker, segmenter);
    a.delegate = delegate;
    return a;
  }

  /** Zeichnet den Quellausschnitt verkleinert auf das Analysebild und führt alle Erkennungen aus. */
  analyze(src: FrameSource, opts: AnalyzeOptions): Analysis {
    const scale = Math.min(1, opts.maxSide / Math.max(src.sw, src.sh));
    const w = Math.max(1, Math.round(src.sw * scale));
    const h = Math.max(1, Math.round(src.sh * scale));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.ctx.drawImage(src.image, src.sx, src.sy, src.sw, src.sh, 0, 0, w, h);
    const id = this.ctx.getImageData(0, 0, w, h);
    const image: RawImage = { width: w, height: h, data: id.data };

    const res = this.landmarker.detect(this.canvas);
    const faceCount = res.faceLandmarks.length;
    const out: Analysis = { width: w, height: h, scale: w / src.sw, faceCount, image };
    if (faceCount !== 1) return out;

    const landmarks = res.faceLandmarks[0].map((p) => ({ x: p.x, y: p.y, z: p.z }));
    const blendshapes: Record<string, number> = {};
    for (const c of res.faceBlendshapes?.[0]?.categories ?? []) blendshapes[c.categoryName] = c.score;
    const matrix = res.facialTransformationMatrixes?.[0]?.data;
    out.face = {
      landmarks,
      matrix: matrix ? Array.from(matrix) : undefined,
      blendshapes: Object.keys(blendshapes).length ? blendshapes : undefined,
    };

    out.personMask = this.segment(w, h, landmarks);
    if (opts.eyeRoi) out.eyeRoi = this.extractEyeRoi(src, landmarks);
    return out;
  }

  /** Personenmaske (1 = Person). Welcher Kategoriewert „Person“ heißt, liest sich an der Nasenspitze ab. */
  private segment(w: number, h: number, landmarks: { x: number; y: number }[]): Uint8Array | undefined {
    if (!this.segmenter) return undefined;
    const r = this.segmenter.segment(this.canvas);
    try {
      const m = r.categoryMask;
      if (!m) return undefined;
      const raw = m.getAsUint8Array();
      const mw = m.width;
      const mh = m.height;
      const nose = landmarks[LM.noseTip];
      const sample = (x: number, y: number) => raw[Math.min(mh - 1, Math.max(0, Math.round(y * (mh - 1)))) * mw + Math.min(mw - 1, Math.max(0, Math.round(x * (mw - 1))))];
      const personValue = sample(nose.x, nose.y);
      const out = new Uint8Array(w * h);
      if (mw === w && mh === h) {
        for (let i = 0; i < out.length; i++) out[i] = raw[i] === personValue ? 1 : 0;
      } else {
        for (let y = 0; y < h; y++) {
          const sy = Math.min(mh - 1, Math.floor((y / h) * mh));
          for (let x = 0; x < w; x++) {
            const sx = Math.min(mw - 1, Math.floor((x / w) * mw));
            out[y * w + x] = raw[sy * mw + sx] === personValue ? 1 : 0;
          }
        }
      }
      return out;
    } finally {
      r.close();
    }
  }

  /** Schneidet beide Augen aus der Quelle (volle Auflösung) und normiert auf feste Breite. */
  private extractEyeRoi(src: FrameSource, lm: { x: number; y: number }[]): EyeRoi | undefined {
    // Landmarks sind relativ zum Analysebild, das den Quellausschnitt komplett abbildet.
    const box = bbox(lm as never, [...EYE_CONTOUR_LEFT, ...EYE_CONTOUR_RIGHT], src.sw, src.sh);
    const padX = box.w * 0.12;
    const padY = box.h * 0.9;
    const rx = Math.max(0, box.x - padX);
    const ry = Math.max(0, box.y - padY);
    const rw = Math.min(src.sw - rx, box.w + 2 * padX);
    const rh = Math.min(src.sh - ry, box.h + 2 * padY);
    if (rw < 8 || rh < 4) return undefined;
    const outW = CONFIG.checks.sharpness.roiWidth;
    const outH = Math.max(8, Math.round((outW * rh) / rw));
    if (this.roiCanvas.width !== outW || this.roiCanvas.height !== outH) {
      this.roiCanvas.width = outW;
      this.roiCanvas.height = outH;
    }
    this.roiCtx.drawImage(src.image, src.sx + rx, src.sy + ry, rw, rh, 0, 0, outW, outH);
    const id = this.roiCtx.getImageData(0, 0, outW, outH);
    const k = outW / rw;
    const exclude = [
      { c: LM.irisLeft, ring: LM.irisLeftRing },
      { c: LM.irisRight, ring: LM.irisRightRing },
    ].map(({ c, ring }) => {
      const centre = px(lm as never, c, src.sw, src.sh);
      const rad = ring.reduce((s, i) => s + dist(centre, px(lm as never, i, src.sw, src.sh)), 0) / ring.length;
      return { cx: (centre.x - rx) * k, cy: (centre.y - ry) * k, r: rad * k * 1.35 };
    });
    return { width: outW, height: outH, data: id.data, exclude };
  }

  close(): void {
    this.landmarker.close();
    this.segmenter?.close();
  }
}
