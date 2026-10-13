// Small comforts: a copy of a book you already have, one author for several
// books, going to a page or a percentage, read aloud's sleep timer, and the
// reading time left that Home uses to say when you'll finish.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { launch, toLibrary, openBook, probe } = require('./helpers');
const { OUT } = require('../fixtures/make-fixtures');

let app, page;
test.beforeAll(async () => ({ app, page } = await launch()));
test.afterAll(async () => app?.close());

const book = (title) => page.evaluate((t) => window.UI.State.books.find((b) => b.title.startsWith(t)), title);

test('adding a copy of a book you have asks whether to keep it', async () => {
  // Another file of The Pear Tree Letters (a few bytes different, so not the same file).
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aion-copy-'));
  const copy = path.join(dir, 'pear-tree-again.epub');
  fs.writeFileSync(copy, Buffer.concat([fs.readFileSync(path.join(OUT, 'pear-tree.epub')), Buffer.from('\n')]));
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
  }, copy);
  const before = await page.evaluate(() => window.UI.State.books.length);
  await page.click('#addBooks');
  await expect(page.locator('#modal h3')).toHaveText('Already in your library?');
  await expect(page.locator('#modal .tidy-row')).toHaveCount(1);
  await page.click('#modal [data-ok]');
  await expect.poll(() => page.evaluate(() => window.UI.State.books.length)).toBe(before);
  await expect(page.locator('#toast')).toContainText('Undo');
});

test('choose several books and set their author at once', async () => {
  await toLibrary(page);
  await page.click('.nav-item[data-view="all"]');
  await page.locator('.card:has-text("Along the Hedge Path")').click({ modifiers: ['Control'] });
  await page.locator('.card:has-text("The Pear Tree Letters")').click({ modifiers: ['Control'] });
  await page.click('#selectBar [data-sel="author"]');
  await page.fill('#mInput', 'Vale, Eleanor');
  await page.click('#modal [data-ok]');
  await expect.poll(async () => (await book('The Pear Tree Letters')).author).toBe('Eleanor Vale');
  expect((await book('Along the Hedge Path')).author).toBe('Eleanor Vale');
});

test('Ctrl+G goes to a percentage or a page, and remembers where you were', async () => {
  await openBook(page, 'The Pear Tree Letters');
  await page.keyboard.press('Control+g');
  await expect(page.locator('#modal .sub')).toContainText('of about');
  await page.fill('#mInput', '50%');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await probe(page)).fraction, { timeout: 10000 }).toBeGreaterThan(0.4);
  await expect(page.locator('#backPill')).toBeVisible();
  await page.keyboard.press('Control+g');
  await page.fill('#mInput', '1');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await probe(page)).fraction, { timeout: 10000 }).toBeLessThan(0.1);
});

test('reading time left is kept, for when you’ll finish', async () => {
  await page.evaluate(() => window.Reader.view.goToFraction(0.3));
  await expect.poll(async () => (await book('The Pear Tree Letters')).msLeft || 0, { timeout: 10000 }).toBeGreaterThan(0);
});

test('read aloud’s sleep timer counts down, and stops reading when it runs out', async () => {
  await page.evaluate(() => window.Reader.ttsSleepNext());
  await expect(page.locator('#ttsSleep')).toHaveClass(/is-on/);
  await expect(page.locator('#ttsSleep span')).toHaveText('15 min');
  // Reading, and the time is up: the next sentence doesn't come.
  await page.evaluate(() => {
    const R = window.Reader;
    R.tts = { playing: true, paused: false, si: 0, sentences: [], blocks: [], bi: 0 };
    R.sleep.until = Date.now() - 1;
    R.ttsNext();
  });
  await expect(page.locator('#toast')).toContainText('sleep timer');
  expect(await page.evaluate(() => window.Reader.tts.paused)).toBe(true);
  await page.evaluate(() => window.Reader.ttsStop());
  await expect(page.locator('#ttsSleep')).not.toHaveClass(/is-on/);
});

test('the progress bar marks where chapters begin', async () => {
  await openBook(page, 'The Pear Tree Letters');
  await expect.poll(() => page.evaluate(() => (window.Reader.tickStops || []).length)).toBeGreaterThan(1);
  expect(await page.evaluate(() => getComputedStyle(document.querySelector('#rProgress')).backgroundImage)).toContain('linear-gradient');
});

test('the contents show each chapter’s minutes, and a check on the ones read', async () => {
  await openBook(page, 'The Pear Tree Letters');
  await page.evaluate(() => window.Reader.view.goToFraction(0.6));
  await page.waitForFunction(() => window.Reader.probe().measured, null, { timeout: 60000 });
  await page.waitForTimeout(800);
  await page.keyboard.press('t');
  await expect.poll(() => page.locator('.toc-item.is-read').count()).toBeGreaterThan(0);
  await expect(page.locator('.toc-item:not(.is-read) .toc-meta').first()).toContainText('min');
  await page.keyboard.press('t');
});

test('a chapter’s last page says what comes next, and turns to it', async () => {
  await openBook(page, 'The Pear Tree Letters');
  await page.waitForFunction(() => window.Reader.probe().measured, null, { timeout: 60000 });
  const toc = await page.evaluate(() => window.Reader.flatToc.map((t) => ({ label: t.label, href: t.href })));
  await page.evaluate((href) => window.Reader.goTo(href), toc[3].href);
  await page.waitForTimeout(1000);
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('#rChapter')).toContainText('last page');
  await expect(page.locator('#catchword')).toBeVisible();
  await expect(page.locator('#catchword .cw-title')).toHaveText(toc[3].label);

  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('#rChapter')).toContainText('pages left');
  await expect(page.locator('#catchword')).toBeHidden();

  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#catchword')).toBeVisible();
  await page.click('#catchword');
  await expect.poll(() => page.evaluate(() => window.Reader.chapter)).toBe(toc[3].label);

  // It can be turned off.
  await page.waitForTimeout(600);
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('#rChapter')).toContainText('last page');
  await expect(page.locator('#catchword')).toBeVisible();
  await page.evaluate(() => window.Reader.change({ chapterNext: false }));
  await expect(page.locator('#catchword')).toBeHidden();
  await page.evaluate(() => window.Reader.change({ chapterNext: true }));
  await toLibrary(page);
});

test('text size is remembered per book; the default stays as it was', async () => {
  await openBook(page, 'The Pear Tree Letters');
  const before = await page.evaluate(() => window.UI.State.settings.fontSize);
  await page.evaluate(() => window.Reader.change({ fontSize: 136 }));
  await toLibrary(page);
  expect(await page.evaluate(() => window.UI.State.settings.fontSize)).toBe(before);
  await openBook(page, 'Along the Hedge Path');
  expect(await page.evaluate(() => window.UI.State.settings.fontSize)).toBe(before);
  await toLibrary(page);
  await openBook(page, 'The Pear Tree Letters');
  expect(await page.evaluate(() => window.UI.State.settings.fontSize)).toBe(136);
  await toLibrary(page);
});

test('Dusk in the evening: Dusk during the chosen hours', async () => {
  const h = new Date().getHours();
  await page.evaluate((h) => window.UI.setSettings({ theme: 'linen', duskFrom: h, duskTo: (h + 1) % 24, duskEvening: true }), h);
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme), { timeout: 10000 }).toBe('dusk');
  expect(await page.evaluate(() => window.UI.State.settings.followSystem)).toBe(false);
  await page.evaluate(() => window.UI.setSettings({ duskEvening: false, theme: 'linen' }));
});
