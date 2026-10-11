// The page after the last page: finished, how long it took, a rating, and the
// next book of the series a click away.
const { test, expect } = require('@playwright/test');
const { launch, openBook, probe } = require('./helpers');

let app, page;
test.beforeAll(async () => ({ app, page } = await launch()));
test.afterAll(async () => app?.close());

const book = (title) => page.evaluate((t) => window.UI.State.books.find((b) => b.title.startsWith(t)), title);

test('turning on from the last page closes the book and opens the Finished page', async () => {
  await openBook(page, 'The Pear Tree Letters');
  await page.evaluate(() => window.Reader.view.goToFraction(1));
  await expect.poll(async () => (await probe(page)).fraction, { timeout: 10000 }).toBeGreaterThan(0.99);
  await page.keyboard.press('ArrowRight');
  const fin = page.locator('#finished');
  await expect(fin).toBeVisible();
  await expect(fin.locator('h1')).toHaveText('The Pear Tree Letters');
  expect((await book('The Pear Tree Letters')).finished).toBe(true);
  await expect(page.locator('#reader')).not.toHaveClass(/is-active/);

  // Rate it right there.
  await fin.locator('.stars .star[data-star="4"]').click();
  await expect.poll(async () => (await book('The Pear Tree Letters')).rating).toBe(4);

  // The next book of the series opens with one click.
  await expect(fin.locator('.fin-book-title')).toHaveText('Along the Hedge Path');
  await fin.locator('[data-fin-open]').click();
  await expect(fin).toBeHidden();
  await page.waitForFunction(() => window.Reader.probe().open, null, { timeout: 30000 });
  expect(await page.evaluate(() => window.Reader.record?.title)).toBe('Along the Hedge Path');
});
