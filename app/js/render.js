/* ------------------------------------------------------------------
   PEAQ – Rendern im Browser (WebCodecs)

   Fügt die aktiven Module zu einer MP4 (H.264) zusammen und brennt die
   Text-Inserts ein – ohne Server, mit Hardware-Encoder.
   Benötigt: app/vendor/mp4box.all.min.js, app/vendor/mp4-muxer.min.js
   ------------------------------------------------------------------ */

window.PeaqRender = (function () {

  /* Gemeinsame Werte für Vorschau, Browser-Render und Server-Export */
  const CONST = {
    MAX_TEXT:   30,      // Zeichen je Insert
    LINE_BREAK: 15,      // ab hier zweizeilig
    SIZE_DIV:   13,      // Schriftgröße = Bildbreite / 13
    TRACK:      -0.03,   // Laufweite in em
    LEAD:       1.14,    // Zeilenabstand
    BASE:       0.57,    // Höhe der Textmitte, Anteil der Bildhöhe
    PAD:        0.06,    // Seitenabstand bei links/rechts
    IN:         1.20,    // Einfahren von unten
    FADE:       0.45,    // Deckkraft beim Einfahren
    OUT:        0.35,    // Hinausfliegen nach oben
    MOVE:       0.030,   // Weg beim Ein-/Ausfahren, Anteil der Bildhöhe
    DRIFT:      0.006,   // Nachgleiten im Stand
    SHADOW:     0.40,    // Deckkraft des Schlagschattens
    SHADOW_SOFT:0.55,    // Weichheit des Schattens, Anteil der Schriftgröße
    CHAR_DUR:   0.40,    // Dauer der Einblendung je Buchstabe
    CHAR_GAP:   0.05,    // Versatz zwischen den Buchstaben
    CHAR_GAUSS: 0.10,    // Gauß-Unschärfe beim Einblenden, Anteil der Schriftgröße
    CHAR_SMEAR: 0.20,    // Richtungsunschärfe vertikal, Anteil der Schriftgröße
    TRANS:      0.60,    // Dauer einer Blende
    TRANS_HALF: 0.30,    // davon je Seite des Schnitts
    FPS:        25
  };

  /* Auswählbare Blenden. Sie verbrauchen keine zusätzliche Zeit, sondern
     liegen über den letzten 0,3 s des einen und den ersten 0,3 s des
     nächsten Moduls. */
  const TRANSITIONS = [
    { id: 'black',  label: 'SCHWARZBLENDE', kurz: 'S' },
    { id: 'leak',   label: 'LICHTLEAK',     kurz: 'L' },
    { id: 'smooth', label: 'SOFT PUSH',     kurz: 'P' }
  ];

  const smoothstep = p => p * p * (3 - 2 * p);

  /* Wirkung der Blende für ein Bild:
     { type, side, s } mit s = 0 (weit weg) bis 1 (direkt am Schnitt) */
  function transitionAt(time, dur, transOut, transIn) {
    const half = CONST.TRANS_HALF;

    if (transIn && transIn !== 'none' && time < half) {
      return { type: transIn, side: 'in', s: smoothstep(Math.max(0, 1 - time / half)) };
    }
    if (transOut && transOut !== 'none' && time > (dur || 4) - half) {
      return { type: transOut, side: 'out', s: smoothstep(Math.max(0, 1 - ((dur || 4) - time) / half)) };
    }
    return null;
  }

  /* Bild zeichnen – mit den Verzerrungen der Blende (vor den Text-Inserts) */
  function drawFrame(ctx, frame, W, H, tr) {
    if (!tr || tr.s <= 0.002) { ctx.drawImage(frame, 0, 0, W, H); return; }

    if (tr.type === 'smooth') {
      /* weicher Schub: leichtes Heranfahren mit auslaufender Unschärfe */
      const zoom = 1 + 0.055 * tr.s;
      const blur = tr.s * W * 0.005;
      const w = W * zoom, h = H * zoom;
      ctx.filter = blur > 0.4 ? 'blur(' + blur.toFixed(2) + 'px)' : 'none';
      ctx.drawImage(frame, (W - w) / 2, (H - h) / 2, w, h);
      ctx.filter = 'none';
      return;
    }

    if (tr.type === 'leak') {
      /* Diagonale Richtungsunschärfe mit leichter Scherung – wie Licht, das
         durch eine Glasscheibe zieht. Beim neuen Video läuft die Verzerrung
         in die andere Richtung wieder zurück. */
      const dir   = tr.side === 'out' ? 1 : -1;
      const smear = tr.s * H * 0.085;
      const blur  = tr.s * W * 0.006;
      const skew  = 0.035 * tr.s * dir;

      ctx.save();
      ctx.filter = blur > 0.4 ? 'blur(' + blur.toFixed(2) + 'px)' : 'none';
      ctx.transform(1, 0, skew, 1, -skew * H / 2, 0);          // Scherung um die Bildmitte

      if (smear > 1.5) {
        const steps = 9;
        ctx.globalAlpha = 1 / steps * 2.1;
        for (let i = 0; i < steps; i++) {
          const k = (i / (steps - 1) - 0.5) * smear;
          ctx.drawImage(frame, k * 0.75 * dir, k, W, H);       // diagonal
        }
      } else {
        ctx.drawImage(frame, 0, 0, W, H);
      }

      ctx.restore();
      ctx.globalAlpha = 1;
      ctx.filter = 'none';
      return;
    }

    ctx.drawImage(frame, 0, 0, W, H);       // black: nur der Schleier danach
  }

  /* Schleier der Blende – nach den Text-Inserts, damit auch sie erfasst werden */
  function paintTransition(ctx, W, H, tr) {
    if (!tr || tr.s <= 0.002) return;

    if (tr.type === 'black') {
      ctx.globalAlpha = tr.s;
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
      return;
    }

    if (tr.type === 'smooth') {
      ctx.globalAlpha = 0.16 * tr.s;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
      return;
    }

    if (tr.type === 'leak') {
      const weich = Math.pow(tr.s, 1.4);
      ctx.globalCompositeOperation = 'screen';

      /* breiter, weicher Streifen zieht diagonal durchs Bild */
      const pos = tr.side === 'out' ? (-0.35 + 1.7 * tr.s) : (1.35 - 1.7 * tr.s);
      const cx  = pos * W;
      const g = ctx.createLinearGradient(cx - W * 0.9, H * 1.1, cx + W * 0.9, -H * 0.1);
      g.addColorStop(0.00, 'rgba(255,255,255,0)');
      g.addColorStop(0.28, 'rgba(255,244,220,' + (0.45 * tr.s).toFixed(3) + ')');
      g.addColorStop(0.50, 'rgba(255,255,255,' + (0.85 * tr.s).toFixed(3) + ')');
      g.addColorStop(0.72, 'rgba(224,238,255,' + (0.45 * tr.s).toFixed(3) + ')');
      g.addColorStop(1.00, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);

      /* helle Blende, die zum Schnitt hin die ganze Mitte einhüllt */
      const r = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.66);
      r.addColorStop(0.00, 'rgba(255,253,246,' + (0.96 * weich).toFixed(3) + ')');
      r.addColorStop(0.45, 'rgba(255,251,240,' + (0.80 * weich).toFixed(3) + ')');
      r.addColorStop(0.78, 'rgba(255,255,255,' + (0.45 * weich).toFixed(3) + ')');
      r.addColorStop(1.00, 'rgba(255,255,255,' + (0.18 * weich).toFixed(3) + ')');
      ctx.fillStyle = r;
      ctx.fillRect(0, 0, W, H);

      ctx.globalCompositeOperation = 'source-over';
    }
  }

  /* Ab 15 Zeichen zweizeilig – möglichst am letzten Wortende davor */
  function textLines(text) {
    const t = String(text || '');
    if (t.length <= CONST.LINE_BREAK) return t ? [t] : [];

    const head  = t.slice(0, CONST.LINE_BREAK + 1);
    const space = head.lastIndexOf(' ');
    const cut   = space > 0 ? space : CONST.LINE_BREAK;

    return [t.slice(0, cut).trim(), t.slice(space > 0 ? cut + 1 : cut).trim()].filter(Boolean);
  }

  /* Position und Deckkraft des Inserts zum Zeitpunkt t (Sekunden im Modul) */
  function insertMotion(t, dur, H) {
    const move  = H * CONST.MOVE;
    const drift = H * CONST.DRIFT;
    const outAt = Math.max(CONST.IN, (dur || 4) - CONST.OUT);

    if (t < outAt) {
      const p = Math.min(1, Math.max(0, t / CONST.IN));
      return {
        y: move * Math.pow(1 - p, 3) - drift * Math.min(1, t / outAt),
        alpha: Math.min(1, t / CONST.FADE)
      };
    }

    const r = Math.min(1, Math.max(0, (t - outAt) / CONST.OUT));
    return { y: -drift - move * Math.pow(r, 3), alpha: 1 - r };
  }

  /* Eine Zeile mit fester Laufweite setzen (Canvas ignoriert letterSpacing teils) */
  function drawTrackedLine(ctx, line, anchorX, y, size, align, charState, baseAlpha, shadow) {
    const track  = size * CONST.TRACK;
    const chars  = Array.from(line);
    const widths = chars.map(ch => ctx.measureText(ch).width);
    const total  = widths.reduce((a, b) => a + b, 0) + track * Math.max(0, chars.length - 1);

    let x = align === 'left' ? anchorX : align === 'right' ? anchorX - total : anchorX - total / 2;

    chars.forEach((ch, i) => {
      const step = charState ? charState() : { done: true };

      if (!step.done) {
        drawSoftChar(ctx, ch, x, y, size, step.progress, baseAlpha, shadow);
      } else if (step.progress !== 0) {
        shadow(1);
        ctx.globalAlpha = baseAlpha;
        ctx.filter = 'none';
        ctx.fillText(ch, x, y);
      }

      x += widths[i] + track;
    });
  }

  /* Buchstabe während der Einblendung.

     Der unscharfe Durchgang wird ohne Schatten gezeichnet – sonst würde der
     Schatten mitverschmieren und sich über die Einzelkopien aufaddieren.
     Parallel blendet ein scharfer Durchgang mit Schatten über, sodass der
     Buchstabe sauber "auflöst". */
  function drawSoftChar(ctx, ch, x, y, size, progress, baseAlpha, shadow) {
    const eased = 1 - Math.pow(1 - progress, 3);
    const alpha = baseAlpha * eased;
    if (alpha <= 0.002) return;

    const gauss = (1 - eased) * size * CONST.CHAR_GAUSS;
    const smear = (1 - eased) * size * CONST.CHAR_SMEAR;

    /* Anteil des scharfen Durchgangs: erst am Ende der Einblendung */
    const crisp = Math.min(1, Math.max(0, (eased - 0.6) / 0.4));

    if (crisp < 1) {
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur  = 0;
      ctx.filter = gauss > 0.3 ? 'blur(' + gauss.toFixed(2) + 'px)' : 'none';

      const weich = alpha * (1 - crisp);

      if (smear > 0.6) {
        const steps = 7;
        ctx.globalAlpha = Math.min(1, weich / steps * 2.4);
        for (let s = 0; s < steps; s++) {
          ctx.fillText(ch, x, y + (s / (steps - 1) - 0.5) * smear);
        }
      } else {
        ctx.globalAlpha = weich;
        ctx.fillText(ch, x, y);
      }

      ctx.filter = 'none';
    }

    if (crisp > 0) {
      shadow(crisp);
      ctx.globalAlpha = alpha * crisp;
      ctx.fillText(ch, x, y);
    }
  }

  /* Text-Insert in einen Canvas zeichnen (statisch oder animiert) */
  function drawInsert(ctx, opts) {
    const lines = textLines(opts.text);
    if (!lines.length) return;

    const W = opts.width;
    const H = opts.height;
    const size = Math.round(W / CONST.SIZE_DIV);
    const pad  = Math.round(W * CONST.PAD);
    const align = opts.align === 'left' || opts.align === 'right' ? opts.align : 'center';

    const motion = opts.time == null ? { y: 0, alpha: 1 } : insertMotion(opts.time, opts.duration, H);
    if (motion.alpha <= 0.002) return;

    const anchorX = align === 'left' ? pad : align === 'right' ? W - pad : W / 2;
    const step    = size * CONST.LEAD;
    const base    = opts.centerY != null ? opts.centerY : H * CONST.BASE;
    const startY  = base + motion.y - (lines.length - 1) * step / 2;

    ctx.save();
    ctx.globalAlpha   = motion.alpha;
    ctx.font          = size + 'px OCRA, monospace';
    ctx.textAlign     = 'left';
    ctx.textBaseline  = 'middle';
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
    ctx.shadowOffsetY = Math.round(size * 0.04);
    ctx.fillStyle     = '#ffffff';

    /* Weicher Schlagschatten, Stärke je nach Schärfe des Buchstabens */
    const shadowBlur = Math.round(size * CONST.SHADOW_SOFT);
    const setShadow  = stark => {
      ctx.shadowColor = 'rgba(0,0,0,' + (CONST.SHADOW * stark).toFixed(3) + ')';
      ctx.shadowBlur  = shadowBlur;
    };

    /* Die Buchstaben blenden nacheinander ein; der Versatz wird so gewählt,
       dass alle innerhalb der Einfahrzeit fertig sind. */
    const count = lines.reduce((n, l) => n + Array.from(l).length, 0);
    const gap   = count > 1
      ? Math.min(CONST.CHAR_GAP, Math.max(0.012, (CONST.IN - CONST.CHAR_DUR) / (count - 1)))
      : 0;

    let index = 0;
    const nextChar = () => {
      const i = index++;
      if (opts.time == null) return { done: true, progress: 1 };          // statisch (PNG)
      const p = (opts.time - i * gap) / CONST.CHAR_DUR;
      if (p <= 0) return { done: false, progress: 0 };
      if (p >= 1) return { done: true, progress: 1 };
      return { done: false, progress: p };
    };

    lines.forEach((line, i) =>
      drawTrackedLine(ctx, line, anchorX, startY + i * step, size, align,
                      nextChar, motion.alpha, setShadow));

    ctx.filter = 'none';
    ctx.restore();
  }

  /* Transparentes PNG für den Server-Export (dort wird es per overlay animiert) */
  async function insertPngDataUrl(text, align, width) {
    if (!text) return null;
    if (document.fonts && document.fonts.ready) await document.fonts.ready;

    const W = width || 3840;
    const H = Math.round(W / CONST.SIZE_DIV * 3.7);        // Platz für zwei Zeilen
    const c = document.createElement('canvas');
    c.width = W; c.height = H;

    const ctx = c.getContext('2d');
    /* Für das PNG ohne Bewegung, mittig im Streifen – die Höhe und die
       Bewegung setzt der Server über den overlay-Filter. */
    drawInsert(ctx, { text, align, width: W, height: H, time: null, centerY: H / 2 });
    return c.toDataURL('image/png');
  }

  /* ---------- Unterstützung prüfen ---------- */

  const supported = () =>
    typeof window.VideoEncoder === 'function' &&
    typeof window.VideoDecoder === 'function' &&
    typeof window.MP4Box === 'object' &&
    typeof window.DataStream === 'function' &&
    typeof window.Mp4Muxer === 'object';

  const CODECS = [
    'avc1.640033', 'avc1.4d0033', 'avc1.640032',
    'avc1.640028', 'avc1.4d0028', 'avc1.42e028'
  ];

  /* Manche Browser antworten auf isConfigSupported gar nicht – deshalb mit Frist */
  const withLimit = (promise, ms) => Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Encoder-Abfrage ohne Antwort')), ms))
  ]);

  async function pickCodec(width, height, bitrate) {
    for (const codec of CODECS) {
      const cfg = {
        codec, width, height, bitrate,
        framerate: CONST.FPS,
        avc: { format: 'avc' },
        latencyMode: 'quality'
      };
      try {
        const res = await withLimit(VideoEncoder.isConfigSupported(cfg), 1500);
        if (res && res.supported) return cfg;
      } catch (e) {
        /* Antwortet der Browser gar nicht, antwortet er auch für die
           übrigen Codecs nicht – dann gleich aufgeben. */
        if (/ohne Antwort/.test(String(e && e.message))) return null;
      }
    }
    return null;
  }

  /* Wirklich ein Bild codieren. Firefox meldet auf isConfigSupported
     "unterstützt", liefert dann aber keine Daten – nur dieser Test ist
     verlässlich. */
  async function encoderWorks(width, height) {
    let settle;
    const result = new Promise(r => { settle = r; });
    let closed = false;
    let encoder = null;

    const finish = ok => {
      if (closed) return;
      closed = true;
      try { if (encoder && encoder.state !== 'closed') encoder.close(); } catch (e) { /* egal */ }
      settle(ok);
    };

    const timer = setTimeout(() => finish(false), 4000);

    try {
      const cfg = await pickCodec(width, height, Math.round(width * height * CONST.FPS * 0.15));
      if (!cfg) { clearTimeout(timer); finish(false); return { ok: false }; }

      encoder = new VideoEncoder({
        output: () => finish(true),
        error:  () => finish(false)
      });
      encoder.configure(cfg);

      const probeCanvas = new OffscreenCanvas(width, height);
      const pctx = probeCanvas.getContext('2d', { alpha: false });
      pctx.fillStyle = '#808080';
      pctx.fillRect(0, 0, width, height);

      const frame = new VideoFrame(probeCanvas, { timestamp: 0, duration: 40000 });
      encoder.encode(frame, { keyFrame: true });
      frame.close();

      encoder.flush().then(() => finish(false), () => finish(false));

      const ok = await result;
      clearTimeout(timer);
      return { ok, codec: cfg.codec };
    } catch (e) {
      clearTimeout(timer);
      finish(false);
      return { ok: false };
    }
  }

  const IS_FIREFOX = /firefox|fxios/i.test(navigator.userAgent || '');

  const softwareResult = grund => ({
    ok: true, mode: 'wasm', codec: 'avc1 (Software)', maxWidth: 1920, grund: grund
  });

  /* Vorab klären, wie dieser Browser H.264 schreiben kann:
     "native"  = WebCodecs-Encoder mit Hardware (Chrome, Edge)
     "wasm"    = mitgelieferter Software-Encoder (Firefox)                  */
  async function probe(opts) {
    const force = (opts && opts.force) || '';

    if (force === 'wasm') return softwareResult('erzwungen');

    /* Firefox hat keinen H.264-Encoder, meldet aber "unterstützt".
       Deshalb dort ohne Umwege den Software-Encoder nehmen. */
    if (IS_FIREFOX && force !== 'native') {
      console.info('[PEAQ] Firefox erkannt – Software-Encoder wird verwendet');
      return softwareResult('firefox');
    }

    const nativeReady =
      typeof window.VideoEncoder === 'function' &&
      typeof window.VideoDecoder === 'function' &&
      typeof window.MP4Box === 'object' &&
      typeof window.Mp4Muxer === 'object' &&
      typeof window.OffscreenCanvas === 'function';

    if (nativeReady) {
      try {
        const hd = await encoderWorks(1920, 1080);
        if (hd.ok) {
          const uhd = await encoderWorks(3840, 2160);
          console.info('[PEAQ] Encoder-Test: HD ok, 4K ' + (uhd.ok ? 'ok' : 'nicht möglich'));
          return {
            ok: true, mode: 'native',
            codec: (uhd.ok ? uhd.codec : hd.codec),
            maxWidth: uhd.ok ? 3840 : 1920
          };
        }
        console.info('[PEAQ] Encoder-Test: kein brauchbarer H.264-Encoder – Software-Encoder wird genutzt');
      } catch (e) { /* weiter zum Software-Encoder */ }
    }

    /* Software-Encoder braucht nur Canvas und ein <video> zum Auslesen */
    if (typeof document.createElement('canvas').getContext === 'function') {
      return softwareResult('kein brauchbarer Encoder im Browser');
    }

    return { ok: false, reason: 'dieser Browser kann kein Video schreiben' };
  }

  /* ---------- Demuxen mit mp4box ---------- */

  function avcDescription(file, trackId) {
    const trak = file.getTrackById(trackId);
    for (const entry of trak.mdia.minf.stbl.stsd.entries) {
      const box = entry.avcC || entry.hvcC;
      if (!box) continue;
      const stream = new DataStream(undefined, 0, DataStream.BIG_ENDIAN);
      box.write(stream);
      return new Uint8Array(stream.buffer, 8);   // Box-Kopf überspringen
    }
    return null;
  }

  /* Herunterladen mit Fortschritt – bei 4K-Clips dauert das auf langsamen
     Leitungen am längsten, deshalb sichtbar machen. */
  async function fetchProgress(url, onBytes) {
    const res = await fetch(url);
    if (!res.ok) throw new Error('Video nicht ladbar (HTTP ' + res.status + ')');

    const total = Number(res.headers.get('content-length')) || 0;
    if (!res.body || !total) return res.arrayBuffer();

    const reader = res.body.getReader();
    const chunks = [];
    let got = 0;

    for (;;) {
      const step = await reader.read();
      if (step.done) break;
      chunks.push(step.value);
      got += step.value.length;
      if (onBytes) onBytes(got, total);
    }

    const all = new Uint8Array(got);
    let off = 0;
    chunks.forEach(c => { all.set(c, off); off += c.length; });
    return all.buffer;
  }

  async function demux(url, onBytes) {
    const buffer = await fetchProgress(url, onBytes);
    buffer.fileStart = 0;

    const file    = MP4Box.createFile();
    const samples = [];
    let info = null, failed = null;

    file.onError    = e => { failed = e; };
    file.onReady    = i => { info = i; };
    file.onSamples  = (id, user, list) => { samples.push.apply(samples, list); };

    file.appendBuffer(buffer);
    if (failed) throw new Error(String(failed));
    if (!info || !info.videoTracks.length) throw new Error('Keine Videospur gefunden');

    const track = info.videoTracks[0];
    file.setExtractionOptions(track.id, null, { nbSamples: 200 });
    file.start();
    file.flush();

    if (!samples.length) throw new Error('Keine Bilddaten gelesen');

    return {
      codec: track.codec,
      width: track.track_width || track.video.width,
      height: track.track_height || track.video.height,
      timescale: track.timescale,
      description: avcDescription(file, track.id),
      samples
    };
  }

  /* Kurz an den Browser abgeben. Über einen MessageChannel, weil setTimeout
     in nicht sichtbaren Tabs auf eine Sekunde gedrosselt wird. */
  const tickChannel = new MessageChannel();
  const tickQueue   = [];
  tickChannel.port1.onmessage = () => { const fn = tickQueue.shift(); if (fn) fn(); };
  const tick = () => new Promise(resolve => { tickQueue.push(resolve); tickChannel.port2.postMessage(0); });

  /* ---------- Rendern mit Software-Encoder (ohne WebCodecs) ---------- */

  let hmeLoading = null;

  function loadHME() {
    if (typeof window.HME !== 'undefined') return Promise.resolve(window.HME);
    if (hmeLoading) return hmeLoading;

    hmeLoading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'vendor/h264-mp4-encoder.web.js';
      s.onload  = () => resolve(window.HME);
      s.onerror = () => reject(new Error('Software-Encoder nicht ladbar'));
      document.head.appendChild(s);
    });
    return hmeLoading;
  }

  /* Bilder über ein <video>-Element holen – funktioniert in jedem Browser */
  function openVideo(src) {
    return new Promise((resolve, reject) => {
      const v = document.createElement('video');
      v.preload = 'auto';
      v.muted = true;
      v.playsInline = true;
      v.addEventListener('loadeddata', () => resolve(v), { once: true });
      v.addEventListener('error', () => reject(new Error('Video nicht ladbar')), { once: true });
      v.src = src;
    });
  }

  const seekTo = (v, t) => new Promise(resolve => {
    v.addEventListener('seeked', resolve, { once: true });
    v.currentTime = t;
  });

  async function renderWasm(opts) {
    const items  = opts.items || [];
    const W      = opts.width;
    const H      = opts.height;
    const report = opts.onProgress || function () {};
    const stopped = () => opts.cancelled && opts.cancelled();

    const HMElib = await loadHME();
    const enc = await HMElib.createH264MP4Encoder();
    enc.width  = W;
    enc.height = H;
    enc.frameRate = CONST.FPS;
    enc.quantizationParameter = 22;      // Qualität (klein = besser)
    enc.speed = 5;                       // 0 langsam/gut … 10 schnell
    enc.groupOfPictures = CONST.FPS;
    enc.initialize();

    console.info('[PEAQ] Software-Render', W + '×' + H, items.length + ' Module');

    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: true });

    const totalFrames = items.reduce((s, it) => s + Math.round((it.duration || 4) * CONST.FPS), 0);
    let done = 0;

    try {
      for (let m = 0; m < items.length; m++) {
        if (stopped()) throw new Error('abgebrochen');

        const item = items[m];
        report({ phase: 'load', module: m + 1, modules: items.length,
                 percent: done / totalFrames * 100 });

        const video = await openVideo(item.src);
        const dur   = item.duration || video.duration || 4;
        const count = Math.round(dur * CONST.FPS);

        for (let i = 0; i < count; i++) {
          if (stopped()) { video.src = ''; throw new Error('abgebrochen'); }

          const t = Math.min(Math.max(0, dur - 0.001), (i + 0.5) / CONST.FPS);
          await seekTo(video, t);

          const tLocal = i / CONST.FPS;
          const tr = transitionAt(tLocal, dur, item.transOut, item.transIn);

          drawFrame(ctx, video, W, H, tr);
          drawInsert(ctx, { text: item.text, align: item.align, width: W, height: H,
                            time: tLocal, duration: dur });
          paintTransition(ctx, W, H, tr);

          enc.addFrameRgba(ctx.getImageData(0, 0, W, H).data);
          done++;

          if (i % 5 === 0 || i === count - 1) {
            report({ phase: 'encode', module: m + 1, modules: items.length,
                     frames: done, totalFrames, percent: done / totalFrames * 100 });
          }

          /* nach jedem Bild abgeben, damit die Seite bedienbar bleibt */
          await tick();
        }

        video.src = '';
      }

      report({ phase: 'finish', percent: 99 });
      enc.finalize();
      const bytes = enc.FS.readFile(enc.outputFilename);
      const blob  = new Blob([bytes], { type: 'video/mp4' });
      enc.delete();

      report({ phase: 'done', percent: 100 });
      return { blob, width: W, height: H, codec: 'avc1 (Software)' };

    } catch (err) {
      try { enc.delete(); } catch (e) { /* egal */ }
      throw err;
    }
  }

  /* ---------- Rendern ---------- */

  /* items: [{ src, text, align, duration }]  ->  Blob (video/mp4) */
  async function render(opts) {
    /* Ohne WebCodecs-Encoder (z. B. Firefox) über den Software-Encoder */
    if (opts.mode === 'wasm' || !supported()) return renderWasm(opts);

    try {
      return await renderNative(opts);
    } catch (err) {
      /* Encoder war doch untauglich – ohne Zutun auf Software umschalten */
      if (err && err.encoderDead) {
        console.warn('[PEAQ] WebCodecs-Encoder untauglich, wechsle auf Software-Encoder');
        if (opts.onProgress) opts.onProgress({ phase: 'fallback', software: true, percent: 0 });
        const size = opts.width > 1920
          ? Object.assign({}, opts, { width: 1920, height: 1080 })
          : opts;
        return renderWasm(size);
      }
      throw err;
    }
  }

  async function renderNative(opts) {

    const items   = opts.items || [];
    const W       = opts.width;
    const H       = opts.height;
    const report  = opts.onProgress || function () {};
    const stopped = () => opts.cancelled && opts.cancelled();

    if (!items.length) throw new Error('Kein aktives Modul');

    /* Kann der Rechner die Wunschauflösung nicht codieren, auf HD ausweichen */
    let outW = W, outH = H;
    let config = await pickCodec(outW, outH, Math.round(outW * outH * CONST.FPS * 0.15));

    if (!config && (W > 1920 || H > 1080)) {
      outW = 1920; outH = 1080;
      config = await pickCodec(outW, outH, Math.round(outW * outH * CONST.FPS * 0.15));
      if (config) report({ phase: 'fallback', width: outW, height: outH, percent: 0 });
    }
    if (!config) throw new Error('Dieser Rechner hat keinen H.264-Encoder für ' + W + '×' + H);

    console.info('[PEAQ] Render', outW + '×' + outH, config.codec, items.length + ' Module');

    const totalFrames = items.reduce((sum, it) => sum + Math.round((it.duration || 4) * CONST.FPS), 0);
    let doneFrames = 0;

    /* Wachhund: wenn nichts mehr passiert, mit klarer Meldung abbrechen */
    let lastMove = Date.now();
    const touch   = () => { lastMove = Date.now(); };
    const stalled = () => Date.now() - lastMove > 45000;
    const guard = () => {
      if (encodeError) throw encodeError;
      if (stopped())   throw new Error('abgebrochen');
      if (stalled())   throw new Error('Rendern hängt – bitte HD statt 4K wählen oder Chrome neu starten');
    };

    const canvas = new OffscreenCanvas(outW, outH);
    const ctx    = canvas.getContext('2d', { alpha: false });

    const { Muxer, ArrayBufferTarget } = Mp4Muxer;
    const target = new ArrayBufferTarget();
    const muxer  = new Muxer({
      target,
      video: { codec: 'avc', width: outW, height: outH, frameRate: CONST.FPS },
      fastStart: 'in-memory'
    });

    let encodeError = null;
    let chunkCount  = 0;
    const encoder = new VideoEncoder({
      output: (chunk, meta) => { chunkCount++; muxer.addVideoChunk(chunk, meta); },
      error:  e => { encodeError = e; }
    });
    encoder.configure(config);

    const frameDur = Math.round(1e6 / CONST.FPS);
    let globalUs   = 0;

    try {
      for (let m = 0; m < items.length; m++) {
        if (stopped()) throw new Error('abgebrochen');

        const item        = items[m];
        const moduleStart = Date.now();
        const share       = Math.round((item.duration || 4) * CONST.FPS);

        report({ phase: 'load', module: m + 1, modules: items.length,
                 percent: doneFrames / totalFrames * 100 });

        const media = await demux(item.src, (got, all) => {
          touch();
          report({
            phase: 'load', module: m + 1, modules: items.length,
            loaded: Math.round(got / all * 100),
            percent: (doneFrames + share * 0.25 * (got / all)) / totalFrames * 100
          });
        });

        const dur = item.duration || (media.samples.length / CONST.FPS);

        const pending = [];
        const decoder = new VideoDecoder({
          output: frame => pending.push(frame),
          error:  e => { encodeError = encodeError || e; }
        });
        decoder.configure({
          codec: media.codec,
          description: media.description || undefined,
          hardwareAcceleration: 'no-preference'
        });

        let firstOfModule = true;

        /* Fertige Bilder zeichnen, Text einbrennen und codieren */
        const drainFrames = async () => {
          while (pending.length) {
            const frame = pending.shift();
            const tLocal = frame.timestamp / 1e6;

            const tr = transitionAt(tLocal, dur, item.transOut, item.transIn);

            drawFrame(ctx, frame, outW, outH, tr);
            frame.close();

            drawInsert(ctx, { text: item.text, align: item.align, width: outW, height: outH,
                              time: tLocal, duration: dur });

            paintTransition(ctx, outW, outH, tr);

            const out = new VideoFrame(canvas, { timestamp: globalUs, duration: frameDur });
            encoder.encode(out, { keyFrame: firstOfModule });
            out.close();

            firstOfModule = false;
            globalUs += frameDur;
            doneFrames++;
            touch();

            /* Notbremse: liefert der Encoder nach 20 Bildern nichts,
               taugt er nicht (so verhält sich Firefox) */
            if (doneFrames === 20 && chunkCount === 0) {
              const dead = new Error('Encoder liefert keine Daten');
              dead.encoderDead = true;
              throw dead;
            }

            while (encoder.encodeQueueSize > 8) { await tick(); guard(); }
          }

          report({ phase: 'encode', module: m + 1, modules: items.length,
                   frames: doneFrames, totalFrames,
                   percent: doneFrames / totalFrames * 100 });
        };

        /* Durchgehend decodieren – ein flush() zwischendurch würde einen
           neuen Keyframe verlangen. */
        for (const s of media.samples) {
          guard();

          decoder.decode(new EncodedVideoChunk({
            type: s.is_sync ? 'key' : 'delta',
            timestamp: Math.round(s.cts / s.timescale * 1e6),
            duration:  Math.round(s.duration / s.timescale * 1e6),
            data: s.data
          }));

          if (pending.length >= 6) await drainFrames();
          while (decoder.decodeQueueSize > 16) { await tick(); await drainFrames(); guard(); }
        }

        await decoder.flush();
        await drainFrames();
        decoder.close();

        console.info('[PEAQ] Modul ' + (m + 1) + '/' + items.length + ' fertig in ' +
                     (Date.now() - moduleStart) + ' ms');
      }

      report({ phase: 'finish', percent: 99 });
      await encoder.flush();
      encoder.close();
      muxer.finalize();

      if (encodeError) throw encodeError;

      report({ phase: 'done', percent: 100 });
      return {
        blob: new Blob([target.buffer], { type: 'video/mp4' }),
        width: outW, height: outH, codec: config.codec
      };

    } catch (err) {
      try { encoder.close(); } catch (e) { /* egal */ }
      throw err;
    }
  }

  return { CONST, TRANSITIONS, textLines, insertMotion, transitionAt, drawFrame, paintTransition,
           drawInsert, insertPngDataUrl, supported, probe, render };

})();
