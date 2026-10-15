import { CONFIG } from '../config';
import type { CheckResult, Status } from '../types';
import { CHECK_ORDER, summarize, topHints, type Summary } from '../checks';
import { Analyzer } from '../detection/analyzer';
import { evaluate, templateRegion } from '../detection/evaluate';
import { Camera } from '../camera/camera';
import { buildSheet } from '../export/sheet';
import { canvasToJpeg } from '../export/jpeg';
import { canShareFiles, downloadBlob, shareBlob } from '../export/download';
import { buildFinal, evaluateStill, type CaptureMeta, type FinalResult, type StillEval } from '../pipeline';
import { h, sleep, store } from './dom';
import { ICON, STATUS_COLOR, STATUS_TEXT, statusIcon } from './icons';
import { Overlay } from './overlay';
import { renderReport } from './report';
import { beep, shutter, unlockAudio } from './sound';

const DISCLAIMER = 'Automatische Vorprüfung, keine Garantie für die Annahme durch die Behörde.';
const LIVE_ROWS = CHECK_ORDER.filter((c) => c.id !== 'resolution');

type Screen = 'start' | 'live' | 'busy' | 'result' | 'error';

export class App {
  private analyzer: Analyzer | null = null;
  private engine: Promise<Analyzer>;
  private engineText = 'Erkennungs-Engine wird geladen …';
  private engineState: 'laden' | 'bereit' | 'fehler' = 'laden';
  private engineListeners: (() => void)[] = [];

  private screen: Screen = 'start';
  private camera: Camera;
  private overlay: Overlay | null = null;
  private loopId = 0;
  private busy = false;
  private greenSince: number | null = null;
  private countdown: number | null = null;
  private wakeLock: { release(): Promise<void> } | null = null;

  private autoOn = store.get('auto', false);
  private sheetCount = store.get('sheetCount', CONFIG.sheet.defaultCount);
  private sheetDpi = store.get('sheetDpi', CONFIG.sheet.defaultDpi);

  // Ergebnis
  private evals: StillEval[] = [];
  private meta: CaptureMeta = { facing: 'environment', hwZoom: 1, estimateDistance: true };
  private final: FinalResult | null = null;
  private finalBlob: Blob | null = null;
  private objectUrls: string[] = [];

