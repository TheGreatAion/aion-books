# Aion Books

A quiet EPUB reader and library for Windows: paper-textured, with painted Mediterranean botanicals.

## Run / build

```
npm start        # run in development (always the latest code)
npm run pack     # unpacked build → release/win-unpacked/Aion Books.exe
npm run dist     # installer → release/Aion-Books-Setup-x.y.z.exe
```

Close the app before building — a running copy locks `release/win-unpacked`.

## Features

- **Library** — shelves, favourites, search, sort (including your own drag-and-drop order), series
  grouping with "next in series", custom covers, a watched folder that auto-imports new EPUBs.
- **Reader** — single / two-page / scroll layouts, typefaces (bundled or your own font files),
  search inside the book, footnote pop-ups, dictionary look-up (online), read aloud with Windows
  voices, highlights & notes, bookmarks, time-left estimates, optional click-the-edge page turns.
- **Stats** — reading time, streaks, pages, a 14-day chart and a daily goal ring.
- **Your data** — export notes to Markdown, back up / restore the whole library, or keep the
  library in a OneDrive/Dropbox folder to share progress between PCs.

## Where things live

- `main.js` — window, library storage, import, watch folder, backup, sync, dictionary, IPC
- `lib/` — EPUB metadata (incl. series), JSON store, bundled fonts, font-file parsing
- `src/` — UI: `library.js`, `reader.js` + `reader-extras.js`, `settings.js`,
  `painted.js` (botanical artwork), `ornaments.js` (icons), `styles.css`

By default the library is in `%APPDATA%/Aion Books` (books, covers, fonts, cached page locations and
`library.json`). Settings → Your data → Library location can move it.

## Keys

| Where    | Key                              | Action                       |
| -------- | -------------------------------- | ---------------------------- |
| Library  | Ctrl+O                           | Add books                    |
| Library  | Ctrl+F or /                      | Search                       |
| Anywhere | Ctrl+,                           | Settings                     |
| Reader   | ← → / PgUp PgDn / Space / wheel  | Turn pages                   |
| Reader   | Ctrl+F                           | Search this book             |
| Reader   | R                                | Read aloud — play / pause    |
| Reader   | T                                | Contents & notes             |
| Reader   | B                                | Bookmark page                |
| Reader   | Ctrl + / Ctrl −                  | Text size                    |
| Reader   | F11                              | Full screen                  |
| Reader   | Esc                              | Close panel / back           |
