const { test, expect } = require('@playwright/test');
const { launch, toLibrary, probe, openBook } = require('./helpers');

const OTHER = ['winter-light.mobi', 'the-long-table.fb2', 'panels.cbz', 'lantern-notes.pdf'];

let app;
let page;
test.beforeAll(async () => ({ app, page } = await launch({ books: OTHER })));
test.afterAll(async () => app?.close());
test.afterEach(async () => toLibrary(page));

const books = () => page.evaluate(() => window.UI.State.books.map(({ title, author, format, needsMeta, cover }) => ({ title, author, format, needsMeta, cover: !!cover })));

test('imports Kindle, FictionBook, comic and PDF files and reads their details', async () => {
  await expect.poll(async () => (await books()).filter((b) => b.needsMeta).length, { timeout: 30000 }).toBe(0);
  const all = await books();
  const by = (f) => all.find((b) => b.format === f);
  expect(by('mobi')).toMatchObject({ title: 'Winter Light', author: 'Clara Holm' });
  expect(by('fb2')).toMatchObject({ title: 'The Long Table', author: 'Ivo Brandt' });
  expect(by('pdf')).toMatchObject({ title: 'Lantern Notes', author: 'Ada Fenwick' });
  expect(by('cbz')).toMatchObject({ title: 'Panels', cover: true }); // named after the file; the first page is the cover
  expect(by('pdf').cover).toBe(true); // the first page, drawn
});

for (const [title, kind] of [
  ['Winter Light', 'mobi'],
  ['The Long Table', 'fb2'],
  ['Lantern Notes', 'pdf'],
  ['Panels', 'cbz'],
]) {
  test(`opens and turns the pages of a ${kind} book`, async () => {
    await openBook(page, title);
    const start = await probe(page);
    expect(start.open).toBe(true);
    for (let i = 0; i < 2; i++) {
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(700);
    }
    await expect.poll(async () => (await probe(page)).fraction).toBeGreaterThan(start.fraction ?? 0);
  });
}

test('the contents of a Kindle book', async () => {
  await openBook(page, 'Winter Light');
  const labels = await page.evaluate(() => window.Reader.flatToc.map((t) => t.label));
  expect(labels).toEqual(['Frost on the Glass', 'The Long Table', 'Lanterns']);
});

test('a comic’s pages are called pages, not file names', async () => {
  await openBook(page, 'Panels');
  await expect.poll(async () => (await probe(page)).chapter).toMatch(/^Page [1-4]$/);
  const labels = await page.evaluate(() => window.Reader.flatToc.map((t) => t.label));
  expect(labels).toEqual(['Page 1', 'Page 2', 'Page 3', 'Page 4']);
});
