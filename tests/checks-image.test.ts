import { describe, expect, it } from 'vitest';
import { checkBackground, checkExpression, checkGlasses, checkLighting, checkSharpness } from '../src/checks';
import { measureBackground, dilate } from '../src/checks/background';
import { measureLighting } from '../src/checks/lighting';
import { laplacianVariance, normalizedSharpness } from '../src/checks/sharpness';
import { measureReflexes } from '../src/checks/glasses';
import { cornerLift, eyeAspectRatio, mouthAspectRatio } from '../src/checks/expression';
import { EAR_LEFT, FACE_OVAL, px, rasterizePolygon } from '../src/detection/geometry';
import { eyeRoiOf, fillRect, idealInput, makeLandmarks, rng, setPixel, solid } from './helpers';
import type { CheckInput, RawImage } from '../src/types';

// ───────────────────────── Ausdruck ─────────────────────────

describe('checkExpression (Blendshapes)', () => {
  const bs = (o: Record<string, number>) => idealInput({ blendshapes: { mouthSmileLeft: 0, mouthSmileRight: 0, jawOpen: 0, eyeBlinkLeft: 0, eyeBlinkRight: 0, ...o } });
  it('grün bei neutralem Gesicht', () => expect(checkExpression(idealInput()).status).toBe('ok'));
  it('Lächeln → rot mit Hinweis', () => {
    const r = checkExpression(bs({ mouthSmileLeft: 0.8, mouthSmileRight: 0.7 }));
    expect(r.status).toBe('fail');
    expect(r.hint).toMatch(/Nicht lächeln/);
  });
  it('nimmt das stärkere der beiden Mundwinkel-Signale', () => {
    expect(checkExpression(bs({ mouthSmileLeft: 0.0, mouthSmileRight: 0.9 })).status).toBe('fail');
  });
  it('leichtes Lächeln → gelb', () => expect(checkExpression(bs({ mouthSmileLeft: 0.35, mouthSmileRight: 0.3 })).status).toBe('warn'));
  it('offener Mund → rot', () => {
    const r = checkExpression(bs({ jawOpen: 0.5 }));
    expect(r.status).toBe('fail');
    expect(r.hint).toMatch(/Mund schließen/);
  });
  it('geschlossene Augen → rot mit Hinweis „Augen öffnen“', () => {
    const r = checkExpression(bs({ eyeBlinkLeft: 0.9, eyeBlinkRight: 0.85 }));
    expect(r.status).toBe('fail');
    expect(r.hint).toMatch(/Augen weit öffnen/);
  });
  it('ein geschlossenes Auge genügt für rot', () => {
    expect(checkExpression(bs({ eyeBlinkLeft: 0.9 })).status).toBe('fail');
  });
  it('kombiniert mehrere Hinweise', () => {
    const r = checkExpression(bs({ mouthSmileLeft: 0.8, jawOpen: 0.4 }));
    expect(r.hint).toMatch(/lächeln/);
    expect(r.hint).toMatch(/Mund schließen/);
  });
});

describe('checkExpression (Rückfall über Landmarks)', () => {
  const spec = { w: 800, h: 1000, cx: 400, chinY: 800, headH: 600 };
  const input = (s: Partial<typeof spec> & { eyeOpen?: number; mouthOpen?: number; smile?: number }) =>
    idealInput({ width: 800, height: 1000, blendshapes: undefined, landmarks: makeLandmarks({ ...spec, ...s }) });

  it('berechnet EAR, MAR und Mundwinkel', () => {
    const lm = makeLandmarks({ ...spec, eyeOpen: 1, mouthOpen: 0.05 });
    expect(eyeAspectRatio(lm, EAR_LEFT, 800, 1000)).toBeCloseTo(0.3, 2);
    expect(mouthAspectRatio(lm, 800, 1000)).toBeCloseTo(0.05 / 1, 1);
    expect(cornerLift(makeLandmarks({ ...spec, smile: 0.2 }), 800, 1000)).toBeCloseTo(0.2, 2);
  });

  it('grün bei offenen Augen, geschlossenem Mund, neutralem Mund', () => {
    expect(checkExpression(input({ eyeOpen: 1, mouthOpen: 0.02, smile: 0 })).status).toBe('ok');
  });
  it('geschlossene Augen → rot', () => expect(checkExpression(input({ eyeOpen: 0.05 })).status).toBe('fail'));
  it('offener Mund → rot', () => expect(checkExpression(input({ mouthOpen: 0.5 })).status).toBe('fail'));
  it('hochgezogene Mundwinkel → rot', () => expect(checkExpression(input({ smile: 0.3 })).status).toBe('fail'));
});

