import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { checkDistance, checkFace, checkPose, checkPosition, checkProportions, checkResolution, grade, summarize, runChecks } from '../src/checks';
import { idealInput, matrixFromAngles } from './helpers';

describe('grade', () => {
  const r = { ok: [10, 20] as [number, number], warn: [5, 25] as [number, number] };
  it('grün im Sollbereich', () => expect(grade(15, r)).toMatchObject({ status: 'ok', score: 1 }));
  it('gelb zwischen Soll und Toleranz', () => {
    const g = grade(22.5, r);
    expect(g.status).toBe('warn');
    expect(g.score).toBeCloseTo(0.75, 6);
    expect(g.side).toBe('high');
  });
  it('rot außerhalb der Toleranz', () => {
    expect(grade(4, r).status).toBe('fail');
    expect(grade(4, r).side).toBe('low');
    expect(grade(40, r).score).toBe(0);
  });
  it('Score sinkt stetig', () => {
    expect(grade(10, r).score).toBeGreaterThan(grade(8, r).score);
    expect(grade(8, r).score).toBeGreaterThan(grade(6, r).score);
    expect(grade(6, r).score).toBeGreaterThan(grade(4, r).score);
  });
  it('unbekannt bei NaN', () => expect(grade(NaN, r).status).toBe('unknown'));
  it('einseitige Bereiche', () => {
    expect(grade(0.1, { ok: [-Infinity, 0.25], warn: [-Infinity, 0.45] }).status).toBe('ok');
    expect(grade(0.3, { ok: [-Infinity, 0.25], warn: [-Infinity, 0.45] }).status).toBe('warn');
    expect(grade(0.5, { ok: [-Infinity, 0.25], warn: [-Infinity, 0.45] }).status).toBe('fail');
  });
});

describe('checkFace', () => {
  it('ok bei genau einem Gesicht', () => expect(checkFace(idealInput()).status).toBe('ok'));
  it('rot ohne Gesicht', () => {
    const r = checkFace(idealInput({ faceCount: 0, landmarks: undefined }));
    expect(r.status).toBe('fail');
    expect(r.hint).toMatch(/Kein Gesicht/);
  });
  it('rot bei mehreren Gesichtern', () => {
    const r = checkFace(idealInput({ faceCount: 2 }));
    expect(r.status).toBe('fail');
    expect(r.hint).toMatch(/eine Person/);
  });
});

describe('checkPose', () => {
  it('grün bei frontaler Haltung', () => expect(checkPose(idealInput()).status).toBe('ok'));
  it('grün an der Grenze (Yaw 4°, Pitch −4°, Roll 2°)', () => {
    expect(checkPose(idealInput({ matrix: matrixFromAngles(4, -4, 2) })).status).toBe('ok');
  });
  it('gelb bei Yaw 7°', () => expect(checkPose(idealInput({ matrix: matrixFromAngles(7, 0, 0) })).status).toBe('warn'));
  it('rot bei Roll 8°', () => expect(checkPose(idealInput({ matrix: matrixFromAngles(0, 0, 8) })).status).toBe('fail'));

  it('Hinweis zur Drehung hängt von der Anzeige ab (gespiegelt vs. normal)', () => {
    // Gesicht zeigt zur Bildrechten → zurück zur Bildlinken
    const normal = checkPose(idealInput({ matrix: matrixFromAngles(12, 0, 0), mirrored: false }));
    expect(normal.hint).toBe('Kopf leicht nach links drehen');
    const mirrored = checkPose(idealInput({ matrix: matrixFromAngles(12, 0, 0), mirrored: true }));
    expect(mirrored.hint).toBe('Kopf leicht nach rechts drehen');
    expect(checkPose(idealInput({ matrix: matrixFromAngles(-12, 0, 0) })).hint).toBe('Kopf leicht nach rechts drehen');
  });

  it('Hinweise zu Nicken und Neigen', () => {
    expect(checkPose(idealInput({ matrix: matrixFromAngles(0, 12, 0) })).hint).toBe('Kinn leicht senken');
    expect(checkPose(idealInput({ matrix: matrixFromAngles(0, -12, 0) })).hint).toBe('Kinn leicht heben');
    expect(checkPose(idealInput({ matrix: matrixFromAngles(0, 0, 10) })).hint).toMatch(/gerade halten/);
  });

  it('wählt die am stärksten verletzte Achse für den Hinweis', () => {
    const r = checkPose(idealInput({ matrix: matrixFromAngles(7, 0, 9) }));
    expect(r.status).toBe('fail');
    expect(r.hint).toMatch(/gerade halten/);
  });

  it('unbekannt ohne Matrix', () => expect(checkPose(idealInput({ matrix: undefined })).status).toBe('unknown'));
  it('Score nimmt mit der Abweichung ab', () => {
    const a = checkPose(idealInput({ matrix: matrixFromAngles(1, 0, 0) })).score;
    const b = checkPose(idealInput({ matrix: matrixFromAngles(6, 0, 0) })).score;
    const c = checkPose(idealInput({ matrix: matrixFromAngles(15, 0, 0) })).score;
    expect(a).toBeGreaterThan(b);
    expect(b).toBeGreaterThan(c);
  });
});

