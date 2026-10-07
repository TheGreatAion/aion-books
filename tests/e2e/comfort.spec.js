// The small things: finding your way back after a jump, the progress bar's
// chapter label, Undo, choosing several books, the keyboard in the library,
// the window remembering itself, following Windows' dark mode and tidy titles.
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { launch, toLibrary, probe, openBook } = require('./helpers');

test.describe('in the reader and the library', () => {
  let app;
  let page;
  test.beforeAll(async () => ({ app, page } = await launch()));
  test.afterAll(async () => app?.close());
  test.afterEach(async () => {
    await page.keyboard.press('Escape');
    await toLibrary(page);
    await page.keyboard.press('Escape');
  });

  test('after a jump, a button takes you back to where you were reading', async () => {
    await openBook(page, 'The Pear Tree Letters');
    await page.evaluate(() => window.Reader.view.goToFraction(0.3)); // somewhere you're reading (not a jump)
    await page.waitForTimeout(900);
    await expect(page.locator('#backPill')).toBeHidden();
    const reading = (await probe(page)).fraction;

    await page.click('#rToc');
    await page.click('.toc-item:has-text("Seed Heads")');
    await expect(page.locator('#backPill')).toBeVisible();
    await expect(page.locator('#backPill [data-back] span')).toContainText(/\d+%/);
    expect((await probe(page)).fraction).toBeGreaterThan(reading + 0.2);

    // A second jump still leads back to where you were reading, not to the first jump.
    await page.evaluate(() => window.Reader.goTo(window.Reader.flatToc[0].href));
    await page.waitForTimeout(600);
    await page.click('#backPill [data-back]');
    await expect.poll(async () => Math.abs((await probe(page)).fraction - reading), { timeout: 10000 }).toBeLessThan(0.03);
    await expect(page.locator('#backPill')).toBeHidden();
  });

  test('“×” stays where you jumped to', async () => {
    await openBook(page, 'The Pear Tree Letters');
    await page.evaluate(() => window.Reader.goTo(window.Reader.flatToc[2].href));
    await page.waitForTimeout(700);
    const here = (await probe(page)).fraction;
    await page.click('#backPill [data-back-x]');
    await expect(page.locator('#backPill')).toBeHidden();
    expect((await probe(page)).fraction).toBe(here);
  });

  test('dragging the progress bar names the chapter you’d land in', async () => {
    await openBook(page, 'The Pear Tree Letters');
    await page.evaluate(() => {
      const r = document.querySelector('#rProgress');
      r.dispatchEvent(new PointerEvent('pointerdown'));
      r.value = 990;
      r.dispatchEvent(new Event('input'));
    });
    await expect(page.locator('#scrubTip')).toBeVisible();
    await expect(page.locator('#scrubTip b')).toHaveText('Seed Heads');
    await expect(page.locator('#scrubTip span')).toHaveText('99%');
    await page.evaluate(() => document.querySelector('#rProgress').dispatchEvent(new Event('change')));
    await expect(page.locator('#scrubTip')).toBeHidden();
    await expect(page.locator('#backPill')).toBeVisible(); // the bar is a jump too
  });

  test('removing a highlight can be undone', async () => {
    await openBook(page, 'Along the Hedge Path');
    const cfi = await page.evaluate(() => window.Reader.loc.cfi);
    await page.evaluate(async (cfi) => {
      const id = window.Reader.id;
      await window.UI.updateBook(id, { highlights: [{ cfi, text: 'quiet', color: 'rose', note: '', createdAt: Date.now() }] }, { quiet: true });
      await window.Reader.removeHighlight(cfi);
    }, cfi);
    expect(await page.evaluate(() => window.Reader.record.highlights.length)).toBe(0);
    await page.click('#toast [data-undo]');
    await expect.poll(() => page.evaluate(() => window.Reader.record.highlights.length)).toBe(1);
  });

  test('Ctrl- and Shift-click choose several books to act on together', async () => {
    const cards = page.locator('#grid .card[data-id]');
    await cards.nth(0).click({ modifiers: ['Control'] });
    await cards.nth(2).click({ modifiers: ['Shift'] });
    await expect(page.locator('#grid .card.is-selected')).toHaveCount(3);
    await expect(page.locator('#selectBar')).toContainText('3 books chosen');
    await cards.nth(1).click({ modifiers: ['Control'] }); // take one away
    await expect(page.locator('#selectBar')).toContainText('2 books chosen');

    await page.click('#selectBar [data-sel="fav"]');
    await expect.poll(() => page.evaluate(() => window.UI.State.books.filter((b) => b.favorite).length)).toBe(2);
    await page.click('#selectBar [data-sel="fav"]'); // and back
    await expect.poll(() => page.evaluate(() => window.UI.State.books.filter((b) => b.favorite).length)).toBe(0);

    await page.keyboard.press('Escape');
    await expect(page.locator('#selectBar')).toBeHidden();
    await expect(page.locator('#grid .card.is-selected')).toHaveCount(0);

    await page.locator('#grid .card').first().focus();
    await page.keyboard.press('Control+a');
    await expect(page.locator('#grid .card.is-selected')).toHaveCount(await cards.count());
    await page.keyboard.press('Escape');
  });

  test('arrow keys move between books; Enter opens one', async () => {
    const cards = page.locator('#grid .card[data-id]');
    await cards.first().focus();
    await page.keyboard.press('ArrowRight');
    await expect(cards.nth(1)).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(cards.nth(0)).toBeFocused();
    // Down a row: the book below, in the same column.
    // A narrow window, so the books wrap onto a second row.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(780, 840));
    await page.waitForTimeout(500);
    await cards.first().focus();
    const cols = await page.evaluate(() => { const cs = [...document.querySelectorAll('#grid .card[data-id]')]; const top = cs[0].getBoundingClientRect().top; return cs.filter((c) => Math.abs(c.getBoundingClientRect().top - top) < 4).length; });
    expect(await cards.count()).toBeGreaterThan(cols);
    await page.keyboard.press('ArrowDown');
    await expect(cards.nth(cols)).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(cards.nth(0)).toBeFocused();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 840));
    await page.keyboard.press('End');
    await expect(cards.last()).toBeFocused();
    await page.keyboard.press('Home');
    await page.keyboard.press('Space');
    await expect(cards.nth(0)).toHaveClass(/is-selected/);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.Reader.probe().open);
  });

  test('removing a book shows Undo, and only removes it once that passes', async () => {
    const count = () => page.evaluate(() => window.UI.State.books.length);
    const before = await count();
    await page.click('.card:has-text("Late Roses")', { button: 'right' });
    await page.click('#menu >> text=Remove from library');
    await expect(page.locator('.card:has-text("Late Roses")')).toHaveCount(0);
    await expect(page.locator('#toast')).toContainText('Removed');
    await page.click('#toast [data-undo]');
    await expect(page.locator('.card:has-text("Late Roses")')).toHaveCount(1);
    expect(await count()).toBe(before);

    // Without Undo, it's gone for good once the moment passes.
    await page.click('.card:has-text("Late Roses")', { button: 'right' });
    await page.click('#menu >> text=Remove from library');
    expect((await page.evaluate(() => window.aion.getLibrary())).books.some((b) => b.title === 'Late Roses')).toBe(true); // not yet
    await page.waitForTimeout(6600);
    expect((await page.evaluate(() => window.aion.getLibrary())).books.some((b) => b.title === 'Late Roses')).toBe(false);
    expect(await count()).toBe(before - 1);
  });
});

