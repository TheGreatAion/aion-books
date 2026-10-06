const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { main: makeFixtures, OUT } = require('../fixtures/make-fixtures');
const { readEpubMeta } = require('../../lib/epubMeta');

test.before(makeFixtures);
const read = (name) => readEpubMeta(fs.readFileSync(path.join(OUT, name)));

test('reads title, author and description', async () => {
  const m = await read('pear-tree.epub');
  assert.equal(m.title, 'The Pear Tree Letters');
  assert.equal(m.author, 'Margaret Ashdown');
  assert.match(m.description, /quiet novel/);
});

test('reads Calibre series metadata', async () => {
  const m = await read('hedge-path.epub');
  assert.equal(m.series, 'The Orchard Years');
  assert.equal(m.seriesIndex, 2);
});

test('finds the cover image', async () => {
  const m = await read('pear-tree.epub');
  assert.ok(m.cover, 'cover expected');
  assert.equal(m.cover.ext, '.png');
  assert.equal(m.cover.data.subarray(1, 4).toString(), 'PNG');
});

test('books without a cover or series are fine', async () => {
  const m = await read('single-file.epub');
  assert.equal(m.cover, null);
  assert.equal(m.series, '');
  assert.equal(m.seriesIndex, null);
});

test('rejects files that are not EPUBs', async () => {
  const JSZip = require('jszip');
  const zip = new JSZip();
  zip.file('hello.txt', 'not a book');
  await assert.rejects(readEpubMeta(await zip.generateAsync({ type: 'nodebuffer' })), /Not a valid EPUB/);
});
