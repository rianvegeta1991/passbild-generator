# Passbild-Generator

Progressive Web App, mit der man am Smartphone (oder Laptop) ein **biometrisches Passfoto 35 × 45 mm**
aufnimmt – zum Beispiel für den deutschen Führerschein. Die App führt live zur richtigen Haltung, prüft das
Foto nach der Aufnahme, schneidet es automatisch zu und exportiert Einzelbild und Druckbogen.

> **Automatische Vorprüfung, keine Garantie für die Annahme durch die Behörde.**

## Grundsätze

- **Alles läuft lokal im Browser.** Kein Upload, keine externen KI-APIs, kein Tracking, keine Konten.
- Gesichtserkennung mit **MediaPipe Tasks Vision** (Face Landmarker mit Blendshapes und Transformationsmatrix,
  Image Segmenter für Person/Hintergrund). WASM kommt von jsDelivr, die Modelle von Google Storage – beides
  wird **einmal geladen und vom Service Worker gespeichert**. Danach funktioniert die App offline.
- **Keine Bildmanipulation am Gesicht:** keine Retusche, kein Glätten, kein Hintergrundtausch. Erlaubt sind nur
  Zuschnitt, Skalierung und eine Drehung um wenige Grad.
- Stack: Vite + TypeScript, kein UI-Framework. Oberfläche auf Deutsch, mobil zuerst.

## Funktionen

**Live-Assistent**

- Rückkamera als Standard, Umschalter auf die Frontkamera; Zoom (Hardware-Zoom, sonst digital).
- Overlay mit 35:45-Fenster, Ovalschablone und Hilfslinien für Scheitel, Augen und Kinn.
- Pro Kriterium eine Ampel mit kurzem Korrekturhinweis („Kopf leicht nach links drehen“, „Näher ran“,
  „Licht von links zu stark“, „Nicht lächeln“ …). Status ist immer an **Symbol und Text** erkennbar
  (Kreis ✓, Dreieck !, Quadrat ✕), nicht nur an der Farbe – Grün und Rot unterscheiden sich außerdem deutlich
  in der Helligkeit.
- Auslösen von Hand, **automatisch** (alle Kriterien rund 1 s grün) oder per **Selbstauslöser** (3 s Countdown
  mit Tonsignal – Handy aufs Stativ oder Regal).

**Nach der Aufnahme**

- **Burst:** 4 Bilder; das beste wird per Gesamtscore gewählt, die anderen lassen sich antippen.
- Alle Prüfungen laufen am **Standbild in voller Auflösung** noch einmal; das fertige 827 × 1063-Bild wird ein
  drittes Mal geprüft. Ergebnis: **Prüfbericht** mit Messwert, Sollbereich und Status je Kriterium.
- **Automatischer Zuschnitt** anhand der Landmarks, Kopfachse und Augenlinie werden bis 5° begradigt.
- Export: **JPEG 827 × 1063 px** (600 dpi, Druckauflösung im JPEG eingetragen) und **Druckbogen 10 × 15 cm**
  mit 4 oder 6 Fotos und dünnen Schnittmarken (1800 × 1200 px bei 300 dpi oder 3543 × 2362 px bei 600 dpi).
- „Vorhandenes Foto prüfen“ wertet auch ein Bild aus der Galerie aus (der Abstand lässt sich dort nicht
  schätzen).

## Lokal starten

Voraussetzung: **Node.js ≥ 20** (Entwicklungsrechner: portable Version unter `C:\Users\Bastian\tools\node`).

```bash
npm install
npm run dev        # http://localhost:8800
npm test           # Unit-Tests (Vitest)
npm run build      # Typprüfung + Produktions-Build nach dist/
npm run preview    # dist/ ausprobieren (http://localhost:8800)
```

**Kamera braucht HTTPS** (oder `localhost`). Zum Testen am echten Handy gibt es zwei einfache Wege:

- Handy per USB, in Chrome `chrome://inspect` aktivieren und `adb reverse tcp:8800 tcp:8800` – dann ist die Seite
  am Handy unter `http://localhost:8800` erreichbar (und damit ein sicherer Kontext).
- Die veröffentlichte HTTPS-Seite benutzen (siehe unten).

Nur für die Entwicklung gibt es `http://localhost:8800/?fake=/pfad/zum/foto.jpg`: ein Foto dient als
„Kamera“, damit sich die ganze Kette ohne Kamera testen lässt. Das ist im Produktions-Build nicht enthalten.

## Deployment (statische Seite)

`npm run build` erzeugt `dist/` mit relativen Pfaden (`base: './'`) – der Ordner läuft in jedem Unterpfad eines
statischen Webservers, **sofern er über HTTPS ausgeliefert wird**.

