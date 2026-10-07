const test = require('node:test');
const assert = require('node:assert');
const { BOOK_FILE, formatOf, detailsFromFilename } = require('../../lib/formats');

test('recognizes every supported book file', () => {
  for (const f of ['a.epub', 'B.MOBI', 'c.azw3', 'd.azw', 'e.prc', 'f.fb2', 'g.fbz', 'h.fb2.zip', 'i.cbz', 'j.pdf']) assert.ok(BOOK_FILE.test(f), f);
  for (const f of ['a.txt', 'b.zip', 'c.m4b', 'd.epub.part']) assert.ok(!BOOK_FILE.test(f), f);
});

test('stores each file under the extension the engine expects', () => {
  assert.equal(formatOf('x/Book.EPUB'), 'epub');
  assert.equal(formatOf('Book.azw3'), 'mobi');
  assert.equal(formatOf('Book.prc'), 'mobi');
  assert.equal(formatOf('Book.fb2.zip'), 'fbz');
  assert.equal(formatOf('Book.fb2'), 'fb2');
  assert.equal(formatOf('Comic.cbz'), 'cbz');
  assert.equal(formatOf('Notes.pdf'), 'pdf');
});

test('makes a title from a file name', () => {
  assert.deepEqual(detailsFromFilename('C:/books/the_long-table.fb2'), { title: 'The long table', author: '' });
  assert.deepEqual(
    detailsFromFilename('Macroeconomics, 8e -- Olivier Blanchard -- 8th, 2019 -- Pearson -- 9780134897899 -- e13 -- Anna’s Archive.pdf'),
    { title: 'Macroeconomics, 8e', author: 'Olivier Blanchard' }
  );
  // A second part that's a date isn't an author.
  assert.deepEqual(detailsFromFilename('Field Notes -- 2019.pdf'), { title: 'Field Notes -- 2019', author: '' });
});
