<h1 align="center">Aion Books</h1>

<p align="center">
  <em>A quiet, paper-textured EPUB reader and library for Windows.</em>
</p>

<p align="center">
  <a href="https://github.com/TheGreatAion/aion-books/releases/latest"><b>Download for Windows</b></a>
  &nbsp;·&nbsp;
  <a href="#features">Features</a>
  &nbsp;·&nbsp;
  <a href="#building-from-source">Build from source</a>
</p>

<p align="center">
  <img src="docs/screenshots/library.png" alt="The Aion Books library, with the book you're reading featured at the top and your other books in progress beneath it" width="860">
</p>

Aion Books is a home for your book collection and a calm place to read it. Pages feel like lightly
weathered paper, a few painted botanicals — ivy, lemons, olive — grow in the margins, and everything
else stays out of the way of the words.

## Download

1. Grab **`Aion-Books-Setup-x.y.z.exe`** from the [latest release](https://github.com/TheGreatAion/aion-books/releases/latest).
2. Run it. Windows may say the publisher is unknown (the installer isn't code-signed) — choose
   **More info → Run anyway**.
3. Drop some books onto the window — EPUB, Kindle (MOBI, AZW3), PDF, comics (CBZ) or FictionBook (FB2) — and start reading.

Installed copies keep themselves up to date: new versions download in the background and install the
next time you restart.

## Features

### Your library
- **Shelves, favourites and series** — books from the same series are grouped together, and when you
  finish one, the next is waiting for you.
- **Continue reading** — your current book up front, with every other book in progress beneath it.
- **Star ratings**, search, and sorting — including your own order, arranged by dragging books around.
- **Custom covers**, editable titles and authors.
- **A watched folder** — save an EPUB into it and it appears in your library on its own.

### Reading
- **EPUB, Kindle (MOBI / AZW3), PDF, comics (CBZ) and FictionBook (FB2)**, all in the same reader.
- **A real page curl** as you turn, and **page edges** either side that show how far through the book you are.
- **Single page, two-page spread, or continuous scroll**, with a choice of typefaces — or add your own
  `.ttf`, `.otf`, `.woff` or `.woff2` fonts.
- **Search inside the book**, **footnote pop-ups**, and a **dictionary** for any word you select.
- **Read aloud** with the voices built into Windows, following along sentence by sentence.
- **Highlights, notes and bookmarks**, exportable to Markdown.
- **Time left** in the chapter and the book, learned from how fast you actually read — or pages left, or
  just the percentage.
- Three papers — **Linen**, **Parchment** and **Dusk** — plus spacing, margins and size controls.

<p align="center">
  <img src="docs/screenshots/reader.png" alt="A two-page spread being read aloud, with the current sentence highlighted" width="860">
</p>

### Your commonplace book
Every passage you've highlighted, from every book, gathered on one page with your notes beside them —
searchable, sorted by book or by date, with one at random at the top. Click a passage to open the book
right there.

### Your reading
Its own page in the sidebar: a year in books, month by month — what you finished, how long each took and
how you rated it — plus time spent reading, streaks, pages turned, a fourteen-day chart, your most-read books, and a daily
reading goal that fills a small ring in the sidebar.

<p align="center">
  <img src="docs/screenshots/stats.png" alt="Reading stats: time read, current streak, books finished, pages turned and a 14-day chart" width="860">
</p>

### Your data stays yours
- Everything lives in one folder on your PC. **Back up and restore** the whole library — books,
  progress, highlights, shelves and fonts — as a single file.
- Put the library in a **OneDrive or Dropbox** folder to share it, and your reading progress, between PCs.
- No accounts and no tracking. The only time Aion Books goes online is when you look up a word
  (via [Wiktionary](https://en.wiktionary.org)) and when it checks GitHub for updates — which you can
  turn off in Settings.

<p align="center">
  <img src="docs/screenshots/library-dusk.png" alt="The library in the dark Dusk theme" width="860">
</p>

## Keyboard shortcuts

| Where    | Keys                              | Does                          |
| -------- | --------------------------------- | ----------------------------- |
| Library  | <kbd>Ctrl</kbd>+<kbd>O</kbd>      | Add books                     |
| Library  | <kbd>Ctrl</kbd>+<kbd>F</kbd> or <kbd>/</kbd> | Search your library |
| Anywhere | <kbd>Ctrl</kbd>+<kbd>,</kbd>      | Settings                      |
| Anywhere | <kbd>?</kbd>                      | Show these shortcuts          |
| Reader   | <kbd>←</kbd> <kbd>→</kbd>, <kbd>PgUp</kbd> <kbd>PgDn</kbd>, <kbd>Space</kbd>, mouse wheel | Turn pages |
| Reader   | <kbd>Ctrl</kbd>+<kbd>F</kbd>      | Search this book              |
| Reader   | <kbd>R</kbd>                      | Read aloud — play / pause     |
| Reader   | <kbd>T</kbd>                      | Contents & notes              |
| Reader   | <kbd>B</kbd>                      | Bookmark this page            |
| Reader   | <kbd>Ctrl</kbd>+<kbd>+</kbd> / <kbd>Ctrl</kbd>+<kbd>−</kbd> | Text size  |
| Reader   | <kbd>F11</kbd>                    | Full screen                   |
| Reader   | <kbd>Esc</kbd>                    | Close a panel, then back to the library |

## Building from source

You'll need [Node.js](https://nodejs.org) 20 or newer.

```
git clone https://github.com/TheGreatAion/aion-books.git
cd aion-books
npm install
npm start
```

| Command           | What it does                                                        |
| ----------------- | ------------------------------------------------------------------- |
| `npm start`       | Run the app from source                                             |
| `npm test`        | Run the unit tests and the app tests                                |
| `npm run pack`    | Build an unpacked copy → `release/win-unpacked/Aion Books.exe`      |
| `npm run dist`    | Build the installer → `release/Aion-Books-Setup-x.y.z.exe`          |
| `npm run release` | Build the installer and publish it as a GitHub release (needs `gh auth login`) |

Close any running copy before building — it locks `release/win-unpacked`.

To publish a new version: bump `version` in `package.json`, commit and push, then run `npm run release`.
Installed copies pick it up automatically.

### How it's put together

| Path                     | What's there                                                              |
| ------------------------ | ------------------------------------------------------------------------- |
| `main.js`                | The window, library storage, importing, watched folder, backups, sync, updates |
| `preload.js`             | The bridge between the app window and the main process                    |
| `lib/`                   | EPUB metadata (including series), book formats, the JSON store, bundled and custom fonts |
| `src/library.js`         | Shelves, the book grid, details, ratings, drag-to-reorder                 |
| `src/reader.js`, `src/reader-extras.js` | The reader: styling, controls, highlights, search, read aloud, footnotes, time left |
| `src/vendor/foliate-js/` | The book engine, [foliate-js](https://github.com/johnfactotum/foliate-js) (MIT), included unmodified |
| `tests/`                 | Unit tests, and app tests that drive the real app against generated sample books |
| `src/settings.js`        | Settings, the Your reading page, and the shortcuts list                    |
| `src/journal.js`         | The commonplace book and the reading timeline                             |
| `src/page-curl.js`       | The page curl                                                             |
| `src/painted.js`         | The painted botanical artwork, drawn as SVG                               |
| `src/styles.css`         | Everything visual                                                         |

By default your library is stored in `%APPDATA%\Aion Books`. **Settings → Your data → Library location**
can move it.

## Thanks

Books are laid out by [foliate-js](https://github.com/johnfactotum/foliate-js) by John Factotum,
the engine behind the [Foliate](https://johnfactotum.github.io/foliate/) reader.

## License

[MIT](LICENSE) © TheGreatAion
