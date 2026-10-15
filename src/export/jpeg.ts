/** Canvas → JPEG-Blob mit eingetragener Druckauflösung (JFIF-Dichte), damit Programme die Größe richtig anzeigen. */
export async function canvasToJpeg(canvas: HTMLCanvasElement, quality: number, dpi: number): Promise<Blob> {
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('JPEG konnte nicht erzeugt werden'))), 'image/jpeg', quality),
  );
  return setJpegDpi(blob, dpi);
}

/** Schreibt die Dichte in den JFIF-Kopf (APP0). Ist keiner vorhanden, bleibt das Bild unverändert. */
export async function setJpegDpi(blob: Blob, dpi: number): Promise<Blob> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  patchJfifDensity(buf, dpi);
  return new Blob([buf], { type: 'image/jpeg' });
}

export function patchJfifDensity(buf: Uint8Array, dpi: number): boolean {
  // FF D8 | FF E0 len(2) 'J' 'F' 'I' 'F' 00 | ver(2) units(1) xd(2) yd(2)
  const isJfif =
    buf.length > 20 &&
    buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff && buf[3] === 0xe0 &&
    buf[6] === 0x4a && buf[7] === 0x46 && buf[8] === 0x49 && buf[9] === 0x46 && buf[10] === 0x00;
  if (!isJfif) return false;
  const d = Math.round(dpi);
  buf[13] = 1; // Einheit: Punkte pro Zoll
  buf[14] = (d >> 8) & 0xff;
  buf[15] = d & 0xff;
  buf[16] = (d >> 8) & 0xff;
  buf[17] = d & 0xff;
  return true;
}
