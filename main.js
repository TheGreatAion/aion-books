const { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme, nativeImage, protocol } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const { Store, DEFAULT_SETTINGS, READING_KEYS } = require('./lib/store');
const { readEpubMeta } = require('./lib/epubMeta');
const { lookupCharacter, isWikipediaUrl } = require('./lib/lookup');
const bookFiles = require('./lib/book-files');
const { planTidy, tidyOne } = require('./lib/titles');
const { naturalAuthor } = require('./lib/authors');
const seriesLookup = require('./lib/series-lookup');
const seriesFinder = require('./lib/series-finder');
const SeriesKey = require('./src/series.js');
const { execFile } = require('child_process');
const { BOOK_FILE, formatOf, detailsFromFilename, BOOK_EXTENSIONS } = require('./lib/formats');
const { buildFontCss, bundledFontFile } = require('./lib/fonts');
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
else moveLibraryFolder();

// Until 1.7 the app was called "Aion Books", and its library folder was named
// after it. The first time the app starts under its new name, the folder moves
// to the new one; if it can't be moved (something has a file in it open), the
// app simply carries on using the old one, so a library is never left behind.
function moveLibraryFolder() {
  const appData = app.getPath('appData');
  const before = path.join(appData, 'Aion Books');
  const now = path.join(appData, 'AionBooks');
  if (!fs.existsSync(before) || fs.existsSync(path.join(now, 'library.json')) || fs.existsSync(path.join(now, 'config.json'))) return;
  try {
    if (fs.existsSync(now)) throw new Error('a folder by the new name is already there');
    fs.renameSync(before, now);
  } catch {
    app.setPath('userData', before);
  }
}

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
    seriesInfo: store.data.seriesInfo,
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
    const [fmt] = FORMATS[path.extname(f.file).toLowerCase()] || ['truetype'];
    out[f.family] =
      (out[f.family] || '') +
      `@font-face{font-family:'${f.family.replace(/'/g, "\\'")}';font-style:${f.style};font-weight:${f.weight};` +
      `font-display:swap;src:url(aion-font://user/${encodeURIComponent(f.file)}) format('${fmt}');}\n`;
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
        author: naturalAuthor(meta.author),
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
      // Take the clutter off the title (ISBNs, series numbers…); the original is kept.
      const tidy = tidyOne(book, store.data.books);
      if (tidy) applyTidy(book, tidy);
      store.data.books.push(book);
      added.push(id);
    } catch (err) {
      failed.push({ name: path.basename(file), reason: err.message });
    }
  }

  if (added.length) {
    placeSeries();
    store.save();
    queueSeriesLookup(added);
  }
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
  zip.file('aion-backup.json', JSON.stringify({ app: 'AionBooks', version: app.getVersion(), createdAt: Date.now() }));
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
  if (!zip.file('library.json') || !zip.file('aion-backup.json')) throw new Error('This isn’t an AionBooks backup');
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
    'shelves', 'bookmarks', 'highlights', 'lastOpenedAt', 'chapter', 'rating', 'series', 'seriesIndex', 'setAside',
  ]);
  ipcMain.handle('book:update', (_e, id, patch) => {
    const book = findBook(id);
    if (!book) return null;
    // A series you set yourself is yours: no suggestions over it.
    if (patch && ('series' in patch || 'seriesIndex' in patch)) {
      patch = { ...patch };
      if ('series' in patch) patch.series = String(patch.series || '').trim();
      if ('seriesIndex' in patch) patch.seriesIndex = patch.seriesIndex === '' || patch.seriesIndex == null ? null : Number(patch.seriesIndex) || null;
      book.seriesSource = 'you';
      delete book.seriesSuggestion;
      delete book.seriesFromTitle;
      delete book.seriesAuto;
    }
    // A title you change yourself is never tidied again.
    if (typeof patch?.title === 'string' && patch.title !== book.title) book.titleEdited = true;
    if (patch && 'finished' in patch) {
      if (patch.finished && !book.finished) book.finishedAt = Date.now();
      if (!patch.finished) book.finishedAt = null;
    }
    // The first time a book is opened is when you began it (for the reading timeline).
    if (patch?.lastOpenedAt && !book.startedAt) book.startedAt = patch.lastOpenedAt;
    // A book set aside from Continue reading comes back when you open it again.
    if (patch?.lastOpenedAt) delete book.setAside;
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
      defaultPath: path.join(app.getPath('documents'), `AionBooks backup ${dayKey()}.aionbackup`),
      filters: [{ name: 'AionBooks backup', extensions: ['aionbackup'] }],
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
      filters: [{ name: 'AionBooks backup', extensions: ['aionbackup', 'zip'] }],
    });
    if (res.canceled) return null;
    try {
      await bookFiles.closeAll();
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
    await bookFiles.closeAll();
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
  ipcMain.handle('lookup:character', (_e, name, context) => lookupCharacter(name, context));
  ipcMain.handle('lookup:open-wikipedia', (_e, url) => {
    if (isWikipediaUrl(url)) shell.openExternal(url);
  });
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

  ipcMain.handle('book:remove', async (_e, id) => {
    const book = findBook(id);
    if (!book) return snapshot();
    await bookFiles.closeFile(bookPath(book)); // Windows won't delete a file that's open
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

  // Parts of a book's file, as the reader asks for them (see lib/book-files.js).
  ipcMain.handle('book:size', (_e, id) => {
    const book = findBook(id);
    return book ? bookFiles.sizeOf(bookPath(book)) : 0;
  });
  ipcMain.handle('book:read', (_e, id, start, end) => {
    const book = findBook(id);
    return book ? bookFiles.readRange(bookPath(book), start, end) : null;
  });

  ipcMain.handle('book:data', (_e, id) => {
    const book = findBook(id);
    return book ? fs.readFileSync(bookPath(book)) : null;
  });

  // Details the reader worked out for a book that isn't an EPUB (see Reader.fillMissingMeta).
  // ---- tidying titles ----
  // ---- series ----
  // Look again for books whose series wasn't found (Wikidata grows all the time).
  ipcMain.handle('series:lookup-all', () => {
    const ids = store.data.books.filter((b) => !b.series && b.seriesSource !== 'you' && !b.seriesSuggestion).map((b) => b.id);
    for (const id of ids) delete findBook(id).seriesLookedUp;
    for (const info of Object.values(store.data.seriesInfo)) if (!info.parts?.length) info.at = 0;
    queueSeriesLookup(ids);
    return ids.length;
  });
  // Take books out of a series they were put in automatically; it won't be offered again.
  ipcMain.handle('series:undo', (_e, ids) => {
    for (const id of Array.isArray(ids) ? ids : []) {
      const b = findBook(id);
      if (!b?.seriesAuto || !b.series) continue;
      b.seriesDismissed = [...new Set([...(b.seriesDismissed || []), SeriesKey.key(b.series)])];
      if (b.seriesFromTitle && b.originalTitle) {
        b.title = b.originalTitle;
        delete b.originalTitle;
      }
      b.series = '';
      b.seriesIndex = null;
      delete b.seriesSource;
      delete b.seriesAuto;
      delete b.seriesFromTitle;
    }
    store.save();
    return snapshot();
  });
  // Accept some suggestions; put the rest aside (they won't be offered again).
  ipcMain.handle('series:review', (_e, accept = [], dismiss = []) => {
    for (const id of accept) {
      const b = findBook(id);
      if (!b?.seriesSuggestion || b.series) continue;
      b.series = librarySpelling(b.seriesSuggestion.series);
      b.seriesIndex = b.seriesSuggestion.number ?? null;
      b.seriesSource = 'online';
      delete b.seriesSuggestion;
    }
    for (const id of dismiss) {
      const b = findBook(id);
      if (!b?.seriesSuggestion) continue;
      b.seriesDismissed = [...new Set([...(b.seriesDismissed || []), SeriesKey.key(b.seriesSuggestion.series)])];
      delete b.seriesSuggestion;
    }
    placeSeries(); // the books approved may tell us where others go
    store.save();
    return snapshot();
  });
  // Rename a series, or take its books out of it: every book in it at once.
  ipcMain.handle('series:rename', (_e, ids, name) => {
    name = String(name || '').trim();
    for (const id of Array.isArray(ids) ? ids : []) {
      const b = findBook(id);
      if (!b) continue;
      b.series = name;
      if (!name) b.seriesIndex = null;
      b.seriesSource = 'you';
      delete b.seriesAuto;
      delete b.seriesSuggestion;
    }
    store.save();
    return snapshot();
  });
  // A new order for a series' books: numbered 1, 2, 3… in that order.
  ipcMain.handle('series:order', (_e, ids) => {
    (Array.isArray(ids) ? ids : []).forEach((id, i) => {
      const b = findBook(id);
      if (!b) return;
      b.seriesIndex = i + 1;
      b.seriesSource = 'you';
      delete b.seriesAuto;
    });
    store.save();
    return snapshot();
  });

  ipcMain.handle('titles:plan', () => planTidy(store.data.books));
  ipcMain.handle('titles:apply', (_e, ids) => {
    const want = new Set(Array.isArray(ids) ? ids : []);
    for (const p of planTidy(store.data.books)) {
      const book = findBook(p.id);
      if (book && want.has(p.id)) applyTidy(book, p);
    }
    store.save();
    return snapshot();
  });
  ipcMain.handle('book:restore-title', (_e, id) => {
    const book = findBook(id);
    if (!book?.originalTitle) return snapshot();
    book.title = book.originalTitle;
    delete book.originalTitle;
    if (book.seriesFromTitle) {
      book.series = '';
      book.seriesIndex = null;
      delete book.seriesFromTitle;
    }
    book.titleEdited = true; // keep it as it was from now on
    store.save();
    return snapshot();
  });

  ipcMain.handle('book:set-meta', (_e, id, meta, cover) => {
    const book = findBook(id);
    if (!book) return null;
    const text = (v) => (typeof v === 'string' ? v.trim() : '');
    if (text(meta?.title)) book.title = text(meta.title);
    if (text(meta?.author)) book.author = naturalAuthor(text(meta.author));
    for (const k of ['description', 'publisher', 'language', 'published']) if (text(meta?.[k])) book[k] = text(meta[k]);
    if (Array.isArray(meta?.subjects)) book.subjects = meta.subjects.filter((s) => typeof s === 'string').slice(0, 12);
    if (text(meta?.series)) {
      book.series = text(meta.series);
      book.seriesIndex = Number(meta.seriesIndex) || undefined;
    }
    if (!book.titleEdited) {
      const tidy = tidyOne(book, store.data.books);
      if (tidy) applyTidy(book, tidy);
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
    const s = store.data.settings;
    if (patch?.theme && s.followSystem && !('followSystem' in patch)) {
      // Choosing a paper by hand: a light one becomes the paper for light mode;
      // one that goes against Windows' current mode stops following it.
      if ((patch.theme === 'dusk') !== systemDark) patch = { ...patch, followSystem: false };
    }
    for (const [k, v] of Object.entries(patch || {})) if (k in DEFAULT_SETTINGS) s[k] = v;
    if (patch?.theme && patch.theme !== 'dusk') s.lightTheme = patch.theme;
    if (patch?.seriesLookup === true) setTimeout(() => queueSeriesLookup(store.data.books.map((b) => b.id)), 0);
    store.save();
    if (patch && patch.theme) applyTitlebar(patch.theme);
    if (patch?.followSystem) checkSystemTheme();
    return s;
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
      defaultPath: path.join(app.getPath('documents'), 'AionBooks highlights & notes.md'),
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    });
    if (res.canceled || !res.filePath) return { written: false };
    fs.writeFileSync(res.filePath, notesMarkdown(books), 'utf8');
    shell.showItemInFolder(res.filePath);
    return { written: true, count: books.length };
  });

  ipcMain.handle('fonts:css', () => buildFontCss());

  ipcMain.handle('window:fullscreen', () => {
    win.setFullScreen(!win.isFullScreen());
    return win.isFullScreen();
  });

  ipcMain.on('app:ready', () => flushPendingOpen());
}

function notesMarkdown(books) {
  const out = ['# Highlights & notes', '', `_Exported from AionBooks on ${new Date().toLocaleDateString()}_`, ''];
  for (const b of books) {
    out.push(`## ${b.title}`, `*${b.author}*`, '');
    for (const h of b.highlights || []) {
      out.push(`> ${h.text.replace(/\n+/g, ' ')}`);
      if (h.note) out.push('', h.note);
      if (h.chapter) out.push('', `*${h.chapter}*`);
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

// ---------- following Windows' light / dark mode ----------
// AionBooks keeps its own paper colors, so it reads Windows' "app mode" setting
// directly rather than letting Chromium switch to dark controls.
let systemDark = false;
function readSystemDark() {
  if (process.env.AION_SYSTEM_DARK) return Promise.resolve(process.env.AION_SYSTEM_DARK === '1'); // tests
  if (process.platform !== 'win32') return Promise.resolve(nativeTheme.shouldUseDarkColors);
  const key = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize';
  return new Promise((resolve) =>
    execFile('reg', ['query', key, '/v', 'AppsUseLightTheme'], { windowsHide: true }, (err, out) =>
      resolve(!err && /AppsUseLightTheme\s+REG_DWORD\s+0x0\b/i.test(String(out)))
    )
  );
}
async function checkSystemTheme() {
  systemDark = await readSystemDark();
  const s = store?.data.settings;
  if (!s?.followSystem) return;
  const want = systemDark ? 'dusk' : s.lightTheme && s.lightTheme !== 'dusk' ? s.lightTheme : 'linen';
  if (s.theme === want) return;
  s.theme = want;
  store.save();
  applyTitlebar(want);
  win?.webContents.send('settings:changed', s);
}

// ---------- finding series ----------
// Books go into their series on their own (see lib/series-finder.js): first
// from what the library already knows — titles that name their series, the
// series' lists of books, families of titles — and then, for the rest, by
// looking each book up once on Wikidata. A sure match is used straight away;
// an unsure one waits for review. Learning a series' list of books often
// places its other books with no more lookups. Anything placed automatically
// can be undone, and a series you set yourself is never touched.
const lookupQueue = [];
let lookupRunning = false;
let lookupProgress = null;
const lookupTries = new Map(); // item → failed attempts this session
const LEARN_AGAIN = 14 * 864e5; // a series whose list wasn't found is tried again after this

// A series name as the library already writes it, if it has it.
function librarySpelling(name) {
  const key = SeriesKey.key(name);
  const same = store.data.books.find((b) => b.series && SeriesKey.key(b.series) === key);
  return same ? SeriesKey.split(same.series).name : name;
}

function putInSeries(b, series, number, from, title) {
  b.series = librarySpelling(series);
  b.seriesIndex = number ?? null;
  b.seriesSource = 'auto';
  b.seriesAuto = { from, at: Date.now() };
  delete b.seriesSuggestion;
  delete b.seriesLookupPending;
  if (title && title !== b.title && !b.titleEdited) {
    b.originalTitle ||= b.title;
    b.title = title;
    b.seriesFromTitle = true; // restoring the title takes the series off too
  }
}

// Everything the library can work out by itself. Returns how many books were placed.
function placeSeries() {
  let placed = 0;
  for (const p of seriesFinder.placeLocally(store.data.books, store.data.seriesInfo)) {
    const b = findBook(p.id);
    if (!b || b.seriesSource === 'you') continue;
    if (p.from === 'renumber') {
      b.series = SeriesKey.split(b.series).name;
      b.seriesIndex = p.number;
      continue;
    }
    putInSeries(b, p.series, p.number, p.from, p.title);
    placed++;
  }
  return placed;
}

// "Put 12 books into their series", once things settle.
let placedCount = 0;
let placedTimer = null;
function announcePlaced(n) {
  if (!n) return;
  placedCount += n;
  clearTimeout(placedTimer);
  placedTimer = setTimeout(() => {
    win?.webContents.send('series:placed', { count: placedCount });
    placedCount = 0;
  }, 1500);
}

function placeAndTell() {
  const n = placeSeries();
  if (n) {
    store.save();
    notifyLater();
    announcePlaced(n);
  }
  return n;
}

function queueSeriesLookup(ids) {
  if (store.data.settings.seriesLookup === false) return;
  // First, learn which books each series in the library holds: that often
  // places other books without looking them up one by one.
  const learn = [];
  for (const b of store.data.books) {
    if (!b.series) continue;
    const key = SeriesKey.key(b.series);
    const info = store.data.seriesInfo[key];
    if (info?.parts?.length || (info && Date.now() - (info.at || 0) < LEARN_AGAIN)) continue;
    if (!learn.includes(`series:${key}`) && !lookupQueue.includes(`series:${key}`)) learn.push(`series:${key}`);
  }
  const firstBook = lookupQueue.findIndex((x) => !x.startsWith('series:'));
  lookupQueue.splice(firstBook < 0 ? lookupQueue.length : firstBook, 0, ...learn);
  for (const id of ids) {
    const b = findBook(id);
    if (!b || b.series || b.seriesLookedUp || b.seriesSource === 'you' || lookupQueue.includes(id)) continue;
    b.seriesLookupPending = true;
    lookupQueue.push(id);
  }
  const books = lookupQueue.filter((x) => !x.startsWith('series:')).length;
  if (books) lookupProgress = { done: lookupProgress?.done || 0, total: (lookupProgress?.done || 0) + books, found: lookupProgress?.found || 0 };
  runLookups();
}

async function learnSeries(key, found) {
  if (store.data.seriesInfo[key]?.parts?.length) return;
  const parts = await seriesLookup.seriesParts(found.qid);
  store.data.seriesInfo[key] = { name: found.series, qid: found.qid, parts, at: Date.now() };
}

const dismissedFor = (b, name) => (b.seriesDismissed || []).includes(SeriesKey.key(name));

async function runLookups() {
  if (lookupRunning) return;
  lookupRunning = true;
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  const progress = () => win?.webContents.send('series:progress', lookupProgress && { ...lookupProgress, finished: !lookupQueue.some((x) => !x.startsWith('series:')) });
  try {
    while (lookupQueue.length) {
      const item = lookupQueue[0];
      let online = false;
      try {
        if (item.startsWith('series:')) {
          // Learn what a series in the library holds: through one of its books, or by its name.
          const key = item.slice(7);
          const b = store.data.books.find((x) => x.series && SeriesKey.key(x.series) === key);
          if (b && !store.data.seriesInfo[key]?.parts?.length) {
            online = true;
            let found = await seriesLookup.findSeries(b, [b.series]);
            if (!found || SeriesKey.key(found.series) !== key) found = await seriesLookup.findSeriesByName(b.series, b.author);
            if (found?.qid) await learnSeries(key, found);
            else store.data.seriesInfo[key] = { name: b.series, qid: null, parts: [], at: Date.now() };
            placeAndTell();
          }
        } else {
          const b = findBook(item);
          if (b) delete b.seriesLookupPending;
          // Placed meanwhile (another book's series list had it)? Then no need to ask.
          if (b && !b.series && !b.seriesLookedUp && b.seriesSource !== 'you') {
            online = true;
            const known = [...new Set(store.data.books.map((x) => x.series).filter(Boolean))];
            const found = await seriesLookup.findSeries(b, known);
            b.seriesLookedUp = Date.now();
            if (found && !dismissedFor(b, found.series)) {
              const key = SeriesKey.key(found.series);
              if (found.sure) {
                putInSeries(b, found.series, found.number, 'online');
                announcePlaced(1);
              } else {
                b.seriesSuggestion = { series: found.series, number: found.number, qid: found.qid };
              }
              if (lookupProgress) lookupProgress.found++;
              await learnSeries(key, found).catch(() => {});
              placeAndTell();
            }
          }
          if (lookupProgress) lookupProgress.done++;
        }
        lookupQueue.shift();
        store.save();
        notifyLater();
        progress();
        // A moment between books (each lookup is a few requests, themselves spaced out).
        if (online && !process.env.AION_WIKIDATA_FIXTURE) await pause(800);
      } catch (err) {
        if (err instanceof seriesLookup.RateLimited) {
          await pause(err.wait); // Wikidata asked us to slow down, and said for how long
          continue;
        }
        // A hiccup: try this one again twice, a little later; then skip it
        // (it's looked up again next time AionBooks starts) and carry on.
        const tries = (lookupTries.get(item) || 0) + 1;
        lookupTries.set(item, tries);
        if (tries <= 2) {
          await pause(5000 * tries);
          continue;
        }
        lookupQueue.shift();
        if (lookupProgress && !item.startsWith('series:')) lookupProgress.done++;
      }
    }
  } finally {
    lookupRunning = false;
    if (!lookupQueue.length) {
      progress();
      lookupProgress = null;
    }
  }
}

let notifyTimer = null;
function notifyLater() {
  clearTimeout(notifyTimer);
  notifyTimer = setTimeout(notify, 400);
}

// A tidied title (and a series found in it) onto a book; the original title is kept.
function applyTidy(book, p) {
  if (p.title && p.title !== book.title) {
    book.originalTitle ||= book.title;
    book.title = p.title;
  }
  if (p.series && !book.series) {
    book.originalTitle ||= p.from;
    book.series = p.series;
    book.seriesIndex = p.seriesIndex;
    book.seriesFromTitle = true;
  }
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
// The window's size and place, as you left it (kept per PC, not in the synced library).
function savedBounds() {
  const w = readConfig().window;
  if (!w || !(w.width > 0) || !(w.height > 0)) return null;
  // Only put it back where it was if that's still on a screen (a monitor may be gone).
  const { screen } = require('electron');
  const area = screen.getDisplayMatching({ x: w.x ?? 0, y: w.y ?? 0, width: w.width, height: w.height }).workArea;
  const visible =
    w.x != null && w.x < area.x + area.width - 80 && w.x + w.width > area.x + 80 && w.y >= area.y - 10 && w.y < area.y + area.height - 80;
  return {
    width: Math.min(w.width, area.width),
    height: Math.min(w.height, area.height),
    ...(visible ? { x: w.x, y: w.y } : {}),
    maximized: !!w.maximized,
  };
}

function rememberBounds() {
  if (!win || win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return;
  const cfg = readConfig();
  const b = win.isMaximized() ? win.getNormalBounds() : win.getBounds();
  cfg.window = { x: b.x, y: b.y, width: b.width, height: b.height, maximized: win.isMaximized() };
  writeConfig(cfg);
}

function createWindow() {
  const theme = store.data.settings.theme;
  const saved = savedBounds();
  win = new BrowserWindow({
    width: saved?.width || 1280,
    height: saved?.height || 840,
    ...(saved?.x != null ? { x: saved.x, y: saved.y } : {}),
    minWidth: 760,
    minHeight: 560,
    title: 'AionBooks',
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

  win.once('ready-to-show', () => {
    if (saved?.maximized) win.maximize();
    win.show();
  });
  let boundsTimer;
  const later = () => {
    clearTimeout(boundsTimer);
    boundsTimer = setTimeout(rememberBounds, 600);
  };
  for (const ev of ['resize', 'move', 'maximize', 'unmaximize']) win.on(ev, later);
  win.on('close', () => {
    clearTimeout(boundsTimer);
    rememberBounds();
  });
  win.on('focus', () => checkSystemTheme());
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

// Fonts for the app and for book pages, from one place: aion-font://app/<file>
// for the bundled typefaces, aion-font://user/<file> for fonts you've added.
// Each is read once and then shared by every page, instead of every chapter
// carrying its own copy inline.
protocol.registerSchemesAsPrivileged([
  { scheme: 'aion-font', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);
const fontBytes = new Map();
function serveFonts() {
  protocol.handle('aion-font', async (req) => {
    const { host, pathname } = new URL(req.url);
    const name = decodeURIComponent(pathname.replace(/^\//, ''));
    let file = null;
    if (host === 'app') file = bundledFontFile(__dirname, name);
    else if (host === 'user' && store.data.fonts.some((f) => f.file === name)) file = path.join(dirs.fonts, name);
    if (!file) return new Response(null, { status: 404 });
    try {
      let bytes = fontBytes.get(file);
      if (!bytes) fontBytes.set(file, (bytes = await fs.promises.readFile(file)));
      const mime = (FORMATS[path.extname(file).toLowerCase()] || [])[1] || 'font/woff2';
      return new Response(bytes, { headers: { 'content-type': mime, 'access-control-allow-origin': '*', 'cache-control': 'max-age=31536000, immutable' } });
    } catch {
      return new Response(null, { status: 404 });
    }
  });
}

app.whenReady().then(() => {
  nativeTheme.themeSource = 'light';
  // Windows' light/dark mode, for "Dusk when Windows is dark".
  nativeTheme.on('updated', () => checkSystemTheme());
  setInterval(() => checkSystemTheme(), 60000);
  checkSystemTheme();
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
  serveFonts();

  queueBookArgs(process.argv);
  registerIpc();
  createWindow();
  win.webContents.once('did-finish-load', () => {
    setTimeout(() => {
      backfillSeries();
      backfillThumbs();
      placeAndTell();
      queueSeriesLookup(store.data.books.map((b) => b.id));
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
