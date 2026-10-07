const { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const { Store, DEFAULT_SETTINGS, READING_KEYS } = require('./lib/store');
const { readEpubMeta } = require('./lib/epubMeta');
const { BOOK_FILE, formatOf, detailsFromFilename, BOOK_EXTENSIONS } = require('./lib/formats');
const { buildFontCss } = require('./lib/fonts');
const { fontInfo, FORMATS } = require('./lib/fontInfo');

let win = null;
let store = null;
let dirs = null;
const pendingOpen = [];

const TITLEBAR = {
  linen: { color: '#00000000', symbolColor: '#5b4632' },
  parchment: { color: '#00000000', symbolColor: '#5a4127' },
  dusk: { color: '#00000000', symbolColor: '#d9cbb0' },
};

if (process.env.AION_DATA_DIR) app.setPath('userData', process.env.AION_DATA_DIR);

// ---------- single instance + "Open with" ----------
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    queueBookArgs(argv);
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
      flushPendingOpen();
    }
  });
}

function queueBookArgs(argv) {
  for (const a of argv.slice(1)) {
    if (BOOK_FILE.test(a) && fs.existsSync(a)) pendingOpen.push(a);
  }
}

async function flushPendingOpen() {
  if (!win || !pendingOpen.length) return;
  const paths = pendingOpen.splice(0);
  const result = await importFiles(paths);
  const id = result.ids[result.ids.length - 1];
  if (id) win.webContents.send('library:open-book', id);
}

// ---------- library helpers ----------
function bookView(b) {
  // The grid shows small thumbnails; fall back to the original if there isn't one yet.
  let coverUrl = null;
  if (b.cover) {
    const thumb = path.join(dirs.thumbs, thumbName(b.cover));
    coverUrl = pathToFileURL(fs.existsSync(thumb) ? thumb : path.join(dirs.covers, b.cover)).href;
  }
  return { ...b, coverUrl };
}

// ---------- cover thumbnails ----------
// Book covers are often several megabytes; decoding 100+ of them for a grid of
// small cards wastes hundreds of MB. Keep a ~360px JPEG copy for display.
const thumbName = (cover) => `${path.parse(cover).name}.jpg`;

// Where a book's file lives in the library (older books are all EPUBs).
function bookPath(book) {
  return path.join(dirs.books, `${book.id}.${book.format || 'epub'}`);
}

function makeThumb(cover) {
  try {
    const img = nativeImage.createFromPath(path.join(dirs.covers, cover));
    if (img.isEmpty()) return false;
    const { width } = img.getSize();
    const small = width > 360 ? img.resize({ width: 360, quality: 'good' }) : img;
    fs.writeFileSync(path.join(dirs.thumbs, thumbName(cover)), small.toJPEG(84));
    return true;
  } catch {
    return false;
  }
}

async function backfillThumbs() {
  let made = 0;
  for (const b of store.data.books) {
    if (!b.cover || fs.existsSync(path.join(dirs.thumbs, thumbName(b.cover)))) continue;
    if (makeThumb(b.cover)) made++;
    await new Promise((r) => setImmediate(r)); // keep the app responsive
  }
  if (made) notify();
}

function snapshot() {
  return {
    books: store.data.books.map(bookView),
    shelves: store.data.shelves,
    settings: store.data.settings,
    orders: store.data.orders,
    fonts: fontFamilies(),
  };
}

// ---------- custom fonts ----------
function fontFamilies() {
  const fams = new Map();
  for (const f of store.data.fonts) {
    if (!fams.has(f.family)) fams.set(f.family, { family: f.family, faces: 0 });
    fams.get(f.family).faces++;
  }
  return [...fams.values()];
}

function customFontCss() {
  const out = {};
  for (const f of store.data.fonts) {
    const file = path.join(dirs.fonts, f.file);
    if (!fs.existsSync(file)) continue;
    const [fmt, mime] = FORMATS[path.extname(f.file).toLowerCase()] || ['truetype', 'font/ttf'];
    const b64 = fs.readFileSync(file).toString('base64');
    out[f.family] =
      (out[f.family] || '') +
      `@font-face{font-family:'${f.family.replace(/'/g, "\\'")}';font-style:${f.style};font-weight:${f.weight};` +
      `font-display:swap;src:url(data:${mime};base64,${b64}) format('${fmt}');}\n`;
  }
  return out;
}

const BUNDLED_FAMILIES = ['EB Garamond', 'Literata', 'Lora', 'IM Fell English'];

