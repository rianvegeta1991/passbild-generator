import { CONFIG } from '../config';
import type { FaceData, Rect, Status } from '../types';
import { FACE_OVAL, measureHead, px } from '../detection/geometry';
import { STATUS_COLOR } from './icons';

export interface OverlayState {
  /** Schablone in Pixeln des Analysebilds */
  region: Rect;
  aw: number;
  ah: number;
  status: Status;
  face?: FaceData;
  personMask?: Uint8Array;
  mirrored: boolean;
}

const DASH: Record<Status, number[]> = {
  ok: [],
  warn: [12, 7],
  fail: [3, 7],
  unknown: [3, 7],
};

/**
 * Zeichnet die Schablone über das Kamerabild: abgedunkelter Rand, 35:45-Fenster,
 * Ovalschablone sowie Hilfslinien für Scheitel, Augen und Kinn. Die Ovalform ändert
 * sich mit dem Status (durchgezogen / gestrichelt / gepunktet), nicht nur die Farbe.
 */
export class Overlay {
  private ctx: CanvasRenderingContext2D;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  }

  resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(this.canvas.clientWidth * dpr);
    const h = Math.round(this.canvas.clientHeight * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  clear(): void {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  draw(s: OverlayState): void {
    this.resize();
    const { ctx, canvas } = this;
    const W = canvas.width;
    const H = canvas.height;
    const kx = W / s.aw;
    const ky = H / s.ah;
    const r = { x: s.region.x * kx, y: s.region.y * ky, w: s.region.w * kx, h: s.region.h * ky };
    const lw = Math.max(2, W / 220);
    const color = STATUS_COLOR[s.status];
    const t = CONFIG.template;

    ctx.clearRect(0, 0, W, H);

    // Rand abdunkeln, Fenster freilassen
    ctx.fillStyle = 'rgba(8, 12, 16, 0.55)';
    ctx.beginPath();
    ctx.rect(0, 0, W, H);
    ctx.rect(r.x, r.y, r.w, r.h);
    ctx.fill('evenodd');
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = lw * 0.6;
    ctx.strokeRect(r.x, r.y, r.w, r.h);

    // Hilfslinien: Scheitel, Augen, Kinn
    const crownY = r.y + (t.chinY - t.headRatio) * r.h;
    const chinY = r.y + t.chinY * r.h;
    const eyeY = r.y + ((CONFIG.checks.position.eyeLine.ok[0] + CONFIG.checks.position.eyeLine.ok[1]) / 2) * r.h;
    ctx.save();
    ctx.setLineDash([lw * 3, lw * 3]);
    ctx.lineWidth = lw * 0.55;
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.font = `${Math.round(W / 34)}px system-ui, sans-serif`;
    ctx.textBaseline = 'bottom';
    for (const [y, label] of [
      [crownY, 'Scheitel'],
      [eyeY, 'Augen'],
      [chinY, 'Kinn'],
    ] as const) {
      ctx.beginPath();
      ctx.moveTo(r.x, y);
      ctx.lineTo(r.x + r.w, y);
      ctx.stroke();
      ctx.fillText(label, r.x + lw * 2, y - lw);
    }
    ctx.restore();

    // Ovalschablone
    ctx.save();
    ctx.setLineDash(DASH[s.status].map((d) => d * (lw / 3)));
    ctx.lineWidth = lw * 1.2;
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.ellipse(r.x + r.w / 2, (crownY + chinY) / 2, t.ovalRx * r.w, (chinY - crownY) * t.ovalRy, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // erkanntes Gesicht
    if (s.face) {
      const lm = s.face.landmarks;
      const mx = (x: number) => (s.mirrored ? 1 - x : x);
      ctx.save();
      ctx.lineWidth = lw * 0.8;
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      FACE_OVAL.forEach((i, n) => {
        const x = mx(lm[i].x) * W;
        const y = lm[i].y * H;
        if (n === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();
      ctx.stroke();
      ctx.globalAlpha = 1;
      const dot = (x: number, y: number, rad: number, fill: string) => {
        ctx.fillStyle = fill;
        ctx.beginPath();
        ctx.arc(mx(x / s.aw) * W, (y / s.ah) * H, rad, 0, Math.PI * 2);
        ctx.fill();
      };
      const head = measureHead(lm, s.aw, s.ah, s.personMask);
      dot(head.crown.x, head.crown.y, lw * 1.6, '#ffffff');
      dot(head.chin.x, head.chin.y, lw * 1.6, '#ffffff');
      for (const i of [468, 473]) {
        const p = px(lm, i, s.aw, s.ah);
        dot(p.x, p.y, lw * 1.2, color);
      }
      ctx.restore();
    }
  }
}