**GitHub Pages:** Repo anlegen, `main` pushen, unter *Settings → Pages* als Quelle „GitHub Actions“ wählen.
[`.github/workflows/pages.yml`](.github/workflows/pages.yml) führt Tests und Build aus und veröffentlicht `dist/`.

**Offline-Betrieb:** Beim ersten Besuch (online) lädt die App rund 17 MB nach – WASM (13,5 MB), Face Landmarker
(3,7 MB), Segmentierung (0,25 MB) – und legt sie im Cache `passbild-modelle-v1` ab. Die App-Dateien selbst liegen
im Cache `passbild-app-<Hash>`, der bei jedem Build neu entsteht. Die Startseite zeigt „Bereit – läuft jetzt auch
offline“, sobald die Engine geladen ist.

## Konfiguration

**Alle Schwellwerte stehen in [`src/config.ts`](src/config.ts).** Jeder Messwert hat einen grünen Bereich (`ok`)
und einen gelben Toleranzbereich (`warn`); dahinter ist er rot. Beispiele:

| Kriterium | Wert in `config.ts` | Standard |
|---|---|---|
| Kopfhaltung | `checks.pose.yaw / pitch / roll` | ±5° / ±5° / ±3° (gelb bis ±8° / ±8° / ±5°) |
| Kopfgröße | `checks.proportions.headRatio` | 71–80 % der Bildhöhe (≈ 32–36 mm) |
| Abstand | `checks.distance.cm` | grün ab 100 cm, gelb ab 70 cm |
| Lächeln / Mund / Blinzeln | `checks.expression.*` | Blendshape ≤ 0,25 / 0,08 / 0,35 |
| Licht | `checks.lighting.*` | Ø 90–200, links/rechts ≤ 15 %, Clipping ≤ 1 %, Kontrast ≥ 40 |
| Hintergrund | `checks.background.*` | Ø 165–245, Streuung ≤ 14, Sättigung ≤ 12 % |
| Schärfe | `checks.sharpness.laplacianVar` | Laplace-Varianz ≥ 250 (belichtungsbereinigt) |
| Brille | `checks.glasses.*` | nur Hinweis, nie rot |

Dazu: Ausgabegröße und JPEG-Qualität (`output`), Druckbogen (`sheet`), Modell-URLs (`models`), Bildrate,
Auto-Auslösung und Burst (`live`), Soll-Geometrie des fertigen Fotos (`template`), Scheitel-Schätzung
(`head.crownFactor`), Gewichte für die Burst-Auswahl (`weights`).

## Aufbau

```
src/
  config.ts          alle Schwellwerte, Maße, URLs
  types.ts           gemeinsame Typen
  camera/            Kamerazugriff, Zoom, Standbild-Aufnahme
  detection/         MediaPipe (Analyzer), Geometrie, Auswertung eines Bilds
  checks/            je Kriterium eine reine Funktion (+ index.ts mit Gesamtscore)
  export/            Zuschnitt, Druckbogen, JPEG mit dpi, Download/Teilen
  ui/                Oberfläche, Overlay, Prüfbericht, Töne
  pipeline.ts        Burst auswerten, bestes Bild wählen, zuschneiden, Bericht
tests/               Vitest – synthetische Landmarks und Bilder, kein Browser nötig
sw.template.js       Vorlage des Service Workers (der Build trägt die Dateiliste ein)
icons.ps1            zeichnet die PNG-Icons (auf dem Rechner gibt es keinen SVG-Renderer)
```

Die **Checks** sind reine Funktionen (`CheckInput` → `CheckResult`) ohne DOM; `tests/` prüft sie mit
synthetisch erzeugten Landmarks, Matrizen und Pixelfeldern (Grenzwerte, Hinweisrichtung, Spiegelung, Randfälle).

## Wie geprüft wird

