import './ui/style.css';
import { App } from './ui/app';

/**
 * Service Worker zuerst registrieren, bevor die Modelle geladen werden:
 * so landen WASM und Modelle schon beim ersten Besuch im Cache und die App läuft danach offline.
 */
async function registerServiceWorker(): Promise<void> {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  const bereit = (async () => {
    try {
      await navigator.serviceWorker.register('./sw.js');
      await navigator.serviceWorker.ready;
    } catch (e) {
      console.warn('Service Worker nicht verfügbar:', e);
    }
  })();
  // Die App darf nie an der Registrierung hängen (z. B. offline) – nach 3 s geht es auf jeden Fall weiter.
  await Promise.race([bereit, new Promise((r) => setTimeout(r, 3000))]);
}

const root = document.getElementById('app') as HTMLElement;
const app = new App(root, registerServiceWorker());
if (import.meta.env.DEV) (window as unknown as { __passbild: App }).__passbild = app;
