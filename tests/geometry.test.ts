import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { anglesFromMatrix, estimateDistanceCm, eyeLineAngleDeg, ipdPx, measureHead, rasterizePolygon } from '../src/detection/geometry';
import { makeLandmarks, matrixFromAngles } from './helpers';

describe('anglesFromMatrix', () => {
  it('liefert 0° für die Einheitsmatrix', () => {
    const a = anglesFromMatrix(matrixFromAngles(0, 0, 0));
    expect(a.yaw).toBeCloseTo(0, 6);
    expect(a.pitch).toBeCloseTo(0, 6);
    expect(a.roll).toBeCloseTo(0, 6);
  });

  it.each([
    [4, 0, 0],
    [-7, 2, 1],
    [0, 6, -2],
    [10, -8, 3],
    [-3, 3, -3],
  ])('liest Yaw %d°, Pitch %d°, Roll %d° wieder aus', (yaw, pitch, roll) => {
    const a = anglesFromMatrix(matrixFromAngles(yaw, pitch, roll));
    expect(a.yaw).toBeCloseTo(yaw, 4);
    expect(a.pitch).toBeCloseTo(pitch, 4);
    expect(a.roll).toBeCloseTo(roll, 4);
  });

  it('ist unabhängig vom Maßstab der Matrix', () => {
    const a = anglesFromMatrix(matrixFromAngles(5, -4, 2, 3.7));
    expect(a.yaw).toBeCloseTo(5, 4);
    expect(a.pitch).toBeCloseTo(-4, 4);
    expect(a.roll).toBeCloseTo(2, 4);
  });

  it('wendet die Pitch-Eichung aus der Konfiguration an', () => {
    const old = CONFIG.checks.pose.pitchOffsetDeg;
    CONFIG.checks.pose.pitchOffsetDeg = 2;
    try {
      expect(anglesFromMatrix(matrixFromAngles(0, 5, 0)).pitch).toBeCloseTo(3, 4);
    } finally {
      CONFIG.checks.pose.pitchOffsetDeg = old;
    }
  });
});

describe('Gesichtsmaße', () => {
  const spec = { w: 800, h: 1000, cx: 400, chinY: 800, headH: 600 };

  it('schätzt den Scheitel aus Stirnpunkt und Faktor', () => {
    const lm = makeLandmarks(spec);
    const head = measureHead(lm, spec.w, spec.h);
    expect(head.source).toBe('schaetzung');
    expect(head.heightPx).toBeCloseTo(600, 3);
    expect(head.crown.y).toBeCloseTo(200, 3);
    expect(head.axis.y).toBeCloseTo(-1, 6);
  });

  it('verfeinert den Scheitel am oberen Maskenrand', () => {
    const lm = makeLandmarks(spec);
    const mask = new Uint8Array(spec.w * spec.h);
    // Person von y = 180 abwärts (Haare ragen 20 px über den Schätzwert)
    for (let y = 180; y < spec.h; y++) for (let x = 250; x < 550; x++) mask[y * spec.w + x] = 1;
    const head = measureHead(lm, spec.w, spec.h, mask);
    expect(head.source).toBe('maske');
    expect(head.crown.y).toBeCloseTo(180, 0);
    expect(head.heightPx).toBeCloseTo(620, 0);
  });

  it('ignoriert eine Maske, die mit dem Hintergrund verschmilzt', () => {
    const lm = makeLandmarks(spec);
    const mask = new Uint8Array(spec.w * spec.h).fill(1); // alles „Person“
    const head = measureHead(lm, spec.w, spec.h, mask);
    expect(head.source).toBe('schaetzung');
    expect(head.heightPx).toBeCloseTo(600, 3);
  });

  it('misst die Kopfhöhe auch bei geneigtem Kopf entlang der Achse', () => {
    const lm = makeLandmarks({ ...spec, tiltDeg: 10 });
    const head = measureHead(lm, spec.w, spec.h);
    expect(head.heightPx).toBeCloseTo(600, 3);
    expect(head.axis.x).toBeGreaterThan(0); // Kopf oben nach rechts geneigt
  });

  it('erkennt die Neigung der Augenlinie', () => {
    expect(eyeLineAngleDeg(makeLandmarks(spec), spec.w, spec.h)).toBeCloseTo(0, 4);
    expect(eyeLineAngleDeg(makeLandmarks({ ...spec, tiltDeg: 8 }), spec.w, spec.h)).toBeCloseTo(8, 3);
  });

  it('schätzt den Abstand mit dem Lochkameramodell', () => {
    // Kurze Kante 1000 px, 52° Bildwinkel → f ≈ 1025 px. IPD 63 mm bei 60 px → 1,08 m
    const d = estimateDistanceCm(60, 1000, 1500, 52, 1);
    expect(d).toBeGreaterThan(100);
    expect(d).toBeLessThan(115);
    // doppelter Zoom bei gleicher Pixelgröße = doppelte Entfernung
    expect(estimateDistanceCm(60, 1000, 1500, 52, 2)).toBeCloseTo(d * 2, 6);
    expect(estimateDistanceCm(0, 1000, 1500, 52, 1)).toBeNaN();
  });

  it('liefert den Augenabstand in Pixeln', () => {
    const lm = makeLandmarks(spec);
    const faceLen = 600 / 1.2;
    expect(ipdPx(lm, spec.w, spec.h)).toBeCloseTo(0.33 * faceLen, 3);
  });
});

describe('rasterizePolygon', () => {
  it('füllt ein Rechteck', () => {
    const m = rasterizePolygon(
      [
        { x: 2, y: 2 },
        { x: 8, y: 2 },
        { x: 8, y: 6 },
        { x: 2, y: 6 },
      ],
      10,
      10,
    );
    expect(m.reduce((a, b) => a + b, 0)).toBe(6 * 4);
    expect(m[2 * 10 + 2]).toBe(1);
    expect(m[1 * 10 + 2]).toBe(0);
    expect(m[6 * 10 + 2]).toBe(0);
  });

  it('füllt ein Dreieck ungefähr zur halben Fläche', () => {
    const m = rasterizePolygon(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 0, y: 100 },
      ],
      100,
      100,
    );
    const n = m.reduce((a, b) => a + b, 0);
    expect(n).toBeGreaterThan(4800);
    expect(n).toBeLessThan(5200);
  });
});
