/* Lokaler Server für den PEAQ Modul-Konfigurator.
   Start:  node server.js   ->  http://localhost:8123/app/

   - liefert die Anwendung und die Videos aus (mit Range-Support fürs Scrubbing)
   - /api/export  fügt die gewählten Module per ffmpeg zu einer MP4 (H.264) zusammen
   - /api/upload  nimmt selbst hochgeladene Clips entgegen, damit sie mit exportiert werden */

const http = require('http');
const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { spawn, spawnSync } = require('child_process');

const ROOT       = __dirname;
const PORT       = process.env.PORT || 8123;
const EXPORT_DIR = path.join(ROOT, 'Export');
const UPLOAD_DIR = path.join(EXPORT_DIR, '_upload');
const CLIP_DIR   = path.join(ROOT, 'Footage', 'Modul Videos');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg':  'image/svg+xml',
  '.ttf':  'font/ttf',
  '.woff2':'font/woff2',
  '.mp4':  'video/mp4',
  '.webm': 'video/webm',
  '.mov':  'video/quicktime'
};

/* ---------------- ffmpeg finden ---------------- */

const FFMPEG_CANDIDATES = [
  process.env.FFMPEG,
  'ffmpeg',
  'C:\\Program Files\\Topaz Labs LLC\\Topaz Video AI\\ffmpeg.exe',
  'C:\\Program Files\\Topaz Labs LLC\\Topaz Video\\ffmpeg.exe',
  'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe',
  'C:\\ffmpeg\\bin\\ffmpeg.exe',
  'C:\\Program Files (x86)\\Common Files\\DVDVideoSoft\\lib\\ffmpeg.exe'
].filter(Boolean);

const FFMPEG = (() => {
  for (const bin of FFMPEG_CANDIDATES) {
    const probe = spawnSync(bin, ['-hide_banner', '-version'], { encoding: 'utf8' });
    if (!probe.error && probe.status === 0) {
      const enc = spawnSync(bin, ['-hide_banner', '-encoders'], { encoding: 'utf8' }).stdout || '';
      const probeBin = bin.replace(/ffmpeg(\.exe)?$/i, (m, ext) => 'ffprobe' + (ext || ''));
      return {
        bin,
        probe: probeBin !== bin && fs.existsSync(probeBin) ? probeBin : null,
        version: (probe.stdout || '').split('\n')[0].trim(),
        x264:  /\slibx264\s/.test(enc),
        nvenc: /\sh264_nvenc\s/.test(enc)
      };
    }
  }
  return null;
})();

/* Auflösung, Codec und Länge einer Datei ermitteln */
function inspect(file) {
  if (FFMPEG && FFMPEG.probe) {
    const r = spawnSync(FFMPEG.probe, [
      '-v', 'error', '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height,codec_name:format=duration',
      '-of', 'json', file
    ], { encoding: 'utf8' });

    try {
      const data = JSON.parse(r.stdout || '{}');
      const s    = data.streams[0];
      if (s && s.width > 0 && s.height > 0) {
        return {
          width: s.width,
          height: s.height,
          codec: s.codec_name,
          duration: parseFloat((data.format || {}).duration) || 0
        };
      }
    } catch (e) { /* Rückfall unten */ }
  }

  /* Ohne ffprobe: Angaben aus der ffmpeg-Ausgabe lesen */
  const r    = spawnSync(FFMPEG.bin, ['-hide_banner', '-i', file], { encoding: 'utf8' });
  const line = (r.stderr || '').match(/Video:\s*(\w+).*?,\s*(\d{2,5})x(\d{2,5})/);
  const dur  = (r.stderr || '').match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/);

  if (!line) return null;
  return {
    codec: line[1],
    width: +line[2],
    height: +line[3],
    duration: dur ? (+dur[1] * 3600 + +dur[2] * 60 + +dur[3]) : 0
  };
}

/* ---------------- Text-Inserts einbrennen ---------------- */

/* Die Anwendung liefert je Insert ein transparentes PNG (in OCR-A gesetzt,
   3840 px breit). Es wird auf die Ausgabebreite skaliert, weich ein- und
   ausgeblendet und dabei um wenige Pixel nach oben bzw. unten bewegt. */

