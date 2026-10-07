// Series: found on Wikidata (from a recorded answer file, never the network),
// reviewed before they're used, shown with the books you're missing, and set,
// renamed, numbered or undone by hand.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { launch, toLibrary } = require('./helpers');

const FIXTURE = path.join(__dirname, '../fixtures/wikidata.json');

let app;
let page;
let dataDir;
test.beforeAll(async () => {
  process.env.AION_WIKIDATA_FIXTURE = FIXTURE;
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aion-series-'));
  ({ app, page } = await launch({ dataDir }));
});
test.afterAll(async () => {
  delete process.env.AION_WIKIDATA_FIXTURE;
  await app?.close();
});
test.afterEach(async () => {
  await page.keyboard.press('Escape');
  await toLibrary(page);
});

const book = (title) => page.evaluate((t) => window.UI.State.books.find((b) => b.title.startsWith(t)), title);

test('new books are looked up, and what’s found waits for review', async () => {
  // Late Roses has no series in its file; Wikidata (the recorded answers) says it's Orchard Years #3.
  await expect.poll(async () => (await book('Late Roses')).seriesSuggestion?.series, { timeout: 15000 }).toBe('The Orchard Years');
  expect((await book('Late Roses')).series || '').toBe(''); // not used until you say so

  await page.click('.nav-item[data-view="series"]');
  await page.click('[data-review-series]');
  await expect(page.locator('.tidy-row')).toHaveCount(2); // Late Roses, and One Long Afternoon
  await expect(page.locator('.tidy-row', { hasText: 'Late Roses' }).locator('.tidy-to')).toHaveText('The Orchard Years · book 3');
  // Untick One Long Afternoon: it's put aside, not offered again.
  await page.locator('.tidy-row', { hasText: 'One Long Afternoon' }).locator('input').uncheck();
  await expect(page.locator('#modal [data-ok]')).toHaveText('Add 1 to its series');
  await page.click('#modal [data-ok]');

  await expect.poll(async () => (await book('Late Roses')).series).toBe('The Orchard Years');
  expect((await book('Late Roses')).seriesIndex).toBe(3);
  expect((await book('One Long Afternoon')).seriesSuggestion).toBeUndefined();
  await expect(page.locator('[data-review-series]')).toHaveCount(0);
});

test('a series page shows your books in order, and the ones you’re missing', async () => {
  await page.click('.nav-item[data-view="series"]');
  const card = page.locator('.series-card', { hasText: 'The Orchard Years' });
  await expect(card).toContainText('3 of 5');
  await card.click();
  await expect(page.locator('#viewTitle')).toHaveText('The Orchard Years');
  await expect(page.locator('#viewCount')).toContainText('3 of 5 in your library');
  await expect(page.locator('#grid .card .t')).toHaveText(['The Pear Tree Letters', 'Along the Hedge Path', 'Late Roses', 'Winter Pruning', 'Seed Heads']);
  await expect(page.locator('#grid .gap-card')).toHaveCount(2);
  await expect(page.locator('#grid .gap-card').first()).toContainText('Not in your library');
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
