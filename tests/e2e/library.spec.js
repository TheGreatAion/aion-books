const { test, expect } = require('@playwright/test');
const { launch } = require('./helpers');

let app;
let page;
test.beforeAll(async () => ({ app, page } = await launch()));
test.afterAll(async () => app?.close());

test('imports books and shows them on the shelf', async () => {
  await expect(page.locator('#grid .card')).toHaveCount(4);
  await expect(page.locator('#grid')).toContainText('The Pear Tree Letters');
  await expect(page.locator('#grid')).toContainText('Late Roses');
});

test('groups a series and lists it in order', async () => {
  await page.click('.nav-item[data-view="series"]');
  await page.click('.series-card');
  await expect(page.locator('#viewTitle')).toHaveText('The Orchard Years');
  await expect(page.locator('#grid .card .t')).toHaveText(['The Pear Tree Letters', 'Along the Hedge Path']);
  await page.click('.nav-item[data-view="all"]');
});

test('search filters the shelf', async () => {
  await page.fill('#search', 'roses');
  await expect(page.locator('#grid .card')).toHaveCount(1);
  await page.fill('#search', '');
  await expect(page.locator('#grid .card')).toHaveCount(4);
});

test('rates a book from the right-click menu and sorts by rating', async () => {
  await page.click('.card:has-text("Late Roses")', { button: 'right' });
  await page.click('.menu-stars .star[data-star="4"]');
  await expect.poll(() => page.evaluate(() => window.UI.State.books.find((b) => b.title === 'Late Roses').rating)).toBe(4);
  await page.selectOption('#sort', 'rating');
  await expect(page.locator('#grid .card .t').first()).toHaveText('Late Roses');
  await page.selectOption('#sort', 'recent');
});

test('drag-and-drop gives the shelf your own order', async () => {
  // Let the cards finish their drop-in animation so the drag lands where we aim.
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));
  const last = await page.locator('#grid .card .t').last().textContent();
  await page.dragAndDrop('#grid .card >> nth=-1', '#grid .card >> nth=0', { targetPosition: { x: 5, y: 60 } });
  await expect(page.locator('#sort')).toHaveValue('custom');
  await expect(page.locator('#grid .card .t').first()).toHaveText(last);
  // The order is saved: it survives a reload.
  await page.reload();
  await page.waitForFunction(() => window.UI?.State?.books?.length);
  await expect(page.locator('#grid .card .t').first()).toHaveText(last);
});

test('settings survive a restart of the window', async () => {
  await page.click('#openSettings');
  await page.click('[data-set="theme"][data-v="dusk"]');
  await page.reload();
  await page.waitForFunction(() => window.UI?.State?.books?.length);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dusk');
});
