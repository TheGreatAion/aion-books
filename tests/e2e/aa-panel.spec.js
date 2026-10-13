// The Aa panel while reading: typefaces as tiles, and spacing, margins, layout
// and paper as rounded tracks, each naming the choice in use and changing the book.
const { test, expect } = require('@playwright/test');
const { launch, toLibrary, openBook } = require('./helpers');

let app, page;
test.beforeAll(async () => ({ app, page } = await launch()));
test.afterAll(async () => app?.close());

// The first long paragraph on screen, as the book shows it.
const paragraph = () =>
  page.evaluate(() => {
    for (const { doc } of window.Reader.contents()) {
      const p = [...doc.querySelectorAll('p')].find((x) => x.textContent.trim().length > 40);
      if (p) {
        const s = doc.defaultView.getComputedStyle(p);
        return { lineHeight: parseFloat(s.lineHeight) / parseFloat(s.fontSize), font: s.fontFamily };
      }
    }
    return null;
  });

test('every choice in the Aa panel names itself and changes the book', async () => {
  await openBook(page, 'The Pear Tree Letters');
  await page.click('#rType');
  await expect(page.locator('#typePop')).toBeVisible();
  await expect(page.locator('#fontChips .face')).toHaveCount(5);
  await expect(page.locator('#fontChips .face[data-v="Original"] span')).toHaveText('Original');

  await page.click('#fontChips [data-v="Literata"]');
  await expect(page.locator('#fontChips [data-v="Literata"]')).toHaveClass(/is-on/);
  await expect.poll(async () => (await paragraph())?.font).toContain('Literata');

  await page.click('#lhChips [data-v="1.4"]');
  await expect(page.locator('#lhVal')).toHaveText('Snug');
  await expect.poll(async () => (await paragraph())?.lineHeight).toBeLessThan(1.5);
  await page.click('#lhChips [data-v="1.85"]');
  await expect(page.locator('#lhVal')).toHaveText('Open');
  await expect.poll(async () => (await paragraph())?.lineHeight).toBeGreaterThan(1.75);

  await page.click('#marginChips [data-v="wide"]');
  await expect(page.locator('#marginVal')).toHaveText('Wide');
  await expect(page.locator('#marginChips [data-v="wide"]')).toHaveClass(/is-on/);
  await expect(page.locator('#marginChips .is-on')).toHaveCount(1);

  await page.click('#layoutChips [data-v="scroll"]');
  await expect(page.locator('#layoutVal')).toHaveText('Scroll');
  await page.click('#layoutChips [data-v="auto"]');
  await expect(page.locator('#layoutVal')).toHaveText('Two pages');

  await page.click('#themeSwatches [data-v="dusk"]');
  await expect(page.locator('#themeVal')).toHaveText('Dusk');
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe('dusk');

  const s = await page.evaluate(() => window.UI.State.settings);
  expect(s).toMatchObject({ fontFamily: 'Literata', lineHeight: 1.85, margin: 'wide', layout: 'auto', theme: 'dusk' });
  await page.click('#themeSwatches [data-v="linen"]');
  await page.keyboard.press('Escape');
  await toLibrary(page);
});

test('Settings uses the same tracks, and they change the defaults', async () => {
  await page.keyboard.press('Control+,');
  await page.click('[data-set="margin"][data-v="narrow"]');
  await expect(page.locator('[data-set="margin"][data-v="narrow"]')).toHaveClass(/is-on/);
  await page.click('.set-faces [data-v="Lora"]');
  await expect(page.locator('.set-faces [data-v="Lora"]')).toHaveClass(/is-on/);
  expect(await page.evaluate(() => window.UI.State.settings)).toMatchObject({ margin: 'narrow', fontFamily: 'Lora' });
});