/* Bewegung der Inserts – identisch zur Vorschau (app/js/dashboard.js) */
const TEXT_IN    = 1.20;     /* Einfahren von unten, langsam auslaufend */
const TEXT_FADE  = 0.45;     /* Deckkraft beim Einfahren */
const TEXT_OUT   = 0.35;     /* Hinausfliegen nach oben, beschleunigend */
const TEXT_MOVE  = 0.030;    /* Weg beim Ein-/Ausfahren, Anteil der Bildhöhe */
const TEXT_DRIFT = 0.006;    /* leichtes Nachgleiten im Stand */
const TEXT_BASE  = 0.57;     /* Höhe der Textmitte, Anteil der Bildhöhe (knapp unter der Mitte) */

const sanitizeText = t => String(t || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 12);

/* Das PNG wird über den movie-Filter geladen (nicht als weiterer Eingang –
   ein geloopter Bild-Eingang verhindert das saubere Ende der concat-Kette). */
function insertOverlay(pngFile, label, dur, W, H) {
  const move  = Math.max(6, Math.round(H * TEXT_MOVE));
  const drift = Math.max(2, Math.round(H * TEXT_DRIFT));
  const len   = (dur || 4).toFixed(3);
  const outAt = Math.max(TEXT_IN + 0.2, (dur || 4) - TEXT_OUT);
  const baseY = `${Math.round(H * TEXT_BASE)}-h/2`;

  /* Schnell von unten herein, weich auslaufend, ohne Stillstand weiter nach oben
     gleiten und am Ende beschleunigt nach oben hinausfliegen. */
  const pIn  = `min(1\\,max(0\\,t/${TEXT_IN}))`;
  const pOut = `min(1\\,max(0\\,(t-${outAt.toFixed(3)})/${TEXT_OUT}))`;

  const y = `if(lt(t\\,${outAt.toFixed(3)})\\,` +
              `${baseY}+${move}*pow(1-${pIn}\\,3)-${drift}*min(1\\,t/${outAt.toFixed(3)})\\,` +
              `${baseY}-${drift}-${move}*pow(${pOut}\\,3))`;

  const png = pngFile.replace(/\\/g, '/').replace(/:/g, '\\:');

  return {
    chain: `movie='${png}':loop=0,setpts=N/25/TB,format=rgba,` +
           `scale=${W}:-1:flags=lanczos,` +
           `fade=in:st=0:d=${TEXT_FADE}:alpha=1,` +
           `fade=out:st=${outAt.toFixed(3)}:d=${TEXT_OUT}:alpha=1,` +
           `trim=0:${len}[${label}]`,
    overlay: `overlay=x=(W-w)/2:y='${y}':eval=frame:format=auto`
  };
}

/* ---------------- Hilfen ---------------- */

function json(res, code, obj) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': body.length });
  res.end(body);
}

