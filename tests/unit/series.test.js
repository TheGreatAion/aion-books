const test = require('node:test');
const assert = require('node:assert');
const Series = require('../../src/series.js');

const book = (series, seriesIndex, author, title = series) => ({ series, seriesIndex, author, title });
const groups = (books) => {
  Series.group(books);
  const out = {};
  for (const b of books) if (b.seriesId) (out[b.seriesName] ??= []).push(b.seriesNo);
  return out;
};

test('a leading "The" doesn’t split a series', () => {
  assert.deepEqual(
    groups([book('Expanse', 3, 'James S. A. Corey'), book('Expanse', 4, 'James S.A. Corey'), book('The Expanse', 1, 'James S. A. Corey')]),
    { 'The Expanse': [3, 4, 1] }
  );
  assert.deepEqual(groups([book('Wheel of Time', 1, 'Robert Jordan'), book('The Wheel of Time', 14, 'Robert Jordan, Brandon Sanderson')]), {
    'The Wheel of Time': [1, 14],
  });
});

test('a number in the name is the book’s number, not part of the series', () => {
  assert.deepEqual(groups([book('Red Rising Trilogy', 3, 'Pierce Brown'), book('Red Rising Trilogy #2', 1, 'Pierce Brown')]), {
    'Red Rising Trilogy': [3, 2],
  });
  assert.deepEqual(Series.split('The Dark Tower, Book 4'), { name: 'The Dark Tower', number: 4 });
  assert.deepEqual(Series.split('Discworld (Vol. 12)'), { name: 'Discworld', number: 12 });
  assert.deepEqual(Series.split('Catch-22'), { name: 'Catch-22', number: null }); // no marker, so not a book number
});

test('spelling, punctuation and "Trilogy" don’t split a series either', () => {
  assert.equal(Series.key('Jonathan Strange & Mr. Norrell'), Series.key('Jonathan Strange and Mr Norrell'));
  assert.equal(Series.key('The Sprawl Trilogy'), Series.key('Sprawl'));
  assert.equal(Series.key('Les Misérables'), Series.key('Les Miserables'));
  assert.notEqual(Series.key('The Series'), ''); // a name that's only "Series" keeps itself
});

test('a series spelled the same is one series, whoever wrote each book', () => {
  const books = [book('The Orchard Years', 1, 'Margaret Ashdown'), book('The Orchard Years', 2, 'Eleanor Vale')];
  Series.group(books);
  assert.equal(books[0].seriesId, books[1].seriesId);
});

test('different spellings by unrelated authors stay apart', () => {
  const books = [book('The Foundation', 1, 'Isaac Asimov'), book('Foundation', 2, 'Isaac Asimov'), book('Foundation Series', 1, 'Someone Else')];
  Series.group(books);
  assert.equal(books[0].seriesId, books[1].seriesId);
  assert.notEqual(books[0].seriesId, books[2].seriesId);
});

test('books without a series are left alone', () => {
  const b = { title: 'Alone', series: '', author: 'X' };
  Series.group([b]);
  assert.equal(b.seriesId, undefined);
});