  /** `swBereit`: erst danach werden die Modelle geladen, damit sie schon beim ersten Besuch im Cache landen. */
  constructor(
    private root: HTMLElement,
    private swBereit: Promise<void> = Promise.resolve(),
  ) {
    this.camera = new Camera(h('video', { class: 'cam' }));
    this.engine = this.loadEngine();
    this.showStart();
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.loopId++;
      else if (this.screen === 'live' && !this.busy) this.startLoop();
    });
    window.addEventListener('resize', () => this.fitStage());
  }

  // ───────────────────────── Engine ─────────────────────────

  private async loadEngine(): Promise<Analyzer> {
    try {
      await this.swBereit;
      const a = await Analyzer.create((t) => this.setEngine('laden', t));
      this.analyzer = a;
      this.setEngine('bereit', `Bereit – läuft jetzt auch offline (${a.delegate === 'GPU' ? 'GPU' : 'CPU'})`);
      return a;
    } catch (e) {
      console.error(e);
      this.setEngine('fehler', 'Die Erkennungs-Engine konnte nicht geladen werden. Internetverbindung prüfen und neu laden.');
      throw e;
    }
  }

  private setEngine(state: 'laden' | 'bereit' | 'fehler', text: string): void {
    this.engineState = state;
    this.engineText = text;
    this.engineListeners.forEach((f) => f());
  }

  // ───────────────────────── Bildschirme ─────────────────────────

  private mount(screen: Screen, ...children: (Node | null)[]): void {
    this.screen = screen;
    this.engineListeners = [];
    this.root.replaceChildren(...(children.filter(Boolean) as Node[]));
    window.scrollTo(0, 0);
  }

  private disclaimer(): HTMLElement {
    return h('p', { class: 'disclaimer', text: DISCLAIMER });
  }

  private showStart(): void {
    this.stopLive();
    this.releaseUrls();
    const status = h('div', { class: 'engine' });
    const startBtn = h('button', { class: 'btn primary big', onclick: () => void this.startCamera() }, h('span', { class: 'bi', html: ICON.camera }), 'Kamera starten');
    const file = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: () => void this.importFile(file) });
    const importBtn = h('button', { class: 'btn', onclick: () => file.click() }, h('span', { class: 'bi', html: ICON.image }), 'Vorhandenes Foto prüfen');
    const renderStatus = () => {
      status.className = `engine ${this.engineState}`;
      status.replaceChildren(
        h('span', { class: 'dot' }),
        h('span', { text: this.engineText }),
        ...(this.engineState === 'fehler' ? [h('button', { class: 'link', text: 'Neu laden', onclick: () => location.reload() })] : []),
      );
    };
    renderStatus();

    this.mount(
      'start',
      h(
        'main',
        { class: 'page start' },
        h('header', { class: 'hero' }, h('img', { src: './icon.svg', alt: '', class: 'logo', width: 64, height: 64 }), h('h1', { text: 'Passbild-Generator' }), h('p', { class: 'sub', text: 'Biometrisches Foto 35 × 45 mm für den Führerschein und ähnliche Dokumente' })),
        h(
          'section',
          { class: 'card' },
          h('h2', { text: 'So gelingt das Foto' }),
          h(
            'ol',
            { class: 'steps' },
            h('li', { html: '<strong>Licht:</strong> Tageslicht von vorn, kein Schatten im Gesicht, keine Lampe direkt dahinter.' }),
            h('li', { html: '<strong>Hintergrund:</strong> glatte, helle Wand (weiß oder hellgrau), mit etwas Abstand zur Person.' }),
            h('li', { html: '<strong>Abstand:</strong> 1–1,5 m und hineinzoomen – so wird das Gesicht nicht verzerrt. Das Handy fest hinstellen und den Selbstauslöser nutzen.' }),
            h('li', { html: '<strong>Gesicht:</strong> gerade in die Kamera, Mund geschlossen, Augen offen, keine Kopfbedeckung.' }),
          ),
        ),
        h('div', { class: 'actions col' }, startBtn, importBtn, file, status),
        h('section', { class: 'privacy' }, h('strong', { text: 'Alles bleibt auf diesem Gerät. ' }), 'Kein Upload, keine Konten, kein Tracking – die Gesichtserkennung läuft lokal im Browser. Nur die Modelle werden einmalig geladen und dann für den Offline-Betrieb gespeichert.'),
        this.disclaimer(),
      ),
    );
    this.engineListeners.push(renderStatus);
  }

  private fatal(title: string, message: string): void {
    this.stopLive();
    this.mount(
      'error',
      h('main', { class: 'page center' }, h('h2', { text: title }), h('p', { class: 'msg', text: message }), h('button', { class: 'btn primary', text: 'Zurück', onclick: () => this.showStart() }), this.disclaimer()),
    );
  }

  // ───────────────────────── Live-Ansicht ─────────────────────────

  private liveEls!: {
    stage: HTMLElement;
    wrap: HTMLElement;
    banner: HTMLElement;
    count: HTMLElement;
    flash: HTMLElement;
    rows: Map<string, { li: HTMLElement; ico: HTMLElement; msg: HTMLElement; detail: HTMLElement }>;
    timerBtn: HTMLButtonElement;
    shutterBtn: HTMLButtonElement;
    zoom: HTMLInputElement;
    zoomLabel: HTMLElement;
    zoomBox: HTMLElement;
    hold: HTMLElement;
  };

  private async startCamera(): Promise<void> {
    unlockAudio();
    try {
      this.buildLive();
      await this.camera.start('environment');
      await this.afterCameraStart();
    } catch (e) {
      this.fatal('Kamera nicht verfügbar', (e as { userMessage?: string }).userMessage ?? 'Die Kamera konnte nicht gestartet werden.');
    }
  }

  private async afterCameraStart(): Promise<void> {
    const r = this.camera.zoomRange;
    this.liveEls.zoomBox.hidden = r.max <= 1;
    this.liveEls.zoom.min = String(r.min);
    this.liveEls.zoom.max = String(r.max);
    this.liveEls.zoom.step = String(r.step);
    this.liveEls.zoom.value = '1';
    this.liveEls.zoomLabel.textContent = '1,0×';
    this.fitStage();
    try {
      this.wakeLock = (await (navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<{ release(): Promise<void> }> } }).wakeLock?.request('screen')) ?? null;
    } catch {
      this.wakeLock = null;
    }
    this.liveEls.banner.textContent = this.analyzer ? 'Gesicht in die Schablone bringen' : 'Erkennungs-Engine wird geladen …';
    void this.engine.then(() => {
      if (this.screen === 'live') this.startLoop();
    });
  }

  private buildLive(): void {
    const video = this.camera.video;
    const canvas = h('canvas', { class: 'overlay' });
    this.overlay = new Overlay(canvas);
    const banner = h('div', { class: 'banner', role: 'status', 'aria-live': 'polite' });
    const count = h('div', { class: 'countdown', hidden: true });
    const flash = h('div', { class: 'flash' });
    const hold = h('div', { class: 'hold' }, h('i'));
    const stage = h('div', { class: 'stage' }, video, canvas, banner, hold, count, flash);
    const wrap = h('div', { class: 'stage-wrap' }, stage);

    const rows: typeof this.liveEls.rows = new Map();
    const list = h('ul', { class: 'checks' });
    for (const c of LIVE_ROWS) {
      const ico = h('span', { class: 'ico', html: statusIcon('unknown') });
      const msg = h('span', { class: 'msg', text: '–' });
      const detail = h('div', { class: 'detail', hidden: true });
      const li = h('li', { class: 's-unknown', tabIndex: 0, role: 'button', onclick: () => (detail.hidden = !detail.hidden) }, h('div', { class: 'line' }, ico, h('span', { class: 'name', text: c.label }), msg), detail);
      rows.set(c.id, { li, ico, msg, detail });
      list.append(li);
    }

    const zoomLabel = h('span', { class: 'zoom-label', text: '1,0×' });
    const zoom = h('input', {
      type: 'range',
      min: 1,
      max: 1,
      step: 0.1,
      value: 1,
      'aria-label': 'Zoom',
      oninput: () => {
        const z = Number(zoom.value);
        zoomLabel.textContent = `${z.toLocaleString('de-DE', { minimumFractionDigits: 1 })}×`;
        void this.camera.setZoom(z);
      },
    });
    const zoomBox = h('div', { class: 'zoom', hidden: true }, h('span', { text: 'Zoom' }), zoom, zoomLabel);

    const auto = h('input', { type: 'checkbox', checked: this.autoOn, onchange: () => {
      this.autoOn = auto.checked;
      store.set('auto', this.autoOn);
      this.greenSince = null;
    } });
    const flip = h('button', { class: 'btn round', 'aria-label': 'Kamera wechseln', title: 'Kamera wechseln', html: ICON.flip, onclick: () => void this.flipCamera() });
    const timerBtn = h('button', { class: 'btn round', 'aria-label': 'Selbstauslöser 3 Sekunden', title: 'Selbstauslöser (3 s)', html: ICON.timer, onclick: () => this.toggleCountdown() });
    const shutterBtn = h('button', { class: 'shutter', 'aria-label': 'Foto aufnehmen', title: 'Foto aufnehmen', onclick: () => void this.capture() });
    const back = h('button', { class: 'btn round', 'aria-label': 'Zurück', title: 'Zurück', html: ICON.retry, onclick: () => this.showStart() });

    this.liveEls = { stage, wrap, banner, count, flash, rows, timerBtn, shutterBtn, zoom, zoomLabel, zoomBox, hold };

    this.mount(
      'live',
      h(
        'div',
        { class: 'live' },
        wrap,
        h('div', { class: 'live-scroll' }, list, this.disclaimer()),
        h(
          'div',
          { class: 'controls' },
          zoomBox,
          h('label', { class: 'switch' }, auto, h('span', { class: 'track' }), h('span', { text: `Auto-Auslöser (alle Kriterien ${CONFIG.live.autoHoldMs / 1000} s grün)` })),
          h('div', { class: 'ctl-row' }, back, flip, shutterBtn, timerBtn),
        ),
      ),
    );
  }

  /** Bühne so groß wie möglich bei Seitenverhältnis des Videos. */
  private fitStage(): void {
    if (this.screen !== 'live' || !this.liveEls) return;
    const { w, h: vh } = this.camera.videoSize;
    if (!w || !vh) return;
    const wrap = this.liveEls.wrap;
    const availW = wrap.clientWidth;
    const availH = wrap.clientHeight;
    const ar = w / vh;
    let sw = availW;
    let sh = sw / ar;
    if (sh > availH) {
      sh = availH;
      sw = sh * ar;
    }
    this.liveEls.stage.style.width = `${Math.floor(sw)}px`;
    this.liveEls.stage.style.height = `${Math.floor(sh)}px`;
    this.camera.applyPreviewTransform();
  }

  private async flipCamera(): Promise<void> {
    if (this.busy) return;
    this.loopId++;
    try {
      await this.camera.start(this.camera.facing === 'environment' ? 'user' : 'environment');
      await this.afterCameraStart();
    } catch (e) {
      this.fatal('Kamera nicht verfügbar', (e as { userMessage?: string }).userMessage ?? 'Die Kamera konnte nicht gestartet werden.');
    }
  }

  private stopLive(): void {
    this.loopId++;
    this.busy = false;
    this.countdown = null;
    this.greenSince = null;
    this.camera.stop();
    void this.wakeLock?.release().catch(() => undefined);
    this.wakeLock = null;
  }

  private startLoop(): void {
    const id = ++this.loopId;
    const tick = async () => {
      if (id !== this.loopId || this.screen !== 'live') return;
      const t0 = performance.now();
      try {
        if (!this.busy) this.liveFrame();
      } catch (e) {
        console.error('Live-Analyse:', e);
      }
      const wait = Math.max(0, 1000 / CONFIG.live.fps - (performance.now() - t0));
      setTimeout(tick, wait);
    };
    void tick();
  }

  private lastSummary: Summary | null = null;

  private liveFrame(): void {
    const an = this.analyzer;
    if (!an || !this.camera.running) return;
    const { w, h: vh } = this.camera.videoSize;
    if (!w || !vh) return;
    const src = this.camera.frameSource();
    const a = an.analyze(src, { maxSide: CONFIG.live.analysisMaxSide, eyeRoi: true });
    const region = templateRegion(a.width, a.height);
    const results = evaluate(a, {
      region,
      mirrored: this.camera.mirrored,
      facing: this.camera.facing,
      zoom: this.camera.totalZoom,
    });
    const live = results.filter((r) => r.id !== 'resolution');
    const sum = summarize(live, CONFIG.live.autoAllowWarn);
    this.lastSummary = sum;
    this.updateRows(live);
    this.overlay?.draw({
      region,
      aw: a.width,
      ah: a.height,
      status: sum.status,
      face: a.face,
      personMask: a.personMask,
      mirrored: this.camera.mirrored,
    });

    // Hinweisband
    const hints = topHints(live, 2);
    const banner = this.liveEls.banner;
    banner.className = `banner s-${sum.passed ? 'ok' : sum.status}`;
    if (this.countdown === null) {
      banner.textContent = sum.passed
        ? this.autoOn
          ? 'Perfekt – bitte nicht bewegen'
          : 'Alles in Ordnung – jetzt auslösen'
        : hints.length
          ? hints.join(' · ')
          : 'Gesicht in die Schablone bringen';
    }

    // Auto-Auslösung
    const now = performance.now();
    if (sum.passed && this.countdown === null) {
      this.greenSince ??= now;
      const held = now - this.greenSince;
      this.liveEls.hold.style.setProperty('--p', this.autoOn ? String(Math.min(1, held / CONFIG.live.autoHoldMs)) : '0');
      if (this.autoOn && held >= CONFIG.live.autoHoldMs) {
        this.greenSince = null;
        void this.capture();
      }
    } else {
      this.greenSince = null;
      this.liveEls.hold.style.setProperty('--p', '0');
    }
  }

  private updateRows(results: CheckResult[]): void {
    const byId = new Map(results.map((r) => [r.id, r]));
    for (const [id, row] of this.liveEls.rows) {
      const r = byId.get(id as CheckResult['id']);
      const status: Status = r?.status ?? 'unknown';
      if (row.li.dataset.s !== status) {
        row.li.dataset.s = status;
        row.li.className = `s-${status}`;
        row.ico.innerHTML = statusIcon(status);
      }
      const text = !r ? '–' : status === 'ok' ? r.value : r.hint || r.value;
      if (row.msg.textContent !== text) row.msg.textContent = text;
      const detail = r ? `Messwert: ${r.value}${r.target ? ` · Soll: ${r.target}` : ''}` : '';
      if (row.detail.textContent !== detail) row.detail.textContent = detail;
    }
  }

  // ───────────────────────── Aufnahme ─────────────────────────

  private toggleCountdown(): void {
    unlockAudio();
    if (this.countdown !== null) {
      this.cancelCountdown();
      return;
    }
    void this.runCountdown();
  }

  private cancelCountdown(): void {
    this.countdown = null;
    this.liveEls.count.hidden = true;
    this.liveEls.timerBtn.classList.remove('active');
  }

  private async runCountdown(): Promise<void> {
    const total = CONFIG.live.countdownSeconds;
    this.countdown = total;
    this.liveEls.timerBtn.classList.add('active');
    for (let n = total; n >= 1; n--) {
      if (this.countdown === null) return; // abgebrochen
      this.countdown = n;
      this.liveEls.count.hidden = false;
      this.liveEls.count.textContent = String(n);
      this.liveEls.banner.className = 'banner s-warn';
      this.liveEls.banner.textContent = 'Selbstauslöser – Position halten';
      beep(n === 1 ? 1000 : 700, 140);
      await sleep(1000);
    }
    if (this.countdown === null) return;
    this.cancelCountdown();
    await this.capture();
  }

  private async capture(): Promise<void> {
    if (this.busy || this.screen !== 'live') return;
    unlockAudio();
    this.busy = true;
    this.cancelCountdown();
    const blobs: Blob[] = [];
    try {
      this.liveEls.banner.className = 'banner s-ok';
      this.liveEls.banner.textContent = 'Nicht bewegen …';
      for (let i = 0; i < CONFIG.live.burstCount; i++) {
        if (i === 0) shutter();
        this.liveEls.flash.classList.remove('go');
        void this.liveEls.flash.offsetWidth;
        this.liveEls.flash.classList.add('go');
        this.liveEls.banner.textContent = `Nicht bewegen … ${i + 1}/${CONFIG.live.burstCount}`;
        blobs.push(await this.camera.captureStill());
        if (i < CONFIG.live.burstCount - 1) await sleep(CONFIG.live.burstGapMs);
      }
    } catch (e) {
      console.error(e);
      this.busy = false;
      this.fatal('Aufnahme fehlgeschlagen', 'Das Foto konnte nicht aufgenommen werden. Bitte noch einmal versuchen.');
      return;
    }
    const meta: CaptureMeta = { facing: this.camera.facing, hwZoom: this.camera.hwZoom, estimateDistance: true };
    this.stopLive();
    await this.process(blobs, meta);
  }

  private async importFile(input: HTMLInputElement): Promise<void> {
    const f = input.files?.[0];
    input.value = '';
    if (!f) return;
    await this.process([f], { facing: 'environment', hwZoom: 1, estimateDistance: false });
  }

  // ───────────────────────── Auswertung ─────────────────────────

  private showBusy(text: string, sub = ''): HTMLElement {
    const t = h('p', { class: 'msg', text });
    const s = h('p', { class: 'sub', text: sub });
    this.mount('busy', h('main', { class: 'page center' }, h('div', { class: 'spinner', role: 'progressbar', 'aria-label': 'Auswertung läuft' }), t, s, this.disclaimer()));
    return t;
  }

  /** Bildreihe auswerten, bestes Bild wählen, zuschneiden, Bericht erstellen. */
  async process(blobs: Blob[], meta: CaptureMeta): Promise<void> {
    this.meta = meta;
    this.showBusy('Auswertung läuft …', 'Alles passiert lokal auf diesem Gerät.');
    let an: Analyzer;
    try {
      an = await this.engine;
    } catch {
      this.fatal('Engine nicht geladen', this.engineText);
      return;
    }
    const msg = this.root.querySelector('.msg');
    try {
      this.evals = [];
      for (let i = 0; i < blobs.length; i++) {
        if (msg) msg.textContent = blobs.length > 1 ? `Bild ${i + 1} von ${blobs.length} wird geprüft …` : 'Foto wird geprüft …';
        await sleep(30); // UI atmen lassen
        this.evals.push(await evaluateStill(an, blobs[i], meta));
      }
      const candidates = this.evals.map((e, i) => ({ e, i })).filter((c) => c.e.hasFace);
      if (!candidates.length) {
        this.fatal('Kein Gesicht erkannt', 'In den Aufnahmen war kein einzelnes Gesicht zu erkennen. Bitte mit besserem Licht und frontal zur Kamera noch einmal versuchen.');
        return;
      }
      candidates.sort((p, q) => q.e.summary.score - p.e.summary.score);
      await this.finalize(candidates[0].i);
    } catch (e) {
      console.error(e);
      this.fatal('Auswertung fehlgeschlagen', 'Das Bild konnte nicht ausgewertet werden. Bitte noch einmal versuchen.');
    }
  }

  private async finalize(index: number): Promise<void> {
    const an = await this.engine;
    const msg = this.root.querySelector('.msg');
    if (msg) msg.textContent = 'Foto wird zugeschnitten und geprüft …';
    await sleep(30);
    const pick = { index, of: this.evals.length, scores: this.evals.map((e) => e.summary.score) };
    const fin = await buildFinal(an, this.evals[index].blob, this.meta, pick);
    if (!fin) {
      this.fatal('Zuschnitt nicht möglich', 'Das Gesicht wurde im ausgewählten Bild nicht erkannt.');
      return;
    }
    this.final = fin;
    this.finalBlob = await canvasToJpeg(fin.canvas, CONFIG.output.jpegQuality, CONFIG.output.dpi);
    this.showResult();
  }

  // ───────────────────────── Ergebnis ─────────────────────────

  private releaseUrls(): void {
    this.objectUrls.forEach((u) => URL.revokeObjectURL(u));
    this.objectUrls = [];
  }

  private url(blob: Blob): string {
    const u = URL.createObjectURL(blob);
    this.objectUrls.push(u);
    return u;
  }

  private showResult(): void {
    const fin = this.final as FinalResult;
    const blob = this.finalBlob as Blob;
    this.releaseUrls();
    const sum = fin.summary;
    const t = CONFIG.template;
    const pos = (y: number) => `${(y * 100).toFixed(2)}%`;
    const guides = h(
      'div',
      { class: 'guides', hidden: true },
      ...(
        [
          [t.chinY - t.headRatio, 'Scheitel'],
          [(CONFIG.checks.position.eyeLine.ok[0] + CONFIG.checks.position.eyeLine.ok[1]) / 2, 'Augen'],
          [t.chinY, 'Kinn'],
        ] as const
      ).map(([y, label]) => h('div', { class: 'gl', style: `top:${pos(y)}` }, h('span', { text: label }))),
    );
    const img = h('img', { src: this.url(blob), alt: 'Fertiges Passbild 35 × 45 mm', width: CONFIG.output.widthPx, height: CONFIG.output.heightPx });
    const guideBtn = h('button', { class: 'btn small', text: 'Hilfslinien', 'aria-pressed': 'false', onclick: () => {
      guides.hidden = !guides.hidden;
      guideBtn.setAttribute('aria-pressed', String(!guides.hidden));
    } });

    // „offen“ (z. B. Abstand bei importierten Fotos) zählt nicht als Mangel, wird aber genannt
    const openOnes = fin.results.filter((r) => r.status === 'unknown').map((r) => r.label);
    const verdictStatus: Status = sum.status === 'unknown' ? 'ok' : sum.status;
    const verdict = h(
      'div',
      { class: `verdict s-${verdictStatus}` },
      h('span', { class: 'ico', html: statusIcon(verdictStatus) }),
      h(
        'div',
        {},
        h('strong', {
          text:
            verdictStatus === 'ok'
              ? 'Alle automatischen Prüfungen bestanden'
              : verdictStatus === 'warn'
                ? 'Fast geschafft – einzelne Werte sind knapp'
                : 'Nicht alle Kriterien erfüllt – besser neu aufnehmen',
        }),
        h('div', { class: 'dim', text: `Gesamtwertung ${(sum.score * 100).toFixed(0)} %${openOnes.length ? ` · nicht beurteilbar: ${openOnes.join(', ')}` : ''} · ${DISCLAIMER}` }),
      ),
    );

    // Burst-Auswahl
    const thumbs =
      this.evals.length > 1
        ? h(
            'section',
            { class: 'card' },
            h('h2', { text: 'Aufnahmen im Vergleich' }),
            h('p', { class: 'dim', text: 'Das beste Bild wurde automatisch gewählt. Tippen, um ein anderes zu verwenden.' }),
            h(
              'div',
              { class: 'thumbs' },
              ...this.evals.map((e, i) =>
                h(
                  'button',
                  {
                    class: `thumb${i === fin.pick.index ? ' sel' : ''}`,
                    'aria-label': `Bild ${i + 1}, Wertung ${(e.summary.score * 100).toFixed(0)} Prozent`,
                    onclick: () => {
                      if (i !== fin.pick.index) void this.reselect(i);
                    },
                  },
                  h('img', { src: this.url(e.thumb ?? e.blob), alt: '' }),
                  h('span', { text: `${i + 1} · ${(e.summary.score * 100).toFixed(0)} %` }),
                ),
              ),
            ),
          )
        : null;

    // Druckbogen
    const sheetImg = h('img', { class: 'sheet-prev', alt: 'Vorschau Druckbogen' });
    const countSel = h(
      'select',
      { 'aria-label': 'Anzahl Fotos', onchange: () => {
        this.sheetCount = Number(countSel.value);
        store.set('sheetCount', this.sheetCount);
        void refreshSheet();
      } },
      ...CONFIG.sheet.counts.map((n) => h('option', { value: n, text: `${n} Fotos`, selected: n === this.sheetCount })),
    );
    const dpiSel = h(
      'select',
      { 'aria-label': 'Auflösung', onchange: () => {
        this.sheetDpi = Number(dpiSel.value);
        store.set('sheetDpi', this.sheetDpi);
        void refreshSheet();
      } },
      ...Object.entries(CONFIG.sheet.sizes).map(([dpi, s]) => h('option', { value: dpi, text: `${dpi} dpi (${s.width} × ${s.height} px)`, selected: Number(dpi) === this.sheetDpi })),
    );
    let sheetBlob: Blob | null = null;
    const refreshSheet = async () => {
      const c = buildSheet(fin.canvas, this.sheetCount, this.sheetDpi);
      sheetBlob = await canvasToJpeg(c, CONFIG.output.jpegQuality, this.sheetDpi);
      sheetImg.src = this.url(sheetBlob);
    };
    void refreshSheet();

    const share = canShareFiles();
    const stamp = new Date().toISOString().slice(0, 10);
    const actions = h(
      'div',
      { class: 'actions col' },
      h('button', { class: 'btn primary big', onclick: () => downloadBlob(blob, `passbild-35x45-${stamp}.jpg`) }, h('span', { class: 'bi', html: ICON.download }), `Passbild speichern (${CONFIG.output.widthPx} × ${CONFIG.output.heightPx})`),
      share ? h('button', { class: 'btn', onclick: () => void shareBlob(blob, `passbild-35x45-${stamp}.jpg`) }, h('span', { class: 'bi', html: ICON.share }), 'Teilen / in Fotos sichern') : null,
    );

    this.mount(
      'result',
      h(
        'main',
        { class: 'page result' },
        h('h1', { text: 'Dein Passbild' }),
        verdict,
        h('div', { class: 'photo-wrap' }, h('div', { class: 'photo' }, img, guides), h('div', { class: 'photo-tools' }, guideBtn)),
        actions,
        thumbs,
        h(
          'section',
          { class: 'card' },
          h('h2', { text: 'Druckbogen 10 × 15 cm' }),
          h('p', { class: 'dim', text: 'Zum Ausdrucken am Fotoautomaten oder Drogeriemarkt. Beim Druck „100 % / ohne Anpassung“ wählen, damit jedes Foto 35 × 45 mm groß bleibt.' }),
          h('div', { class: 'row' }, countSel, dpiSel),
          sheetImg,
          h('div', { class: 'actions col' },
            h('button', { class: 'btn primary', onclick: () => sheetBlob && downloadBlob(sheetBlob, `passbogen-10x15-${this.sheetCount}x-${this.sheetDpi}dpi-${stamp}.jpg`) }, h('span', { class: 'bi', html: ICON.sheet }), 'Druckbogen speichern'),
            share ? h('button', { class: 'btn', onclick: () => sheetBlob && void shareBlob(sheetBlob, `passbogen-10x15-${stamp}.jpg`) }, h('span', { class: 'bi', html: ICON.share }), 'Bogen teilen') : null,
          ),
        ),
        h('section', { class: 'card' }, h('h2', { text: 'Prüfbericht' }), renderReport(fin.results), this.limitNote(fin)),
        h('div', { class: 'actions col' }, h('button', { class: 'btn', onclick: () => this.showStart() }, h('span', { class: 'bi', html: ICON.retry }), 'Neues Foto aufnehmen')),
        this.disclaimer(),
      ),
    );
  }

  private limitNote(fin: FinalResult): HTMLElement {
    const notes: string[] = [];
    if (fin.plan.adjusted === 'shifted') notes.push('Der Ausschnitt musste leicht verschoben werden, weil neben dem Kopf zu wenig Bild war.');
    if (fin.plan.adjusted === 'tightened') notes.push('Der Kopf ist im Original zu groß für den Ausschnitt – bitte weiter weg oder herauszoomen. Der Kopf erscheint deshalb größer als vorgesehen.');
    if (Math.abs(fin.plan.levelDeg) > 0.05) notes.push(`Bild um ${Math.abs(fin.plan.levelDeg).toLocaleString('de-DE', { maximumFractionDigits: 1 })}° begradigt (reine Drehung, keine Retusche).`);
    notes.push('Es wird nichts retuschiert: nur Zuschnitt, Skalierung und eine kleine Drehung.');
    return h('p', { class: 'dim note', text: notes.join(' ') });
  }

  private async reselect(i: number): Promise<void> {
    this.showBusy('Foto wird zugeschnitten und geprüft …');
    try {
      await this.finalize(i);
    } catch (e) {
      console.error(e);
      this.fatal('Auswertung fehlgeschlagen', 'Das Bild konnte nicht ausgewertet werden.');
    }
  }

  // ───────────────────────── Entwicklung ─────────────────────────

  /** Nur für Tests im Browser (window.__passbild). */
  get debug() {
    return {
      camera: this.camera,
      analyzer: () => this.analyzer,
      summary: () => this.lastSummary,
      final: () => this.final,
      evals: () => this.evals,
      CONFIG,
      STATUS_COLOR,
      STATUS_TEXT,
    };
  }
}