function addFonts(files) {
  const added = new Set();
  const failed = [];
  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    if (!FORMATS[ext]) {
      failed.push({ name: path.basename(file), reason: 'Not a font file' });
      continue;
    }
    try {
      const buf = fs.readFileSync(file);
      if (buf.length > 15 * 1024 * 1024) throw new Error('Larger than 15 MB');
      let { family, weight, style } = fontInfo(buf, file);
      family = family.replace(/['"\\<>;{}]/g, '').trim().slice(0, 60) || 'My font';
      if (BUNDLED_FAMILIES.includes(family)) family = `${family} (yours)`;
      const id = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 12);
      if (store.data.fonts.some((f) => f.id === id)) {
        added.add(family);
        continue;
      }
      // A second file with the same weight & style replaces the first.
      store.data.fonts = store.data.fonts.filter((f) => !(f.family === family && f.weight === weight && f.style === style));
      const name = `${id}${ext}`;
      fs.writeFileSync(path.join(dirs.fonts, name), buf);
      store.data.fonts.push({ id, family, weight, style, file: name });
      added.add(family);
    } catch (err) {
      failed.push({ name: path.basename(file), reason: err.message });
    }
  }
  store.save();
  return { added: [...added], failed };
}

// ---------- reading stats ----------
function dayKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function findBook(id) {
  return store.data.books.find((b) => b.id === id);
}

function collectBooks(p, out = []) {
  let stat;
  try {
    stat = fs.statSync(p);
  } catch {
    return out;
  }
  if (stat.isDirectory()) {
    let entries = [];
    try {
      entries = fs.readdirSync(p);
    } catch {
      return out;
    }
    for (const name of entries) {
      if (name.startsWith('.')) continue;
      collectBooks(path.join(p, name), out);
    }
  } else if (BOOK_FILE.test(p)) {
    out.push(p);
  }
  return out;
}

async function importFiles(inputPaths, { quiet = false } = {}) {
  const files = [...new Set(inputPaths.flatMap((p) => collectBooks(p)))];
  const added = [];
  const ids = [];
  const failed = [];
  let i = 0;
  const known = new Set(store.data.books.map((b) => b.sourcePath));

  for (const file of files) {
    i += 1;
    // Watched-folder scans skip files we've already imported from that exact path.
    if (quiet && known.has(file)) continue;
    if (!quiet) win?.webContents.send('import:progress', { done: i - 1, total: files.length, name: path.basename(file) });
    try {
      const buf = fs.readFileSync(file);
      const id = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 16);
      ids.push(id);
      if (findBook(id)) continue; // already in the library

      // EPUB details are read here; other formats get a title from the file name
      // for now, and the reader fills in the rest (see Reader.fillMissingMeta).
      const format = formatOf(file);
      const meta = format === 'epub' ? await readEpubMeta(buf) : detailsFromFilename(file);
      fs.writeFileSync(bookPath({ id, format }), buf);

      let cover = null;
      if (meta.cover) {
        cover = `${id}${meta.cover.ext}`;
        fs.writeFileSync(path.join(dirs.covers, cover), meta.cover.data);
        makeThumb(cover);
      }

      const book = {
        id,
        title: meta.title,
        author: meta.author,
        description: meta.description,
        publisher: meta.publisher,
        language: meta.language,
        published: meta.published,
        subjects: meta.subjects,
        series: meta.series,
        seriesIndex: meta.seriesIndex,
        seriesChecked: true,
        format,
        needsMeta: format !== 'epub',
        cover,
        sourcePath: file,
        size: buf.length,
        addedAt: Date.now(),
        lastOpenedAt: 0,
        progress: 0,
        location: null,
        finished: false,
        favorite: false,
        shelves: [],
        bookmarks: [],
        highlights: [],
      };
      store.data.books.push(book);
      added.push(id);
    } catch (err) {
      failed.push({ name: path.basename(file), reason: err.message });
    }
  }

  if (added.length) store.save();
  if (!quiet) win?.webContents.send('import:progress', { done: files.length, total: files.length, finished: true });
  return { added: added.length, found: files.length, ids, failed, library: snapshot() };
}

function notify() {
  win?.webContents.send('library:changed', snapshot());
}

// ---------- series (backfilled for books added before series support) ----------
async function backfillSeries() {
  let changed = false;
  for (const b of store.data.books) {
    if (b.seriesChecked || (b.format && b.format !== 'epub')) continue;
    try {
      const meta = await readEpubMeta(fs.readFileSync(bookPath(b)));
      b.series = meta.series || '';
      b.seriesIndex = meta.seriesIndex;
    } catch {
      /* unreadable: leave as is */
    }
    b.seriesChecked = true;
    changed = true;
  }
  if (changed) {
    store.save();
    notify();
  }
}

