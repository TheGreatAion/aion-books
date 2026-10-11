const test = require('node:test');
const assert = require('node:assert');
const { placeLocally, fromTitle } = require('../../lib/series-finder');

const book = (id, title, author, extra = {}) => ({ id, title, author, series: '', ...extra });

test('a series named in the title', () => {
  const known = new Set(['dark tower']);
  assert.deepEqual(fromTitle("Caliban's War: Book Two of the Expanse series"), { title: "Caliban's War", series: 'Expanse', number: 2 });
  assert.deepEqual(fromTitle('The Fury of the Gods: Book Three of the Bloodsworn Saga'), { title: 'The Fury of the Gods', series: 'Bloodsworn Saga', number: 3 });
  assert.deepEqual(fromTitle('Words of Radiance (Stormlight Archive, The)'), { title: 'Words of Radiance', series: 'The Stormlight Archive', number: null });
  assert.deepEqual(fromTitle("Assassin's Apprentice (Farseer Trilogy #1)"), { title: "Assassin's Apprentice", series: 'Farseer Trilogy', number: 1 });
  assert.deepEqual(fromTitle('The Dark Tower IV Wizard and Glass', known), { title: 'Wizard and Glass', series: 'The Dark Tower', number: 4 });
  // Editions, imprints and plain subtitles aren't series.
  assert.equal(fromTitle('Middlemarch (Penguin Classics)'), null);
  assert.equal(fromTitle('Emma (Annotated Edition)'), null);
  assert.equal(fromTitle('Dune (Novel)'), null);
  assert.equal(fromTitle('The Dark Tower IV Wizard and Glass'), null); // not a series we know
  assert.equal(fromTitle('Catch-22'), null);
});

test('on a series’ list of books, by the same author', () => {
  const books = [
    book('a', 'The Waste Lands', 'Stephen King', { series: 'The Dark Tower', seriesIndex: 3 }),
    book('b', 'The Gunslinger', 'Stephen King'),
    book('c', 'The Drawing of the Three', 'Stephen King'),
    book('d', 'The Gunslinger', 'Someone Else'), // another author's book of that name
  ];
  const info = {
    'dark tower': {
      name: 'The Dark Tower',
      parts: [
        { number: 1, title: 'The Dark Tower: The Gunslinger' },
        { number: 2, title: 'The Dark Tower II: The Drawing of the Three' },
        { number: 3, title: 'The Dark Tower III: The Waste Lands' },
      ],
    },
  };
  const placed = placeLocally(books, info);
  assert.deepEqual(
    placed.map((p) => [p.id, p.series, p.number, p.from]),
    [
      ['b', 'The Dark Tower', 1, 'list'],
      ['c', 'The Dark Tower', 2, 'list'],
    ]
  );
});

test('one author’s books named alike, and the number on the end', () => {
  const books = ['Philosopher’s Stone: 1', 'Chamber of Secrets: 2', 'Prisoner of Azkaban: 3'].map((t, i) => book(String(i), `Harry Potter and the ${t}`, 'J.K. Rowling'));
  const placed = placeLocally(books);
  assert.deepEqual(
    placed.map((p) => [p.series, p.number, p.title]),
    [
      ['Harry Potter', 1, 'Harry Potter and the Philosopher’s Stone'],
      ['Harry Potter', 2, 'Harry Potter and the Chamber of Secrets'],
      ['Harry Potter', 3, 'Harry Potter and the Prisoner of Azkaban'],
    ]
  );
  // Two alike is a coincidence, not a series.
  assert.equal(placeLocally(books.slice(0, 2)).length, 0);
});

test('never touches a series you set, or one you took a book out of', () => {
  const books = [
    book('a', 'Words of Radiance (Stormlight Archive, The)', 'Brandon Sanderson', { seriesSource: 'you' }),
    book('b', 'Oathbringer (Stormlight Archive, The)', 'Brandon Sanderson', { seriesDismissed: ['stormlight archive'] }),
  ];
  assert.equal(placeLocally(books).length, 0);
});

test('two books with one number: the series’ list sorts them out', () => {
  const books = [
    book('a', 'Towers of Midnight', 'Robert Jordan', { series: 'Wheel of Time', seriesIndex: 14 }),
    book('b', 'A Memory of Light', 'Robert Jordan', { series: 'Wheel of Time', seriesIndex: 14 }),
  ];
  const info = { 'wheel of time': { parts: [{ number: 13, title: 'Towers of Midnight' }, { number: 14, title: 'A Memory of Light' }] } };
  assert.deepEqual(placeLocally(books, info), [{ id: 'a', number: 13, from: 'renumber' }]);
});

test('a missing number comes from the series’ list', () => {
  const books = [
    book('a', 'The Way of Kings', 'Brandon Sanderson', { series: 'The Stormlight Archive', seriesIndex: 1 }),
    book('b', 'Words of Radiance', 'Brandon Sanderson', { series: 'The Stormlight Archive', seriesIndex: null, seriesAuto: { from: 'title' } }),
  ];
  const info = { 'stormlight archive': { parts: [{ number: 1, title: 'The Way of Kings' }, { number: 2, title: 'Words of Radiance' }] } };
  assert.deepEqual(placeLocally(books, info, { suggest: false }), [{ id: 'b', number: 2, from: 'renumber' }]);
});

test('one series by two names, by the same author, becomes one', () => {
  const books = [
    book('a', 'The Name of the Wind', 'Patrick Rothfuss', { series: 'The Kingkiller', seriesIndex: 1 }),
    book('b', 'The Wise Man’s Fear', 'Patrick Rothfuss', { series: 'The Kingkiller Chronicle', seriesIndex: 2, seriesAuto: { from: 'online' } }),
    book('c', 'Other', 'Someone Else', { series: 'The Kingkiller Saga', seriesIndex: 1 }),
  ];
  const merged = placeLocally(books, {}, { suggest: false }).filter((p) => p.from === 'merge');
  assert.deepEqual(merged, [{ id: 'b', series: 'The Kingkiller', number: null, from: 'merge' }]);
});

test('an author’s only series is suggested for their other books, never applied', () => {
  const books = [
    book('a', 'Howling Dark', 'Christopher Ruocchio', { series: 'Sun Eater', seriesIndex: 2 }),
    book('b', 'Empire of Silence', 'Christopher Ruocchio', { seriesLookedUp: 1 }),
    book('c', 'Not Yet Looked Up', 'Christopher Ruocchio'),
    // Two series by this author: no telling which, so nothing is suggested.
    book('d', 'Malice', 'John Gwynne', { series: 'Faithful and the Fallen', seriesIndex: 1 }),
    book('e', 'The Shadow of the Gods', 'John Gwynne', { series: 'Bloodsworn Saga', seriesIndex: 1 }),
    book('f', 'Another', 'John Gwynne', { seriesLookedUp: 1 }),
    // An edition, not a series: never suggested.
    book('g', 'The Hobbit', 'J.R.R. Tolkien', { series: 'Middle Earth Illustrated Editions', seriesIndex: 2 }),
    book('h', 'The Silmarillion', 'J.R.R. Tolkien', { seriesLookedUp: 1 }),
  ];
  assert.deepEqual(placeLocally(books), [{ id: 'b', series: 'Sun Eater', number: null, from: 'author', suggest: true }]);
});
