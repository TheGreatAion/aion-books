// Series are yours to make: a series written in a book's own file shows, and
// otherwise books go into a series only when you put them there (from a
// book's menu, Edit details, or several at once), renamed, numbered,
// reordered or taken out again by hand. Nothing is guessed or looked up.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { launch, toLibrary } = require('./helpers');

let app;
let page;
let dataDir;
test.beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aion-series-'));
  ({ app, page } = await launch({ dataDir }));
});
test.afterAll(async () => {
  await app?.close();
});
test.afterEach(async () => {
  await page.keyboard.press('Escape');
  await toLibrary(page);
});

const book = (title) => page.evaluate((t) => window.UI.State.books.find((b) => b.title.startsWith(t)), title);

test('a series in a book’s own file shows; nothing else is guessed', async () => {
  await expect.poll(async () => (await book('The Pear Tree Letters')).seriesName).toBe('The Orchard Years');
  // Late Roses says nothing about a series: it stays out of one.
  await page.waitForTimeout(1500);
  const b = await book('Late Roses');
  expect(b.series || '').toBe('');
  expect(b.seriesSuggestion).toBeUndefined();
});

test('put a book in a series from its menu, with its number', async () => {
  await page.click('.nav-item[data-view="all"]');
  await page.click('.card:has-text("Late Roses")', { button: 'right' });
  await page.click('#menu >> text=Add to a series…');
  await page.fill('#sName', 'The Orchard Years');
  await page.fill('#sNo', '4');
  await page.click('#modal [data-ok]');
  await expect.poll(async () => (await book('Late Roses')).seriesName).toBe('The Orchard Years');
  const b = await book('Late Roses');
  expect(b.seriesNo).toBe(4);
  expect(b.seriesSource).toBe('you');
});

test('a series page shows your books in order, with a gap where a number is skipped', async () => {
  await page.click('.nav-item[data-view="series"]');
  const card = page.locator('.series-card', { hasText: 'The Orchard Years' });
  await card.click();
  await expect(page.locator('#viewTitle')).toHaveText('The Orchard Years');
  await expect(page.locator('#grid .card[data-id] .t')).toHaveText(['The Pear Tree Letters', 'Along the Hedge Path', 'Late Roses']);
  await expect(page.locator('#grid .gap-card')).toHaveCount(1); // book 3
  await expect(page.locator('#grid .card.up-next .t')).toHaveText('The Pear Tree Letters');
});

test('set a book’s series yourself in Edit details', async () => {
  await page.click('.nav-item[data-view="all"]');
  await page.click('.card:has-text("One Long Afternoon")', { button: 'right' });
  await page.click('#menu >> text=Edit title & author');
  await page.fill('#eSeries', 'Orchard Classics');
  await page.fill('#eSeriesNo', '1');
  await page.click('#modal [data-ok]');
  await expect.poll(async () => (await book('One Long Afternoon')).seriesName).toBe('Orchard Classics');
  const b = await book('One Long Afternoon');
  expect(b.seriesNo).toBe(1);
  expect(b.seriesSource).toBe('you');
});

test('rename a series, and undo one, from its menu', async () => {
  await page.click('.nav-item[data-view="series"]');
  await page.click('.series-card:has-text("Orchard Classics")', { button: 'right' });
  await page.click('#menu >> text=Rename series…');
  await page.fill('#mInput', 'The Classics');
  await page.click('#modal [data-ok]');
  await expect(page.locator('.series-card', { hasText: 'The Classics' })).toHaveCount(1);

  await page.click('.series-card:has-text("The Classics")', { button: 'right' });
  await page.click('#menu >> text=Not a series');
  await expect.poll(async () => (await book('One Long Afternoon')).series).toBe('');
  // Taken out by hand: never looked up and offered again.
  expect((await book('One Long Afternoon')).seriesSource).toBe('you');
});

test('choose several books and put them in a series, numbered in order', async () => {
  await page.click('.nav-item[data-view="all"]');
  await page.evaluate(() => {
    // A known order to number them by.
    window.UI.setSettings({ sort: 'title' });
  });
  await page.selectOption('#sort', 'title');
  const cards = page.locator('#grid .card[data-id]');
  await page.locator('.card:has-text("Along the Hedge Path")').click({ modifiers: ['Control'] });
  await page.locator('.card:has-text("One Long Afternoon")').click({ modifiers: ['Control'] });
  await page.click('#selectBar [data-sel="series"]');
  await page.fill('#sName', 'Two Walks');
  await page.click('#modal [data-ok]');
  await expect.poll(async () => (await book('One Long Afternoon')).seriesName).toBe('Two Walks');
  expect((await book('Along the Hedge Path')).seriesNo).toBe(1); // first in title order
  expect((await book('One Long Afternoon')).seriesNo).toBe(2);
  expect(await cards.count()).toBeGreaterThan(0);
});

test('authors are written the way people write them', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aion-authors-'));
  fs.writeFileSync(
    path.join(dir, 'library.json'),
    JSON.stringify({
      version: 3,
      books: [
        { id: 'a1', title: 'Words of Radiance', author: 'Sanderson, Brandon', format: 'epub', progress: 0, highlights: [], bookmarks: [], shelves: [], addedAt: 1 },
        { id: 'a2', title: 'Towers of Midnight', author: 'Robert Jordan, Brandon Sanderson', format: 'epub', progress: 0, highlights: [], bookmarks: [], shelves: [], addedAt: 1 },
      ],
      settings: {},
    })
  );
  const other = await launch({ books: [], dataDir: dir });
  const authors = await other.page.evaluate(() => window.UI.State.books.map((b) => [b.author, b.originalAuthor]));
  expect(authors).toEqual([
    ['Brandon Sanderson', 'Sanderson, Brandon'],
    ['Robert Jordan, Brandon Sanderson', undefined], // two authors: left alone
  ]);
  await other.app.close();
});

test('the + on the Series page makes a series from the books you tick, in that order', async () => {
  await page.click('.nav-item[data-view="series"]');
  await page.click('[data-new-series]');
  await expect(page.locator('#modal [data-ok]')).toBeDisabled(); // a name and a book first
  await page.fill('#seName', 'Evening Reads');
  await page.fill('#seFind', 'late');
  await page.locator('.pick-row:has-text("Late Roses") input').check();
  await page.fill('#seFind', '');
  await page.locator('.pick-row:has-text("The Pear Tree Letters") input').check();
  await expect(page.locator('.pick-row:has-text("Late Roses") .pick-no')).toHaveText('1');
  await expect(page.locator('.pick-row:has-text("The Pear Tree Letters") .pick-no')).toHaveText('2');
  await page.click('#modal [data-ok]');
  await expect.poll(async () => (await book('Late Roses')).seriesName).toBe('Evening Reads');
  expect((await book('Late Roses')).seriesNo).toBe(1);
  expect((await book('The Pear Tree Letters')).seriesNo).toBe(2);

  // On the series' page, the + changes it: here, taking a book out.
  await page.click('.series-card:has-text("Evening Reads")');
  await page.click('[data-add-to-series]');
  await expect(page.locator('#seName')).toHaveValue('Evening Reads');
  await page.locator('.pick-row:has-text("Late Roses") input').uncheck();
  await page.click('#modal [data-ok]');
  await expect.poll(async () => (await book('Late Roses')).series || '').toBe('');
  expect((await book('The Pear Tree Letters')).seriesNo).toBe(1);
});
