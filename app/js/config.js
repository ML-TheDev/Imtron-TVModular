/* ------------------------------------------------------------------
   PEAQ – Modularer Video-Konfigurator
   Zentrale Konfiguration

   Die Clip-Bibliothek liest der Server beim Aufruf direkt aus
   "Footage/Modul Videos" (Schema: "<Nr> - Modul - <Name>.mp4").
   Neue Videos dort erscheinen also automatisch in der Anwendung –
   die Listen unten dienen nur als Rückfalllösung ohne Server.
   ------------------------------------------------------------------ */

const CONFIG = {

  /* Zugangspasswort (rein clientseitig – siehe README) */
  password: 'PEAQtv57',

  /* Fernseher-Auswahl oben rechts. Weitere Geräte einfach ergänzen. */
  tvs: [
    { id: 'ptv-43gqu-5026t', name: 'PTV 43GQU-5026T 43D3200U+P20' }
  ],

  /* Rückfall-Bibliothek (Stand: 19.08.2026) */
  library: [
    { id: '1-modul-intro-variante1',   label: 'INTRO VARIANTE1',   group: 1, src: '../Footage/Modul Videos/1 - Modul - Intro Variante1.mp4' },
    { id: '1-modul-intro-variante2',   label: 'INTRO VARIANTE2',   group: 1, src: '../Footage/Modul Videos/1 - Modul - Intro Variante2.mp4' },
    { id: '2-modul-detailshot-1',      label: 'DETAILSHOT 1',      group: 2, src: '../Footage/Modul Videos/2 - Modul - Detailshot 1.mp4' },
    { id: '2-modul-detailshot-2',      label: 'DETAILSHOT 2',      group: 2, src: '../Footage/Modul Videos/2 - Modul - Detailshot 2.mp4' },
    { id: '3-modul-erlebniswelten',    label: 'ERLEBNISWELTEN',    group: 3, src: '../Footage/Modul Videos/3 - Modul - Erlebniswelten.mp4' },
    { id: '3-modul-zoom-out',          label: 'ZOOM OUT',          group: 3, src: '../Footage/Modul Videos/3 - Modul - Zoom Out.mp4' },
    { id: '4-modul-display-feature-1', label: 'DISPLAY FEATURE 1', group: 4, src: '../Footage/Modul Videos/4 - Modul - Display Feature 1.mp4' },
    { id: '4-modul-display-feature-2', label: 'DISPLAY FEATURE 2', group: 4, src: '../Footage/Modul Videos/4 - Modul - Display Feature 2.mp4' },
    { id: '5-modul-sound-feature',     label: 'SOUND FEATURE',     group: 5, src: '../Footage/Modul Videos/5 - Modul - Sound Feature.mp4' },
    { id: '5-modul-sound-feature-2',   label: 'SOUND FEATURE 2',   group: 5, src: '../Footage/Modul Videos/5 - Modul - Sound Feature 2.mp4' },
    { id: '6-modul-fernbedienung',     label: 'FERNBEDIENUNG',     group: 6, src: '../Footage/Modul Videos/6 - Modul - Fernbedienung.mp4' },
    { id: '7-modul-google-outro',      label: 'GOOGLE OUTRO',      group: 7, src: '../Footage/Modul Videos/7 - Modul - Google Outro.mp4' }
  ],

  /* Voreingestellte Modul-Slots: Clips mit "Variante" im Namen sind Alternativen
     EINES Moduls (V1 / V2), alle übrigen Clips laufen als eigene Module nacheinander */
  modules: [
    { clip: '1-modul-intro-variante1' },
    { clip: '2-modul-detailshot-1' },
    { clip: '2-modul-detailshot-2' },
    { clip: '3-modul-erlebniswelten' },
    { clip: '3-modul-zoom-out' },
    { clip: '4-modul-display-feature-1' },
    { clip: '4-modul-display-feature-2' },
    { clip: '5-modul-sound-feature' },
    { clip: '5-modul-sound-feature-2' },
    { clip: '6-modul-fernbedienung' },
    { clip: '7-modul-google-outro' }
  ]
};
