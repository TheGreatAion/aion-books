const test = require('node:test');
const assert = require('node:assert');
const { planTidy } = require('../../lib/titles');

let n = 0;
const book = (title, series = '', seriesIndex = null, extra = {}) => ({ id: `b${++n}`, title, series, seriesIndex, ...extra });
const plan = (...books) => planTidy(books).map(({ from, title, series, seriesIndex }) => (series ? { from, title, series, seriesIndex } : { from, title }));

test('takes off ISBNs and Kindle tags', () => {
  assert.deepEqual(plan(book('Rhythm of War (9781429952040)')), [{ from: 'Rhythm of War (9781429952040)', title: 'Rhythm of War' }]);
  assert.deepEqual(plan(book('Dune [Kindle Edition]')), [{ from: 'Dune [Kindle Edition]', title: 'Dune' }]);
  assert.deepEqual(plan(book('Dune 9780441013593')), [{ from: 'Dune 9780441013593', title: 'Dune' }]);
});

test('takes off a series prefix or number only when it matches the book’s series', () => {
  assert.deepEqual(plan(book('Farseer 01 - Assassin’s Apprentice', 'Farseer', 1)), [{ from: 'Farseer 01 - Assassin’s Apprentice', title: 'Assassin’s Apprentice' }]);
  assert.deepEqual(plan(book('Morning Star 03', 'Red Rising Trilogy', 3)), [{ from: 'Morning Star 03', title: 'Morning Star' }]);
  // The wrong number, or a different series: leave it.
  assert.deepEqual(plan(book('Morning Star 03', 'Red Rising Trilogy', 2)), []);
  assert.deepEqual(plan(book('Farseer 01 - Assassin’s Apprentice', 'Tawny Man', 1)), []);
});

test('never touches titles whose numbers are part of them', () => {
  assert.deepEqual(plan(book('1984'), book('Catch-22'), book('Fahrenheit 451'), book('2001: A Space Odyssey', 'Space Odyssey', 1)), []);
  assert.deepEqual(plan(book('Words of Radiance (Stormlight Archive, The)')), []); // a series without a number could be a subtitle
});

test('a series named in a title is left there: series are yours to make', () => {
  assert.deepEqual(plan(book('Leviathan Falls (The Expanse Book 9)')), []);
  assert.deepEqual(plan(book('The Kingkiller #01 - The Name of the Wind')), []);
  assert.deepEqual(plan(book('Of Empires and Dust (The Bound and The Broken Book 4)'), book('The Bound and the Broken 2 : Of Darkness and Light')), []);
});

test('a title you edited yourself is left alone', () => {
  assert.deepEqual(plan(book('Rhythm of War (9781429952040)', '', null, { titleEdited: true })), []);
});
