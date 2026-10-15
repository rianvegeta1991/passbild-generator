/** Gemeinsame Typen. Alle Koordinaten der Landmarks sind normiert (0..1), Ursprung oben links. */

export interface Pt {
  x: number;
  y: number;
  z?: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** RGBA-Pixel wie bei ImageData – ohne DOM, damit die Prüfungen testbar bleiben. */
export interface RawImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/** Augenbereich, auf feste Breite normiert; `exclude` sind die Iriskreise (Hornhautreflexe zählen nicht). */
export interface EyeRoi extends RawImage {
  exclude: { cx: number; cy: number; r: number }[];
}

export type Status = 'ok' | 'warn' | 'fail' | 'unknown';

export type CheckId =
  | 'face'
  | 'pose'
  | 'proportions'
  | 'position'
  | 'distance'
  | 'expression'
  | 'lighting'
  | 'background'
  | 'sharpness'
  | 'glasses'
  | 'resolution';

export interface CheckResult {
  id: CheckId;
  label: string;
  status: Status;
  /** 0..1, für die Auswahl des besten Bildes */
  score: number;
  /** gemessener Wert als Text */
  value: string;
  /** Sollbereich als Text */
  target: string;
  /** kurzer Korrekturhinweis (leer, wenn alles passt) */
  hint: string;
}

/** Alles, was die Prüfungen über das Bild wissen müssen. */
export interface CheckInput {
  /** Größe des Analysebilds in Pixeln */
  width: number;
  height: number;
  faceCount: number;
  landmarks?: Pt[];
  /** Transformationsmatrix, spaltenweise (wie MediaPipe sie liefert) */
  matrix?: number[];
  blendshapes?: Record<string, number>;
  image?: RawImage;
  /** 1 = Person, 0 = Hintergrund; gleiche Größe wie `image` */
  personMask?: Uint8Array;
  eyeRoi?: EyeRoi;
  /** der Ausschnitt (Schablone bzw. fertiges Foto) in Pixeln des Analysebilds */
  region: Rect;
  /** geschätzter Abstand Kamera–Gesicht */
  distanceCm?: number;
  /** Höhe des Ausschnitts im Originalbild (für die Auflösungsprüfung) */
  cropSourceHeightPx?: number;
  /** true, wenn die Anzeige gespiegelt ist (Frontkamera-Vorschau) */
  mirrored: boolean;
}

/** Ergebnis der Gesichtserkennung auf einem Bild. */
export interface FaceData {
  landmarks: Pt[];
  matrix?: number[];
  blendshapes?: Record<string, number>;
}
