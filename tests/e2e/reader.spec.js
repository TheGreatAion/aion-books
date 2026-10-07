const { test, expect } = require('@playwright/test');
const { launch, toLibrary, probe, openBook, waitForMeasured, bookFrame } = require('./helpers');

let app;
let page;
test.beforeAll(async () => ({ app, page } = await launch()));
test.afterAll(async () => app?.close());
test.afterEach(async () => {
  await page.evaluate(() => window.UI.setSettings({ fontSize: 100, layout: 'auto' }));
  await toLibrary(page);
});

const turn = async (n, key = 'ArrowRight') => {
  for (let i = 0; i < n; i++) {
    await page.keyboard.press(key);
    await page.waitForTimeout(250);
  }
  await page.waitForTimeout(300);
};

test('turns pages forwards and back', async () => {
  await openBook(page, 'The Pear Tree Letters');
  const start = await probe(page);
  await turn(3);
  const later = await probe(page);
  expect(later.position).not.toBe(start.position);
  await turn(3, 'ArrowLeft');
  expect((await probe(page)).position).toBe(start.position);
});

test('reopens a book where you left off', async () => {
  await openBook(page, 'Along the Hedge Path');
  await turn(4);
  const here = (await probe(page)).position;
  await toLibrary(page);
  await openBook(page, 'Along the Hedge Path');
  // The engine settles on the exact spot a moment after the chapter appears.
  await expect.poll(async () => (await probe(page)).position, { timeout: 15000 }).toBe(here);
});

// A narrow window shows one column, and pages often start mid-paragraph; the
// saved place must still bring you back to the same page, not the one before.
test('reopens on the same page in a narrow window', async () => {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(800, 560));
  try {
    await page.waitForTimeout(500);
    await openBook(page, 'The Pear Tree Letters');
    await page.evaluate(() => window.Reader.goTo(window.Reader.flatToc[1].href));
    await page.waitForTimeout(800);
    await turn(2);
    const here = (await probe(page)).position;
    await toLibrary(page);
    await openBook(page, 'The Pear Tree Letters');
    await expect.poll(async () => (await probe(page)).position, { timeout: 15000 }).toBe(here);
  } finally {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 840));
  }
});

// Books size their text in different ways; every one must respond to the size buttons.
for (const [title, how] of [
  ['The Pear Tree Letters', 'em'],
  ['One Long Afternoon', 'rem'],
  ['Late Roses', 'pt'],
]) {
  test(`text size reaches a book sized in ${how}`, async () => {
    await openBook(page, title);
    const before = (await probe(page)).textPx;
    await page.click('#rType');
    for (let i = 0; i < 5; i++) await page.click('#fontUp');
    await page.waitForTimeout(800);
    const after = (await probe(page)).textPx;
    expect(after / before).toBeGreaterThan(1.2);
    await page.keyboard.press('Escape');
  });
}

test('names the right chapter when chapters share one file', async () => {
  await openBook(page, 'One Long Afternoon');
  await page.click('#rToc');
  await page.click('.toc-item:has-text("Chapter 3")');
  await page.waitForTimeout(800);
  const p = await probe(page);
  expect(p.chapter).toBe('Chapter 3: Windfall');
  expect(p.heads).toContain('One Long Afternoon'); // the short title, without the subtitle and brackets
  expect(p.folios[0]).toMatch(/^\d+$/);
});

test('finds text in the book and jumps to it', async () => {
  await openBook(page, 'The Pear Tree Letters');
  await page.keyboard.press('Control+f');
  await page.fill('#bookSearch', 'foxgloves');
  await page.press('#bookSearch', 'Enter');
  await expect(page.locator('#searchStatus')).toHaveText(/\d+ match/, { timeout: 15000 });
  const before = (await probe(page)).position;
  await page.locator('.sr-hit').nth(8).click();
  await page.waitForTimeout(800);
  expect((await probe(page)).position).not.toBe(before);
});

test('shows footnotes in a pop-up', async () => {
  await openBook(page, 'The Pear Tree Letters');
  await page.keyboard.press('Control+f');
  await page.fill('#bookSearch', 'planted the year');
  await page.press('#bookSearch', 'Enter');
  await expect(page.locator('.sr-hit')).toHaveCount(1, { timeout: 15000 });
  await page.click('.sr-hit');
  await page.waitForTimeout(800);
  const frame = await bookFrame(page, 'a[href="#fn2"]');
  expect(frame).not.toBeNull();
  await frame.click('a[href="#fn2"]');
  await expect(page.locator('#notePop')).toBeVisible();
  await expect(page.locator('#notePop')).toContainText('Possibly the gardener');
  await page.keyboard.press('Escape');
});

test('highlights a selection and keeps it', async () => {
  await openBook(page, 'Along the Hedge Path');
  const frame = await bookFrame(page, 'p');
  await frame.evaluate(() => {
    const p = [...document.querySelectorAll('p')].find((x) => x.textContent.includes('garden'));
    const t = p.firstChild;
    const r = document.createRange();
    r.setStart(t, 4);
    r.setEnd(t, 30);
    getSelection().removeAllRanges();
    getSelection().addRange(r);
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await expect(page.locator('#selBar')).toBeVisible();
  await page.click('.hl-dot[data-color="sage"]');
  const saved = () => page.evaluate(() => window.Reader.record.highlights || []);
  await expect.poll(async () => (await saved()).length).toBe(1);
  expect((await saved())[0]).toMatchObject({ color: 'sage' });
  await page.click('#rToc');
  await page.click('.tab[data-tab="marks"]');
  await expect(page.locator('.mark[data-kind="hl"]')).toHaveCount(1);
  await page.keyboard.press('Escape');
});

test('bookmarks a page and finds it again', async () => {
  await openBook(page, 'Along the Hedge Path');
  await turn(2);
  await page.keyboard.press('b');
  await expect(page.locator('#rBookmark')).toHaveClass(/is-on/);
  const here = (await probe(page)).position;
  await turn(3);
  await expect(page.locator('#rBookmark')).not.toHaveClass(/is-on/);
  await page.click('#rToc');
  await page.click('.tab[data-tab="marks"]');
  await page.click('.mark[data-kind="bm"]');
  const target = await page.evaluate(() => window.Reader.record.bookmarks[0].progress);
  await expect.poll(async () => Math.abs((await probe(page)).fraction - target), { timeout: 15000 }).toBeLessThan(0.02);
  await expect(page.locator('#rBookmark')).toHaveClass(/is-on/);
  expect(here).toBeTruthy();
});

test('switching layouts keeps your place', async () => {
  await openBook(page, 'The Pear Tree Letters');
  await waitForMeasured(page);
  await turn(5);
  const before = (await probe(page)).fraction;
  for (const layout of ['single', 'auto', 'single', 'auto']) {
    await page.evaluate((l) => window.Reader.change({ layout: l }), layout);
    await page.waitForTimeout(1200);
  }
  expect(Math.abs((await probe(page)).fraction - before)).toBeLessThan(0.02);
});

test('shows time left once the book is measured', async () => {
  await openBook(page, 'The Pear Tree Letters');
  await waitForMeasured(page);
  await expect.poll(async () => (await probe(page)).footer).toMatch(/left in chapter .* in book/);
});
