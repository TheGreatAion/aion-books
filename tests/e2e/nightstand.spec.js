// Continue reading and the nightstand: setting a book aside with the × on hover,
// Undo, the next book taking its place, and coming back when it's opened again.
const { test, expect } = require('@playwright/test');
const { launch, toLibrary, openBook } = require('./helpers');

let app, page;
test.beforeAll(async () => ({ app, page } = await launch()));
test.afterAll(async () => app?.close());

const featured = () => page.locator('#hero .hero-main h2').textContent();
const alsoTitles = () => page.locator('#hero .ns-title').allTextContents();

test('the × sets a book aside, and the next one takes its place', async () => {
  const titles = await page.evaluate(() => window.UI.State.books.map((b) => b.title));
  // Open every book, so the last opened is featured and the rest go on the nightstand.
  for (const t of titles) {
    await openBook(page, t);
    await toLibrary(page);
  }
  const last = titles[titles.length - 1];
  expect(await featured()).toBe(last);
  expect(await alsoTitles()).toHaveLength(titles.length - 1);

  // The × is only there while you're over the book.
  const slot = page.locator('#hero .ns-slot').first();
  const x = slot.locator('.aside-x');
  const gone = (await alsoTitles())[0];
  expect(await x.evaluate((el) => getComputedStyle(el).opacity)).toBe('0');
  await slot.hover();
  await expect.poll(() => x.evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
  await x.click();
  await expect.poll(alsoTitles).not.toContain(gone);
  expect(await alsoTitles()).toHaveLength(titles.length - 2);
  // Not "Reading now" any more either, but its place in the book is kept.
  const b = await page.evaluate((t) => window.UI.State.books.find((x) => x.title === t), gone);
  expect(b.setAside).toBeTruthy();
  expect(b.lastOpenedAt).toBeTruthy();

  // Undo brings it back.
  await page.locator('#toast [data-undo]').click();
  await expect.poll(alsoTitles).toContain(gone);

  // The featured book has one too; the most recent of the others steps up.
  const next = (await alsoTitles())[0];
  await page.locator('#hero .hero-cover-wrap').hover();
  await page.locator('#hero .hero-cover-wrap .aside-x').click();
  await expect.poll(featured).toBe(next);
  expect(await alsoTitles()).not.toContain(last);

  // Opening it again puts it back on the nightstand.
  await openBook(page, last);
  await toLibrary(page);
  await expect.poll(featured).toBe(last);
});

test('The nightstand holds eight, four to a row', async () => {
  // Pretend there are twelve books on the go (the test library has four).
  const cols = await page.evaluate(() => {
    const row = document.querySelector('#hero .ns-row');
    const slot = row.firstElementChild.outerHTML;
    row.innerHTML = slot.repeat(8);
    return getComputedStyle(row).gridTemplateColumns.split(' ').length;
  });
  const width = await page.evaluate(() => document.querySelector('#hero .ns-row').clientWidth);
  // Four columns whenever there's room for them (each at least 210px wide).
  expect(cols).toBe(width >= 4 * 210 + 54 ? 4 : Math.floor((width + 18) / 228));
  const src = require('fs').readFileSync(require('path').join(__dirname, '../../src/library.js'), 'utf8');
  expect(src).toMatch(/const MAX_ALSO = 8;/);
});

test('Reading now has a way back to All books', async () => {
  await page.locator('#nav [data-view="reading"]').click();
  await expect(page.locator('#viewTitle')).toHaveText('Reading now');
  await page.locator('#viewCount [data-goto="all"]').click();
  await expect(page.locator('#viewTitle')).toHaveText('All books');
});

test('search sits beside the heading, and Ctrl+F finds it from Settings', async () => {
  const inHeading = await page.evaluate(() => !!document.querySelector('.lib-heading #search'));
  expect(inHeading).toBe(true);
  await page.keyboard.press('Control+,');
  await expect(page.locator('#viewTitle')).toHaveText('Settings');
  await page.keyboard.press('Control+f');
  await expect(page.locator('#search')).toBeFocused();
  await expect(page.locator('#viewTitle')).toHaveText('All books');
  await page.keyboard.press('Escape');
});
