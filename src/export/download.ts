export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Teilen-Dialog des Betriebssystems (Speichern in Fotos, Drucken …), falls verfügbar. */
export async function shareBlob(blob: Blob, filename: string): Promise<boolean> {
  const file = new File([blob], filename, { type: blob.type });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (!nav.canShare || !nav.canShare({ files: [file] })) return false;
  try {
    await nav.share({ files: [file], title: 'Passbild' });
    return true;
  } catch (e) {
    if ((e as { name?: string }).name === 'AbortError') return true; // vom Nutzer abgebrochen
    return false;
  }
}

export function canShareFiles(): boolean {
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (!nav.canShare) return false;
  try {
    return nav.canShare({ files: [new File([''], 'x.jpg', { type: 'image/jpeg' })] });
  } catch {
    return false;
  }
}