test('the window opens at the size and place you left it', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aion-win-'));
  let { app } = await launch({ books: ['pear-tree.epub'], dataDir });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ x: 120, y: 90, width: 1010, height: 700 }));
  await new Promise((r) => setTimeout(r, 900));
  await app.close();
  ({ app } = await launch({ books: [], dataDir }).catch(async () => {
    // (No books to import this time: wait for the window instead.)
    const a = await electron.launch({ args: [path.join(__dirname, '../..')], env: { AION_WIKIDATA_FIXTURE: path.join(__dirname, '../fixtures/wikidata-none.json'), ...process.env, AION_DATA_DIR: dataDir } });
    await a.firstWindow();
    return { app: a };
  }));
  const b = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds());
  expect(b).toMatchObject({ x: 120, y: 90, width: 1010, height: 700 });
  await app.close();
});

test('Dusk when Windows is dark', async () => {
  process.env.AION_SYSTEM_DARK = '1';
  try {
    const { app, page } = await launch({ books: ['pear-tree.epub'] });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'linen');
    await page.click('#openSettings');
    await page.click('[data-toggle="followSystem"]');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dusk'); // Windows is dark
    // Choosing a light paper by hand while Windows is dark stops following it.
    await page.click('[data-set="theme"][data-v="parchment"]');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'parchment');
    expect(await page.evaluate(() => window.UI.State.settings.followSystem)).toBe(false);
    await app.close();
  } finally {
    delete process.env.AION_SYSTEM_DARK;
  }
});

test('titles: tidied when added, reviewed for older books, and restorable', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aion-titles-'));
  // A book added before tidying existed.
  fs.writeFileSync(
    path.join(dataDir, 'library.json'),
    JSON.stringify({
      version: 3,
      books: [{ id: 'older1', title: 'Morning Star 03', author: 'Pierce Brown', series: 'Red Rising', seriesIndex: 3, format: 'epub', progress: 0, highlights: [], bookmarks: [], shelves: [], addedAt: 1 }],
      settings: {},
    })
  );
  const { app, page } = await launch({ books: ['pear-tree.epub', 'cluttered.epub'], dataDir });
  // Added just now: "The Orchard Years 3 - Winter Pruning (9780000000002)" → "Winter Pruning", book 3 of The Orchard Years.
  const added = await page.evaluate(() => window.UI.State.books.find((b) => b.originalTitle?.startsWith('The Orchard Years 3')));
  expect(added).toMatchObject({ title: 'Winter Pruning', series: 'The Orchard Years', seriesIndex: 3 });

  // The older book is offered for review.
  await page.click('#openSettings');
  await page.click('[data-action="tidy-titles"]');
  await expect(page.locator('.tidy-row')).toHaveCount(1);
  await expect(page.locator('.tidy-row .tidy-to')).toHaveText('Morning Star');
  await page.click('#modal [data-ok]');
  await expect.poll(() => page.evaluate(() => window.UI.State.book('older1').title)).toBe('Morning Star');

  // Restore the original from the book's menu.
  await page.click('.nav-item[data-view="all"]');
  await page.click('.card:has-text("Winter Pruning")', { button: 'right' });
  await page.click('#menu >> text=Restore original title');
  await expect.poll(() => page.evaluate((id) => window.UI.State.book(id).title, added.id)).toBe('The Orchard Years 3 - Winter Pruning (9780000000002)');
  await app.close();
});
