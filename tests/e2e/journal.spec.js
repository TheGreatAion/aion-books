const { test, expect } = require('@playwright/test');
const { launch, toLibrary, probe, openBook } = require('./helpers');

let app;
let page;
test.beforeAll(async () => ({ app, page } = await launch()));
test.afterAll(async () => app?.close());
test.afterEach(async () => toLibrary(page));

const idOf = (title) => page.evaluate((t) => window.UI.State.books.find((b) => b.title.startsWith(t)).id, title);

// Marks the passage on screen at a contents entry as a highlight; returns where it was.
async function highlightAt(title, tocIndex, { color, note = '', text }) {
  await openBook(page, title);
  await page.evaluate((i) => window.Reader.goTo(window.Reader.flatToc[i].href), tocIndex);
  await page.waitForTimeout(800);
  const { cfi, fraction } = await page.evaluate(() => ({ cfi: window.Reader.loc.cfi, fraction: window.Reader.loc.fraction }));
  const id = await idOf(title);
  await page.evaluate(
    async ({ id, h }) => {
      const b = window.UI.State.book(id);
      await window.UI.updateBook(id, { highlights: [...(b.highlights || []), h] });
    },
    { id, h: { cfi, text, color, note, chapter: `Chapter ${tocIndex}`, createdAt: Date.now() } }
  );
  await toLibrary(page);
  return { cfi, fraction };
}

test('an empty commonplace book says how it fills itself', async () => {
  await page.click('#openCommonplace');
  await expect(page.locator('#viewTitle')).toHaveText('Commonplace book');
  await expect(page.locator('#commonplacePanel .cp-empty')).toContainText('Highlight a passage');
});

let target;
test('gathers every highlight, with notes, by book', async () => {
  target = await highlightAt('The Pear Tree Letters', 2, { color: 'sage', note: 'Like the old garden at home.', text: 'the bees grow slow and heavy' });
  await highlightAt('The Pear Tree Letters', 1, { color: 'rose', text: 'a dry creak of old oak' });
  await highlightAt('Along the Hedge Path', 1, { color: 'ochre', text: 'a dog barked twice and then thought better of it' });

  await page.click('#openCommonplace');
  await expect(page.locator('#viewCount')).toHaveText('3 passages');
  await expect(page.locator('.cp-featured blockquote')).toBeVisible(); // a passage at random, as an epigraph
  await expect(page.locator('#cpList .cp-book h3')).toHaveText(['Along the Hedge Path', 'The Pear Tree Letters']);
  // Within a book, passages run in reading order.
  await expect(page.locator('#cpList .cp-group').nth(1).locator('blockquote')).toHaveText(['a dry creak of old oak', 'the bees grow slow and heavy']);
  await expect(page.locator('.cp-note')).toHaveText('Like the old garden at home.');
});

test('search, colours, notes and grouping by date', async () => {
  await page.click('#openCommonplace');
  await page.fill('#cpSearch', 'garden at home'); // matches the note
  await expect(page.locator('#cpList .cp-entry')).toHaveCount(1);
  await page.fill('#cpSearch', 'hedge'); // matches the book's title
  await expect(page.locator('#cpList .cp-entry')).toHaveCount(1);
  await page.fill('#cpSearch', '');
  await expect(page.locator('#cpList .cp-entry')).toHaveCount(3);

  await page.click('[data-cp-color="rose"]');
  await expect(page.locator('#cpList .cp-entry')).toHaveCount(1);
  await page.click('[data-cp-color=""]');
  await page.click('[data-cp-notes]');
  await expect(page.locator('#cpList .cp-entry')).toHaveCount(1);
  await page.click('[data-cp-notes]');

  await page.click('[data-cp-group="date"]');
  await expect(page.locator('#cpList .cp-month')).toHaveCount(1); // all made this month
  await expect(page.locator('#cpList .cp-entry .cp-where b')).toHaveCount(3); // each says which book
  await page.click('[data-cp-group="book"]');
});

test('opens the book right at a passage', async () => {
  await page.click('#openCommonplace');
  const entry = page.locator('#cpList .cp-entry', { hasText: 'bees grow slow' });
  await entry.hover();
  await entry.locator('[data-cp="open"]').click();
  await page.waitForFunction(() => window.Reader.probe().open);
  await expect.poll(async () => Math.abs((await probe(page)).fraction - target.fraction), { timeout: 15000 }).toBeLessThan(0.02);
  await toLibrary(page);
  await expect(page.locator('#commonplacePanel')).toBeVisible(); // back where you were
});

test('the timeline shows the books finished this year, month by month', async () => {
  const id = await idOf('Along the Hedge Path');
  await openBook(page, 'Along the Hedge Path'); // opening a book for the first time is when you began it
  await toLibrary(page);
  expect(await page.evaluate((id) => window.UI.State.book(id).startedAt, id)).toBeGreaterThan(0);
  await page.evaluate(async (id) => window.UI.updateBook(id, { finished: true, rating: 4 }), id);

  await page.click('#openStats');
  const tl = page.locator('#timelineGroup');
  await expect(tl.locator('h2')).toHaveText('Your year in books');
  await expect(tl.locator('.tl-summary')).toContainText('1 book finished');
  const month = new Date().toLocaleDateString(undefined, { month: 'long' });
  const row = tl.locator('.tl-month').first();
  await expect(row.locator('.tl-label')).toHaveText(month);
  await expect(row.locator('.tl-book .t')).toHaveText('Along the Hedge Path');
  await expect(row.locator('.tl-book .m')).toContainText('in a day');
  await expect(tl.locator('.tl-notes')).toContainText('Along the Hedge Path'); // the favourite
  // The months before, with nothing in them, fold into a single quiet line.
  if (new Date().getMonth() > 0) {
    await expect(tl.locator('.tl-month')).toHaveCount(2);
    await expect(tl.locator('.tl-month.quiet .tl-label')).toHaveText(/^Jan/);
  }

  await row.locator('.tl-book').click();
  await page.waitForFunction(() => window.Reader.probe().open);
  expect(await page.evaluate(() => window.Reader.id)).toBe(id);
});