// ───────────────────────── Licht ─────────────────────────

/** Bild mit Gesichtsoval (aus den Landmarks) in `face` und Umgebung in `bg`. */
function scene(faceLuma: number | ((x: number, y: number) => number), bg = 200) {
  const input = idealInput();
  const { width: w, height: h } = input;
  const img = solid(w, h, [bg, bg, bg]);
  const poly = FACE_OVAL.map((i) => px(input.landmarks!, i, w, h));
  const mask = rasterizePolygon(poly, w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      const v = typeof faceLuma === 'number' ? faceLuma : faceLuma(x, y);
      const c = Math.max(0, Math.min(255, Math.round(v)));
      setPixel(img, x, y, [c, c, c]);
    }
  }
  return { input: { ...input, image: img }, mask };
}

describe('checkLighting', () => {
  it('grün bei gleichmäßigem, mittelhellem Gesicht mit leichter Textur', () => {
    const rand = rng(3);
    const { input } = scene(() => 140 + (rand() - 0.5) * 70);
    const r = checkLighting(input);
    expect(r.status).toBe('ok');
  });

  it('zu dunkel → Hinweis „mehr Licht“', () => {
    const rand = rng(5);
    const { input } = scene(() => 45 + (rand() - 0.5) * 30);
    const r = checkLighting(input);
    expect(r.status).toBe('fail');
    expect(r.hint).toMatch(/dunkel/);
  });

  it('zu hell, überstrahlt', () => {
    const { input } = scene(255);
    const r = checkLighting(input);
    expect(r.status).toBe('fail');
    expect(r.hint).toMatch(/hell|überstrahlt/);
  });

  it('linke Hälfte deutlich heller → „Licht von links zu stark“ (und gespiegelt: rechts)', () => {
    const base = scene(0);
    const axis = px(base.input.landmarks!, 168, base.input.width, base.input.height).x;
    const rand = rng(7);
    const { input } = scene((x) => (x < axis ? 190 : 100) + (rand() - 0.5) * 40);
    const r = checkLighting(input);
    expect(r.status).not.toBe('ok');
    expect(r.hint).toMatch(/Licht von links zu stark/);
    expect(checkLighting({ ...input, mirrored: true }).hint).toMatch(/Licht von rechts zu stark/);
  });

  it('rechte Hälfte heller → „Licht von rechts zu stark“', () => {
    const base = scene(0);
    const axis = px(base.input.landmarks!, 168, base.input.width, base.input.height).x;
    const rand = rng(9);
    const { input } = scene((x) => (x < axis ? 100 : 190) + (rand() - 0.5) * 40);
    expect(checkLighting(input).hint).toMatch(/Licht von rechts zu stark/);
  });

  it('flaches Licht (kaum Kontrast) → gelb/rot', () => {
    const { input } = scene(150);
    const r = checkLighting(input);
    expect(r.status).not.toBe('ok');
    expect(r.hint).toMatch(/Kontrast/);
  });

  it('misst Mittelwert, Asymmetrie, Clipping und Kontrast', () => {
    const img = solid(10, 10, [100, 100, 100]);
    for (let y = 0; y < 10; y++) for (let x = 5; x < 10; x++) setPixel(img, x, y, [200, 200, 200]);
    setPixel(img, 0, 0, [255, 255, 255]);
    const mask = new Uint8Array(100).fill(1);
    const m = measureLighting(img, mask, 5);
    expect(m.pixels).toBe(100);
    expect(m.mean).toBeCloseTo(150 + 0.5 * 0.21 * 0 + (255 - 100) / 100, 0);
    expect(m.leftMean).toBeLessThan(m.rightMean);
    expect(m.asymmetry).toBeLessThan(-0.5);
    expect(m.clippedHigh).toBeCloseTo(0.01, 6);
    expect(m.contrast).toBeGreaterThan(90);
  });

  it('unbekannt ohne Bild', () => expect(checkLighting(idealInput({ image: undefined })).status).toBe('unknown'));
});

// ───────────────────────── Hintergrund ─────────────────────────

