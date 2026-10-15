import type { CheckResult } from '../types';
import { h } from './dom';
import { STATUS_TEXT, statusIcon } from './icons';

/** Prüfbericht: je Kriterium Messwert, Sollbereich und Status (Symbol + Text, nicht nur Farbe). */
export function renderReport(results: CheckResult[]): HTMLElement {
  return h(
    'ul',
    { class: 'report' },
    ...results.map((r) =>
      h(
        'li',
        { class: `rep-row s-${r.status}` },
        h('span', { class: 'ico', html: statusIcon(r.status), title: STATUS_TEXT[r.status] }),
        h(
          'div',
          { class: 'rep-body' },
          h('div', { class: 'rep-head' }, h('strong', { text: r.label }), h('span', { class: 'badge', text: STATUS_TEXT[r.status] })),
          h('div', { class: 'rep-line' }, h('span', { class: 'k', text: 'Messwert' }), h('span', { text: r.value })),
          r.target ? h('div', { class: 'rep-line dim' }, h('span', { class: 'k', text: 'Soll' }), h('span', { text: r.target })) : null,
          r.hint ? h('div', { class: 'rep-hint', text: r.hint }) : null,
        ),
      ),
    ),
  );
}
