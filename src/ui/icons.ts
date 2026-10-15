import type { Status } from '../types';

/**
 * Statussymbole: Form UND Farbe (Kreis mit Haken / Dreieck mit Ausrufezeichen /
 * Quadrat mit Kreuz). Wer Rot und Grün schlecht unterscheidet, erkennt den Status an der Form.
 */
export const STATUS_COLOR: Record<Status, string> = {
  ok: '#5eead4', // helles Blaugrün
  warn: '#f5a524', // Bernstein
  fail: '#e5383b', // kräftiges, dunkleres Rot (deutlich weniger hell als das Grün)
  unknown: '#8b97a6',
};

export const STATUS_TEXT: Record<Status, string> = {
  ok: 'in Ordnung',
  warn: 'knapp',
  fail: 'nicht erfüllt',
  unknown: 'offen',
};

export function statusIcon(status: Status): string {
  const c = STATUS_COLOR[status];
  switch (status) {
    case 'ok':
      return `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10.5" fill="${c}"/><path d="M6.8 12.4l3.6 3.6 6.8-7.2" fill="none" stroke="#06231f" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    case 'warn':
      return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.2L22.6 20.6H1.4z" fill="${c}" stroke="${c}" stroke-width="1.6" stroke-linejoin="round"/><path d="M12 9v5.2" stroke="#2b1a00" stroke-width="2.6" stroke-linecap="round"/><circle cx="12" cy="17.4" r="1.5" fill="#2b1a00"/></svg>`;
    case 'fail':
      return `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="2" width="20" height="20" rx="3.5" fill="${c}"/><path d="M7.6 7.6l8.8 8.8M16.4 7.6l-8.8 8.8" stroke="#fff" stroke-width="2.8" stroke-linecap="round"/></svg>`;
    default:
      return `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9.5" fill="none" stroke="${c}" stroke-width="2.4" stroke-dasharray="3.5 3.5"/></svg>`;
  }
}

export const ICON = {
  flip: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h13l-3-3M20 16H7l3 3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  timer:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="13.5" r="7.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 9.5v4.3l2.8 1.7M9.5 2.8h5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  image:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4.5" width="18" height="15" rx="2.5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="9" cy="10" r="1.8" fill="currentColor"/><path d="M4 17l5-4.5 3.5 3 3-2.5L20 17" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
  camera:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h3l1.6-2.4h6.8L17 8h3a1 1 0 011 1v9a1 1 0 01-1 1H4a1 1 0 01-1-1V9a1 1 0 011-1z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="12" cy="13.2" r="3.4" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
  download:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11m0 0l-4.2-4.2M12 15l4.2-4.2M5 19.5h14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  share:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V4m0 0L8.5 7.5M12 4l3.5 3.5M6 11v8h12v-8" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  retry:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 10-2.6 5.9M20 5v5.5h-5.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  sheet:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="1.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M9 5v14M15 5v14M3 12h18" stroke="currentColor" stroke-width="1.6"/></svg>',
};
