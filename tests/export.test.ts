import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { applyPlan, planCrop } from '../src/export/crop';
import { layoutSheet } from '../src/export/sheet';
import { patchJfifDensity } from '../src/export/jpeg';

const { widthPx: W, heightPx: H } = CONFIG.output;

describe('planCrop', () => {
  it('bringt Kinn auf die Sollhöhe und mittig, Kopf auf den Sollanteil', () => {
    const plan = planCrop({ x: 1500, y: 2200 }, 1100, 0, 3000, 4000);
    const chin = applyPlan(plan, { x: 1500, y: 2200 });
    expect(chin.x).toBeCloseTo(W / 2, 3);
    expect(chin.y).toBeCloseTo(CONFIG.template.chinY * H, 3);
    const crown = applyPlan(plan, { x: 1500, y: 2200 - 1100 });
    expect((chin.y - crown.y) / H).toBeCloseTo(CONFIG.template.headRatio, 4);
    expect(plan.adjusted).toBe('none');
    expect(plan.srcHeightPx).toBeCloseTo(H / plan.scale, 6);
  });

  it('bleibt bei geneigter Kopfachse mittig und senkrecht', () => {
    // Kopf um 3° im Uhrzeigersinn geneigt: Scheitel liegt rechts oberhalb des Kinns
    const phi = (3 * Math.PI) / 180;
    const chin = { x: 1500, y: 2200 };
    const crown = { x: chin.x + Math.sin(phi) * 1100, y: chin.y - Math.cos(phi) * 1100 };
    const plan = planCrop(chin, 1100, 3, 3000, 4000);
    const c = applyPlan(plan, crown);
    expect(c.x).toBeCloseTo(W / 2, 2);
    expect(applyPlan(plan, chin).x).toBeCloseTo(W / 2, 2);
  });

  it('dreht die Augenlinie waagrecht', () => {
    const phi = 2.5;
    const r = (phi * Math.PI) / 180;
    const left = { x: 1400, y: 1800 };
    const right = { x: 1400 + Math.cos(r) * 300, y: 1800 + Math.sin(r) * 300 };
    const plan = planCrop({ x: 1500, y: 2200 }, 1100, phi, 3000, 4000);
    const a = applyPlan(plan, left);
    const b = applyPlan(plan, right);
    expect(b.y - a.y).toBeCloseTo(0, 3);
    expect(b.x - a.x).toBeGreaterThan(0);
  });

  it('dreht nur bis zur konfigurierten Grenze', () => {
    expect(planCrop({ x: 1500, y: 2200 }, 1100, 9, 3000, 4000).levelDeg).toBe(0);
    expect(planCrop({ x: 1500, y: 2200 }, 1100, 4, 3000, 4000).levelDeg).toBe(4);
  });

  it('verschiebt den Ausschnitt, wenn er über den Rand ragt', () => {
    // Kopf nahe am linken Bildrand
    const plan = planCrop({ x: 330, y: 2200 }, 1100, 0, 3000, 4000);
    expect(plan.adjusted).toBe('shifted');
    expect(plan.aabb.x).toBeGreaterThanOrEqual(-1e-6);
    expect(plan.aabb.x + plan.aabb.w).toBeLessThanOrEqual(3000 + 1e-6);
    expect(plan.scale).toBeCloseTo((CONFIG.template.headRatio * H) / 1100, 6); // Maßstab bleibt
  });

  it('zieht den Ausschnitt nur dann enger, wenn er nie ins Bild passt', () => {
    const plan = planCrop({ x: 400, y: 600 }, 700, 0, 800, 800);
    expect(plan.adjusted).toBe('tightened');
    expect(plan.aabb.x).toBeGreaterThanOrEqual(-1e-6);
    expect(plan.aabb.y).toBeGreaterThanOrEqual(-1e-6);
    expect(plan.aabb.x + plan.aabb.w).toBeLessThanOrEqual(800 + 1e-6);
    expect(plan.aabb.y + plan.aabb.h).toBeLessThanOrEqual(800 + 1e-6);
    expect(plan.scale).toBeGreaterThan((CONFIG.template.headRatio * H) / 700); // Kopf wird größer als Soll
  });

  it('Ausschnitt bleibt komplett im Bild – auch gedreht', () => {
    for (const lvl of [-4, -1, 2, 5]) {
      const plan = planCrop({ x: 600, y: 1500 }, 800, lvl, 1800, 2400);
      expect(plan.aabb.x).toBeGreaterThanOrEqual(-1e-6);
      expect(plan.aabb.y).toBeGreaterThanOrEqual(-1e-6);
      expect(plan.aabb.x + plan.aabb.w).toBeLessThanOrEqual(1800 + 1e-6);
      expect(plan.aabb.y + plan.aabb.h).toBeLessThanOrEqual(2400 + 1e-6);
    }
  });

  it('Ausschnitt hat das Seitenverhältnis 35:45', () => {
    const plan = planCrop({ x: 1500, y: 2200 }, 1100, 0, 3000, 4000);
    expect(plan.destW / plan.destH).toBeCloseTo(35 / 45, 2);
    expect(plan.aabb.w / plan.aabb.h).toBeCloseTo(35 / 45, 2);
  });
});