describe('checkProportions', () => {
  const h = 514;
  const at = (ratio: number) => idealInput({}, { headH: ratio * h, chinY: 0.86 * h });
  it('grün bei 75,5 %', () => expect(checkProportions(idealInput()).status).toBe('ok'));
  it('grün bei 72 % und 79 %', () => {
    expect(checkProportions(at(0.72)).status).toBe('ok');
    expect(checkProportions(at(0.79)).status).toBe('ok');
  });
  it('Kopf zu klein → „Näher ran“', () => {
    const r = checkProportions(at(0.6));
    expect(r.status).toBe('fail');
    expect(r.hint).toMatch(/Näher/);
    expect(checkProportions(at(0.68)).status).toBe('warn');
  });
  it('Kopf zu groß → „Weiter weg“', () => {
    const r = checkProportions(at(0.9));
    expect(r.status).toBe('fail');
    expect(r.hint).toMatch(/Weiter weg/);
  });
  it('bezieht sich auf die Höhe des Ausschnitts, nicht des Bilds', () => {
    // Ausschnitt halb so hoch wie das Bild → derselbe Kopf wirkt doppelt so groß
    const r = checkProportions(idealInput({ region: { x: 0, y: 0, w: 200, h: 257 } }));
    expect(r.status).toBe('fail');
  });
  it('nennt Messwert in Prozent und Millimetern', () => {
    const r = checkProportions(idealInput());
    expect(r.value).toMatch(/75,5 %/);
    expect(r.value).toMatch(/34,0 mm/);
    expect(r.target).toBe('71–80 % (32–36 mm)');
  });
});

describe('checkPosition', () => {
  it('grün bei der Sollposition', () => expect(checkPosition(idealInput()).status).toBe('ok'));
  it('Kopf rechts der Mitte → nach links bewegen', () => {
    const r = checkPosition(idealInput({}, { cx: 400 / 2 + 40 }));
    expect(r.status).not.toBe('ok');
    expect(r.hint).toBe('Kopf etwas nach links bewegen');
    expect(checkPosition(idealInput({ mirrored: true }, { cx: 400 / 2 + 40 })).hint).toBe('Kopf etwas nach rechts bewegen');
  });
  it('Kopf zu weit oben → tiefer', () => {
    const r = checkPosition(idealInput({}, { chinY: 0.7 * 514 }));
    expect(r.status).not.toBe('ok');
    expect(r.hint).toMatch(/tiefer|Platz über/);
  });
  it('Kinn zu nah am unteren Rand', () => {
    const r = checkPosition(idealInput({}, { chinY: 0.97 * 514 }));
    expect(r.status).not.toBe('ok');
  });
  it('Augenlinie bei Kopfhöhe 75,5 % liegt knapp über der Mitte', () => {
    const r = checkPosition(idealInput());
    const m = /Augen (\d+) %/.exec(r.value);
    expect(Number(m?.[1])).toBeGreaterThanOrEqual(36);
    expect(Number(m?.[1])).toBeLessThanOrEqual(52);
  });
});

