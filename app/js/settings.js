/* ------------------------------------------------------------------
   PEAQ – Einstellungen: Modulvideos ersetzen, hinzufügen, archivieren

   Läuft nur mit dem lokalen Server (Start.cmd), weil dort die Dateien
   im Ordner "Footage/Modul Videos" liegen.
   ------------------------------------------------------------------ */

(function () {

  if (sessionStorage.getItem('peaq-auth') !== '1') {
    location.replace('index.html');
    return;
  }

  const liste       = document.getElementById('clipList');
  const anzahl      = document.getElementById('clipCount');
  const serverNote  = document.getElementById('serverNote');
  const status      = document.getElementById('status');
  const statusBar   = document.getElementById('statusBar');
  const statusFill  = document.getElementById('statusFill');
  const fileReplace = document.getElementById('fileReplace');
  const fileAdd     = document.getElementById('fileAdd');
  const addGroup    = document.getElementById('addGroup');
  const addName     = document.getElementById('addName');
  const addVariant  = document.getElementById('addVariant');
  const addBtn      = document.getElementById('addBtn');
  const reloadBtn   = document.getElementById('reloadBtn');

  let serverDa   = false;
  let ersetzeDatei = null;      // Datei, die gerade ausgetauscht wird

  const mb  = b => (b / 1048576).toFixed(1);
  const sek = s => s ? s.toFixed(2).replace('.', ',') + ' s' : '–';

  function melde(text, fehler) {
    status.textContent = text;
    status.classList.toggle('is-error', !!fehler);
  }

  function fortschritt(anteil) {
    if (anteil == null) { statusBar.hidden = true; return; }
    statusBar.hidden = false;
    statusFill.style.width = Math.round(anteil * 100) + '%';
  }

  /* Hochladen mit Fortschritt – fetch kann das nicht anzeigen */
  function sende(url, datei, onFortschritt) {
    return new Promise((resolve, reject) => {
      const req = new XMLHttpRequest();
      req.open('POST', url);
      req.upload.onprogress = e => {
        if (e.lengthComputable && onFortschritt) onFortschritt(e.loaded / e.total);
      };
      req.onload = () => {
        let daten = {};
        try { daten = JSON.parse(req.responseText); } catch (e) { /* egal */ }
        if (req.status >= 200 && req.status < 300) resolve(daten);
        else reject(new Error(daten.error || ('Fehler ' + req.status)));
      };
      req.onerror = () => reject(new Error('Verbindung unterbrochen'));
      req.send(datei);
    });
  }

  /* ---------- Liste aufbauen ---------- */

  async function lade() {
    liste.innerHTML = '<div class="clip-row clip-empty">WIRD GELADEN …</div>';

    let daten = null;
    try {
      const res = await fetch('/api/clips');
      daten = await res.json();
      serverDa = res.ok && Array.isArray(daten.clips);
    } catch (e) {
      serverDa = false;
    }

    if (!serverDa) {
      serverNote.hidden = false;
      serverNote.textContent =
        'Videos verwalten geht nur mit dem lokalen Server – bitte Start.cmd ausführen. ' +
        'Online sind die Dateien Teil der Veröffentlichung und können hier nicht geändert werden.';
      liste.innerHTML = '';
      (CONFIG.library || []).forEach(c => liste.appendChild(zeile({
        datei: c.src.split('/').pop(), label: c.label, group: c.group
      }, true)));
      anzahl.textContent = (CONFIG.library || []).length + ' VIDEOS';
      addBtn.disabled = true;
      return;
    }

    serverNote.hidden = true;
    liste.innerHTML = '';
    daten.clips.forEach(c => liste.appendChild(zeile(c, false)));
    anzahl.textContent = daten.clips.length + ' VIDEOS · ' + daten.modules.length + ' MODULE';

    /* Modulnummer für den Zusatz sinnvoll vorbelegen */
    const hoechste = daten.clips.reduce((m, c) => Math.max(m, c.group || 0), 0);
    addGroup.value = String(hoechste + 1);
  }

  function zeile(clip, nurLesen) {
    const row = document.createElement('div');
    row.className = 'clip-row';

    const nr = clip.group == null ? '–' : String(clip.group).padStart(2, '0');
    const masse = clip.breite ? clip.breite + '×' + clip.hoehe : '';
    const hd = clip.breite && clip.breite < 3840;

    row.innerHTML =
      '<span class="clip-nr">' + nr + '</span>' +
      '<span class="clip-name">' + clip.label +
        (clip.variant ? ' <span class="clip-tag">VARIANTE</span>' : '') +
      '</span>' +
      '<span class="clip-file">' + clip.datei + '</span>' +
      '<span class="clip-meta">' + (masse ? masse + (hd ? ' <span class="clip-warn">KEIN 4K</span>' : '') : '') + '</span>' +
      '<span class="clip-meta">' + sek(clip.laenge) + '</span>' +
      '<span class="clip-meta">' + (clip.size ? mb(clip.size) + ' MB' : '') + '</span>';

    const knoepfe = document.createElement('span');
    knoepfe.className = 'clip-actions';

    if (!nurLesen) {
      const tausch = document.createElement('button');
      tausch.type = 'button';
      tausch.className = 'clip-btn';
      tausch.textContent = 'ERSETZEN';
      tausch.addEventListener('click', () => {
        ersetzeDatei = clip.datei;
        fileReplace.value = '';
        fileReplace.click();
      });

      const weg = document.createElement('button');
      weg.type = 'button';
      weg.className = 'clip-btn clip-btn-quiet';
      weg.textContent = 'ARCHIVIEREN';
      weg.addEventListener('click', () => archiviere(clip.datei));

      knoepfe.appendChild(tausch);
      knoepfe.appendChild(weg);
    }

    row.appendChild(knoepfe);
    return row;
  }

  /* ---------- Ersetzen ---------- */

  fileReplace.addEventListener('change', async () => {
    const datei = fileReplace.files && fileReplace.files[0];
    if (!datei || !ersetzeDatei) return;

    melde('ERSETZE ' + ersetzeDatei + ' …');
    fortschritt(0);

    try {
      const antwort = await sende(
        '/api/clips/replace?file=' + encodeURIComponent(ersetzeDatei),
        datei,
        p => fortschritt(p)
      );
      fortschritt(null);
      melde(antwort.datei + ' ersetzt · ' + (antwort.breite ? antwort.breite + '×' + antwort.hoehe + ' · ' : '') +
            sek(antwort.laenge) + ' · alte Fassung: ' + (antwort.gesichert || 'keine'));
      await lade();
    } catch (e) {
      fortschritt(null);
      melde(String(e.message || e), true);
    } finally {
      ersetzeDatei = null;
    }
  });

  /* ---------- Hinzufügen ---------- */

  const modulNummer = () => parseInt(addGroup.value, 10);

  addBtn.addEventListener('click', () => {
    const nr = modulNummer();
    if (!(nr >= 1 && nr <= 99)) { melde('Bitte eine Modulnummer von 1 bis 99 angeben', true); return; }
    if (!addName.value.trim()) { melde('Bitte eine Bezeichnung angeben', true); return; }
    fileAdd.value = '';
    fileAdd.click();
  });

  fileAdd.addEventListener('change', async () => {
    const datei = fileAdd.files && fileAdd.files[0];
    if (!datei) return;

    let name = addName.value.trim();
    if (addVariant.checked && !/variante/i.test(name)) name += ' Variante';

    const endung = (datei.name.split('.').pop() || 'mp4').toLowerCase();

    melde('LADE ' + datei.name + ' HOCH …');
    fortschritt(0);

    try {
      const antwort = await sende(
        '/api/clips/add?group=' + modulNummer() + '&name=' + encodeURIComponent(name) +
          '&ext=' + encodeURIComponent(endung),
        datei,
        p => fortschritt(p)
      );
      fortschritt(null);
      melde(antwort.datei + ' angelegt · ' + (antwort.breite ? antwort.breite + '×' + antwort.hoehe + ' · ' : '') +
            sek(antwort.laenge));
      addName.value = '';
      addVariant.checked = false;
      await lade();
    } catch (e) {
      fortschritt(null);
      melde(String(e.message || e), true);
    }
  });

  /* ---------- Archivieren ---------- */

  async function archiviere(datei) {
    if (!window.confirm(datei + ' aus der Auswahl nehmen?\n\nDie Datei wird nach Footage/Archiv verschoben und bleibt dort erhalten.')) return;

    melde('VERSCHIEBE ' + datei + ' …');
    try {
      const res = await fetch('/api/clips/archive?file=' + encodeURIComponent(datei), { method: 'POST' });
      const antwort = await res.json();
      if (!res.ok) throw new Error(antwort.error || 'Fehler');
      melde(antwort.datei + ' liegt jetzt in ' + antwort.gesichert);
      await lade();
    } catch (e) {
      melde(String(e.message || e), true);
    }
  }

  reloadBtn.addEventListener('click', () => { melde(''); lade(); });

  lade();

})();