function readBody(req, limitBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > limitBytes) { reject(new Error('Datei zu groß')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/* Pfad aus der Anwendung ('../Footage/…' oder 'Export/_upload/…') sicher auflösen */
function resolveInsideRoot(rel) {
  const clean = decodeURIComponent(String(rel)).replace(/^(\.\.\/)+/, '').replace(/^[\\/]+/, '');
  const abs = path.resolve(ROOT, clean);
  if (!abs.startsWith(ROOT) || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) return null;
  return abs;
}

function stamp() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function runFfmpeg(args) {
  return new Promise(resolve => {
    const proc = spawn(FFMPEG.bin, args);
    let log = '';
    proc.stderr.on('data', d => { log += d.toString(); });
    proc.on('error', err => resolve({ ok: false, log: String(err) }));
    proc.on('close', code => resolve({ ok: code === 0, log: log.slice(-4000) }));
  });
}

/* ---------------- Clip-Bibliothek aus dem Footage-Ordner ---------------- */

/* Kennzeichnung für Alternativen desselben Moduls */
const VARIANT_RX = /variante/i;

/* Dateinamen im Schema "<Nr> - Modul - <Name>.mp4" werden zu Modulgruppen */
function scanLibrary() {
  if (!fs.existsSync(CLIP_DIR)) return { clips: [], modules: [] };

  const files = fs.readdirSync(CLIP_DIR)
    .filter(f => /\.(mp4|mov|webm|m4v)$/i.test(f))
    .sort((a, b) => a.localeCompare(b, 'de', { numeric: true }));

  const clips = files.map(file => {
    const base  = file.replace(/\.[^.]+$/, '');
    const match = base.match(/^\s*(\d+)\s*[-–]\s*Modul\s*[-–]\s*(.+?)\s*$/i);
    const group = match ? parseInt(match[1], 10) : null;
    const name  = match ? match[2] : base;

    return {
      id: base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
      label: name.toUpperCase(),
      group,
      src: '../Footage/Modul Videos/' + file,
      size: fs.statSync(path.join(CLIP_DIR, file)).size
    };
  });

  /* Clips mit "Variante" im Namen sind Alternativen EINES Moduls –
     alle übrigen Clips sind eigene Module und laufen nacheinander. */
  clips.forEach(c => { c.variant = VARIANT_RX.test(c.label); });

  const order   = [];
  const byGroup = new Map();

  clips.forEach(c => {
    const key = c.group === null ? 'x' + c.id : c.group;
    if (!byGroup.has(key)) { byGroup.set(key, []); order.push(key); }
    byGroup.get(key).push(c);
  });

  const modules = [];
  order.forEach(key => {
    const list = byGroup.get(key);
    const varianten = list.filter(c => c.variant);

    if (varianten.length) modules.push({ clip: varianten[0].id });
    list.filter(c => !c.variant).forEach(c => modules.push({ clip: c.id }));
  });

  return { clips, modules };
}

/* ---------------- Export ---------------- */

async function handleExport(req, res) {
  if (!FFMPEG) {
    json(res, 501, {
      error: 'ffmpeg nicht gefunden. Bitte ffmpeg installieren (z. B. "winget install Gyan.FFmpeg") ' +
             'oder den Pfad über die Umgebungsvariable FFMPEG setzen.'
    });
    return;
  }

  let payload;
  try {
    payload = JSON.parse((await readBody(req, 32 * 1024 * 1024)).toString('utf8'));
  } catch (e) {
    json(res, 400, { error: 'Ungültige Anfrage' });
    return;
  }

  const items = (payload.items || []).map(it => ({
    file: resolveInsideRoot(it.path || it),
    text: sanitizeText(it.text),
    png:  typeof it.png === 'string' ? it.png : null
  }));
  const files = items.map(it => it.file);

  if (!files.length || files.some(f => !f)) {
    json(res, 400, { error: 'Mindestens ein Modul-Video wurde nicht gefunden.' });
    return;
  }

  /* Text-Inserts als PNG zwischenspeichern */
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const tempPngs = [];

  items.forEach((it, i) => {
    if (!it.text || !it.png) { it.pngFile = null; return; }
    const data = it.png.replace(/^data:image\/png;base64,/, '');
    const file = path.join(UPLOAD_DIR, `insert-${Date.now()}-${i}.png`);
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
    it.pngFile = file;
    tempPngs.push(file);
  });

  const hasText = items.some(it => it.pngFile);

  fs.mkdirSync(EXPORT_DIR, { recursive: true });

  const listPath = path.join(os.tmpdir(), `peaq-concat-${Date.now()}.txt`);
  fs.writeFileSync(
    listPath,
    files.map(f => `file '${f.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n'),
    'utf8'
  );

  const name = `PEAQ_Gesamtvideo_${stamp()}.mp4`;
  const out  = path.join(EXPORT_DIR, name);

  /* Passen alle Clips zueinander, wird verlustfrei kopiert */
  const specs   = files.map(inspect);
  const known   = specs.filter(Boolean);
  const uniform = known.length === files.length && known.every(s =>
    s.width === known[0].width && s.height === known[0].height && s.codec === known[0].codec);

  let result = { ok: false, log: '' };
  let mode   = 'copy';
  let target = known.length ? { width: known[0].width, height: known[0].height } : null;

  /* Mit Text-Inserts muss codiert werden – Kopieren kann keinen Text einbrennen */
  if (uniform && !hasText) {
    result = await runFfmpeg([
      '-hide_banner', '-y', '-f', 'concat', '-safe', '0', '-i', listPath,
      '-c', 'copy', '-movflags', '+faststart', out
    ]);
  }

  /* Sonst: auf die größte Auflösung skalieren, Texte einbrennen und neu codieren */
  if (!result.ok) {
    const encoder = FFMPEG.x264
      ? ['-c:v', 'libx264', '-preset', 'medium', '-crf', '18']
      : FFMPEG.nvenc
        ? ['-c:v', 'h264_nvenc', '-preset', 'p5', '-rc', 'vbr', '-cq', '20', '-b:v', '0']
        : null;

    if (!encoder) {
      try { fs.unlinkSync(listPath); } catch (e) { /* egal */ }
      json(res, 500, { error: 'Kein H.264-Encoder verfügbar und verlustfreies Zusammenfügen nicht möglich.' });
      return;
    }

    const W = known.length ? Math.max.apply(null, known.map(s => s.width))  : 3840;
    const H = known.length ? Math.max.apply(null, known.map(s => s.height)) : 2160;
    target  = { width: W, height: H };
    mode    = FFMPEG.x264 ? 'libx264' : 'h264_nvenc';

    const inputs = [];
    files.forEach(f => inputs.push('-i', f));

    const chains = [];

    items.forEach((it, i) => {
      const base = `[${i}:v]scale=${W}:${H}:force_original_aspect_ratio=decrease:flags=lanczos,` +
                   `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=25,format=yuv420p`;

      if (it.pngFile) {
        const ov = insertOverlay(it.pngFile, 'o' + i, (specs[i] || {}).duration, W, H);
        chains.push(base + `[b${i}]`);
        chains.push(ov.chain);
        chains.push(`[b${i}][o${i}]${ov.overlay},format=yuv420p[v${i}]`);
      } else {
        chains.push(base + `[v${i}]`);
      }
    });

    const filter = chains.join(';') + ';' +
      files.map((f, i) => `[v${i}]`).join('') + `concat=n=${files.length}:v=1:a=0[out]`;

    result = await runFfmpeg(
      ['-hide_banner', '-y'].concat(inputs, [
        '-filter_complex', filter, '-map', '[out]'
      ], encoder, ['-movflags', '+faststart', out])
    );
  }

  try { fs.unlinkSync(listPath); } catch (e) { /* egal */ }
  tempPngs.forEach(f => { try { fs.unlinkSync(f); } catch (e) { /* egal */ } });

  if (!result.ok || !fs.existsSync(out)) {
    json(res, 500, { error: 'Export fehlgeschlagen.', detail: result.log });
    return;
  }

  json(res, 200, {
    name,
    url: '/Export/' + encodeURIComponent(name) + '?dl=1',
    size: fs.statSync(out).size,
    mode,
    inserts: items.filter(it => it.pngFile).length,
    resolution: target ? target.width + 'x' + target.height : null,
    ffmpeg: FFMPEG.version
  });
}

async function handleUpload(req, res, query) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });

  const safe = (query.get('name') || 'clip.mp4').replace(/[^\w.\- ]+/g, '_').slice(-60);
  const file = `${Date.now()}-${safe}`;
  const abs  = path.join(UPLOAD_DIR, file);

  try {
    fs.writeFileSync(abs, await readBody(req, 2 * 1024 * 1024 * 1024));
  } catch (e) {
    json(res, 413, { error: String(e.message || e) });
    return;
  }

  json(res, 200, { path: 'Export/_upload/' + file });
}

/* ---------------- Server ---------------- */

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const rel = decodeURIComponent(url.pathname);

  if (req.method === 'POST' && rel === '/api/export') return handleExport(req, res);
  if (req.method === 'POST' && rel === '/api/upload') return handleUpload(req, res, url.searchParams);

  if (rel === '/api/library') {
    try {
      return json(res, 200, scanLibrary());
    } catch (e) {
      return json(res, 500, { error: String(e.message || e) });
    }
  }

  if (rel === '/api/status') {
    return json(res, 200, FFMPEG
      ? { ffmpeg: FFMPEG.version, bin: FFMPEG.bin, x264: FFMPEG.x264, nvenc: FFMPEG.nvenc }
      : { ffmpeg: null });
  }

  if (rel === '/') {
    res.writeHead(302, { Location: '/app/index.html' }).end();
    return;
  }

  let target = rel.endsWith('/') ? rel + 'index.html' : rel;
  const file = path.join(ROOT, path.normalize(target).replace(/^([\\/])+/, ''));

  if (!file.startsWith(ROOT)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  fs.stat(file, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404 – nicht gefunden');
      return;
    }

    const type  = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
    const range = req.headers.range;
    const extra = url.searchParams.get('dl')
      ? { 'Content-Disposition': 'attachment; filename="' + path.basename(file) + '"' }
      : {};

    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range) || [];
      const start = m[1] ? parseInt(m[1], 10) : 0;
      const end   = m[2] ? parseInt(m[2], 10) : stat.size - 1;

      res.writeHead(206, Object.assign({
        'Content-Type': type,
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': end - start + 1
      }, extra));
      fs.createReadStream(file, { start, end }).pipe(res);
    } else {
      res.writeHead(200, Object.assign({
        'Content-Type': type,
        'Content-Length': stat.size,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-cache'
      }, extra));
      fs.createReadStream(file).pipe(res);
    }
  });
}).listen(PORT, () => {
  console.log('PEAQ Konfigurator läuft: http://localhost:' + PORT + '/app/');
  console.log(FFMPEG ? 'Export über: ' + FFMPEG.bin : 'Hinweis: ffmpeg nicht gefunden – Export deaktiviert.');
});
