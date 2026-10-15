# Passbild-Generator

PWA für biometrische Passfotos (35 × 45 mm, Führerschein): Live-Assistent mit Kamera, Prüfungen,
automatischer Zuschnitt, Export als JPEG und Druckbogen 10 × 15 cm. **Deutsch ist die Quellsprache**
(UI, Code-Kommentare, Commits). Details für Nutzer stehen in `README.md`.

## Ordner und Werkzeuge

- Arbeitsordner: `C:\Users\Bastian\Claude Data\passbild-generator\`. **Noch kein GitHub-Repo, nichts gepusht.**
- Anders als die übrigen Projekte (Vanilla, kein Node) ist das hier ausdrücklich **Vite + TypeScript + Vitest**.
  Node ist **nicht installiert**; es liegt portabel unter `C:\Users\Bastian\tools\node` (v24, SHA-256 geprüft).
  In der Shell erst `export PATH="/c/Users/Bastian/tools/node:$PATH"`, dann `npm run dev|test|build`.
- Dev-Server: `preview_start` mit `passbild-generator` (Port **8800**, Vite) oder `passbild-generator-dist`
  (Port **8801**, `vite preview` auf `dist/`). Beide Einträge stehen in `Claude Data/.claude/launch.json`.
- **Bash-Heredocs mit Sonderzeichen sind hier unzuverlässig** – Dateien mit dem Write-Werkzeug schreiben.
- Icons: `powershell -File icons.ps1` (System.Drawing); bei Logoänderung `public/icon.svg` **und** das Skript anpassen.
  Achtung PowerShell ist case-insensitiv: eine Variable `$ecken` überschrieb den Parameter `$Ecken`.

## Architektur

`camera/` (Stream, Zoom, `takePhoto`) → `detection/analyzer.ts` (MediaPipe, ein Bild → `Analysis`) →
`detection/evaluate.ts` (`Analysis` + Umgebung → `CheckInput`) → `checks/*` (reine Funktionen, je Kriterium
`CheckInput` → `CheckResult`; `checks/index.ts` bündelt und bewertet) → `ui/*`. `pipeline.ts` wertet einen Burst
aus, wählt das beste Bild, plant den Zuschnitt (`export/crop.ts`) und prüft das fertige 827 × 1063-Bild erneut.

- **Alle Schwellwerte in `src/config.ts`** (Bereich `ok` = grün, `warn` = gelb, sonst rot; `grade()` in `checks/common.ts`).
- Landmarks sind normiert (0..1); Prüfungen rechnen mit Pixelmaßen des Analysebilds (`width`/`height`), nie im Normraum.
- Das Analysebild ist **unverspiegelt**. Links/Rechts-Hinweise werden über `screenSide(…, mirrored)` in die
  Bildschirmsicht umgerechnet (Frontkamera-Vorschau ist ein Spiegel).
- Vorzeichen (Matrix, spaltenweise): `yaw > 0` Gesicht zeigt zur Bildrechten, `pitch > 0` Blick nach oben,
  `roll > 0` Kopf oben zur Bildlinken geneigt. **Roll-Vorzeichen am Echtbild bestätigt** (Foto um 10° gedreht → −9°);
  Yaw und Pitch folgen derselben Konvention, ihre absolute Richtung ist nicht unabhängig bestätigt.
- Das Segmentierungsmodell liefert eine Kategoriemaske ohne feste Semantik – „Person“ ist der Wert an der Nasenspitze
  (`Analyzer.segment`). Nicht auf `1` festnageln.
- Der Zuschnitt erfindet **nie Pixel**: erst verschieben, dann enger ziehen (`adjusted: 'shifted' | 'tightened'`).
- Schärfe ist belichtungsbereinigt (Laplace-Varianz × (128/Mittelwert)²) und am Beispielbild kalibriert
  (scharf ≈ 1500, 1 px Unschärfe ≈ 90, 2 px ≈ 9). Die Schwelle 250/90 ist **nicht** an echten Handyfotos geeicht.
- Service Worker: `sw.template.js` → `vite.config.ts` trägt die Dateiliste ein und erzeugt `dist/sw.js`. Modelle/WASM
  liegen im eigenen Cache `passbild-modelle-v1` (überlebt App-Updates). Die App-Registrierung darf den Start nie
  blockieren (3-s-Grenze in `main.ts`) – sonst bleibt die Seite offline leer.

## Farben und Rot-Grün-Schwäche

Bastian ist rot-grün-schwach: Status nie nur über Farbe. `ui/icons.ts` gibt Form + Farbe (Kreis ✓ hellblaugrün,
Dreieck ! bernstein, Quadrat ✕ kräftiges Rot); die Luminanz fällt von ok (≈ 0,66) über warn (≈ 0,47) auf fail
(≈ 0,20). Der Ovalrand im Overlay unterscheidet sich zusätzlich durch Strichart. Neue Statusanzeigen genauso bauen.

## Testen

- `npm test`: Unit-Tests mit synthetischen Landmarks/Bildern (`tests/helpers.ts`).
- Im Browser ohne Kamera: `http://localhost:8800/?fake=/dev/portrait.jpg` (nur Dev; `dev/` ist gitignored, das Bild
  stammt von `storage.googleapis.com/mediapipe-assets/portrait.jpg`). Debug-Zugriff: `window.__passbild.debug`.
- `img.decode()` hängt im eingebetteten Browser – `onload` verwenden.
- **Nicht getestet:** echte Handykamera, `takePhoto`, Hardware-Zoom, iOS Safari, Gerätedrehung, Selbstauslöser mit Ton am Gerät.
