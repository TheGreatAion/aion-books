// Putting books into their series without asking the reader to do it.
//
// Most books don't say which series they're in, or say it in their title
// instead ("Caliban's War: Book Two of the Expanse series"). This works out
// what it can from what's already in the library, with no network:
//
//   1. title     — the title names the series: "(Stormlight Archive, The)",
//                  "Book Three of the Bloodsworn Saga", "The Dark Tower IV …";
//   2. list      — the series' list of books (learned from Wikidata for a
//                  series already in the library) has this title, and the
//                  same author wrote both;
//   3. family    — one author's books named alike: "Harry Potter and the …";
//   4. renumber  — two books in one series share a number, and the series'
//                  list says which is which.
//
// Books whose series you set yourself are never touched, nor are books you've
// taken out of a series that was found for them (book.seriesDismissed).
const Series = require('../src/series.js');
const { surnameOf } = require('./authors');

const WORD_NUMBERS = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10,
};
const ROMAN = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10, xi: 11, xii: 12, xiii: 13, xiv: 14, xv: 15 };
const numberWord = (s) => {
  const t = String(s || '').toLowerCase();
  if (/^\d+(\.\d+)?$/.test(t)) return Number(t);
  return WORD_NUMBERS[t] ?? ROMAN[t] ?? null;
};

// Brackets that hold an edition or an imprint, not a series.
const NOT_A_SERIES = /\b(classics?|edition|illustrated|unabridged|abridged|annotated|kindle|vintage|penguin|oxford|everyman|library|collection|omnibus|boxed? set|bundle|novel|a novel|translation|translated|anniversary|deluxe|reprint|ebook|e-book|audiobook)\b/i;

// The form two writings of one title have in common: no subtitle, no
// brackets, no leading "The", no punctuation.
function titleKey(raw) {
  return String(raw || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s*[([][^)\]]*[)\]]\s*/g, ' ')
    .split(/\s*:\s+|\s+[-–—]\s+/)[0]
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/^(the|a|an)\s+/, '');
}

// A title's keys within a series: its own, and — when it starts with the
// series' name, as "Mistborn: The Final Empire" or "The Dark Tower II: The
// Drawing of the Three" do — the part after the colon too.
function keysWithin(raw, seriesKey) {
  const keys = new Set([titleKey(raw)]);
  const m = /^(.+?):\s+(.+)$/.exec(String(raw || ''));
  if (m && seriesKey && titleKey(m[1]).startsWith(seriesKey)) keys.add(titleKey(m[2]));
  keys.delete('');
  return keys;
}

// "(Stormlight Archive, The)" → "The Stormlight Archive"
const unInvert = (s) => String(s).replace(/^(.+?),\s*(the|a|an)$/i, (_, a, b) => `${b[0].toUpperCase()}${b.slice(1).toLowerCase()} ${a}`).trim();

/**
 * A series named in a book's title, with the title it leaves.
 * @param knownKeys  Series.key()s of series already in the library
 * @returns { title, series, number } or null
 */
function fromTitle(raw, knownKeys = new Set()) {
  const t = String(raw || '').trim();
  let m;
  // "Caliban's War: Book Two of the Expanse series", "The Fury of the Gods: Book Three of the Bloodsworn Saga"
  m = /^(.+?)\s*[:,(-]\s*(?:book|volume|vol\.?|part)\s+([a-z]+|\d+)\s+(?:of|in)\s+(?:the\s+)?(.+?)\s*\)?$/i.exec(t);
  if (m && numberWord(m[2]) != null) {
    const series = m[3].replace(/\s+(series|sequence)$/i, '').trim();
    return { title: m[1].trim(), series: /^(the)\s/i.test(m[3]) ? series : series, number: numberWord(m[2]) };
  }
  // "Words of Radiance (Stormlight Archive, The)", "Death's End (Remembrance of Earth's Past)",
  // "Assassin's Apprentice (Farseer Trilogy #1)", "Fire & Blood (A Song of Ice and Fire)"
  m = /^(.+?)\s*[([]\s*([^)\]]+?)\s*[)\]]$/.exec(t);
  if (m && /\p{L}/u.test(m[1])) {
    const inner = m[2].replace(/^the\s+(.+\bseries)$/i, '$1');
    const split = Series.split(inner);
    const n = /[,\s]+(?:book|bk\.?|#)\s*([a-z]+|\d+)$/i.exec(split.name);
    const name = unInvert((n ? split.name.slice(0, n.index) : split.name).replace(/\s+series$/i, '').trim());
    const number = split.number ?? (n ? numberWord(n[1]) : null);
    const known = knownKeys.has(Series.key(name));
    if (name.length >= 3 && !NOT_A_SERIES.test(name) && (known || number != null || name.split(/\s+/).length >= 2)) {
      return { title: m[1].trim(), series: name, number };
    }
  }
  // "The Dark Tower IV Wizard and Glass", "Wheel of Time 12 - The Gathering Storm": only for a series we know.
  m = /^(.+?)\s+(\d{1,2}|[ivx]{1,4})\b\s*[:.-]?\s+(.+)$/i.exec(t);
  if (m && knownKeys.has(Series.key(m[1])) && numberWord(m[2]) != null) {
    return { title: m[3].trim(), series: m[1].trim(), number: numberWord(m[2]) };
  }
  return null;
}