// ---------- watched folder ----------
let watcher = null;
const watchQueue = new Map();

function startWatching(folder) {
  stopWatching();
  if (!folder || !fs.existsSync(folder)) return;
  // Pick up anything already there that isn't in the library yet.
  importQuietly([folder]);
  try {
    watcher = fs.watch(folder, { recursive: true }, (_evt, name) => {
      if (!name || !BOOK_FILE.test(name)) return;
      const full = path.join(folder, name);
      clearTimeout(watchQueue.get(full));
      // Wait for the copy to finish before importing.
      watchQueue.set(full, setTimeout(() => waitStable(full).then(() => importQuietly([full])), 1500));
    });
  } catch {
    watcher = null;
  }
}

function stopWatching() {
  watcher?.close();
  watcher = null;
}

async function waitStable(file, tries = 10) {
  let last = -1;
  for (let i = 0; i < tries; i++) {
    let size;
    try {
      size = fs.statSync(file).size;
    } catch {
      return;
    }
    if (size === last && size > 0) return;
    last = size;
    await new Promise((r) => setTimeout(r, 700));
  }
}

async function importQuietly(paths) {
  const res = await importFiles(paths, { quiet: true });
  if (res.added) {
    notify();
    win?.webContents.send('import:auto', { added: res.added });
  }
}

// ---------- backup & restore ----------
const DATA_DIRS = ['books', 'covers', 'locations', 'fonts'];

async function createBackup(file) {
  store.flush();
  const JSZip = require('jszip');
  const zip = new JSZip();
  zip.file('library.json', fs.readFileSync(store.file));
  zip.file('aion-backup.json', JSON.stringify({ app: 'Aion Books', version: app.getVersion(), createdAt: Date.now() }));
  for (const d of DATA_DIRS) {
    const dir = path.join(dirs.root, d);
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      if (fs.statSync(p).isFile()) zip.file(`${d}/${name}`, fs.createReadStream(p), { compression: d === 'books' ? 'STORE' : 'DEFLATE' });
    }
  }
  await new Promise((resolve, reject) => {
    zip
      .generateNodeStream({ type: 'nodebuffer', streamFiles: true })
      .pipe(fs.createWriteStream(file))
      .on('finish', resolve)
      .on('error', reject);
  });
  return { books: store.data.books.length };
}

async function restoreBackup(file) {
  const JSZip = require('jszip');
  const zip = await JSZip.loadAsync(fs.readFileSync(file));
  if (!zip.file('library.json') || !zip.file('aion-backup.json')) throw new Error('This isn’t an Aion Books backup');
  JSON.parse(await zip.file('library.json').async('string')); // validate before touching anything
  stopWatching();
  store.flush();
  // From here on, nothing in memory may be written back over the restored files.
  fs.unwatchFile(store.file);
  store.save = store.flush = () => {};
  // Keep the current library aside rather than deleting it.
  const aside = path.join(dirs.root, `_before-restore-${dayKey()}-${Date.now() % 100000}`);
  fs.mkdirSync(aside, { recursive: true });
  for (const d of [...DATA_DIRS, 'library.json']) {
    const p = path.join(dirs.root, d);
    if (fs.existsSync(p)) fs.renameSync(p, path.join(aside, d));
  }
  for (const entry of Object.values(zip.files)) {
    if (entry.dir) continue;
    const rel = path.normalize(entry.name);
    if (rel.startsWith('..') || path.isAbsolute(rel)) continue;
    const top = rel.split(path.sep)[0];
    if (!(top === 'library.json' || DATA_DIRS.includes(top))) continue;
    const out = path.join(dirs.root, rel);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, await entry.async('nodebuffer'));
  }
  return { aside };
}

// ---------- library location (e.g. a OneDrive folder for syncing) ----------
const configFile = () => path.join(app.getPath('userData'), 'config.json');
function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(configFile(), 'utf8'));
  } catch {
    return {};
  }
}
function writeConfig(cfg) {
  fs.writeFileSync(configFile(), JSON.stringify(cfg, null, 1));
}

