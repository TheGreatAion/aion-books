// Bookmarks as cloth ribbons in the reader.
const { test, expect } = require('@playwright/test');
const { launch, toLibrary, openBook, probe, waitForMeasured } = require('./helpers');

let app, page;
test.beforeAll(async () => ({ app, page } = await launch()));
test.afterAll(async () => app?.close());

const goTo = async (f) => {
  await page.evaluate((f) => window.Reader.view.goToFraction(f), f);
  await page.waitForTimeout(900);
};

test('a bookmark hangs a ribbon on its page, and peeks from the top edge elsewhere', async () => {
  await openBook(page, 'The Pear Tree Letters');
  await waitForMeasured(page);
  await goTo(0.6);
  await page.keyboard.press('b');
  await expect(page.locator('#ribbons .ribbon.hang')).toHaveCount(1);
  await expect(page.locator('#ribbons .ribbon.tab')).toHaveCount(0);

  await goTo(0.1);
  await expect(page.locator('#ribbons .ribbon.hang')).toHaveCount(0);
  await expect(page.locator('#ribbons .ribbon.tab')).toHaveCount(1);

  // The tab sits right of the middle (60% in), and takes you there.
  const box = await page.locator('#ribbons .ribbon.tab').boundingBox();
  const stage = await page.locator('#stage').boundingBox();
  expect(box.x - stage.x).toBeGreaterThan(stage.width / 2);
  await page.locator('#ribbons .ribbon.tab').click();
  await expect.poll(async () => (await probe(page)).fraction, { timeout: 10000 }).toBeGreaterThan(0.5);
  await expect(page.locator('#ribbons .ribbon.hang')).toHaveCount(1);

  // Taking the bookmark off takes the ribbon away.
  await page.keyboard.press('b');
  await expect(page.locator('#ribbons .ribbon')).toHaveCount(0);
  await toLibrary(page);
  await expect(page.locator('#ribbons .ribbon')).toHaveCount(0);
});