function bgScene(color: [number, number, number], noise = 0, seed = 1) {
  const w = 200;
  const h = 260;
  const img = solid(w, h, color);
  const rand = rng(seed);
  if (noise) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const n = (rand() - 0.5) * 2 * noise;
        setPixel(img, x, y, [color[0] + n, color[1] + n, color[2] + n].map((v) => Math.max(0, Math.min(255, v))) as [number, number, number]);
      }
    }
  }
  const mask = new Uint8Array(w * h);
  for (let y = 60; y < h; y++) for (let x = 55; x < 145; x++) mask[y * w + x] = 1;
  fillRect(img, { x: 55, y: 60, w: 90, h: 200 }, [120, 90, 80]);
  const input: CheckInput = { ...idealInput(), width: w, height: h, image: img, personMask: mask, region: { x: 0, y: 0, w, h } };
  return input;
}

describe('checkBackground', () => {
  it('grün bei hellgrauer, gleichmäßiger Wand', () => expect(checkBackground(bgScene([215, 215, 215], 4)).status).toBe('ok'));
  it('zu dunkel', () => {
    const r = checkBackground(bgScene([60, 60, 60], 3));
    expect(r.status).toBe('fail');
    expect(r.hint).toMatch(/zu dunkel/);
  });
  it('zu bunt (rote Wand)', () => {
    const r = checkBackground(bgScene([230, 120, 120], 3));
    expect(r.status).not.toBe('ok');
    expect(r.hint).toMatch(/zu bunt/);
  });
  it('ungleichmäßig (starkes Rauschen/Muster)', () => {
    const r = checkBackground(bgScene([210, 210, 210], 55));
    expect(r.status).not.toBe('ok');
    expect(r.hint).toMatch(/ungleichmäßig/);
  });
  it('Helligkeitsverlauf zählt als ungleichmäßig', () => {
    const input = bgScene([200, 200, 200]);
    const { width: w, height: h } = input.image!;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (!input.personMask![y * w + x]) setPixel(input.image!, x, y, [90 + (x / w) * 150, 90 + (x / w) * 150, 90 + (x / w) * 150]);
    expect(checkBackground(input).status).not.toBe('ok');
  });
  it('Hintergrund kaum sichtbar → rot', () => {
    const input = bgScene([215, 215, 215]);
    input.personMask!.fill(1);
    const r = checkBackground(input);
    expect(r.status).toBe('fail');
    expect(r.hint).toMatch(/kaum sichtbar/);
  });
  it('wertet nur den Ausschnitt aus', () => {
    const input = bgScene([215, 215, 215], 3);
    // Störung links außerhalb des Ausschnitts
    fillRect(input.image!, { x: 0, y: 0, w: 40, h: 260 }, [255, 0, 0]);
    expect(checkBackground({ ...input, region: { x: 40, y: 0, w: 160, h: 260 } }).status).toBe('ok');
    expect(checkBackground({ ...input, region: { x: 0, y: 0, w: 200, h: 260 } }).status).not.toBe('ok');
  });
  it('lässt einen Randstreifen um die Person aus (Haarsaum)', () => {
    const input = bgScene([215, 215, 215]);
    const w = input.image!.width;
    // dunkler Saum direkt neben der Maske
    for (let y = 60; y < 260; y++) for (let x = 52; x < 55; x++) setPixel(input.image!, x, y, [20, 20, 20]);
    const m = measureBackground(input.image!, input.personMask!, input.region);
    expect(m.std).toBeLessThan(2);
    expect(w).toBe(200);
  });
  it('unbekannt ohne Maske', () => expect(checkBackground(idealInput()).status).toBe('unknown'));

  it('dilate weitet die Maske um den Radius aus', () => {
    const m = new Uint8Array(11 * 11);
    m[5 * 11 + 5] = 1;
    const d = dilate(m, 11, 11, 2);
    expect(d[5 * 11 + 3]).toBe(1);
    expect(d[5 * 11 + 7]).toBe(1);
    expect(d[3 * 11 + 5]).toBe(1);
    expect(d[5 * 11 + 8]).toBe(0);
    expect(d[1 * 11 + 5]).toBe(0);
  });
});

// ───────────────────────── Schärfe ─────────────────────────

function checker(w: number, h: number, cell: number, lo = 60, hi = 200): RawImage {
  const img = solid(w, h, [0, 0, 0]);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = (Math.floor(x / cell) + Math.floor(y / cell)) % 2 ? hi : lo;
      setPixel(img, x, y, [v, v, v]);
    }
  }
  return img;
}

