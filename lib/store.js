// Tiny JSON-file store for the library, written atomically and debounced.
const fs = require('fs');
const { naturalAuthor } = require('./authors');
const path = require('path');

const DEFAULT_SETTINGS = {
  theme: 'linen', // linen | parchment | dusk
  fontFamily: 'EB Garamond',
  fontSize: 100, // percent
  lineHeight: 1.6,
  margin: 'comfortable', // narrow | comfortable | wide
  layout: 'auto', // single | auto (two-page when wide) | scroll
  sort: 'recent',
  motion: 'full', // full | gentle | still
  flora: true, // botanical decorations
  wheelTurns: true, // mouse wheel turns pages
  autoHideBars: true, // fade reader controls while reading
  pagesLeft: true, // show "n pages left in chapter"
  confirmRemove: true,
  footerInfo: 'time', // what the reader's footer shows: time | pages | percent
  timeLeft: true, // (replaced by footerInfo; kept so older libraries migrate)
  dailyGoal: 20, // minutes a day; 0 = off
  tapZones: false, // click page edges to turn
  ttsVoice: '', // read-aloud voice name ('' = system default)
  ttsRate: 1,
  watchFolder: '', // folder auto-imported from
  autoUpdate: true, // check GitHub for new versions on start-up
  runningHeads: true, // book title, chapter and page numbers around the page
  followSystem: false, // Dusk when Windows is in dark mode, your light paper otherwise
  lightTheme: 'linen', // the paper for light mode when following Windows
  seriesLookup: true, // look up the series of newly added books on Wikidata (suggestions wait for review)
  pageCurl: true, // stop-motion page curl when turning
  bookEdges: true, // page edges that show how far through the book you are
  openingQuote: true, // a quote beside Continue reading, different each time Aion opens
};

const READING_KEYS = ['fontFamily', 'fontSize', 'lineHeight', 'margin', 'layout'];

class Store {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, 'library.json');
    this.timer = null;
    this.data = {
      version: 1,
      books: [],
      shelves: [],
      fonts: [], // user-added font faces
      orders: {}, // custom book order: { all: [ids], 'shelf:<id>': [ids] }
      stats: { days: {} }, // { 'YYYY-MM-DD': { ms, pages } }
      settings: { ...DEFAULT_SETTINGS },
    };
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.data = {
        ...this.data,
        ...raw,
        settings: { ...DEFAULT_SETTINGS, ...(raw.settings || {}) },
      };
    } catch (_) {
      /* first run, or unreadable file: start fresh */
    }
    // v2: the default text size went from 108% to 100%. Move anyone still on the
    // old default; a size someone actually picked is left alone.
    if ((this.data.version || 1) < 2) {
      if (this.data.settings.fontSize === 108) this.data.settings.fontSize = 100;
      this.data.version = 2;
    }
    // v3: "show time left" and "show pages left" became one footer choice.
    if (this.data.version < 3) {
      const s = this.data.settings;
      if (s.timeLeft === false) s.footerInfo = s.pagesLeft === false ? 'percent' : 'pages';
      this.data.version = 3;
    }
    // v4: authors written as people write them ("Brandon Sanderson", not
    // "Sanderson, Brandon"), so one author is one author; the original is kept.
    if (this.data.version < 4) {
      for (const b of this.data.books) {
        const n = naturalAuthor(b.author);
        if (n && n !== b.author) {
          b.originalAuthor = b.author;
          b.author = n;
        }
      }
      this.data.version = 4;
    }
    this.data.seriesInfo ||= {}; // what Wikidata says each series holds, by series key
  }

  save() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 250);
  }

  flush() {
    clearTimeout(this.timer);
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 1));
    fs.renameSync(tmp, this.file);
    this.lastWrite = Date.now();
  }
}

module.exports = { Store, DEFAULT_SETTINGS, READING_KEYS };