describe('layoutSheet', () => {
  it('300 dpi: 1800 × 1200, Fotos 35 × 45 mm', () => {
    const l = layoutSheet(6, 300);
    expect([l.width, l.height]).toEqual([1800, 1200]);
    expect(l.photoW).toBe(Math.round((35 / 25.4) * 300));
    expect(l.photoH).toBe(Math.round((45 / 25.4) * 300));
    expect(l.photos).toHaveLength(6);
  });
  it('600 dpi: 3543 × 2362, Fotos in Originalgröße 827 × 1063', () => {
    const l = layoutSheet(4, 600);
    expect([l.width, l.height]).toEqual([3543, 2362]);
    expect([l.photoW, l.photoH]).toEqual([827, 1063]);
  });
  it.each([4, 5, 6])('%d Fotos liegen im Bogen, ohne sich zu überlappen, mit Rand', (n) => {
    for (const dpi of [300, 600]) {
      const l = layoutSheet(n, dpi);
      expect(l.photos).toHaveLength(n);
      for (const p of l.photos) {
        expect(p.x).toBeGreaterThan(0);
        expect(p.y).toBeGreaterThan(0);
        expect(p.x + p.w).toBeLessThan(l.width);
        expect(p.y + p.h).toBeLessThan(l.height);
      }
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const a = l.photos[i];
          const b = l.photos[j];
          const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
          expect(overlap).toBe(false);
        }
      }
    }
  });
  it('lässt zwischen den Fotos Platz für Schnittmarken', () => {
    const l = layoutSheet(6, 300);
    const gapX = l.photos[1].x - (l.photos[0].x + l.photoW);
    const gapY = l.photos[3].y - (l.photos[0].y + l.photoH);
    expect(gapX).toBe(l.gap);
    expect(gapY).toBe(l.gap);
    expect(l.gap).toBeGreaterThan(20);
  });
  it('lehnt unbekannte Auflösungen ab', () => expect(() => layoutSheet(4, 123)).toThrow());
});

describe('patchJfifDensity', () => {
  const jfif = () => {
    const b = new Uint8Array(40);
    b.set([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]);
    return b;
  };
  it('trägt dpi ein', () => {
    const b = jfif();
    expect(patchJfifDensity(b, 600)).toBe(true);
    expect(b[13]).toBe(1);
    expect((b[14] << 8) | b[15]).toBe(600);
    expect((b[16] << 8) | b[17]).toBe(600);
  });
  it('lässt Dateien ohne JFIF-Kopf unverändert', () => {
    const b = new Uint8Array(40);
    b.set([0xff, 0xd8, 0xff, 0xe1]);
    const copy = b.slice();
    expect(patchJfifDensity(b, 600)).toBe(false);
    expect(b).toEqual(copy);
  });
});