| Kriterium | Methode |
|---|---|
| **Kopfhaltung** | Yaw/Pitch/Roll aus der Transformationsmatrix des Face Landmarkers (Zerlegung R = Ry·Rx·Rz) |
| **Kopfgröße** | Kinn (Landmark 152) bis Scheitel. Scheitel = Stirnpunkt (10) + 20 % der Strecke Kinn→Stirn, danach am oberen Rand der Personenmaske entlang der Kopfachse verfeinert. Verhältnis zur Höhe des Ausschnitts |
| **Position** | Kopfmitte, Augenlinie, Rand über Scheitel und unter Kinn |
| **Abstand** | aus dem Augenabstand (Iris zu Iris, 63 mm) mit Lochkameramodell und angenommenem Bildwinkel; bei Zoom hochgerechnet. Zu nah = Weitwinkelverzerrung („Mindestens 1–1,5 m, ggf. Zoom“) |
| **Ausdruck** | Blendshapes `mouthSmile*`, `jawOpen`, `eyeBlink*`; ohne Blendshapes Rückfall auf EAR/MAR und Mundwinkel aus den Landmarks |
| **Licht** | Luminanz im Gesichtsoval: Mittelwert, Differenz linke/rechte Hälfte, Anteil geclippter Pixel, Kontrast (P95 − P5) |
| **Hintergrund** | Maske (ohne Randstreifen um die Person) im Ausschnitt: Mittelwert, Streuung, HSV-Sättigung |
| **Schärfe** | Varianz des Laplace-Filters im Augenbereich, auf feste Breite normiert und von der Belichtung bereinigt |
| **Brille** | kleine, sehr helle Flecken im Augenbereich (ohne Hornhautreflexe in der Iris) – nur Hinweis |
| **Auflösung** | echte Bildpunkte im Ausschnitt (nur nach der Aufnahme) |

Bei der Auswahl des besten Burst-Bildes zählt ein gewichteter Gesamtscore (jede rote Prüfung wird zusätzlich
abgewertet).

## Grenzen der automatischen Prüfung

Die App ist eine **Vorprüfung**. Sie ersetzt weder die Mustertafel noch die Sichtprüfung der Behörde.

- **Die Schwellwerte sind eine Näherung** an Fotomustertafel und ICAO 9303, keine amtliche Norm. Sie sind in
  `config.ts` bewusst nachjustierbar. Ob ein Foto angenommen wird, entscheidet am Ende die Stelle, die es sieht.
- **Scheitel:** Die Kopfhöhe wird aus Landmarks und Personenmaske *geschätzt*. Volles Haar, Frisuren und die
  grobe Maske (256 × 256 px) machen das ungenau, vor allem bei Hochsteckfrisuren oder ähnlichem Haar- und Hintergrundton.
- **Augenlinie:** Bei der vorgeschriebenen Kopfhöhe von 71–80 % kann die Augenlinie nicht im oberen Drittel
  liegen – sie landet knapp über der Bildmitte (Standard 36–52 % von oben). Der Sollbereich steht in
  `checks.position.eyeLine`.
- **Abstand** ist nur eine Schätzung: Der Bildwinkel der Kamera ist unbekannt (Annahme in `config.ts`), und der
  Augenabstand variiert (Kinder!). Bei importierten Fotos entfällt er.
- **Nicken (Pitch)** hängt von der kanonischen Gesichtsform des Modells ab; ein systematischer Versatz lässt sich
  über `checks.pose.pitchOffsetDeg` ausgleichen.
- **Ausdruck:** Blendshapes unterscheiden „neutral“ nicht sicher von „leicht angespannt“. Brillenträger, sehr
  schmale Augen oder Bärte können Werte verschieben.
- **Licht und Hintergrund** werden nur an Helligkeit, Streuung und Sättigung gemessen. Ein Schlagschatten, der
  zufällig gleichmäßig ist, oder ein Muster mit gleicher Durchschnittshelligkeit bleibt unentdeckt. Rote Augen,
  Haarsträhnen vor dem Auge, Kopfbedeckung und Schmuck werden nicht geprüft.
- **Brille** ist ein reiner Hinweis auf Reflexe. Ob eine Brille zulässig ist, regeln die Behörden.
- **Kameras:** Hardware-Zoom und Fotos in voller Auflösung (`takePhoto`) gibt es vor allem in Chrome auf
  Android. In Safari/iOS bleibt es beim Videobild (meist 1080p) und beim digitalen Zoom – das Foto ist dann
  weniger scharf, die Auflösungsprüfung warnt entsprechend.
- **Druck:** Fotoautomaten und Drogerien skalieren manchmal. Beim Druck „100 %“ / „ohne Anpassung“ wählen und
  nachmessen: 35 × 45 mm.
- **Browser:** getestet mit Chromium. MediaPipe braucht WebAssembly und WebGL (sonst Rückfall auf CPU, langsamer).

## Datenschutz

Es gibt keinen Server. Fotos, Landmarks und Berichte verlassen das Gerät nicht und werden nicht gespeichert
(nur der Schalter „Auto-Auslöser“ und die Druckbogen-Wahl landen im `localStorage`). Die einzigen Netzwerkzugriffe
sind der einmalige Download von WASM und Modellen (jsDelivr, Google Storage) beim ersten Start.