describe('checkDistance', () => {
  it('grün ab 1 m', () => expect(checkDistance(idealInput({ distanceCm: 130 })).status).toBe('ok'));
  it('gelb zwischen 70 und 100 cm', () => expect(checkDistance(idealInput({ distanceCm: 85 })).status).toBe('warn'));
  it('rot unter 70 cm mit Hinweis auf Abstand und Zoom', () => {
    const r = checkDistance(idealInput({ distanceCm: 40 }));
    expect(r.status).toBe('fail');
    expect(r.hint).toMatch(/1–1,5 m/);
    expect(r.hint).toMatch(/Zoom/);
  });
  it('unbekannt ohne Schätzung', () => {
    expect(checkDistance(idealInput({ distanceCm: undefined })).status).toBe('unknown');
    expect(checkDistance(idealInput({ distanceCm: NaN })).status).toBe('unknown');
  });
});

describe('checkResolution', () => {
  it('grün ab 1063 px', () => expect(checkResolution(idealInput({ cropSourceHeightPx: 1200 })).status).toBe('ok'));
  it('gelb ab 640 px', () => expect(checkResolution(idealInput({ cropSourceHeightPx: 800 })).status).toBe('warn'));
  it('rot darunter', () => expect(checkResolution(idealInput({ cropSourceHeightPx: 400 })).status).toBe('fail'));
});

describe('runChecks und summarize', () => {
  it('ohne Gesicht bleiben alle übrigen Prüfungen unbekannt', () => {
    const r = runChecks(idealInput({ faceCount: 0, landmarks: undefined }));
    expect(r[0]).toMatchObject({ id: 'face', status: 'fail' });
    expect(r.slice(1).every((x) => x.status === 'unknown')).toBe(true);
  });

  it('lässt „Auflösung“ weg, solange sie nicht bekannt ist', () => {
    expect(runChecks(idealInput()).some((r) => r.id === 'resolution')).toBe(false);
    expect(runChecks(idealInput({ cropSourceHeightPx: 1200 })).some((r) => r.id === 'resolution')).toBe(true);
  });

  it('gewichtet und wertet rote Prüfungen zusätzlich ab', () => {
    const base = runChecks(idealInput());
    const worse = base.map((r) => (r.id === 'pose' ? { ...r, status: 'fail' as const, score: 0 } : r));
    expect(summarize(worse).score).toBeLessThan(summarize(base).score - 0.08);
    expect(summarize(worse).status).toBe('fail');
  });

  it('Auto-Auslösung: gelb blockiert nur ohne allowWarn, Brillenhinweis nie', () => {
    const r = [
      { id: 'pose', label: '', status: 'ok', score: 1, value: '', target: '', hint: '' },
      { id: 'glasses', label: '', status: 'warn', score: 0.7, value: '', target: '', hint: 'x' },
    ] as ReturnType<typeof runChecks>;
    expect(summarize(r).passed).toBe(true);
    r[0] = { ...r[0], status: 'warn' };
    expect(summarize(r, false).passed).toBe(false);
    expect(summarize(r, true).passed).toBe(true);
    r[0] = { ...r[0], status: 'fail' };
    expect(summarize(r, true).passed).toBe(false);
    r[0] = { ...r[0], status: 'unknown' };
    expect(summarize(r, true).passed).toBe(false);
  });

  it('Schwellwerte stammen aus config.ts', () => {
    expect(CONFIG.checks.proportions.headRatio.ok).toEqual([0.71, 0.8]);
  });
});
