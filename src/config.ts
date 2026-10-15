/**
 * Zentrale Konfiguration: alle Schwellwerte, Maße und URLs an einer Stelle.
 *
 * Jeder Messwert hat einen grünen Bereich (`ok`) und einen gelben Toleranzbereich
 * (`warn`); alles außerhalb davon ist rot. Grundlage: BMI/Bundesdruckerei-
 * Fotomustertafel bzw. ICAO 9303 – die Werte sind eine Näherung und hier
 * nachjustierbar.
 */

/** Zulässiger Bereich: innerhalb von `ok` grün, innerhalb von `warn` gelb, sonst rot. */
export interface Range {
  ok: [number, number];
  warn: [number, number];
}

const INF = Number.POSITIVE_INFINITY;
/** Hilfsfunktionen für einseitige Grenzen. */
const bis = (ok: number, warn: number): Range => ({ ok: [-INF, ok], warn: [-INF, warn] });
const ab = (ok: number, warn: number): Range => ({ ok: [ok, INF], warn: [warn, INF] });
const zwischen = (ok: [number, number], warn: [number, number]): Range => ({ ok, warn });

const MP_VERSION = '1.1.1'; // muss zur installierten @mediapipe/tasks-vision-Version passen

export const CONFIG = {
  /** Ausgabeformat */
  output: {
    mmWidth: 35,
    mmHeight: 45,
    widthPx: 827, // 35 mm bei 600 dpi
    heightPx: 1063, // 45 mm bei 600 dpi
    dpi: 600,
    jpegQuality: 0.95,
  },

  /** Druckbogen 10 × 15 cm (quer) */
  sheet: {
    /** Fotoanzahl, die zur Wahl steht (4–6 laut Vorgabe) */
    counts: [4, 6] as number[],
    defaultCount: 6,
    /** Pixelmaße des Bogens je Auflösung */
    sizes: {
      300: { width: 1800, height: 1200 },
      600: { width: 3543, height: 2362 },
    } as Record<number, { width: number; height: number }>,
    defaultDpi: 300,
    /** Abstand zwischen den Fotos in mm (Platz für die Schnittmarken) */
    gapMm: 4,
    /** Schnittmarken: Linienstärke und Länge in mm */
    markWidthMm: 0.12,
    markLengthMm: 1.6,
    markColor: '#666666',
    backgroundColor: '#ffffff',
  },

  /** Modelle und WASM – werden einmal geladen und vom Service Worker gecacht */
  models: {
    wasmBase: `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/wasm`,
    faceLandmarker:
      'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
    segmenter:
      'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite',
  },

  /** Live-Vorschau und Aufnahme */
  live: {
    fps: 10,
    /** längste Kante des Analysebilds in der Live-Vorschau */
    analysisMaxSide: 640,
    /** längste Kante des Analysebilds bei Standbildern */
    stillMaxSide: 1280,
    /** so lange müssen alle Kriterien grün sein, bevor automatisch ausgelöst wird (ms) */
    autoHoldMs: 1000,
    /** bei der Auto-Auslösung genügt auch „gelb“, wenn true */
    autoAllowWarn: false,
    countdownSeconds: 3,
    burstCount: 4,
    burstGapMs: 120,
    /** Videoauflösung, die angefragt wird */
    videoIdeal: { width: 1920, height: 1080 },
    /** Breite der Schablone im Verhältnis zur Bildbreite (bei Hochformat) */
    templateWidthFraction: 0.64,
    /** Zoom-Obergrenze bei rein digitalem Zoom */
    softZoomMax: 4,
  },

  /**
   * Sollgeometrie des fertigen Fotos (Anteile der Bildhöhe, von oben gemessen).
   * Bei Kopfhöhe 75,5 % bleiben 24,5 % für Rand: ~10 % oben, ~14,5 % unten.
   */
  template: {
    headRatio: 0.755,
    /** Kinn liegt bei dieser Höhe (von oben) */
    chinY: 0.855,
    /** Ovalschablone: Halbachsen relativ zur Kopfhöhe bzw. Bildbreite */
    ovalRy: 0.5,
    ovalRx: 0.33,
  },

  /** Scheitel-Schätzung aus der Stirn-Landmark 10 */
  head: {
    /** Anteil der Strecke Kinn→Landmark 10, der noch bis zum Scheitel dazukommt */
    crownFactor: 0.2,
    /** Suchbereich der Maske oberhalb der Stirn, relativ zur Strecke Kinn→Stirn */
    maskSearchExtra: 0.5,
    /** Maske nur übernehmen, wenn sie höchstens so weit vom Schätzwert abweicht (relativ) */
    maskMaxDeviation: 0.3,
  },

  checks: {
    pose: {
      yaw: zwischen([-5, 5], [-8, 8]),
      pitch: zwischen([-5, 5], [-8, 8]),
      roll: zwischen([-3, 3], [-5, 5]),
      /** Eichung: so viele Grad zieht man vom gemessenen Neigungswert ab */
      pitchOffsetDeg: 0,
    },
    proportions: {
      /** Kinn–Scheitel im Verhältnis zur Bildhöhe (32–36 mm von 45 mm ≈ 71–80 %) */
      headRatio: zwischen([0.71, 0.8], [0.66, 0.85]),
    },
    position: {
      /** horizontale Abweichung der Kopfmitte, Anteil der Bildbreite */
      centerOffset: bis(0.03, 0.06),
      /** Augenlinie, Anteil der Bildhöhe von oben (Kopfhöhe 71–80 % lässt keine Linie im oberen Drittel zu) */
      eyeLine: zwischen([0.36, 0.52], [0.31, 0.57]),
      /** Rand über dem Scheitel, Anteil der Bildhöhe */
      topMargin: ab(0.04, 0.01),
      /** Rand unter dem Kinn */
      bottomMargin: ab(0.05, 0.015),
    },
    distance: {
      /** Abstand Kamera–Gesicht in cm (aus dem Augenabstand geschätzt) */
      cm: ab(100, 70),
      /** mittlerer Augenabstand Erwachsener in mm */
      ipdMm: 63,
      /** angenommener Bildwinkel der KURZEN Bildkante in Grad */
      fovShortSideDeg: { environment: 52, user: 60 },
    },
    expression: {
      smile: bis(0.25, 0.45), // mouthSmileLeft/Right (Maximum)
      jawOpen: bis(0.08, 0.2),
      blink: bis(0.35, 0.6), // eyeBlinkLeft/Right (Maximum)
      /** Rückfall ohne Blendshapes */
      ear: ab(0.2, 0.15), // Eye Aspect Ratio (Minimum beider Augen)
      mar: bis(0.1, 0.25), // Mouth Aspect Ratio
      cornerLift: bis(0.12, 0.2), // Mundwinkel über Mundmitte, relativ zur Mundbreite
    },
    lighting: {
      meanLuma: zwischen([90, 200], [65, 225]),
      /** |links − rechts| / Mittelwert */
      asymmetry: bis(0.15, 0.28),
      /** Anteil überstrahlter (≥ 250) bzw. abgesoffener (≤ 8) Pixel im Gesicht */
      clipped: bis(0.01, 0.04),
      /** Spreizung der Helligkeit im Gesicht (Perzentil 95 − 5) */
      contrast: ab(40, 25),
    },
    background: {
      meanLuma: zwischen([165, 245], [130, 252]),
      stdLuma: bis(14, 26),
      saturation: bis(0.12, 0.25),
      /** Mindestanteil Hintergrund im Ausschnitt, sonst „nicht beurteilbar“ */
      minFraction: 0.04,
    },
    sharpness: {
      /** Varianz des Laplace-Filters im (auf feste Breite normierten) Augenbereich */
      laplacianVar: ab(250, 90),
      roiWidth: 160,
    },
    glasses: {
      /** Helligkeit, ab der ein Pixel als Reflex zählt */
      brightLuma: 245,
      /** Anteil heller Pixel im Augenbereich */
      brightFraction: bis(0.003, 0.015),
      /** Größe eines Flecks (Anteil des Augenbereichs), die als „klein“ gilt */
      maxBlobFraction: 0.02,
      minBlobPixels: 3,
    },
    resolution: {
      /** Höhe des Ausschnitts im Original in Pixeln */
      cropHeightPx: ab(1063, 640),
    },
  },

  /** Gewichte für den Gesamtscore (Auswahl des besten Burst-Bildes) */
  weights: {
    face: 4,
    pose: 3,
    expression: 3,
    sharpness: 3,
    proportions: 2,
    lighting: 2,
    background: 2,
    position: 1,
    distance: 1,
    resolution: 1,
    glasses: 0.5,
  } as Record<string, number>,

  /** Rotationskorrektur: nur bis zu dieser Neigung (Grad) wird begradigt */
  crop: {
    maxLevelDeg: 5,
  },
};

export type AppConfig = typeof CONFIG;
