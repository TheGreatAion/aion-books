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

test('a change to one book redraws only its card', async () => {
  await page.click('.nav-item[data-view="all"]');
  const card = (title) => page.locator(`#grid .card:has-text("${title}")`);
  await card('Late Roses').evaluate((el) => (el.dataset.kept = 'yes'));
  await card('The Pear Tree Letters').evaluate((el) => (el.dataset.kept = 'yes'));
  const id = await card('The Pear Tree Letters').getAttribute('data-id');
  await page.evaluate((id) => window.UI.updateBook(id, { favorite: true }), id);
  await expect(card('The Pear Tree Letters').locator('.fav')).toHaveClass(/is-on/);
  expect(await card('The Pear Tree Letters').getAttribute('data-kept')).toBeNull(); // drawn anew
  expect(await card('Late Roses').getAttribute('data-kept')).toBe('yes'); // left as it was
  await page.evaluate((id) => window.UI.updateBook(id, { favorite: false }), id);
});

test('groups a series and lists it in order', async () => {
  await page.click('.nav-item[data-view="series"]');
  await page.click('.series-card');
  await expect(page.locator('#viewTitle')).toHaveText('The Orchard Years');
  await expect(page.locator('#grid .card[data-id] .t')).toHaveText(['The Pear Tree Letters', 'Along the Hedge Path']);
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
  await page.locator('#nav [data-view="all"]').click();
  await expect(page.locator('#grid .card .t').first()).toHaveText(last);
});

test('settings survive a restart of the window', async () => {
  await page.click('#openSettings');
  await page.click('[data-set="theme"][data-v="dusk"]');
  await page.reload();
  await page.waitForFunction(() => window.UI?.State?.books?.length);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dusk');
});

test('settings are grouped into six sections', async () => {
  await page.click('#openSettings');
  await expect(page.locator('#settingsPanel h2')).toHaveText([
    'Reading',
    'Turning pages & the page',
    'Read aloud',
    'Library',
    'Your data',
    'App',
  ]);
  // Gone: the stats (own page), the shortcuts (overlay), sorting (library header) and the remove switch.
  await expect(page.locator('#settingsPanel .stat-tiles')).toHaveCount(0);
  await expect(page.locator('#settingsPanel .keys')).toHaveCount(0);
  await expect(page.locator('#settingsPanel [data-set="sort"]')).toHaveCount(0);
  await expect(page.locator('#settingsPanel [data-toggle="confirmRemove"]')).toHaveCount(0);
  await expect(page.locator('#settingsPanel [data-set="footerInfo"]')).toHaveCount(3);
});

test('settings can be searched, in everyday words too', async () => {
  await page.click('#openSettings');
  await expect(page.locator('#search')).toBeHidden();
  await page.keyboard.press('Control+f');
  await expect(page.locator('#setSearch')).toBeFocused();
  const shown = (title) => page.locator('#settingsPanel .set-row:not(.set-miss) .set-title', { hasText: title });

  await page.keyboard.type('font');
  await expect(shown('Typeface')).toHaveCount(1); // "font" isn't in its name
  await expect(shown('Line spacing')).toHaveCount(0);
  await expect(page.locator('#settingsPanel .set-group:not(.set-miss) h2', { hasText: 'Read aloud' })).toHaveCount(0);

  await page.fill('#setSearch', 'read aloud'); // a section's name shows the whole section
  await expect(shown('Voice')).toHaveCount(1);
  await expect(shown('Speed')).toHaveCount(1);

  await page.fill('#setSearch', 'goal'); // kept on another page: a way there
  await expect(shown('Daily reading goal')).toHaveCount(1);

  await page.fill('#setSearch', 'zzzz');
  await expect(page.locator('.set-empty')).toHaveText('No setting matches “zzzz”.');

  await page.keyboard.press('Escape');
  await expect(page.locator('#setSearch')).toHaveValue('');
  await expect(shown('Line spacing')).toHaveCount(1);
  await expect(shown('Daily reading goal')).toHaveCount(0);
});

test('your reading has its own page, reached from the sidebar and the goal ring', async () => {
  await page.click('#openStats');
  await expect(page.locator('#viewTitle')).toHaveText('Your reading');
  await expect(page.locator('#statsPanel')).toBeVisible();
  await expect(page.locator('#settingsPanel')).toBeHidden();
  await expect(page.locator('#statsPanel .stat-tiles .stat')).toHaveCount(4);
  await page.click('#statsPanel [data-set="dailyGoal"][data-v="45"]');
  await expect(page.locator('#goalRow')).toContainText('of 45 min');
  await expect(page.locator('#statsPanel [data-set="dailyGoal"][data-v="45"]')).toHaveClass(/is-on/);

  await page.click('.nav-item[data-view="all"]');
  await expect(page.locator('#statsPanel')).toBeHidden();
  await page.click('#goalRow');
  await expect(page.locator('#statsPanel')).toBeVisible();
  await page.click('#statsPanel [data-set="dailyGoal"][data-v="20"]');
});

test('? shows the keyboard shortcuts', async () => {
  await page.click('.nav-item[data-view="all"]');
  await page.keyboard.press('?');
  await expect(page.locator('#modal .keys')).toBeVisible();
  await expect(page.locator('#modal')).toContainText('Read aloud');
  await page.keyboard.press('Escape');
  await expect(page.locator('#modalBack')).toBeHidden();
  // Not while typing in the search box.
  await page.click('#search');
  await page.keyboard.press('?');
  await expect(page.locator('#modalBack')).toBeHidden();
  await page.fill('#search', '');
  await page.locator('#search').blur();
});

test('a book stays in its series after it has been opened', async () => {
  const id = await page.evaluate(() => window.UI.State.books.find((b) => b.title === 'Along the Hedge Path').id);
  await page.evaluate((id) => window.UI.updateBook(id, { lastOpenedAt: Date.now() }, { quiet: true }), id);
  expect(await page.evaluate((id) => window.UI.State.book(id).seriesName, id)).toBe('The Orchard Years');
});
