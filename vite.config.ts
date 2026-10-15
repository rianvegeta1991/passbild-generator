import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

/**
 * Erzeugt beim Build den Service Worker aus sw.template.js und trägt die
 * (gehashten) Dateien der App als Vorab-Cache ein. Modelle und WASM kommen
 * zur Laufzeit dazu (siehe Vorlage).
 */
function serviceWorkerPlugin(): Plugin {
  return {
    name: 'passbild-service-worker',
    apply: 'build',
    generateBundle(_opts, bundle) {
      const dateien = new Set<string>(['./', './manifest.webmanifest', './icon-192.png', './icon-512.png', './icon-maskable-512.png', './apple-touch-icon.png', './icon.svg']);
      for (const name of Object.keys(bundle)) dateien.add('./' + name);
      const liste = [...dateien].sort();
      const version = createHash('sha1').update(liste.join('|')).update(
        Object.values(bundle).map((b) => ('code' in b ? b.code : String(b.source))).join(''),
      ).digest('hex').slice(0, 10);
      const vorlage = readFileSync('sw.template.js', 'utf8');
      const quelle = vorlage
        .replace('__VERSION__', version)
        .replace('__PRECACHE__', JSON.stringify(liste));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: quelle });
    },
  };
}

export default defineConfig({
  base: './',
  build: { target: 'es2022', sourcemap: false },
  plugins: [serviceWorkerPlugin()],
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
});
