// Tidying book titles: taking off the clutter files often carry, such as
// "Farseer 01 - Assassin's Apprentice", "Morning Star 03" or
// "Rhythm of War (9781429952040)".
//
// Only what can be confirmed is changed:
//   - an ISBN or a "[Kindle …]" tag goes, because those are never part of a title;
//   - a number goes only if it's the book's number in the series you've put
//     it in, and a prefix only if it's that series' name.
// So "1984", "Catch-22" and "Fahrenheit 451" are left alone. A title never
// puts a book into a series: series are yours to make.
const Series = require('../src/series.js');

const ISBN = /\s*[[(]\s*(?:ISBN[\s:-]*)?(?:97[89][\s-]?)?(?:\d[\s-]?){9}[\dXx]\s*[\])]\s*$/;
const BARE_ISBN13 = /\s+(?:ISBN[\s:-]*)?97[89]\d{10}\s*$/i;
const EDITION = /\s*[[(]\s*(?:kindle|ebook|e-book|epub|digital)\b[^\])]*[\])]\s*$/i;
const MARK = '(?:#|book\\s+|vol\\.?\\s*|volume\\s+|no\\.\\s*)';
const N = '0*(\\d+(?:\\.\\d+)?)';
const SEP = '\\s*[-–—:.]\\s+';

const sameNumber = (a, b) => b != null && b !== '' && Number(a) === Number(b);
const numberOf = (b) => Series.split(b.series || '').number ?? (b.seriesIndex != null && b.seriesIndex !== '' ? Number(b.seriesIndex) : null);

// Clutter that's never part of a title.
function stripClutter(t) {
  for (let i = 0; i < 2; i++) t = t.replace(ISBN, '').replace(BARE_ISBN13, '').replace(EDITION, '').trim();
  return t;
}

// Clutter that names a series we already know about (with the right number).
function withoutKnownSeries(t, seriesKey, number) {
  // "Farseer 01 - Assassin's Apprentice", "The Bound and the Broken 2 : Of Darkness and Light"
  let m = new RegExp(`^(.+?)\\s*,?\\s*${MARK}?${N}${SEP}(.+)$`, 'i').exec(t);
  if (m && Series.key(m[1]) === seriesKey && (number == null || sameNumber(m[2], number))) return { title: m[3], number: Number(m[2]) };
  // "Assassin's Apprentice (Farseer #1)"
  m = new RegExp(`^(.+?)\\s*[[(]([^\\])]+?)\\s*,?\\s*${MARK}${N}\\s*[\\])]$`, 'i').exec(t);
  if (m && Series.key(m[2]) === seriesKey && (number == null || sameNumber(m[3], number))) return { title: m[1], number: Number(m[3]) };
  // "Morning Star 03": a trailing number that's the book's number in its series.
  m = /^(.+?)\s+0*(\d{1,3})$/.exec(t);
  if (m && number != null && sameNumber(m[2], number) && /\p{L}/u.test(m[1])) return { title: m[1], number };
  return null;
}

// What tidying would change for each book. A book whose title you've edited
// yourself is left alone.
//   → [{ id, from, title, series?, seriesIndex? }]
function planTidy(books) {
  const plans = new Map();
  // 1. Clutter, and series spelled out in titles.
  for (const b of books) {
    if (b.titleEdited || !b.title) continue;
    const plan = { id: b.id, from: b.title, title: stripClutter(String(b.title).trim()) };
    plans.set(b.id, plan);
  }
  // 2. The book's own series repeated in its title comes off.
  for (const b of books) {
    const p = plans.get(b.id);
    if (!p || !b.series) continue;
    const hit = withoutKnownSeries(p.title, Series.key(b.series), numberOf(b));
    if (hit?.title.trim()) p.title = hit.title.trim();
  }
  return [...plans.values()].filter((p) => p.title !== p.from);
}

// The tidied title of one book being added.
function tidyOne(book, books = []) {
  return planTidy([...books.filter((b) => b.id !== book.id), book]).find((p) => p.id === book.id) || null;
}

module.exports = { planTidy, tidyOne, stripClutter };
