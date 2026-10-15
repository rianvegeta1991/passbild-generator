import { CONFIG } from '../config';

export interface SheetLayout {
  width: number;
  height: number;
  cols: number;
  rows: number;
  /** Position und Größe jedes Fotos in Pixeln */
  photos: { x: number; y: number; w: number; h: number }[];
  photoW: number;
  photoH: number;
  gap: number;
}

/** Raster für `count` Fotos (4–6) auf dem 10×15-cm-Bogen (quer). Fotos behalten 35×45 mm. */
export function layoutSheet(count: number, dpi: number): SheetLayout {
  const size = CONFIG.sheet.sizes[dpi];
  if (!size) throw new Error(`Keine Bogengröße für ${dpi} dpi`);
  const pxPerMm = dpi / 25.4;
  const photoW = Math.round(CONFIG.output.mmWidth * pxPerMm);
  const photoH = Math.round(CONFIG.output.mmHeight * pxPerMm);
  const gap = Math.round(CONFIG.sheet.gapMm * pxPerMm);
  // 4 Fotos: 2×2, ab 5: 3×2 – so bleibt rundum Rand für den Druckerrand
  const cols = count <= 4 ? 2 : 3;
  const rows = Math.ceil(count / cols);
  const totalW = cols * photoW + (cols - 1) * gap;
  const totalH = rows * photoH + (rows - 1) * gap;
  const x0 = Math.round((size.width - totalW) / 2);
  const y0 = Math.round((size.height - totalH) / 2);
  const photos: SheetLayout['photos'] = [];
  for (let i = 0; i < count; i++) {
    const r = Math.floor(i / cols);
    const c = i % cols;
    photos.push({ x: x0 + c * (photoW + gap), y: y0 + r * (photoH + gap), w: photoW, h: photoH });
  }
  return { width: size.width, height: size.height, cols, rows, photos, photoW, photoH, gap };
}

/** Druckbogen: Fotos im Raster mit dünnen Schnittmarken an den Ecken (außerhalb der Fotos). */
export function buildSheet(photo: HTMLCanvasElement, count: number, dpi: number): HTMLCanvasElement {
  const layout = layoutSheet(count, dpi);
  const canvas = document.createElement('canvas');
  canvas.width = layout.width;
  canvas.height = layout.height;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  ctx.fillStyle = CONFIG.sheet.backgroundColor;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  for (const p of layout.photos) ctx.drawImage(photo, p.x, p.y, p.w, p.h);

  const pxPerMm = dpi / 25.4;
  const lw = Math.max(1, Math.round(CONFIG.sheet.markWidthMm * pxPerMm));
  // Die Marke darf weder in das Foto noch in die Nachbarmarke ragen
  const len = Math.min(Math.round(CONFIG.sheet.markLengthMm * pxPerMm), Math.floor(layout.gap / 2) - lw);
  ctx.strokeStyle = CONFIG.sheet.markColor;
  ctx.lineWidth = lw;
  ctx.lineCap = 'butt';
  ctx.beginPath();
  for (const p of layout.photos) {
    const x0 = p.x;
    const x1 = p.x + p.w;
    const y0 = p.y;
    const y1 = p.y + p.h;
    for (const [cx, cy, dx, dy] of [
      [x0, y0, -1, -1],
      [x1, y0, 1, -1],
      [x0, y1, -1, 1],
      [x1, y1, 1, 1],
    ] as const) {
      // waagrechte und senkrechte Marke, vom Fotorand nach außen
      ctx.moveTo(cx + dx * (lw / 2 + 1), cy);
      ctx.lineTo(cx + dx * (lw / 2 + 1 + len), cy);
      ctx.moveTo(cx, cy + dy * (lw / 2 + 1));
      ctx.lineTo(cx, cy + dy * (lw / 2 + 1 + len));
    }
  }
  ctx.stroke();
  return canvas;
}
