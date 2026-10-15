type Child = Node | string | null | undefined | false;

/** Kleine Hilfe zum Bauen von DOM-Knoten ohne Framework. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, unknown> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = String(v);
    else if (k === 'text') el.textContent = String(v);
    else if (k === 'html') el.innerHTML = String(v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    else if (k in el && k !== 'list' && k !== 'style') (el as unknown as Record<string, unknown>)[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return el;
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** localStorage ohne Absturz (privater Modus, gesperrte Cookies). */
export const store = {
  get<T>(key: string, fallback: T): T {
    try {
      const raw = localStorage.getItem('passbild:' + key);
      return raw === null ? fallback : (JSON.parse(raw) as T);
    } catch {
      return fallback;
    }
  },
  set(key: string, value: unknown): void {
    try {
      localStorage.setItem('passbild:' + key, JSON.stringify(value));
    } catch {
      /* ignorieren */
    }
  },
};
