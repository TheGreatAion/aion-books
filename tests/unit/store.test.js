const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Store, DEFAULT_SETTINGS } = require('../../lib/store');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'aion-store-'));

test('a new library starts with the defaults', () => {
  const s = new Store(tmp());
  assert.deepEqual(s.data.books, []);
  assert.equal(s.data.settings.fontSize, 100);
  assert.equal(s.data.settings.theme, DEFAULT_SETTINGS.theme);
});

test('saves and reloads', () => {
  const dir = tmp();
  const s = new Store(dir);
  s.data.books.push({ id: 'abc', title: 'A Book' });
  s.data.settings.theme = 'dusk';
  s.flush();
  const again = new Store(dir);
  assert.equal(again.data.books[0].title, 'A Book');
  assert.equal(again.data.settings.theme, 'dusk');
});

test('moves the old 108% default text size to 100%', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'library.json'), JSON.stringify({ version: 1, books: [], settings: { fontSize: 108 } }));
  assert.equal(new Store(dir).data.settings.fontSize, 100);
});

test('keeps a text size the reader chose themselves', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'library.json'), JSON.stringify({ version: 1, books: [], settings: { fontSize: 126 } }));
  assert.equal(new Store(dir).data.settings.fontSize, 126);
});

test('new settings get their defaults in an older library', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'library.json'), JSON.stringify({ version: 2, books: [], settings: { theme: 'parchment' } }));
  const s = new Store(dir);
  assert.equal(s.data.settings.theme, 'parchment');
  assert.equal(s.data.settings.runningHeads, true);
  assert.equal(s.data.settings.dailyGoal, 20);
});

test('survives a corrupt library file', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'library.json'), '{ not json');
  assert.deepEqual(new Store(dir).data.books, []);
});
