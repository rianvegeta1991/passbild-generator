/**
 * Nur für die Entwicklung (?fake=<Bild-URL>): ein Foto als „Kamera“, damit sich
 * die ganze Kette ohne echte Kamera testen lässt. Wird im Build nicht eingebunden.
 */
export async function fakeStream(url: string): Promise<MediaStream> {
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('Testbild nicht ladbar: ' + url));
    img.src = url;
  });
  const k = Math.min(1, 1280 / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * k);
  c.height = Math.round(img.naturalHeight * k);
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  const draw = () => ctx.drawImage(img, 0, 0, c.width, c.height);
  draw();
  setInterval(draw, 100);
  return c.captureStream(15);
}