const surnamesOf = (author) =>
  String(author || '')
    .split(/\s*(?:;|&|\band\b)\s*|,\s*(?=[A-Z][a-z]+\s)/)
    .map((a) => surnameOf(a))
    .filter(Boolean)
    .map((s) => s.toLowerCase());

/**
 * Where the books without a series belong, from what the library already knows.
 * @param books       the library's books
 * @param seriesInfo  { [Series.key]: { name, parts: [{ number, title }] } }
 * @returns [{ id, series, number, from, title? }] — title when the title itself changes
 */
function placeLocally(books, seriesInfo = {}) {
  const out = [];
  const free = (b) => !b.series && b.seriesSource !== 'you';
  const dismissed = (b, name) => (b.seriesDismissed || []).includes(Series.key(name));
  const knownKeys = new Set(books.filter((b) => b.series).map((b) => Series.key(b.series)));
  for (const k of Object.keys(seriesInfo)) knownKeys.add(k);
  const placed = new Map(); // id → placement

  // 1. Series named in the title.
  for (const b of books) {
    if (!free(b)) continue;
    const hit = fromTitle(b.title, knownKeys);
    if (!hit || dismissed(b, hit.series)) continue;
    const p = { id: b.id, series: hit.series, number: hit.number, from: 'title' };
    if (!b.titleEdited && hit.title && hit.title !== b.title) p.title = hit.title;
    placed.set(b.id, p);
    knownKeys.add(Series.key(hit.series));
  }

  // Who writes each series in the library (and the name it goes by there).
  const authors = new Map();
  const names = new Map();
  for (const b of books) {
    const s = b.series || placed.get(b.id)?.series;
    if (!s) continue;
    const k = Series.key(s);
    if (!authors.has(k)) authors.set(k, new Set());
    surnamesOf(b.author).forEach((n) => authors.get(k).add(n));
    if (!names.has(k)) names.set(k, Series.split(s).name);
  }

  // 2. On a series' list of books, by the same author.
  const lists = [];
  for (const [k, info] of Object.entries(seriesInfo)) {
    if (!Array.isArray(info?.parts) || !info.parts.length) continue;
    const by = authors.get(k);
    if (!by?.size) continue; // a list with no book of it here: can't tell who wrote it
    lists.push({ k, name: names.get(k) || info.name, by, parts: info.parts.map((p) => ({ ...p, keys: keysWithin(p.title, k) })) });
  }
  for (const b of books) {
    if (!free(b) || placed.has(b.id)) continue;
    const mine = surnamesOf(b.author);
    const partOf = (l) => {
      const mineKeys = keysWithin(b.title, l.k);
      return l.parts.find((p) => [...mineKeys].some((k) => p.keys.has(k)));
    };
    const hits = lists.filter((l) => mine.some((n) => l.by.has(n)) && partOf(l));
    if (hits.length !== 1) continue; // nowhere, or more than one series claims it
    const [l] = hits;
    if (dismissed(b, l.name)) continue;
    const part = partOf(l);
    placed.set(b.id, { id: b.id, series: l.name, number: part.number ?? null, from: 'list' });
  }

  // 3. One author's books named alike: "Harry Potter and the …" (three or more, so it's a pattern).
  const families = new Map();
  for (const b of books) {
    const m = /^(.{3,40}?)\s+and\s+the\s+\S/i.exec(String(b.title || ''));
    if (!m) continue;
    const k = `${surnamesOf(b.author)[0] || ''}|${m[1].toLowerCase()}`;
    if (!families.has(k)) families.set(k, { name: m[1].trim(), books: [] });
    families.get(k).books.push(b);
  }
  for (const f of families.values()) {
    if (f.books.length < 3) continue;
    // If some already have a series, the family takes theirs.
    const has = f.books.find((b) => b.series || placed.get(b.id));
    const name = has ? Series.split(has.series || placed.get(has.id).series).name : f.name;
    for (const b of f.books) {
      if (!free(b) || placed.has(b.id) || dismissed(b, name)) continue;
      const n = /[:\s]\s*0*(\d{1,2})$/.exec(b.title);
      const p = { id: b.id, series: name, number: n ? Number(n[1]) : null, from: 'family' };
      if (n && !b.titleEdited) p.title = b.title.slice(0, n.index).replace(/[\s:]+$/, '');
      placed.set(b.id, p);
    }
  }
  out.push(...placed.values());

  // 4. Two books with one number: the series' list says which is which.
  const groups = new Map();
  for (const b of books) {
    if (!b.series || b.seriesSource === 'you') continue;
    const k = Series.key(b.series);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(b);
  }
  for (const [k, list] of groups) {
    const parts = seriesInfo[k]?.parts;
    if (!Array.isArray(parts) || !parts.length) continue;
    const count = new Map();
    for (const b of list) {
      const n = Series.split(b.series).number ?? b.seriesIndex;
      if (n != null) count.set(Number(n), (count.get(Number(n)) || 0) + 1);
    }
    for (const b of list) {
      const n = Series.split(b.series).number ?? b.seriesIndex;
      if (n == null || count.get(Number(n)) < 2) continue;
      const mineKeys = keysWithin(b.title, k);
      const part = parts.find((p) => [...keysWithin(p.title, k)].some((x) => mineKeys.has(x)));
      if (part?.number != null && part.number !== Number(n)) out.push({ id: b.id, number: part.number, from: 'renumber' });
    }
  }
  return out;
}

module.exports = { placeLocally, fromTitle, titleKey, keysWithin, numberWord };
