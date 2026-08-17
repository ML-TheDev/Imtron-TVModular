/* ------------------------------------------------------------------
   PEAQ – Dashboard: Modulleiste, Video-Tausch, Gesamt-Playback
   ------------------------------------------------------------------ */

(function () {

  /* ---------- Zugang ---------- */

  if (sessionStorage.getItem('peaq-auth') !== '1') {
    location.replace('index.html');
    return;
  }

  /* ---------- Elemente ---------- */

  const strip        = document.getElementById('strip');
  const stage        = document.getElementById('stage');
  const player       = document.getElementById('player');
  const preloader    = document.getElementById('preloader');
  const playBtn      = document.getElementById('playBtn');
  const scrub        = document.getElementById('scrub');
  const tcNow        = document.getElementById('tcNow');
  const tcTotal      = document.getElementById('tcTotal');
  const moduleCount  = document.getElementById('moduleCount');
  const segmentLabel = document.getElementById('segmentLabel');
  const fileInput    = document.getElementById('fileInput');
  const exportBtn    = document.getElementById('exportBtn');
  const exportNote   = document.getElementById('exportNote');

  const stripScroll  = document.getElementById('stripScroll');
  const stripThumb   = document.getElementById('stripThumb');
  const insertsWrap  = document.querySelector('.inserts-wrap');
  const insertsTgl   = document.getElementById('insertsToggle');
  const insertText   = document.getElementById('insertText');
  const overlayBox   = document.querySelector('.insert-overlay');
  const layoutBtn    = document.getElementById('layoutBtn');
  const layoutLoad   = document.getElementById('layoutLoadBtn');
  const layoutInput  = document.getElementById('layoutInput');

  const playhead = document.createElement('div');
  playhead.className = 'playhead';

  /* ---------- Zustand ---------- */

  /* Schlüssel mit Version: startet mit frischem Standardlayout */
  const STORAGE_KEY = 'peaq-modulkonfiguration-v2';
  const PX_PER_SEC  = 50;          // Maßstab der Modulleiste: 4 s Clip = 200 px breit
  const MIN_PX_PER_SEC = 30;       // darunter wird die Leiste horizontal scrollbar

  let library   = CONFIG.library.map(c => Object.assign({}, c));
  let defaults  = CONFIG.modules.map(m => Object.assign({}, m));
  const durations = {};            // clipId -> Sekunden
  const cards     = [];            // DOM-Referenzen je Modul
  const inserts   = [];            // DOM-Referenzen je Text-Insert
  const segments  = [];            // DOM-Referenzen je Timeline-Segment

  /* Alle Insert-Werte stammen aus js/render.js, damit Vorschau, Browser-Render
     und Server-Export dieselbe Darstellung ergeben. */
  const IC = (window.PeaqRender && PeaqRender.CONST) || {
    MAX_TEXT: 30, LINE_BREAK: 15, SIZE_DIV: 13, TRACK: -0.03, BASE: 0.57,
    IN: 1.20, FADE: 0.45, OUT: 0.35, MOVE: 0.030, DRIFT: 0.006
  };

  const MAX_TEXT        = IC.MAX_TEXT;
  const INSERT_SIZE_DIV = IC.SIZE_DIV;
  const INSERT_TRACK    = IC.TRACK;
  const INSERT_BASE     = IC.BASE;
  const TXT_IN    = IC.IN;
  const TXT_FADE  = IC.FADE;
  const TXT_OUT   = IC.OUT;
  const TXT_MOVE  = IC.MOVE;
  const TXT_DRIFT = IC.DRIFT;
  const TEXT_IN    = 0.22;         // Einblendung in Sekunden
  const TEXT_OUT   = 0.22;         // Ausblendung in Sekunden
  const TEXT_LEAD  = 0.30;         // so früh vor Modulende beginnt das Ausblenden

  let state    = [];
  let current  = -1;               // aktuell geladenes Modul (Index in state)
  let fileTarget = -1;             // Modul, für das eine Datei gewählt wird
  let rafId    = null;

  /* Der Modulname gehört zum Video (Nummer aus dem Dateinamen) und bleibt
     beim Verschieben unverändert. */
  function modName(i) {
    const clip = state[i] ? getClip(state[i].clip) : null;
    if (!clip) return 'MODUL --';
    if (clip.group == null) return clip.label;
    return 'MODUL ' + String(clip.group).padStart(2, '0');
  }

  /* Bibliothek direkt aus dem Footage-Ordner holen; ohne Server bleibt CONFIG */
  async function loadLibrary() {
    try {
      const res  = await fetch('/api/library');
      const data = await res.json();
      if (!res.ok || !Array.isArray(data.clips) || !data.clips.length) return;

      library  = data.clips;
      defaults = data.modules.length ? data.modules : defaults;
    } catch (e) {
      /* Rückfall auf die Liste in config.js */
    }
  }

  const cleanText  = t => String(t || '').slice(0, MAX_TEXT);

  /* Ab 15 Zeichen zweizeilig (Logik in js/render.js) */
  const textLines = t => window.PeaqRender ? PeaqRender.textLines(t) : [String(t || '')];
  const cleanAlign = a => (a === 'left' || a === 'right') ? a : 'center';

  function loadState() {
    const fallback = () => defaults.map(m => ({ clip: m.clip, enabled: true, text: '', align: 'center' }));

    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (!Array.isArray(saved) || !saved.length) return fallback();

      const restored = saved
        .filter(s => library.some(c => c.id === s.clip))
        .map(s => ({
          clip: s.clip,
          enabled: s.enabled !== false,
          text: cleanText(s.text),
          align: cleanAlign(s.align)
        }));

      return restored.length ? restored : fallback();
    } catch (e) {
      return fallback();
    }
  }

  function saveState() {
    const plain = state
      .filter(m => { const c = getClip(m.clip); return c && !c.custom; })
      .map(m => ({ clip: m.clip, enabled: m.enabled, text: m.text || '', align: m.align || 'center' }));
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(plain)); } catch (e) { /* egal */ }
  }

  /* ---------- Helfer ---------- */

  const getClip = id => library.find(c => c.id === id) || null;

  const srcOf = mod => {
    const clip = getClip(mod.clip);
    if (!clip) return null;
    return clip.custom ? clip.src : encodeURI(clip.src);
  };

  const durOf = mod => durations[mod.clip] || 0;

  /* Aktive Module mit Start-Offset auf der Gesamt-Timeline */
  function timeline() {
    let offset = 0;
    const out = [];
    state.forEach((m, i) => {
      if (!m.enabled || !getClip(m.clip)) return;
      const dur = durOf(m);
      out.push({ index: i, start: offset, duration: dur });
      offset += dur;
    });
    return out;
  }

  const totalDuration = () => timeline().reduce((sum, s) => sum + s.duration, 0);

  function fmt(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  }

  /* Dauer eines Clips ermitteln (einmalig, im Hintergrund) */
  function measure(clip) {
    if (durations[clip.id] || clip.measuring) return;
    clip.measuring = true;
    const probe = document.createElement('video');
    probe.preload = 'metadata';
    probe.muted = true;
    probe.addEventListener('loadedmetadata', () => {
      durations[clip.id] = probe.duration || 0;
      clip.measuring = false;
      renderMeta();
      renderScrub();
    });
    probe.addEventListener('error', () => { clip.measuring = false; });
    probe.src = clip.custom ? clip.src : encodeURI(clip.src);
  }

  /* ---------- Modulleiste aufbauen ---------- */

  function buildStrip() {
    strip.innerHTML = '';
    cards.length = 0;

    state.forEach(() => {
      const card = document.createElement('div');
      card.className = 'module';
      card.draggable = true;

      card.innerHTML =
        '<div class="module-frame">' +
          '<video muted playsinline preload="metadata" disablepictureinpicture ' +
                 'controlslist="nodownload nofullscreen noremoteplayback"></video>' +
          '<div class="module-off-flag">DEAKTIVIERT</div>' +
          '<span class="module-time"></span>' +
          '<button class="module-x" type="button" title="Modul ausgrauen">&#10005;</button>' +
        '</div>' +
        '<div class="module-meta">' +
          '<span class="module-name"></span>' +
          '<span class="module-clip"></span>' +
        '</div>' +
        '<div class="module-variants" hidden></div>';

      const frame = card.querySelector('.module-frame');
      const video = card.querySelector('video');
      const xBtn  = card.querySelector('.module-x');

      video.draggable = false;
      video.disablePictureInPicture = true;
      video.controls = false;

      frame.addEventListener('click', () => {
        const i = indexOfCard(card);
        if (!state[i].enabled || !getClip(state[i].clip)) return;
        loadModule(i, { autoplay: true });
      });

      /* Doppelklick öffnet die Clip-Auswahl */
      frame.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        openSwapMenu(indexOfCard(card), frame);
      });

      xBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleModule(indexOfCard(card));
      });

      /* Schwarze Leiste unter dem Modul: Variante direkt umschalten */
      card.querySelector('.module-variants').addEventListener('click', (e) => {
        const b = e.target.closest('button[data-clip]');
        if (!b) return;
        e.stopPropagation();
        assignClip(indexOfCard(card), b.dataset.clip);
      });

      /* Standbild des Clips zeigen */
      video.addEventListener('loadedmetadata', () => {
        const i = indexOfCard(card);
        if (i < 0) return;
        durations[state[i].clip] = video.duration || durations[state[i].clip] || 0;
        try { video.currentTime = Math.min(0.1, (video.duration || 1) / 2); } catch (err) { /* egal */ }
        renderMeta();
        renderScrub();
      });

      attachDragHandlers(card);

      strip.appendChild(card);
      cards.push({ card, video, xBtn, frame });
    });

    strip.appendChild(playhead);
    buildInserts();
    renderSources();
  }

  /* Ein schwarzes Textkästchen je Modul – es sitzt im Modulkästchen selbst,
     wird also beim Verschieben automatisch mitgenommen. */
  function buildInserts() {
    inserts.length = 0;

    state.forEach((mod, idx) => {
      const card = cards[idx].card;
      const box  = document.createElement('div');
      box.className = 'insert-box';
      box.innerHTML =
        '<div class="insert-head"><span class="insert-name"></span><span class="insert-count"></span></div>' +
        '<input type="text" maxlength="' + MAX_TEXT + '" placeholder="TEXT" spellcheck="false">' +
        '<div class="insert-align">' +
          '<button type="button" data-align="left"   title="linksbündig">L</button>' +
          '<button type="button" data-align="center" title="mittig">M</button>' +
          '<button type="button" data-align="right"  title="rechtsbündig">R</button>' +
        '</div>';

      const input = box.querySelector('input');

      /* Beim Tippen soll nicht das Modul gezogen werden */
      input.draggable = false;
      input.addEventListener('focus', () => { card.draggable = false; });
      input.addEventListener('blur',  () => { card.draggable = true; });

      box.querySelector('.insert-align').addEventListener('click', (e) => {
        const b = e.target.closest('button[data-align]');
        if (!b) return;
        const i = inserts.findIndex(x => x.box === box);
        if (i < 0) return;
        state[i].align = cleanAlign(b.dataset.align);
        saveState();
        renderInserts();
        renderOverlay(true);
      });

      input.addEventListener('input', () => {
        const i = inserts.findIndex(x => x.box === box);
        if (i < 0) return;
        state[i].text = cleanText(input.value);
        if (input.value !== state[i].text) input.value = state[i].text;
        box.querySelector('.insert-count').textContent = state[i].text.length + '/' + MAX_TEXT;
        saveState();
        renderOverlay(true);
      });

      card.appendChild(box);
      inserts.push({ box, input });
    });

    renderInserts();
  }

  /* Beschriftung, Breite und Zustand der Textkästchen */
  function renderInserts() {
    state.forEach((mod, i) => {
      const it = inserts[i];
      if (!it) return;

      it.box.style.animationDelay = (i * 55) + 'ms';
      it.box.classList.toggle('is-off', !mod.enabled);
      it.box.querySelector('.insert-name').textContent = modName(i);
      it.box.querySelector('.insert-count').textContent = (mod.text || '').length + '/' + MAX_TEXT;
      if (it.input.value !== (mod.text || '')) it.input.value = mod.text || '';

      it.box.querySelectorAll('.insert-align button').forEach(b => {
        b.classList.toggle('is-active', b.dataset.align === (mod.align || 'center'));
      });
    });
  }

  /* Auffächern ein-/ausklappen */
  insertsTgl.addEventListener('click', () => {
    const open = !strip.classList.contains('show-inserts');
    strip.classList.toggle('show-inserts', open);
    insertsWrap.classList.toggle('is-open', open);
    insertsTgl.setAttribute('aria-expanded', String(open));

    if (open) {
      /* Animation neu starten, damit die Kästchen wieder auffächern */
      inserts.forEach(it => {
        it.box.style.animation = 'none';
        void it.box.offsetWidth;
        it.box.style.animation = '';
      });
      renderInserts();
    }

    updateProgress();
  });

  /* Clip-Quellen der Vorschauen setzen (nur wenn geändert) */
  function renderSources() {
    state.forEach((mod, i) => {
      const { video } = cards[i];
      const src = srcOf(mod);
      if (!src) { video.removeAttribute('src'); return; }
      if (video.dataset.src !== src) {
        video.dataset.src = src;
        video.src = src;
      }
      const clip = getClip(mod.clip);
      if (clip) measure(clip);
    });
  }

  /* Varianten: nur Clips mit "Variante" im Namen, innerhalb derselben Modulnummer.
     Alle übrigen Clips sind eigenständige Module. */
  const isVariant = c => !!c && /variante/i.test(c.label);

  const variantsOf = clip =>
    isVariant(clip) && clip.group != null
      ? library.filter(c => c.group === clip.group && isVariant(c))
      : [];

  /* "INTRO VARIANTE2" -> "V2" */
  function variantLabel(clip, siblings) {
    const m = clip.label.match(/variante\s*(\d+)/i);
    return 'V' + (m ? m[1] : siblings.indexOf(clip) + 1);
  }

  function renderVariants(i) {
    const bar  = cards[i].card.querySelector('.module-variants');
    const clip = getClip(state[i].clip);
    const sibs = variantsOf(clip);

    if (sibs.length < 2) {
      bar.hidden = true;
      bar.innerHTML = '';
      return;
    }

    bar.hidden = false;
    bar.innerHTML = sibs.map(s =>
      '<button type="button" data-clip="' + s.id + '"' +
      (s.id === clip.id ? ' class="is-active"' : '') +
      ' title="' + s.label + '">' + variantLabel(s, sibs) + '</button>'
    ).join('');
  }

  /* Maßstab der Leiste: 50 px/s, bei vielen Modulen so weit verkleinert,
     dass alle nebeneinander sichtbar bleiben */
  function stripScale() {
    const gap   = parseFloat(getComputedStyle(strip).columnGap) || 12;
    /* 2 px Luft, damit durch Rundung keine Scrollleiste auftaucht */
    const avail = strip.clientWidth - gap * Math.max(0, state.length - 1) - 2;
    const secs  = state.reduce((sum, m) => sum + (durOf(m) || 4), 0);
    if (!secs || avail <= 0) return PX_PER_SEC;
    return Math.max(MIN_PX_PER_SEC, Math.min(PX_PER_SEC, avail / secs));
  }

  /* Texte, Breiten und Zustände der Karten aktualisieren */
  function renderMeta() {
    const scale = stripScale();

    state.forEach((mod, i) => {
      const { card } = cards[i];
      const clip = getClip(mod.clip);
      const dur  = durOf(mod);

      card.querySelector('.module-name').textContent = modName(i);
      card.querySelector('.module-clip').textContent = clip ? clip.label : '–';
      card.querySelector('.module-time').textContent = dur ? fmt(dur) : '--:--';
      card.querySelector('.module-x').innerHTML = mod.enabled ? '&#10005;' : '&#43;';
      card.querySelector('.module-x').title = mod.enabled ? 'Modul ausgrauen' : 'Modul aktivieren';

      card.classList.toggle('is-off', !mod.enabled);
      card.classList.toggle('is-current', i === current && mod.enabled);
      card.style.width = Math.floor((dur > 0 ? dur : 4) * scale) + 'px';

      renderVariants(i);
    });

    renderInserts();
    renderStripScroll();

    const active = timeline().length;
    moduleCount.textContent = active + ' / ' + state.length + ' AKTIV';
    tcTotal.textContent = fmt(totalDuration());
    stage.classList.toggle('is-empty', active === 0);
  }

  /* ---------- Eigener Regler unter der Modulleiste ---------- */

  function renderStripScroll() {
    const overflow = strip.scrollWidth - strip.clientWidth;

    if (overflow <= 1) {
      stripScroll.hidden = true;
      return;
    }

    stripScroll.hidden = false;
    const trackW = stripScroll.clientWidth;
    const thumbW = Math.max(40, Math.round(trackW * strip.clientWidth / strip.scrollWidth));
    stripThumb.style.width = thumbW + 'px';
    stripThumb.style.left  = Math.round((trackW - thumbW) * (strip.scrollLeft / overflow)) + 'px';
  }

  /* Position im Regler auf die Leiste übertragen */
  function scrollFromTrack(clientX) {
    const r        = stripScroll.getBoundingClientRect();
    const thumbW   = stripThumb.offsetWidth;
    const usable   = r.width - thumbW;
    const overflow = strip.scrollWidth - strip.clientWidth;
    if (usable <= 0 || overflow <= 0) return;

    const x = Math.min(Math.max(clientX - r.left - thumbW / 2, 0), usable);
    strip.scrollLeft = (x / usable) * overflow;
    renderStripScroll();          // nicht auf das scroll-Event warten
  }

  strip.addEventListener('scroll', renderStripScroll);

  stripScroll.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    scrollFromTrack(e.clientX);

    const move = ev => scrollFromTrack(ev.clientX);
    const up   = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });

  /* ---------- Timeline-Balken unter dem Player ---------- */

  function renderScrub() {
    const line = timeline();
    scrub.innerHTML = '';
    segments.length = 0;

    line.forEach(seg => {
      const el = document.createElement('div');
      el.className = 'scrub-seg';
      el.style.flexGrow = seg.duration > 0 ? seg.duration : 1;
      el.style.flexBasis = '0';
      el.innerHTML = '<div class="scrub-fill"></div>';
      scrub.appendChild(el);
      segments.push({ el, fill: el.querySelector('.scrub-fill'), seg });
    });
  }

  scrub.addEventListener('click', (e) => {
    if (!segments.length) return;

    let best = null;
    segments.forEach(s => {
      const r = s.el.getBoundingClientRect();
      const dist = e.clientX < r.left ? r.left - e.clientX
                 : e.clientX > r.right ? e.clientX - r.right : 0;
      if (!best || dist < best.dist) best = { s, dist, rect: r };
    });

    const frac = Math.min(1, Math.max(0, (e.clientX - best.rect.left) / best.rect.width));
    loadModule(best.s.seg.index, { autoplay: !player.paused, time: frac * best.s.seg.duration });
  });

  /* ---------- Module per Drag & Drop verschieben ---------- */

  const indexOfCard = card => cards.findIndex(c => c.card === card);

  let dragFrom = -1;

  /* Umsortieren mit weicher Bewegung: Positionen vorher messen, umhängen,
     und die Differenz von der alten zur neuen Position animieren. */
  const slideAnim = new WeakMap();

  function animateReorder(change) {
    const before = new Map();
    cards.forEach(c => before.set(c.card, c.card.getBoundingClientRect().left));

    change();

    cards.forEach(c => {
      const dx = before.get(c.card) - c.card.getBoundingClientRect().left;
      if (!dx || typeof c.card.animate !== 'function') return;

      const running = slideAnim.get(c.card);
      if (running) running.cancel();

      slideAnim.set(c.card, c.card.animate(
        [{ transform: 'translateX(' + dx + 'px)' }, { transform: 'translateX(0)' }],
        { duration: 200, easing: 'cubic-bezier(.2,.7,.3,1)' }
      ));
    });
  }

  function attachDragHandlers(card) {
    card.addEventListener('dragstart', (e) => {
      dragFrom = indexOfCard(card);
      card.classList.add('is-dragging');
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', String(dragFrom)); } catch (err) { /* egal */ }
    });

    card.addEventListener('dragend', () => {
      card.classList.remove('is-dragging');
      dragFrom = -1;
    });

    /* Sobald die Mitte eines anderen Moduls überschritten wird,
       rutscht dieses Modul sofort auf den alten Platz. */
    card.addEventListener('dragover', (e) => {
      if (dragFrom < 0) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';

      const over = indexOfCard(card);
      if (over < 0 || over === dragFrom) return;

      const r = card.getBoundingClientRect();
      const mid = r.left + r.width / 2;
      const passed = over > dragFrom ? e.clientX > mid : e.clientX < mid;
      if (!passed) return;

      const from = dragFrom;
      animateReorder(() => moveModule(from, over));
      dragFrom = over;
    });

    card.addEventListener('drop', (e) => {
      e.preventDefault();          // Reihenfolge steht bereits
      dragFrom = -1;
    });
  }

  /* Auch die Lücken zwischen den Modulen nehmen den Drop an */
  strip.addEventListener('dragover', (e) => { if (dragFrom >= 0) e.preventDefault(); });
  strip.addEventListener('drop', (e) => { e.preventDefault(); dragFrom = -1; });

  function moveModule(from, to) {
    if (from === to || from < 0 || to < 0 || from >= state.length || to >= state.length) return;

    const runningMod  = current >= 0 ? state[current] : null;

    state.splice(to, 0, state.splice(from, 1)[0]);
    cards.splice(to, 0, cards.splice(from, 1)[0]);
    inserts.splice(to, 0, inserts.splice(from, 1)[0]);

    /* DOM-Knoten nur umhängen – die Videos bleiben dadurch geladen.
       Die Textfelder stecken in den Kästchen und wandern automatisch mit. */
    cards.forEach(c => strip.appendChild(c.card));
    strip.appendChild(playhead);

    current = runningMod ? state.indexOf(runningMod) : -1;

    saveState();
    renderMeta();
    renderScrub();
    preloadNext();
    updateProgress();
  }

  /* ---------- Modul aus-/einschalten ---------- */

  function toggleModule(i) {
    state[i].enabled = !state[i].enabled;

    if (!state[i].enabled && i === current) {
      const line = timeline();
      const next = line.find(s => s.index > i) || line[0];
      if (next) {
        loadModule(next.index, { autoplay: !player.paused });
      } else {
        player.pause();
        player.removeAttribute('src');
        current = -1;
      }
    }

    saveState();
    renderMeta();
    renderScrub();
    updateProgress();
  }

  /* ---------- Video tauschen ---------- */

  function openSwapMenu(i, anchor) {
    closeSwapMenu();

    const menu = document.createElement('div');
    menu.className = 'swap-menu';
    menu.id = 'swapMenu';

    library.forEach(clip => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = (clip.group ? clip.group + ' · ' : '') + clip.label;
      if (clip.id === state[i].clip) b.classList.add('is-active');
      b.addEventListener('click', () => {
        assignClip(i, clip.id);
        closeSwapMenu();
      });
      menu.appendChild(b);
    });

    menu.appendChild(document.createElement('hr'));

    const own = document.createElement('button');
    own.type = 'button';
    own.textContent = 'EIGENES VIDEO …';
    own.addEventListener('click', () => {
      fileTarget = i;
      fileInput.value = '';
      fileInput.click();
      closeSwapMenu();
    });
    menu.appendChild(own);

    document.body.appendChild(menu);

    const r = anchor.getBoundingClientRect();
    const top  = r.bottom + window.scrollY + 6;
    const left = Math.min(r.left + window.scrollX, window.scrollX + window.innerWidth - menu.offsetWidth - 12);
    menu.style.top  = top + 'px';
    menu.style.left = Math.max(12, left) + 'px';

    setTimeout(() => document.addEventListener('click', closeSwapMenu, { once: true }), 0);
  }

  function closeSwapMenu() {
    const m = document.getElementById('swapMenu');
    if (m) m.remove();
  }

  function assignClip(i, clipId) {
    state[i].clip = clipId;
    if (!state[i].enabled) state[i].enabled = true;

    saveState();
    renderSources();
    renderMeta();
    renderScrub();

    if (i === current) loadModule(i, { autoplay: !player.paused });
    updateProgress();
  }

  fileInput.addEventListener('change', () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file || fileTarget < 0) return;

    const clip = {
      id: 'custom-' + Date.now() + '-' + fileTarget,
      label: file.name.replace(/\.[^.]+$/, '').toUpperCase().slice(0, 22),
      src: URL.createObjectURL(file),
      custom: true,
      file: file                    // wird für den Export zum Server geschickt
    };

    library.push(clip);
    measure(clip);
    assignClip(fileTarget, clip.id);
    fileTarget = -1;
  });

  /* ---------- Playback ---------- */

  function loadModule(i, opts) {
    opts = opts || {};
    const mod = state[i];
    const src = srcOf(mod);
    if (!src || !mod.enabled) return;

    current = i;
    if (player.dataset.src !== src) {
      player.dataset.src = src;
      player.src = src;
      player.load();
    }

    const applyTime = () => {
      try { player.currentTime = opts.time || 0; } catch (e) { /* egal */ }
      if (opts.autoplay) player.play().catch(() => {});
    };

    if (player.readyState >= 1) applyTime();
    else player.addEventListener('loadedmetadata', applyTime, { once: true });

    renderMeta();
    preloadNext();
    updateProgress();
  }

  function nextIndex() {
    const line = timeline();
    const pos = line.findIndex(s => s.index === current);
    return pos >= 0 && pos < line.length - 1 ? line[pos + 1].index : -1;
  }

  function preloadNext() {
    const n = nextIndex();
    if (n < 0) return;
    const src = srcOf(state[n]);
    if (src && preloader.dataset.src !== src) {
      preloader.dataset.src = src;
      preloader.src = src;
    }
  }

  player.addEventListener('ended', () => {
    const n = nextIndex();
    if (n >= 0) {
      loadModule(n, { autoplay: true });
    } else {
      player.pause();
      setPlayLabel();
      updateProgress();
    }
  });

  player.addEventListener('play',  () => { setPlayLabel(); startLoop(); });
  player.addEventListener('pause', () => { setPlayLabel(); });

  function setPlayLabel() {
    playBtn.textContent = player.paused ? 'PLAY' : 'PAUSE';
  }

  function togglePlay() {
    const line = timeline();
    if (!line.length) return;

    if (current < 0 || !state[current].enabled) {
      loadModule(line[0].index, { autoplay: true });
      return;
    }

    if (player.paused) {
      /* Am Ende der Gesamt-Timeline: von vorn beginnen */
      const isLast = nextIndex() < 0;
      const atEnd  = player.duration && player.currentTime >= player.duration - 0.05;
      if (isLast && atEnd) loadModule(line[0].index, { autoplay: true });
      else player.play().catch(() => {});
    } else {
      player.pause();
    }
  }

  playBtn.addEventListener('click', togglePlay);

  /* ---------- Fortschrittsanzeige ---------- */

  function globalTime() {
    const line = timeline();
    const seg = line.find(s => s.index === current);
    if (!seg) return 0;
    return seg.start + Math.min(player.currentTime || 0, seg.duration || Infinity);
  }

  /* Text-Insert des laufenden Moduls einblenden:
     schnell herein (von unten), kurz vor dem Modulende wieder nach unten hinaus */
  /* Der Bildbereich kann schmaler sein als die schwarze Fläche –
     Overlay und Schriftgröße richten sich nach dem echten Bild. */
  let videoH = 0;                  // Höhe des sichtbaren Bildes in Pixeln

  function positionOverlay() {
    const vw = player.videoWidth  || 16;
    const vh = player.videoHeight || 9;
    const sw = stage.clientWidth;
    const sh = stage.clientHeight;
    if (!sw || !sh) return;

    const scale = Math.min(sw / vw, sh / vh);
    const dw    = vw * scale;
    const dh    = vh * scale;
    videoH = dh;

    overlayBox.style.left  = Math.round((sw - dw) / 2) + 'px';
    overlayBox.style.width = Math.round(dw) + 'px';
    overlayBox.style.top   = Math.round((sh - dh) / 2 + dh * INSERT_BASE) + 'px';
    insertText.style.fontSize = Math.round(dw / INSERT_SIZE_DIV) + 'px';
  }

  player.addEventListener('loadedmetadata', positionOverlay);

  function renderOverlay(force) {
    const line = timeline();
    const seg  = line.find(s => s.index === current);
    const txt  = seg ? (state[seg.index].text || '') : '';
    const align = seg ? (state[seg.index].align || 'center') : 'center';

    /* Ausrichtung und Größe passend zum Videobild (wie im Export) */
    overlayBox.classList.toggle('align-left',   align === 'left');
    overlayBox.classList.toggle('align-center', align === 'center');
    overlayBox.classList.toggle('align-right',  align === 'right');
    positionOverlay();

    if (insertText.dataset.text !== txt) {
      insertText.dataset.text = txt;
      insertText.textContent = '';
      textLines(txt).forEach(line => {
        const span = document.createElement('span');
        span.className = 'insert-line';
        span.textContent = line;
        span.style.letterSpacing = INSERT_TRACK + 'em';
        span.style.marginRight   = (-INSERT_TRACK) + 'em';   // Laufweite hinter dem letzten Zeichen ausgleichen
        insertText.appendChild(span);
      });
    }

    if (!txt || !seg) {
      insertText.style.opacity = '0';
      return;
    }

    /* Ablauf: langsam von unten herein, im Stand leichtes Nachgleiten,
       zum Schluss beschleunigt nach unten hinaus. */
    const t     = player.currentTime || 0;
    const dur   = seg.duration || 4;
    const move  = (videoH || stage.clientHeight) * TXT_MOVE;
    const drift = (videoH || stage.clientHeight) * TXT_DRIFT;
    const outAt = Math.max(TXT_IN, dur - TXT_OUT);

    let y, alpha;

    if (t < outAt) {
      /* schnell herein, weich auslaufend – und ohne Stillstand weiter gleitend */
      const p = Math.min(1, Math.max(0, t / TXT_IN));
      y     = move * Math.pow(1 - p, 3) - drift * Math.min(1, t / outAt);
      alpha = Math.min(1, t / TXT_FADE);
    } else {
      /* nimmt wieder Fahrt auf und fliegt beschleunigt nach oben hinaus */
      const r = Math.min(1, Math.max(0, (t - outAt) / TXT_OUT));
      y     = -drift - move * Math.pow(r, 3);
      alpha = 1 - r;
    }

    insertText.style.transform = 'translateY(' + y.toFixed(2) + 'px)';
    insertText.style.opacity   = alpha.toFixed(3);
  }

  function updateProgress() {
    const line = timeline();
    const seg  = line.find(s => s.index === current);

    tcNow.textContent   = fmt(globalTime());
    tcTotal.textContent = fmt(totalDuration());

    /* Segmentbalken füllen */
    segments.forEach(s => {
      let frac = 0;
      if (seg && s.seg.index === seg.index) {
        frac = s.seg.duration ? (player.currentTime || 0) / s.seg.duration : 0;
      } else if (seg && s.seg.start < seg.start) {
        frac = 1;
      }
      s.fill.style.width = Math.min(100, Math.max(0, frac * 100)) + '%';
    });

    /* Abspielstrich über der Modulleiste */
    if (seg && cards[seg.index]) {
      const card = cards[seg.index].card;
      const frac = seg.duration ? Math.min(1, (player.currentTime || 0) / seg.duration) : 0;
      playhead.style.left = (card.offsetLeft + frac * card.offsetWidth) + 'px';
      playhead.classList.add('is-on');
      segmentLabel.textContent =
        modName(seg.index) + ' · ' + (line.findIndex(s => s.index === seg.index) + 1) + ' / ' + line.length;
    } else {
      playhead.classList.remove('is-on');
      segmentLabel.textContent = line.length ? '' : 'KEIN AKTIVES MODUL';
    }

    cards.forEach((c, i) => c.card.classList.toggle('is-current', i === current && state[i].enabled));

    renderOverlay();
  }

  function startLoop() {
    if (rafId) return;
    const step = () => {
      updateProgress();
      if (!player.paused && !player.ended) {
        rafId = requestAnimationFrame(step);
      } else {
        rafId = null;
        updateProgress();
      }
    };
    rafId = requestAnimationFrame(step);
  }

  player.addEventListener('seeked', updateProgress);
  player.addEventListener('timeupdate', updateProgress);   // greift auch, wenn der Tab im Hintergrund liegt
  window.addEventListener('resize', () => { renderMeta(); updateProgress(); });

  /* ---------- Tastatur ---------- */

  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input, textarea')) return;

    if (e.code === 'Space') {
      e.preventDefault();
      togglePlay();
    } else if (e.code === 'ArrowRight' || e.code === 'ArrowLeft') {
      e.preventDefault();
      seekGlobal(globalTime() + (e.code === 'ArrowRight' ? 2 : -2));
    } else if (e.code === 'Escape') {
      closeSwapMenu();
    }
  });

  function seekGlobal(t) {
    const line = timeline();
    if (!line.length) return;
    const total = totalDuration();
    t = Math.min(Math.max(0, t), Math.max(0, total - 0.05));

    const seg = line.find(s => t >= s.start && t < s.start + s.duration) || line[line.length - 1];
    loadModule(seg.index, { autoplay: !player.paused, time: t - seg.start });
  }

  /* ---------- Export als MP4 (H.264) ---------- */

  function note(text, isError) {
    exportNote.textContent = text;
    exportNote.classList.toggle('is-error', !!isError);
  }

  const mb = bytes => (bytes / 1048576).toFixed(1);

  /* Insert-Text als transparentes PNG für den Server-Export (gemeinsame
     Zeichenlogik mit dem Browser-Renderer, siehe js/render.js) */
  const insertPng = (text, align) =>
    window.PeaqRender ? PeaqRender.insertPngDataUrl(text, align, 3840) : Promise.resolve(null);

  /* ---------- Fortschrittsfenster ---------- */

  const modal       = document.getElementById('renderModal');
  const modalStep   = document.getElementById('renderStep');
  const modalBar    = document.getElementById('renderBar');
  const modalPct    = document.getElementById('renderPct');
  const modalEngine = document.getElementById('renderEngine');
  const modalCancel = document.getElementById('renderCancel');
  const resSelect   = document.getElementById('resSelect');

  let cancelRender = false;
  let renderStart  = 0;

  function showModal(engine) {
    cancelRender = false;
    renderStart  = Date.now();
    modal.hidden = false;
    modalEngine.textContent = engine;
    setProgress(0, 'VORBEREITUNG …');
  }

  function hideModal() { modal.hidden = true; }

  function setProgress(percent, step) {
    const p = Math.max(0, Math.min(100, percent || 0));
    modalBar.style.width = p.toFixed(1) + '%';

    /* Restzeit schätzen – so ist ein langsamer Lauf von einem Stillstand zu unterscheiden */
    let rest = '';
    const passed = (Date.now() - renderStart) / 1000;
    if (p > 3 && p < 99.5 && passed > 2) {
      const sec = Math.round(passed / p * (100 - p));
      rest = ' · NOCH CA. ' + (sec >= 90 ? Math.round(sec / 60) + ' MIN' : Math.max(1, sec) + ' S');
    }

    modalPct.textContent = Math.round(p) + ' %' + rest;
    if (step) modalStep.textContent = step;
  }

  modalCancel.addEventListener('click', () => {
    cancelRender = true;
    setProgress(100, 'WIRD ABGEBROCHEN …');
  });

  function targetSize() {
    const [w, h] = (resSelect.value || '3840x2160').split('x').map(Number);
    return { width: w, height: h };
  }

  function startDownload(url, name) {
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
  }

  /* Rendern auf dem lokalen Server (ffmpeg), Fortschritt wird abgefragt */
  async function exportViaServer(line, size) {
    const items = [];

    for (const seg of line) {
      const clip = getClip(state[seg.index].clip);
      const txt  = state[seg.index].text || '';
      const png  = await insertPng(txt, state[seg.index].align || 'center');

      if (clip.custom) {
        if (!clip.serverPath) {
          if (!clip.file) throw new Error('Eigenes Video nicht verfügbar');
          setProgress(0, 'ÜBERTRAGE ' + clip.label + ' …');
          const up = await fetch('/api/upload?name=' + encodeURIComponent(clip.file.name), {
            method: 'POST', body: clip.file
          });
          const upData = await up.json();
          if (!up.ok) throw new Error(upData.error || 'Übertragung fehlgeschlagen');
          clip.serverPath = upData.path;
        }
        items.push({ path: clip.serverPath, text: txt, png: png });
      } else {
        items.push({ path: clip.src, text: txt, png: png });
      }
    }

    setProgress(1, 'AUFTRAG WIRD GESTARTET …');

    const res = await fetch('/api/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items, width: size.width, height: size.height })
    });
    const start = await res.json();
    if (!res.ok) throw new Error(start.error || 'Export fehlgeschlagen');

    /* Fortschritt abfragen, bis der Auftrag fertig ist */
    for (;;) {
      await new Promise(r => setTimeout(r, 400));
      const st = await (await fetch('/api/export/status?id=' + encodeURIComponent(start.jobId))).json();

      setProgress(st.percent || 0, (st.step || '').toUpperCase() + ' …');

      if (st.error) throw new Error(st.error);
      if (st.done) {
        startDownload(st.url, st.name);
        return {
          name: st.name, size: st.size, mode: st.mode,
          inserts: st.inserts, resolution: st.resolution, place: 'IM ORDNER EXPORT'
        };
      }
    }
  }

  /* Rendern im Browser (WebCodecs) – funktioniert auch online ohne Server */
  async function exportViaBrowser(line, size) {
    const items = line.map(seg => ({
      src: srcOf(state[seg.index]),
      text: state[seg.index].text || '',
      align: state[seg.index].align || 'center',
      duration: seg.duration
    }));

    let hinweis = '';

    const out = await PeaqRender.render({
      items,
      width: size.width,
      height: size.height,
      cancelled: () => cancelRender,
      onProgress: p => {
        if (p.phase === 'fallback') {
          hinweis = ' · 4K NICHT MÖGLICH, HD GERENDERT';
          return;
        }
        const step = p.phase === 'load'
              ? 'MODUL ' + p.module + ' VON ' + p.modules + ' WIRD GELADEN' +
                (p.loaded != null ? ' … ' + p.loaded + ' %' : ' …')
              : p.phase === 'encode' ? 'MODUL ' + p.module + ' VON ' + p.modules + ' WIRD CODIERT …'
              : p.phase === 'finish' ? 'DATEI WIRD GESCHRIEBEN …'
              : 'FERTIG';
        setProgress(p.percent, step);
      }
    });

    const name = 'PEAQ_Gesamtvideo_' +
      new Date().toISOString().slice(0, 16).replace(/[:T-]/g, '') + '.mp4';
    const url = URL.createObjectURL(out.blob);
    startDownload(url, name);
    setTimeout(() => URL.revokeObjectURL(url), 30000);

    return {
      name, size: out.blob.size, mode: 'webcodecs',
      inserts: items.filter(i => i.text).length,
      resolution: out.width + 'x' + out.height,
      place: 'IM DOWNLOAD-ORDNER' + hinweis
    };
  }

  async function runExport() {
    const line = timeline();
    if (!line.length) { note('KEIN AKTIVES MODUL', true); return; }

    const size   = targetSize();
    const server = serverRender;

    if (!server && !(window.PeaqRender && PeaqRender.supported())) {
      note('DIESER BROWSER KANN NICHT RENDERN – BITTE CHROME ODER EDGE', true);
      return;
    }

    if (!server && size.width > maxRenderWidth) {
      size.width = 1920;
      size.height = 1080;
    }

    exportBtn.disabled = true;
    note('');
    showModal(server ? 'FFMPEG · LOKAL' : 'WEBCODECS · IM BROWSER');

    try {
      const out = server ? await exportViaServer(line, size) : await exportViaBrowser(line, size);

      note(out.name + ' · ' + mb(out.size) + ' MB · ' + out.resolution + ' · ' +
           (out.mode === 'copy' ? 'VERLUSTFREI KOPIERT' : out.mode.toUpperCase()) +
           (out.inserts ? ' · ' + out.inserts + ' TEXT-INSERTS EINGEBRANNT' : '') +
           ' · ' + out.place);
    } catch (e) {
      const msg = String(e.message || e);
      note(/abgebrochen/i.test(msg) ? 'EXPORT ABGEBROCHEN' : msg.toUpperCase(),
           !/abgebrochen/i.test(msg));
    } finally {
      hideModal();
      exportBtn.disabled = false;
    }
  }

  exportBtn.addEventListener('click', runExport);

  /* ---------- Fernseher-Auswahl ---------- */

  const TV_KEY   = 'peaq-fernseher';
  const tvButton = document.getElementById('tvButton');
  const tvMenu   = document.getElementById('tvMenu');
  const tvName   = document.getElementById('tvName');
  const tvPicker = document.querySelector('.tv-picker');

  const tvList = (CONFIG.tvs && CONFIG.tvs.length)
    ? CONFIG.tvs
    : [{ id: 'unbekannt', name: 'KEIN GERÄT HINTERLEGT' }];

  let currentTv = tvList.find(t => t.id === localStorage.getItem(TV_KEY)) || tvList[0];

  function renderTv() {
    tvName.textContent = currentTv.name;

    tvMenu.innerHTML = '';
    tvList.forEach(tv => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = tv.name;
      if (tv.id === currentTv.id) b.classList.add('is-active');
      b.addEventListener('click', () => {
        currentTv = tv;
        try { localStorage.setItem(TV_KEY, tv.id); } catch (e) { /* egal */ }
        closeTvMenu();
        renderTv();
      });
      tvMenu.appendChild(b);
    });

    if (tvList.length < 2) {
      const hint = document.createElement('div');
      hint.className = 'tv-menu-hint';
      hint.textContent = 'WEITERE GERÄTE FOLGEN';
      tvMenu.appendChild(hint);
    }
  }

  function closeTvMenu() {
    tvMenu.hidden = true;
    tvPicker.classList.remove('is-open');
    tvButton.setAttribute('aria-expanded', 'false');
  }

  tvButton.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = tvMenu.hidden;
    tvMenu.hidden = !open;
    tvPicker.classList.toggle('is-open', open);
    tvButton.setAttribute('aria-expanded', String(open));
    if (open) setTimeout(() => document.addEventListener('click', closeTvMenu, { once: true }), 0);
  });

  renderTv();

  /* ---------- Layout speichern (Ordner wählen) ---------- */

  function layoutData() {
    const line = timeline();
    return {
      app: 'PEAQ Modul-Konfigurator',
      gespeichert: new Date().toISOString(),
      fernseher: currentTv.name,
      gesamtlaenge: fmt(totalDuration()),
      module: state.map((m, i) => {
        const clip = getClip(m.clip);
        return {
          position: i + 1,
          name: modName(i),
          clip: clip ? clip.label : null,
          datei: clip ? clip.src.split('/').pop() : null,
          aktiv: m.enabled,
          text: m.text || '',
          ausrichtung: m.align || 'center',
          laenge: durOf(m) ? +durOf(m).toFixed(2) : null
        };
      }),
      reihenfolge_im_video: line.map(s => modName(s.index))
    };
  }

  async function saveLayout() {
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '').replace(/(\d{8})/, '$1_');
    const name  = 'PEAQ_Layout_' + stamp + '.json';
    const blob  = new Blob([JSON.stringify(layoutData(), null, 2)], { type: 'application/json' });

    /* Ordnerauswahl, wo verfügbar (Chrome / Edge) */
    if (window.showDirectoryPicker) {
      try {
        const dir    = await window.showDirectoryPicker({ mode: 'readwrite' });
        const handle = await dir.getFileHandle(name, { create: true });
        const stream = await handle.createWritable();
        await stream.write(blob);
        await stream.close();
        note(name + ' IN ' + (dir.name || 'ORDNER').toUpperCase() + ' GESPEICHERT');
        return;
      } catch (e) {
        if (e && e.name === 'AbortError') { note(''); return; }
        /* sonst weiter zum Download */
      }
    }

    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    note(name + ' HERUNTERGELADEN');
  }

  layoutBtn.addEventListener('click', () => {
    saveLayout().catch(e => note(String(e.message || e).toUpperCase(), true));
  });

  /* ---------- Layout laden ---------- */

  /* Clip über Dateiname (bevorzugt) oder Bezeichnung wiederfinden */
  function findClip(entry) {
    const file = String(entry.datei || '').toLowerCase();
    if (file) {
      const byFile = library.find(c => c.src.toLowerCase().endsWith('/' + file));
      if (byFile) return byFile;
    }
    const label = String(entry.clip || '').toUpperCase();
    return library.find(c => c.label === label) || null;
  }

  function applyLayout(data) {
    if (!data || !Array.isArray(data.module) || !data.module.length) {
      throw new Error('Keine Module in der Datei');
    }

    const next    = [];
    let   missing = 0;

    data.module.forEach(entry => {
      const clip = findClip(entry);
      if (!clip) { missing++; return; }
      next.push({
        clip: clip.id,
        enabled: entry.aktiv !== false,
        text: cleanText(entry.text),
        align: cleanAlign(entry.ausrichtung)
      });
    });

    if (!next.length) throw new Error('Kein Video der Datei gefunden');

    /* Fernseher übernehmen, wenn er bekannt ist */
    const tv = tvList.find(t => t.name === data.fernseher);
    if (tv) {
      currentTv = tv;
      try { localStorage.setItem(TV_KEY, tv.id); } catch (e) { /* egal */ }
      renderTv();
    }

    state   = next;
    current = -1;
    player.pause();
    player.removeAttribute('src');
    player.dataset.src = '';

    buildStrip();
    renderMeta();
    renderScrub();
    saveState();

    const first = timeline()[0];
    if (first) loadModule(first.index, { autoplay: false });
    setPlayLabel();
    updateProgress();

    note(next.length + ' MODULE GELADEN' + (missing ? ' · ' + missing + ' NICHT GEFUNDEN' : ''), missing > 0);
  }

  layoutLoad.addEventListener('click', () => { layoutInput.value = ''; layoutInput.click(); });

  layoutInput.addEventListener('change', async () => {
    const file = layoutInput.files && layoutInput.files[0];
    if (!file) return;
    try {
      applyLayout(JSON.parse(await file.text()));
    } catch (e) {
      note('LAYOUT NICHT LESBAR – ' + String(e.message || e).toUpperCase(), true);
    }
  });

  /* Ist ffmpeg über den lokalen Server erreichbar, wird dort gerendert
     (schneller, kann verlustfrei kopieren) – sonst im Browser. */
  let serverRender = false;
  let maxRenderWidth = 3840;

  async function announceEngine() {
    if (serverRender) {
      note('RENDERT LOKAL MIT FFMPEG');
      return;
    }

    const check = window.PeaqRender
      ? await PeaqRender.probe()
      : { ok: false, reason: 'render.js nicht geladen' };

    if (!check.ok) {
      exportBtn.disabled = true;
      resSelect.disabled = true;
      note('EXPORT HIER NICHT MÖGLICH – ' + check.reason.toUpperCase() +
           '. BITTE CHROME ODER EDGE VERWENDEN.', true);
      return;
    }

    maxRenderWidth = check.maxWidth;

    /* Kann der Rechner nur HD, die 4K-Wahl entfernen */
    if (maxRenderWidth < 3840) {
      const uhd = resSelect.querySelector('option[value="3840x2160"]');
      if (uhd) uhd.remove();
      resSelect.value = '1920x1080';
      note('RENDERT IM BROWSER (WEBCODECS · MAXIMAL HD)');
    } else {
      note('RENDERT IM BROWSER (WEBCODECS)');
    }
  }

  /* ?render=browser bzw. ?render=server erzwingt eine Variante */
  const forcedEngine = new URLSearchParams(location.search).get('render');

  fetch('/api/status')
    .then(r => r.json())
    .then(s => { serverRender = !!(s && s.ffmpeg); })
    .catch(() => { serverRender = false; })
    .then(() => {
      if (forcedEngine === 'browser') serverRender = false;
      if (forcedEngine === 'server')  serverRender = true;
      announceEngine();
    });

  /* ---------- Kopfzeile / Fußzeile ---------- */

  document.getElementById('resetBtn').addEventListener('click', () => {
    localStorage.removeItem(STORAGE_KEY);
    location.reload();
  });

  document.getElementById('logoutBtn').addEventListener('click', () => {
    sessionStorage.removeItem('peaq-auth');
    location.replace('index.html');
  });

  /* ---------- Start ---------- */

  (async function boot() {
    await loadLibrary();

    state = loadState();

    buildStrip();
    renderMeta();
    renderScrub();

    const first = timeline()[0];
    if (first) loadModule(first.index, { autoplay: false });
    setPlayLabel();
    updateProgress();
  })();

})();
