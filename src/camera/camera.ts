import { CONFIG } from '../config';
import type { FrameSource } from '../detection/analyzer';

export type Facing = 'environment' | 'user';

export interface CameraError extends Error {
  userMessage: string;
}

function cameraError(e: unknown): CameraError {
  const name = (e as { name?: string })?.name ?? '';
  let msg: string;
  if (!window.isSecureContext) msg = 'Der Kamerazugriff funktioniert nur über HTTPS (oder localhost).';
  else if (name === 'NotAllowedError' || name === 'SecurityError') {
    msg = 'Kamerazugriff verweigert. Bitte in den Browser-Einstellungen für diese Seite erlauben und neu laden.';
  } else if (name === 'NotFoundError' || name === 'OverconstrainedError') msg = 'Keine passende Kamera gefunden.';
  else if (name === 'NotReadableError') msg = 'Die Kamera wird gerade von einer anderen App benutzt.';
  else msg = 'Die Kamera konnte nicht gestartet werden.';
  const err = new Error(msg) as CameraError;
  err.userMessage = msg;
  return err;
}

interface ZoomRange {
  min: number;
  max: number;
  step: number;
}

/** Kamerazugriff: Vorschau, Zoom (Hardware, sonst digital) und Standbild-Aufnahme. */
export class Camera {
  readonly video: HTMLVideoElement;
  facing: Facing = 'environment';
  /** true, wenn die Vorschau wie ein Spiegel angezeigt wird (Frontkamera) */
  mirrored = false;
  private stream: MediaStream | null = null;
  private track: MediaStreamTrack | null = null;
  private imageCapture: ImageCapture | null = null;
  private hwRange: ZoomRange | null = null;
  hwZoom = 1;
  softZoom = 1;

  constructor(video: HTMLVideoElement) {
    this.video = video;
    video.playsInline = true;
    video.muted = true;
    video.autoplay = true;
  }

  get running(): boolean {
    return !!this.stream;
  }

  get totalZoom(): number {
    return this.hwZoom * this.softZoom;
  }

  /** Zoombereich für den Regler (Gesamtfaktor). */
  get zoomRange(): { min: number; max: number; step: number } {
    if (this.hwRange) return { min: 1, max: Math.min(this.hwRange.max, 8), step: 0.1 };
    return { min: 1, max: CONFIG.live.softZoomMax, step: 0.1 };
  }

  async start(facing: Facing = this.facing): Promise<void> {
    this.stop();
    this.facing = facing;
    let stream: MediaStream;
    try {
      if (import.meta.env.DEV && new URLSearchParams(location.search).has('fake')) {
        const { fakeStream } = await import('./fake');
        stream = await fakeStream(new URLSearchParams(location.search).get('fake') as string);
      } else {
        if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error('unsupported'), { name: 'NotFoundError' });
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: facing },
            width: { ideal: CONFIG.live.videoIdeal.width },
            height: { ideal: CONFIG.live.videoIdeal.height },
          },
        });
      }
    } catch (e) {
      throw cameraError(e);
    }
    this.stream = stream;
    this.track = stream.getVideoTracks()[0];
    const settings = this.track.getSettings();
    // Ohne Angabe (Laptop-Webcam) wie einen Spiegel anzeigen
    this.mirrored = settings.facingMode ? settings.facingMode === 'user' : true;

    this.video.srcObject = stream;
    await this.video.play().catch(() => undefined);
    if (!this.video.videoWidth) {
      await new Promise<void>((res) => this.video.addEventListener('loadedmetadata', () => res(), { once: true }));
    }

    this.imageCapture = null;
    if ('ImageCapture' in window && !(import.meta.env.DEV && new URLSearchParams(location.search).has('fake'))) {
      try {
        this.imageCapture = new ImageCapture(this.track);
      } catch {
        this.imageCapture = null;
      }
    }

    const caps = (this.track.getCapabilities?.() ?? {}) as MediaTrackCapabilities & { zoom?: ZoomRange };
    this.hwRange = caps.zoom && caps.zoom.max > 1 ? { min: caps.zoom.min, max: caps.zoom.max, step: caps.zoom.step || 0.1 } : null;
    this.hwZoom = 1;
    this.softZoom = 1;
    this.applyPreviewTransform();
  }

  stop(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.track = null;
    this.imageCapture = null;
    this.video.srcObject = null;
  }

  /** Gesamtzoom setzen: erst per Hardware (wenn vorhanden), der Rest digital. */
  async setZoom(total: number): Promise<void> {
    const range = this.zoomRange;
    const z = Math.min(range.max, Math.max(range.min, total));
    let hw = 1;
    if (this.hwRange && this.track) {
      hw = Math.min(this.hwRange.max, Math.max(1, z));
      try {
        await this.track.applyConstraints({ advanced: [{ zoom: hw } as MediaTrackConstraintSet] });
      } catch {
        hw = this.hwZoom;
      }
    }
    this.hwZoom = hw;
    this.softZoom = Math.max(1, z / hw);
    this.applyPreviewTransform();
  }

  /** Digitaler Zoom und Spiegelung der Vorschau (rein optisch). */
  applyPreviewTransform(): void {
    const s = this.softZoom;
    this.video.style.transform = `scale(${this.mirrored ? -s : s}, ${s})`;
  }

  get videoSize(): { w: number; h: number } {
    return { w: this.video.videoWidth, h: this.video.videoHeight };
  }

  /** Der sichtbare Ausschnitt des Videos (Mitte, wenn digital gezoomt wird). */
  frameSource(): FrameSource {
    const { w, h } = this.videoSize;
    const sw = w / this.softZoom;
    const sh = h / this.softZoom;
    return { image: this.video, sx: (w - sw) / 2, sy: (h - sh) / 2, sw, sh };
  }

  /** Ein Standbild in möglichst hoher Auflösung. */
  async captureStill(): Promise<Blob> {
    if (this.imageCapture) {
      try {
        const settings: PhotoSettings = {};
        try {
          const caps = await this.imageCapture.getPhotoCapabilities();
          if (caps.imageWidth && (caps.imageWidth.max ?? 0) > 4096) settings.imageWidth = 4096;
          // Blitz nur ausschalten, wenn das Gerät den Modus kennt (sonst lehnt takePhoto die Einstellung ab)
          if (caps.fillLightMode?.includes('off')) settings.fillLightMode = 'off';
        } catch {
          /* ohne Angaben: Standard */
        }
        return await this.imageCapture.takePhoto(settings);
      } catch (e) {
        console.warn('takePhoto fehlgeschlagen, nutze Videobild', e);
      }
    }
    return this.grabVideoFrame();
  }

  /** Aktuelles Videobild in voller Videoauflösung als JPEG. */
  grabVideoFrame(): Promise<Blob> {
    const { w, h } = this.videoSize;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    c.getContext('2d')?.drawImage(this.video, 0, 0, w, h);
    return new Promise((resolve, reject) =>
      c.toBlob((b) => (b ? resolve(b) : reject(new Error('Bild konnte nicht erzeugt werden'))), 'image/jpeg', 0.95),
    );
  }
}
