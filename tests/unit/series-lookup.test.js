const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { naturalAuthor, surnameOf } = require('../../lib/authors');

test('authors in catalog order are turned round; lists of authors are not', () => {
  assert.equal(naturalAuthor('Sanderson, Brandon'), 'Brandon Sanderson');
  assert.equal(naturalAuthor('Le Guin, Ursula K.'), 'Ursula K. Le Guin');
  assert.equal(naturalAuthor('Tolkien, J. R. R.'), 'J. R. R. Tolkien');
  assert.equal(naturalAuthor('Robert Jordan, Brandon Sanderson'), 'Robert Jordan, Brandon Sanderson');
  assert.equal(naturalAuthor('Smith, Jr.'), 'Smith, Jr.');
  assert.equal(naturalAuthor('Homer'), 'Homer');
});

test('the surname used to look a book up', () => {
  assert.equal(surnameOf('Sanderson, Brandon'), 'Sanderson');
  assert.equal(surnameOf('Robert Jordan, Brandon Sanderson'), 'Jordan');
  assert.equal(surnameOf('Martin Luther King Jr.'), 'King');
  assert.equal(surnameOf(''), '');
});

test('finds a series from Wikidata’s answer (recorded), and prefers one already in the library', async () => {
  process.env.AION_WIKIDATA_FIXTURE = path.join(__dirname, '../fixtures/wikidata.json');
  const { findSeries, seriesParts, titleVariants } = require('../../lib/series-lookup');
  const found = await findSeries({ title: 'Late Roses', author: 'Thomas Wren' }, ['The Orchard Years']);
  assert.deepEqual(found, { qid: 'Q900001', series: 'The Orchard Years', number: 3, sure: true });
  // Two series fit as well as each other: not sure, so it waits for a look.
  assert.equal((await findSeries({ title: 'One Long Afternoon', author: 'Ada Fenwick' })).sure, false);
  // No author to check against: never sure.
  assert.equal((await findSeries({ title: 'Late Roses', author: '' })).sure, false);
  assert.equal(await findSeries({ title: 'Nothing Known', author: 'Nobody' }), null);
  const parts = await seriesParts('Q900001');
  assert.deepEqual(parts.map((p) => p.number), [1, 2, 3, 4, 5]);
  assert.deepEqual(titleVariants('Of Blood And Fire: An Epic Fantasy Adventure').slice(0, 2), ['Of Blood And Fire: An Epic Fantasy Adventure', 'Of Blood And Fire']);
  delete process.env.AION_WIKIDATA_FIXTURE;
});
