// Launches the real app against a throwaway library, preloaded with the test books.
const { _electron: electron } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { OUT } = require('../fixtures/make-fixtures');

const ROOT = path.join(__dirname, '../..');
const book = (name) => path.join(OUT, name);
const ALL_BOOKS = ['pear-tree.epub', 'hedge-path.epub', 'single-file.epub', 'point-sized.epub'];

async function launch({ books = ALL_BOOKS, dataDir } = {}) {
  dataDir = dataDir || fs.mkdtempSync(path.join(os.tmpdir(), 'aion-e2e-'));
  const app = await electron.launch({
    args: [ROOT, ...books.map(book)], // book paths on the command line are imported, like "Open with"
    env: { ...process.env, AION_DATA_DIR: dataDir },
  });
  const page = await app.firstWindow();
  await page.waitForFunction((n) => window.UI?.State?.books?.length >= n, books.length, { timeout: 30000 });
  // Opening books from the command line opens the last one; start from the library.
  await page.waitForTimeout(500);
  await toLibrary(page);
  return { app, page, dataDir };
}

async function toLibrary(page) {
  for (let i = 0; i < 3; i++) {
    const inReader = await page.evaluate(() => document.querySelector('#reader').classList.contains('is-active'));
    if (!inReader) return;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
  }
}

const probe = (page) => page.evaluate(() => window.Reader.probe());

async function openBook(page, title) {
  const id = await page.evaluate((t) => window.UI.State.books.find((b) => b.title.startsWith(t)).id, title);
  await page.evaluate((id) => window.Reader.open(id), id);
  await page.waitForFunction(() => window.Reader.probe().open, null, { timeout: 30000 });
  await page.waitForTimeout(500);
}

async function waitForMeasured(page) {
  await page.waitForFunction(() => window.Reader.probe().measured, null, { timeout: 60000 });
}

// The frame of the book page that contains a selector (book pages live in iframes).
async function bookFrame(page, selector) {
  for (const f of page.frames()) {
    if (f === page.mainFrame()) continue;
    if (await f.$(selector).catch(() => null)) return f;
  }
  return null;
}

module.exports = { launch, toLibrary, probe, openBook, waitForMeasured, bookFrame, ALL_BOOKS };