function boxBlur(img: RawImage, r: number): RawImage {
  const out = solid(img.width, img.height, [0, 0, 0]);
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      let s = 0;
      let n = 0;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const xx = Math.min(img.width - 1, Math.max(0, x + dx));
          const yy = Math.min(img.height - 1, Math.max(0, y + dy));
          s += img.data[(yy * img.width + xx) * 4];
          n++;
        }
      }
      const v = s / n;
      setPixel(out, x, y, [v, v, v]);
    }
  }
  return out;
}

describe('checkSharpness', () => {
  const sharp = checker(160, 60, 4);
  it('Varianz ist 0 bei einfarbiger Fläche', () => expect(laplacianVariance(solid(50, 50, [128, 128, 128]))).toBeCloseTo(0, 6));
  it('scharfes Muster → grün', () => expect(checkSharpness(idealInput({ eyeRoi: eyeRoiOf(sharp) })).status).toBe('ok'));
  it('unscharf → rot mit Hinweis', () => {
    const r = checkSharpness(idealInput({ eyeRoi: eyeRoiOf(boxBlur(sharp, 3)) }));
    expect(r.status).toBe('fail');
    expect(r.hint).toMatch(/Unscharf/);
  });
  it('mehr Unschärfe → kleinerer Wert', () => {
    const a = laplacianVariance(sharp);
    const b = laplacianVariance(boxBlur(sharp, 1));
    const c = laplacianVariance(boxBlur(sharp, 2));
    expect(a).toBeGreaterThan(b);
    expect(b).toBeGreaterThan(c);
  });
  it('ist von der Belichtung unabhängig (dunkle Aufnahme gleich scharf wie helle)', () => {
    const bright = checker(160, 60, 4, 120, 240);
    const dark = checker(160, 60, 4, 40, 80); // gleiches Muster, Drittel der Helligkeit
    expect(normalizedSharpness(dark)).toBeCloseTo(normalizedSharpness(bright), -1);
    expect(laplacianVariance(dark)).toBeLessThan(laplacianVariance(bright) / 4);
  });
  it('unbekannt ohne Augenbereich', () => expect(checkSharpness(idealInput()).status).toBe('unknown'));
});

// ───────────────────────── Brille ─────────────────────────

describe('checkGlasses', () => {
  const eye = () => solid(160, 50, [150, 120, 110]);
  it('grün ohne helle Flecken', () => expect(checkGlasses(idealInput({ eyeRoi: eyeRoiOf(eye()) })).status).toBe('ok'));

  it('kleiner heller Fleck (Reflex) → gelb, nie rot', () => {
    const img = eye();
    fillRect(img, { x: 40, y: 20, w: 7, h: 6 }, [255, 255, 255]);
    fillRect(img, { x: 110, y: 18, w: 6, h: 6 }, [255, 255, 255]);
    const r = checkGlasses(idealInput({ eyeRoi: eyeRoiOf(img) }));
    expect(r.status).toBe('warn');
    expect(r.hint).toMatch(/Reflex/);
    expect(r.value).toMatch(/2 Flecken/);
  });

  it('sehr viel Weiß bleibt trotzdem nur ein Hinweis', () => {
    const img = eye();
    fillRect(img, { x: 0, y: 0, w: 160, h: 25 }, [255, 255, 255]);
    expect(checkGlasses(idealInput({ eyeRoi: eyeRoiOf(img) })).status).toBe('warn');
  });

  it('Hornhautreflexe in der Iris zählen nicht', () => {
    const img = eye();
    fillRect(img, { x: 40, y: 20, w: 4, h: 4 }, [255, 255, 255]);
    const m = measureReflexes({ ...img, exclude: [{ cx: 42, cy: 22, r: 8 }] });
    expect(m.brightFraction).toBe(0);
    expect(m.blobs).toBe(0);
  });

  it('zählt Flecken getrennt', () => {
    const img = eye();
    fillRect(img, { x: 10, y: 10, w: 4, h: 4 }, [255, 255, 255]);
    fillRect(img, { x: 60, y: 30, w: 4, h: 4 }, [255, 255, 255]);
    fillRect(img, { x: 61, y: 34, w: 2, h: 2 }, [255, 255, 255]); // hängt an Fleck 2
    expect(measureReflexes(eyeRoiOf(img)).blobs).toBe(2);
  });

  it('unbekannt ohne Augenbereich', () => expect(checkGlasses(idealInput()).status).toBe('unknown'));
});