// When the library lives in a synced folder, another PC may update it.
// Reload when library.json changes on disk and we weren't the writer.
function watchLibraryFile() {
  fs.watchFile(store.file, { interval: 4000 }, (cur) => {
    if (!cur.mtimeMs || cur.mtimeMs <= (store.lastWrite || 0) + 1500) return;
    try {
      store = new Store(dirs.root);
      store.lastWrite = cur.mtimeMs;
      notify();
    } catch {
      /* half-synced file: try again next time */
    }
  });
}

// ---------- dictionary ----------
async function define(word) {
  const { net } = require('electron');
  const w = String(word || '').trim().toLowerCase().slice(0, 60);
  if (!w) return { error: 'Nothing to look up' };
  // Node's fetch first; Electron's network stack (which follows system proxy settings) as a fallback.
  const get = async (url, ms) => {
    const opts = () => {
      const ctrl = new AbortController();
      setTimeout(() => ctrl.abort(), ms);
      return { signal: ctrl.signal, headers: { 'User-Agent': 'AionBooks/1.0 (desktop e-book reader)' } };
    };
    try {
      return await fetch(url, opts());
    } catch {
      return net.fetch(url, opts());
    }
  };
  const strip = (html) =>
    String(html || '')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\s+/g, ' ')
      .trim();

  // Wiktionary first (Wikimedia's REST API), then the Free Dictionary API.
  try {
    const res = await get(`https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(w)}`, 7000);
    if (res.status === 404) return { word: w, entries: [] };
    if (res.ok) {
      const data = await res.json();
      const meanings = (data.en || [])
        .slice(0, 3)
        .map((m) => ({
          part: m.partOfSpeech,
          defs: (m.definitions || [])
            .filter((d) => strip(d.definition))
            .slice(0, 2)
            .map((d) => ({ text: strip(d.definition), example: strip(d.parsedExamples?.[0]?.example || d.examples?.[0] || '') })),
        }))
        .filter((m) => m.defs.length);
      return { word: w, entries: meanings.length ? [{ word: w, phonetic: '', meanings }] : [] };
    }
  } catch {
    /* fall through to the second source */
  }
  try {
    const res = await get(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(w)}`, 5000);
    if (res.status === 404) return { word: w, entries: [] };
    if (!res.ok) return { error: 'The dictionary isn’t answering right now' };
    const data = await res.json();
    const entries = data.slice(0, 1).map((e) => ({
      word: e.word,
      phonetic: e.phonetic || (e.phonetics || []).find((p) => p.text)?.text || '',
      meanings: (e.meanings || []).slice(0, 3).map((m) => ({
        part: m.partOfSpeech,
        defs: (m.definitions || []).slice(0, 2).map((d) => ({ text: d.definition, example: d.example || '' })),
      })),
    }));
    return { word: w, entries };
  } catch {
    return { error: 'Couldn’t reach the dictionary' };
  }
}

// ---------- automatic updates (GitHub releases) ----------
// Only the installed version can update itself; the unpacked build and `npm start` can't.
let updater = null;
let updateStatus = { state: 'idle' };

function canSelfUpdate() {
  if (!app.isPackaged) return false;
  const dir = path.dirname(process.execPath);
  return fs.readdirSync(dir).some((f) => /^Uninstall .*\.exe$/i.test(f));
}

function setUpdateStatus(s) {
  updateStatus = { ...s, at: Date.now() };
  win?.webContents.send('update:status', updateStatus);
}

function setupUpdates() {
  if (!canSelfUpdate()) {
    setUpdateStatus({ state: 'unsupported' });
    return;
  }
  try {
    ({ autoUpdater: updater } = require('electron-updater'));
  } catch {
    setUpdateStatus({ state: 'unsupported' });
    return;
  }
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;
  updater.on('checking-for-update', () => setUpdateStatus({ state: 'checking' }));
  updater.on('update-available', (i) => setUpdateStatus({ state: 'downloading', version: i.version, percent: 0 }));
  updater.on('update-not-available', () => setUpdateStatus({ state: 'current' }));
  updater.on('download-progress', (p) =>
    setUpdateStatus({ state: 'downloading', version: updateStatus.version, percent: Math.round(p.percent) })
  );
  updater.on('update-downloaded', (i) => setUpdateStatus({ state: 'ready', version: i.version }));
  updater.on('error', (e) => setUpdateStatus({ state: 'error', message: String(e?.message || e).split('\n')[0].slice(0, 160) }));
  if (store.data.settings.autoUpdate !== false) {
    setTimeout(() => updater.checkForUpdates().catch(() => {}), 5000);
  }
}

// ---------- IPC ----------
function registerIpc() {
  ipcMain.handle('update:get', () => updateStatus);
  ipcMain.handle('update:check', async () => {
    if (!updater) return updateStatus;
    try {
      await updater.checkForUpdates();
    } catch (e) {
      setUpdateStatus({ state: 'error', message: String(e?.message || e).split('\n')[0].slice(0, 160) });
    }
    return updateStatus;
  });
  ipcMain.handle('update:install', () => {
    if (updater && updateStatus.state === 'ready') {
      store.flush();
      setImmediate(() => updater.quitAndInstall(false, true));
    }
  });

  ipcMain.handle('library:get', () => snapshot());

  ipcMain.handle('library:import-dialog', async () => {
    const res = await dialog.showOpenDialog(win, {
      title: 'Add books to your library',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Books', extensions: BOOK_EXTENSIONS },
        { name: 'EPUB', extensions: ['epub'] },
        { name: 'Kindle (MOBI, AZW3)', extensions: ['mobi', 'azw', 'azw3', 'prc'] },
        { name: 'PDF', extensions: ['pdf'] },
        { name: 'Comics (CBZ)', extensions: ['cbz'] },
        { name: 'FictionBook (FB2)', extensions: ['fb2', 'fbz'] },
      ],
    });
    if (res.canceled) return null;
    return importFiles(res.filePaths);
  });

  ipcMain.handle('library:import-folder-dialog', async () => {
    const res = await dialog.showOpenDialog(win, {
      title: 'Add a folder of books',
      properties: ['openDirectory'],
    });
    if (res.canceled) return null;
    return importFiles(res.filePaths);
  });

  ipcMain.handle('library:import-paths', (_e, paths) => importFiles(Array.isArray(paths) ? paths : []));

  const EDITABLE = new Set([
    'title', 'author', 'progress', 'location', 'finished', 'favorite',
    'shelves', 'bookmarks', 'highlights', 'lastOpenedAt', 'chapter', 'rating',
  ]);
  ipcMain.handle('book:update', (_e, id, patch) => {
    const book = findBook(id);
    if (!book) return null;
    if (patch && 'finished' in patch) {
      if (patch.finished && !book.finished) book.finishedAt = Date.now();
      if (!patch.finished) book.finishedAt = null;
    }
    // The first time a book is opened is when you began it (for the reading timeline).
    if (patch?.lastOpenedAt && !book.startedAt) book.startedAt = patch.lastOpenedAt;
    for (const [k, v] of Object.entries(patch || {})) if (EDITABLE.has(k)) book[k] = v;
    store.save();
    return bookView(book);
  });

  // ---- custom order ----
  ipcMain.handle('library:set-order', (_e, key, ids) => {
    if (typeof key !== 'string' || !Array.isArray(ids)) return store.data.orders;
    const known = new Set(store.data.books.map((b) => b.id));
    store.data.orders[key] = ids.filter((id) => known.has(id));
    store.save();
    return store.data.orders;
  });

  // ---- reading stats ----
  ipcMain.handle('stats:log', (_e, id, ms, pages, locs) => {
    ms = Math.max(0, Math.min(Number(ms) || 0, 10 * 60 * 1000));
    pages = Math.max(0, Math.min(Number(pages) || 0, 500));
    locs = Math.max(0, Math.min(Number(locs) || 0, 200));
    if (!ms && !pages) return;
    const key = dayKey();
    const day = (store.data.stats.days[key] ||= { ms: 0, pages: 0 });
    day.ms += ms;
    day.pages += pages;
    // Reading speed, in time per epub.js "location" (~1,200 characters of text).
    if (locs > 0 && ms > 0) {
      const sp = (store.data.stats.speed ||= { ms: 0, locs: 0 });
      sp.ms += ms;
      sp.locs += locs;
    }
    const book = findBook(id);
    if (book) {
      book.readingMs = (book.readingMs || 0) + ms;
      book.pagesRead = (book.pagesRead || 0) + pages;
    }
    store.save();
  });
  ipcMain.handle('stats:get', () => ({ days: store.data.stats.days, speed: store.data.stats.speed || null, today: dayKey() }));

  // ---- covers ----
  ipcMain.handle('book:set-cover', async (_e, id) => {
    const book = findBook(id);
    if (!book) return null;
    const res = await dialog.showOpenDialog(win, {
      title: `Choose a cover for “${book.title}”`,
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif'] }],
    });
    if (res.canceled) return null;
    const src = res.filePaths[0];
    const name = `${id}-${Date.now().toString(36)}${path.extname(src).toLowerCase()}`;
    fs.copyFileSync(src, path.join(dirs.covers, name));
    if (book.cover && book.cover !== name) fs.rmSync(path.join(dirs.covers, book.cover), { force: true });
    if (book.cover) fs.rmSync(path.join(dirs.thumbs, thumbName(book.cover)), { force: true });
    book.cover = name;
    makeThumb(name);
    store.save();
    return snapshot();
  });

  // ---- watched folder ----
  ipcMain.handle('watch:choose', async () => {
    const res = await dialog.showOpenDialog(win, { title: 'Choose a folder to watch for new books', properties: ['openDirectory'] });
    if (res.canceled) return null;
    store.data.settings.watchFolder = res.filePaths[0];
    store.save();
    startWatching(res.filePaths[0]);
    return store.data.settings;
  });
  ipcMain.handle('watch:clear', () => {
    store.data.settings.watchFolder = '';
    store.save();
    stopWatching();
    return store.data.settings;
  });

  // ---- backup & restore ----
  ipcMain.handle('backup:create', async () => {
    const res = await dialog.showSaveDialog(win, {
      title: 'Back up your library',
      defaultPath: path.join(app.getPath('documents'), `Aion Books backup ${dayKey()}.aionbackup`),
      filters: [{ name: 'Aion Books backup', extensions: ['aionbackup'] }],
    });
    if (res.canceled || !res.filePath) return null;
    const info = await createBackup(res.filePath);
    shell.showItemInFolder(res.filePath);
    return info;
  });
  ipcMain.handle('backup:restore', async () => {
    const res = await dialog.showOpenDialog(win, {
      title: 'Restore a backup',
      properties: ['openFile'],
      filters: [{ name: 'Aion Books backup', extensions: ['aionbackup', 'zip'] }],
    });
    if (res.canceled) return null;
    try {
      await restoreBackup(res.filePaths[0]);
    } catch (err) {
      return { error: err.message };
    }
    setTimeout(() => {
      app.relaunch();
      app.exit(0);
    }, 600);
    return { ok: true };
  });

  // ---- library location ----
  ipcMain.handle('location:pick', async () => {
    const res = await dialog.showOpenDialog(win, {
      title: 'Choose where your library lives',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (res.canceled) return null;
    const folder = res.filePaths[0];
    if (path.resolve(folder) === path.resolve(dirs.root)) return { same: true };
    return { folder, hasLibrary: fs.existsSync(path.join(folder, 'library.json')) };
  });
  ipcMain.handle('location:set', async (_e, folder, mode) => {
    if (!folder || !fs.existsSync(folder)) return { error: 'That folder no longer exists' };
    store.flush();
    if (mode === 'move') {
      for (const d of [...DATA_DIRS, 'library.json']) {
        const p = path.join(dirs.root, d);
        if (fs.existsSync(p)) fs.cpSync(p, path.join(folder, d), { recursive: true, force: true });
      }
    }
    const cfg = readConfig();
    if (path.resolve(folder) === path.resolve(app.getPath('userData'))) delete cfg.dataDir;
    else cfg.dataDir = folder;
    writeConfig(cfg);
    setTimeout(() => {
      app.relaunch();
      app.exit(0);
    }, 500);
    return { ok: true };
  });
  ipcMain.handle('location:reset', () => {
    const cfg = readConfig();
    delete cfg.dataDir;
    writeConfig(cfg);
    setTimeout(() => {
      app.relaunch();
      app.exit(0);
    }, 500);
    return { ok: true };
  });

  // ---- dictionary ----
  ipcMain.handle('lookup:define', (_e, word) => define(word));
  ipcMain.handle('lookup:web', (_e, word) => {
    const w = String(word || '').trim().slice(0, 80);
    if (w) shell.openExternal(`https://en.wiktionary.org/wiki/${encodeURIComponent(w)}`);
  });

  // ---- custom fonts ----
  ipcMain.handle('fonts:add-dialog', async () => {
    const res = await dialog.showOpenDialog(win, {
      title: 'Add a font',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Fonts', extensions: ['ttf', 'otf', 'woff', 'woff2'] }],
    });
    if (res.canceled) return null;
    return { ...addFonts(res.filePaths), library: snapshot() };
  });
  ipcMain.handle('fonts:remove', (_e, family) => {
    for (const f of store.data.fonts.filter((x) => x.family === family)) {
      fs.rmSync(path.join(dirs.fonts, f.file), { force: true });
    }
    store.data.fonts = store.data.fonts.filter((f) => f.family !== family);
    if (store.data.settings.fontFamily === family) store.data.settings.fontFamily = DEFAULT_SETTINGS.fontFamily;
    store.save();
    return snapshot();
  });
  ipcMain.handle('fonts:custom-css', () => customFontCss());

  ipcMain.handle('book:remove', (_e, id) => {
    const book = findBook(id);
    if (!book) return snapshot();
    store.data.books = store.data.books.filter((b) => b.id !== id);
    for (const k of Object.keys(store.data.orders)) store.data.orders[k] = store.data.orders[k].filter((x) => x !== id);
    for (const f of [
      bookPath(book),
      book.cover && path.join(dirs.covers, book.cover),
      book.cover && path.join(dirs.thumbs, thumbName(book.cover)),
      path.join(dirs.locations, `${id}.json`),
    ]) {
      if (f) fs.rmSync(f, { force: true });
    }
    store.save();
    return snapshot();
  });

  ipcMain.handle('book:data', (_e, id) => {
    const book = findBook(id);
    return book ? fs.readFileSync(bookPath(book)) : null;
  });

  // Details the reader worked out for a book that isn't an EPUB (see Reader.fillMissingMeta).
  ipcMain.handle('book:set-meta', (_e, id, meta, cover) => {
    const book = findBook(id);
    if (!book) return null;
    const text = (v) => (typeof v === 'string' ? v.trim() : '');
    if (text(meta?.title)) book.title = text(meta.title);
    if (text(meta?.author)) book.author = text(meta.author);
    for (const k of ['description', 'publisher', 'language', 'published']) if (text(meta?.[k])) book[k] = text(meta[k]);
    if (Array.isArray(meta?.subjects)) book.subjects = meta.subjects.filter((s) => typeof s === 'string').slice(0, 12);
    if (text(meta?.series)) {
      book.series = text(meta.series);
      book.seriesIndex = Number(meta.seriesIndex) || undefined;
    }
    if (cover?.data?.length && !book.cover) {
      const ext = { 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'image/svg+xml': '.svg' }[cover.type] || '.jpg';
      book.cover = `${id}${ext}`;
      fs.writeFileSync(path.join(dirs.covers, book.cover), Buffer.from(cover.data));
      makeThumb(book.cover);
    }
    book.needsMeta = false;
    store.save();
    notify();
    return bookView(book);
  });

  ipcMain.handle('book:show-source', (_e, id) => {
    const book = findBook(id);
    const target = book && fs.existsSync(book.sourcePath) ? book.sourcePath : book && bookPath(book);
    shell.showItemInFolder(target);
  });

  ipcMain.handle('book:locations-get', (_e, id) => {
    try {
      return fs.readFileSync(path.join(dirs.locations, `${id}.json`), 'utf8');
    } catch {
      return null;
    }
  });

  ipcMain.handle('book:locations-save', (_e, id, json) => {
    fs.writeFileSync(path.join(dirs.locations, `${id}.json`), json);
  });

  ipcMain.handle('shelf:create', (_e, name) => {
    const shelf = { id: crypto.randomUUID().slice(0, 8), name: String(name).trim().slice(0, 60) || 'New shelf' };
    store.data.shelves.push(shelf);
    store.save();
    return snapshot();
  });

  ipcMain.handle('shelf:rename', (_e, id, name) => {
    const shelf = store.data.shelves.find((s) => s.id === id);
    if (shelf && String(name).trim()) shelf.name = String(name).trim().slice(0, 60);
    store.save();
    return snapshot();
  });

  ipcMain.handle('shelf:delete', (_e, id) => {
    store.data.shelves = store.data.shelves.filter((s) => s.id !== id);
    delete store.data.orders[`shelf:${id}`];
    for (const b of store.data.books) b.shelves = (b.shelves || []).filter((s) => s !== id);
    store.save();
    return snapshot();
  });

  ipcMain.handle('settings:set', (_e, patch) => {
    for (const [k, v] of Object.entries(patch || {})) if (k in DEFAULT_SETTINGS) store.data.settings[k] = v;
    store.save();
    if (patch && patch.theme) applyTitlebar(patch.theme);
    return store.data.settings;
  });

  ipcMain.handle('settings:reset', (_e, scope) => {
    const keys = scope === 'reading' ? READING_KEYS : Object.keys(DEFAULT_SETTINGS);
    for (const k of keys) store.data.settings[k] = DEFAULT_SETTINGS[k];
    store.save();
    applyTitlebar(store.data.settings.theme);
    return store.data.settings;
  });

  // A picture of part of the window (in CSS pixels), for the page-curl animation.
  ipcMain.handle('reader:snapshot', async (e, rect) => {
    const r = { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) };
    if (r.width < 1 || r.height < 1) return null;
    const img = await e.sender.capturePage(r);
    return img.isEmpty() ? null : img.toJPEG(88);
  });

  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    dataDir: dirs.root,
    customLocation: !!readConfig().dataDir,
    electron: process.versions.electron,
  }));

  ipcMain.handle('app:open-data', () => shell.openPath(dirs.root));

  ipcMain.handle('notes:export', async () => {
    const books = store.data.books.filter((b) => (b.highlights || []).length || (b.bookmarks || []).length);
    if (!books.length) return { written: false, empty: true };
    const res = await dialog.showSaveDialog(win, {
      title: 'Export highlights & notes',
      defaultPath: path.join(app.getPath('documents'), 'Aion Books — highlights & notes.md'),
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    });
    if (res.canceled || !res.filePath) return { written: false };
    fs.writeFileSync(res.filePath, notesMarkdown(books), 'utf8');
    shell.showItemInFolder(res.filePath);
    return { written: true, count: books.length };
  });

  ipcMain.handle('fonts:css', () => buildFontCss(__dirname));

  ipcMain.handle('window:fullscreen', () => {
    win.setFullScreen(!win.isFullScreen());
    return win.isFullScreen();
  });

  ipcMain.on('app:ready', () => flushPendingOpen());
}

