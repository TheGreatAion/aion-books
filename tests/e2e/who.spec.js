const { test, expect } = require('@playwright/test');
const { launch, toLibrary, probe, openBook, bookFrame } = require('./helpers');

// The Orchard Years: book 1 (The Pear Tree Letters) introduces Agnes Hale at the
// end of chapter 1; book 2 (Along the Hedge Path) introduces Tobias Reed at the
// end of its chapter 1, and both appear at the end of its chapter 2.

let app;
let page;
test.beforeAll(async () => ({ app, page } = await launch()));
test.afterAll(async () => app?.close());
test.afterEach(async () => {
  await page.keyboard.press('Escape');
  await toLibrary(page);
});

const card = () => page.locator('#notePop');
const who = (name) => page.evaluate((n) => window.Reader.whoIsThis({ text: n }), name);
const at = async (title, tocIndex) => {
  await openBook(page, title);
  await page.evaluate((i) => window.Reader.goTo(window.Reader.flatToc[i].href), tocIndex);
  await page.waitForTimeout(900);
};

test('a name you’ve met in this book: where they first appeared, and how often', async () => {
  await at('Along the Hedge Path', 2); // chapter 3, after both of Tobias's mentions
  await who('Tobias');
  await expect(card().locator('.who-name')).toHaveText('Tobias');
  await expect(card()).toContainText('Tobias Reed came up the hedge path');
  await expect(card().locator('.who-head').first()).toContainText('First mentioned');
  await expect(card().locator('.who-head').first()).toContainText('The Pear Tree'); // chapter 1's title
  await expect(card()).toContainText('Last seen');
  await expect(card()).toContainText('Mentioned 2 times so far in this book');
});

test('looks back into the earlier books of the series', async () => {
  await at('Along the Hedge Path', 2);
  await who('Agnes');
  await expect(card()).toContainText('in The Pear Tree Letters', { timeout: 20000 }); // first met in book 1
  await expect(card()).toContainText('Agnes Hale, the gardener’s widow');
  await expect(card()).toContainText('1 time so far in this book, and 2 in 1 earlier book');
});

test('never looks past your place in the book', async () => {
  await at('Along the Hedge Path', 0); // the start of chapter 1, before Tobias appears
  await who('Tobias');
  await expect(card()).toContainText('hasn’t come up before this page', { timeout: 20000 });
  await expect(card()).not.toContainText('quinces');
});

test('“Go there” jumps to the passage', async () => {
  await at('Along the Hedge Path', 2);
  await who('Tobias');
  const before = (await probe(page)).fraction;
  await card().locator('[data-who-go]').first().click();
  await expect.poll(async () => (await probe(page)).fraction).toBeLessThan(before);
  const frame = await bookFrame(page, 'p');
  expect(await page.evaluate(() => window.Reader.probe().chapter)).toBe('The Pear Tree');
  expect(frame).not.toBeNull();
});

test('the Who? button, and Wikipedia only when asked, with a warning', async () => {
  await at('The Pear Tree Letters', 0);
  await expect(page.locator('#selBar .sel-btn[data-act="who"]')).toHaveCount(1);
  await who('Agnes');
  await expect(card().locator('[data-who-wiki]')).toHaveText('Look it up on Wikipedia');
  await expect(card().locator('.who-online')).toContainText('May give away what happens later');
  await expect(card().locator('.who-wiki')).toHaveCount(0); // nothing fetched until you click
});

test('asks for a name when the selection isn’t one', async () => {
  await at('The Pear Tree Letters', 0);
  await page.evaluate(() => window.Reader.whoIsThis({ text: 'The garden had gone quiet in the way gardens do' }));
  await expect(card()).toContainText('Select a name');
});
