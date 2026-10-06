// Tiny JSON-file store for the library, written atomically and debounced.
const fs = require('fs');
const path = require('path');

const DEFAULT_SETTINGS = {
  theme: 'linen', // linen | parchment | dusk
  fontFamily: 'EB Garamond',
  fontSize: 108, // percent
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
  timeLeft: true, // show estimated time left
  dailyGoal: 20, // minutes a day; 0 = off
  tapZones: false, // click page edges to turn
  ttsVoice: '', // read-aloud voice name ('' = system default)
  ttsRate: 1,
  watchFolder: '', // folder auto-imported from
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
