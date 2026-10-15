/** Töne für Countdown und Auslöser – synthetisiert, keine Audiodateien. */
let ctx: AudioContext | null = null;

/** Muss einmal aus einer Nutzergeste heraus laufen (mobile Autoplay-Sperre). */
export function unlockAudio(): void {
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx ??= new AC();
    if (ctx.state === 'suspended') void ctx.resume();
  } catch {
    /* ohne Ton weitermachen */
  }
}

export function beep(freq = 880, ms = 120, volume = 0.25): void {
  if (!ctx) return;
  try {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    const t = ctx.currentTime;
    o.type = 'sine';
    o.frequency.value = freq;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(volume, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000);
    o.connect(g).connect(ctx.destination);
    o.start(t);
    o.stop(t + ms / 1000 + 0.02);
  } catch {
    /* ignorieren */
  }
}

/** Auslöserton: kurzer, höherer Doppelton. */
export function shutter(): void {
  beep(1320, 90, 0.3);
  setTimeout(() => beep(990, 140, 0.3), 90);
  try {
    navigator.vibrate?.(60);
  } catch {
    /* ignorieren */
  }
}