function notesMarkdown(books) {
  const out = ['# Highlights & notes', '', `_Exported from Aion Books on ${new Date().toLocaleDateString()}_`, ''];
  for (const b of books) {
    out.push(`## ${b.title}`, `*${b.author}*`, '');
    for (const h of b.highlights || []) {
      out.push(`> ${h.text.replace(/\n+/g, ' ')}`);
      if (h.note) out.push('', h.note);
      if (h.chapter) out.push('', `— ${h.chapter}`);
      out.push('');
    }
    const bms = b.bookmarks || [];
    if (bms.length) {
      out.push('**Bookmarks**', '');
      for (const m of bms) out.push(`- ${m.chapter || 'Bookmark'} (${Math.round((m.progress || 0) * 100)}%)`);
      out.push('');
    }
  }
  return out.join('\n');
}

function applyTitlebar(theme) {
  if (!win || process.platform !== 'win32') return;
  try {
    win.setTitleBarOverlay({ ...(TITLEBAR[theme] || TITLEBAR.linen), height: 44 });
  } catch {
    /* overlay not supported */
  }
}

// ---------- window ----------
function createWindow() {
  const theme = store.data.settings.theme;
  win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 760,
    minHeight: 560,
    title: 'Aion Books',
    backgroundColor: theme === 'dusk' ? '#2b2620' : '#efe6d3',
    titleBarStyle: 'hidden',
    titleBarOverlay: { ...(TITLEBAR[theme] || TITLEBAR.linen), height: 44 },
    icon: path.join(__dirname, 'build', 'icon.png'),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(__dirname, 'src', 'index.html'));

  // Links inside books open in the default browser, never in-app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file:')) {
      e.preventDefault();
      if (/^https?:/i.test(url)) shell.openExternal(url);
    }
  });

  win.on('closed', () => {
    win = null;
  });
}

app.whenReady().then(() => {
  nativeTheme.themeSource = 'light';
  // The library can live elsewhere (e.g. a OneDrive folder); fall back if it's gone.
  const cfgDir = readConfig().dataDir;
  const root = cfgDir && fs.existsSync(cfgDir) ? cfgDir : app.getPath('userData');
  dirs = {
    root,
    books: path.join(root, 'books'),
    covers: path.join(root, 'covers'),
    locations: path.join(root, 'locations'),
    fonts: path.join(root, 'fonts'),
    thumbs: path.join(root, 'thumbs'),
  };
  for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true });
  store = new Store(root);

  queueBookArgs(process.argv);
  registerIpc();
  createWindow();
  win.webContents.once('did-finish-load', () => {
    setTimeout(() => {
      backfillSeries();
      backfillThumbs();
      if (store.data.settings.watchFolder) startWatching(store.data.settings.watchFolder);
      watchLibraryFile();
      setupUpdates();
    }, 1500);
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => {
  stopWatching();
  store?.flush();
});
app.on('window-all-closed', () => {
  store?.flush();
  if (process.platform !== 'darwin') app.quit();
});
