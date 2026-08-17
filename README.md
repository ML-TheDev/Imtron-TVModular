# PEAQ – Modularer Video-Konfigurator

Lokale Web-Anwendung: Passwortabfrage → Dashboard mit Modulleiste, Video-Tausch und
durchlaufendem Gesamtvideo.

## Starten

Doppelklick auf **Start.cmd** (benötigt Node.js, ist auf diesem Rechner vorhanden).
Der Browser öffnet automatisch `http://localhost:8123/app/`.

Manuell:

```bash
node server.js
```

Passwort: **PEAQtv57** (in [app/js/config.js](app/js/config.js) änderbar).

## Aufbau

| Datei | Zweck |
| --- | --- |
| [app/index.html](app/index.html) | Zugangsseite: Logo links oben, schwarzer Button → Passwortfeld |
| [app/dashboard.html](app/dashboard.html) | Dashboard: Modulleiste + Gesamtvideo, „MODULAUSWAHL" rechts oben |
| [app/js/config.js](app/js/config.js) | Passwort, Clip-Bibliothek, Modul-Slots |
| [app/js/dashboard.js](app/js/dashboard.js) | Modulleiste, Tausch-Logik, Playback über alle Module |
| [app/js/render.js](app/js/render.js) | Insert-Darstellung und Rendern im Browser (WebCodecs) |
| `app/vendor/` | mp4box.js und mp4-muxer (MIT) für das Rendern im Browser |
| [app/css/style.css](app/css/style.css) | Gestaltung (Verlauf #b4b0a9 → #d3d1cd, Module #d6d4d0, OCR-A) |
| [server.js](server.js) | Statischer Server mit Range-Support (Scrubbing) + Export-Schnittstelle |
| `Export/` | Zielordner der exportierten Gesamtvideos |

Die Videos werden direkt aus `Footage/Modul Videos/` gelesen – nichts wird kopiert.

## Fernseher-Auswahl

Oben rechts, links neben „MODULAUSWAHL", steht ein schwarzer Knopf mit der
Gerätebezeichnung und einem grauen Pfeil. Er öffnet eine Liste – derzeit mit einem
Gerät: **PTV 43GQU-5026T 43D3200U+P20**. Weitere Fernseher einfach in
[app/js/config.js](app/js/config.js) unter `tvs` ergänzen:

```js
tvs: [
  { id: 'ptv-43gqu-5026t', name: 'PTV 43GQU-5026T 43D3200U+P20' },
  { id: 'ptv-55xyz',       name: 'PTV 55XYZ-…' }
]
```

Die Wahl wird gespeichert und im Layout-JSON als `fernseher` mitgeschrieben.

## Bedienung

* **Ziehen** – Modul horizontal an eine andere Stelle schieben. Sobald die Mitte eines anderen Moduls überschritten wird, rutscht dieses weich zur Seite und gibt den Platz frei. Der Modulname gehört zum Video (Nummer aus dem Dateinamen) und wandert beim Verschieben mit.
* **Modul-Kästchen anklicken** – springt im Gesamtvideo an den Anfang dieses Moduls
* **✕ rechts oben am Video** – Modul ausgrauen (fliegt aus Timeline, Gesamtlänge und Export); der Button wird zu **+** zum Wiedereinschalten
* **Schwarze Leiste unter dem Modul (V1 / V2)** – Variante umschalten. Sie erscheint nur bei Clips, die „Variante" im Dateinamen tragen.
* **Doppelklick auf das Vorschaubild** – Auswahlmenü mit allen Clips der Bibliothek plus „EIGENES VIDEO …" (Datei vom Rechner)
* **Abspielstrich** – wandert live über die Modulkästchen; das gerade laufende Modul wird aufgehellt und hervorgehoben
* **Zeitanzeige** – aktuelle Position / Gesamtlänge aller aktiven Module
* **Tastatur** – Leertaste = Play/Pause, ←/→ = 2 Sekunden springen
* Reihenfolge und Auswahl werden im Browser gespeichert; **ZURÜCKSETZEN** stellt den Ausgangszustand her.

## Text-Inserts

Unter der Modulleiste liegt die zunächst kaum sichtbare Zeile **⊕ TEXT INSERTS**. Ein
Klick fächert in jedem Modulkästchen ein schwarzes Textfeld auf – es sitzt im Kästchen
selbst, über die volle Breite am unteren Rand, und wird beim Verschieben mitgenommen.
Darunter steht die Ausrichtung **L / M / R** (links, mittig, rechts, je mit 6 %
Randabstand).

* **Bis zu 30 Zeichen**, ab 15 Zeichen zweizeilig – umgebrochen wird am letzten Wortende davor, sonst hart.
* Schriftgröße = Bildbreite ÷ 13, Laufweite −0,03 em, Textmitte auf 57 % der Bildhöhe (knapp unter der Bildmitte).
* Bewegung: schnell von unten herein und weich auslaufend, danach ohne Stillstand langsam weiter nach oben gleitend, zum Schluss beschleunigt nach oben hinaus mit Ausblendung.

Die Eingaben werden gespeichert und beim Export eingebrannt.

Die Vorschau ist maßstabsgetreu: Der Player nimmt die volle Breite ein und lässt links
und rechts schwarze Flächen, wenn das Bild kleiner ist; die Inserts richten sich am
tatsächlichen Bildbereich aus und skalieren mit ihm – was in der Vorschau steht, sitzt
im Export an derselben Stelle.

Technisch: Die Anwendung setzt den Text im Browser in OCR-A auf ein transparentes PNG
(3840 px breit) und schickt es mit; ffmpeg legt es per `overlay` mit animierter Position
und Alpha-Blende in das Video. So sieht der Export exakt aus wie die Vorschau, und es
wird kein `drawtext`/freetype im ffmpeg-Build benötigt (der hier vorhandene hat es nicht).

## Layout speichern und laden

**LAYOUT SPEICHERN** legt die komplette Zusammenstellung als JSON ab – Reihenfolge,
gewählte Varianten, aktive Module, Text-Inserts samt Ausrichtung, Cliplängen und
Gesamtlänge. In Chrome/Edge öffnet sich dafür eine **Ordnerauswahl**; wo diese
Programmierschnittstelle fehlt, wird die Datei stattdessen heruntergeladen.

**LAYOUT LADEN** liest so eine Datei wieder ein und stellt alles wieder her. Die Clips
werden über den Dateinamen zugeordnet (ersatzweise über die Bezeichnung); fehlende
Videos werden übersprungen und in der Meldung genannt.

## Export

**EXPORT MP4 (H.264)** fügt alle aktiven Module in der aktuellen Reihenfolge zusammen,
brennt die Text-Inserts ein und startet den Download. Daneben steht die Auswahl der
Auflösung (4K oder HD). Während des Renderns zeigt ein Fenster den aktuellen Schritt,
einen Fortschrittsbalken und die Prozentzahl; **ABBRECHEN** stoppt den Lauf.

Es gibt zwei Render-Wege, die Anwendung wählt selbst:

| Weg | wann | Eigenschaften |
| --- | --- | --- |
| **ffmpeg, lokal** | wenn der lokale Server läuft und ffmpeg findet | volle ffmpeg-Qualität, kann ohne Inserts verlustfrei kopieren, Ergebnis landet in `Export/`; Fortschritt kommt aus `-progress` |
| **WebCodecs, im Browser** | online, z. B. auf Vercel | rendert im Browser mit dem Hardware-Encoder, ganz ohne Server; gemessen rund 2 s für 8 s Material in 4K, Ergebnis geht in den Download-Ordner |

Mit `?render=browser` bzw. `?render=server` an der Adresse lässt sich der Weg erzwingen.

**Browser:** Die Anwendung prüft beim Laden mit einer echten Encoder-Abfrage, was der
Browser kann, und wählt danach:

* **Chrome / Edge** – WebCodecs mit Hardware-Encoder, 4K in Sekunden.
* **Firefox / Safari** – dort fehlt ein H.264-Encoder (Patentgründe). Deshalb liegt ein
  Software-Encoder als WebAssembly bei ([app/vendor/h264-mp4-encoder.web.js](app/vendor/h264-mp4-encoder.web.js),
  minih264 + MP4-Muxer, MIT, 1,6 MB, wird nur bei Bedarf geladen). Die Bilder kommen
  über ein `<video>`-Element, der Text wird per Canvas eingebrannt. Ausgabe ist echtes
  H.264 (Baseline) in **HD**; gemessen rund **2 Minuten für 32 Sekunden Material**,
  die 4K-Auswahl entfällt in diesem Modus.
* Kann ein Rechner nur HD codieren, verschwindet die 4K-Auswahl ebenfalls.

Erzwingen lässt sich der Software-Weg mit `?render=wasm`.

Zum Rendern mit WebCodecs nutzt die Anwendung
[app/vendor/mp4box.all.min.js](app/vendor/mp4box.all.min.js) zum Demuxen sowie
[app/vendor/mp4-muxer.min.js](app/vendor/mp4-muxer.min.js) zum Schreiben der MP4 (beide
MIT-Lizenz, mitgeliefert). Größe, Laufweite, Position und Bewegung der Inserts liegen
gemeinsam in [app/js/render.js](app/js/render.js), damit Vorschau, Browser-Render und
ffmpeg-Export gleich aussehen.

Beim ffmpeg-Weg gilt: Haben alle Clips dieselbe Auflösung und denselben Codec **und ist
kein Text-Insert gesetzt**, werden sie verlustfrei aneinandergehängt (`-c copy`) – kein
Qualitätsverlust, ein bis zwei Sekunden.
Sonst wird auf die größte vorkommende Auflösung skaliert und neu codiert
(libx264 CRF 18, sonst NVENC); für 24 Sekunden 4K sind das rund 20 Sekunden.

**Bildrate:** Das gesamte Material liegt in 25 fps vor, und beide Render-Wege geben
25 fps aus – es wird also nichts umgerechnet. Der Wert steht in
[app/js/render.js](app/js/render.js) unter `CONST.FPS` sowie in [server.js](server.js)
im `fps=25` der Filterkette. Käme später Material mit einer anderen Bildrate hinzu,
müsste das angepasst werden (der Browser-Renderer setzt die Zeitstempel in festen
40-ms-Schritten und würde einen 30-fps-Clip sonst länger machen).

ffmpeg wird automatisch gesucht: PATH, Topaz-Installation, übliche Installationsordner.
Ein eigener Pfad lässt sich per Umgebungsvariable setzen:

```bash
set FFMPEG=C:\ffmpeg\bin\ffmpeg.exe && node server.js
```

Ohne ffmpeg bleibt der Export-Button deaktiviert; empfohlene Installation:
`winget install Gyan.FFmpeg`.

## Module erweitern

Die Bibliothek wird beim Aufruf direkt aus `Footage/Modul Videos/` gelesen – neue
Dateien erscheinen ohne Codeänderung. Maßgeblich ist das Namensschema:

```text
<Modulnummer> - Modul - <Name>.mp4      z. B.  1 - Modul - Intro Variante2.mp4
```

* **„Variante" im Namen** = Alternative desselben Moduls. Alle Varianten einer Modulnummer teilen sich ein Kästchen und werden über die schwarze Leiste (V1 / V2 …) umgeschaltet; in der Timeline liegt immer nur die gewählte.
* **Alle übrigen Clips** sind eigene Module und laufen nacheinander – auch mehrere mit derselben Modulnummer (z. B. Detailshot 1 und 2).
* Das Schlüsselwort steht in `server.js` unter `VARIANT_RX`.
* Die Breite der Kästchen richtet sich nach der Cliplänge, damit der Abspielstrich maßstabsgetreu läuft; bei vielen Modulen wird der Maßstab so weit verkleinert, dass alle nebeneinander passen.

Die Listen in `app/js/config.js` sind nur die Rückfalllösung, wenn die Seite ohne den
lokalen Server geöffnet wird.

## Hinweise

* Die Passwortabfrage ist eine reine Oberflächensperre im Browser (Passwort steht in
  `config.js`). Für eine echte Zugangssicherung online braucht es serverseitigen Schutz.
* Die Schrift OCR-A wird zuerst aus der lokalen Installation („OCR-A BT") geladen und
  fällt sonst auf die mitgelieferte `app/assets/ocr-a.ttf` zurück.
