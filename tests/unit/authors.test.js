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

