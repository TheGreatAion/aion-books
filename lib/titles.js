// Tidying book titles: taking off the clutter files often carry, such as
// "Farseer 01 - Assassin's Apprentice", "Morning Star 03" or
// "Rhythm of War (9781429952040)".
//
// Only what can be confirmed is changed:
//   - an ISBN or a "[Kindle …]" tag goes, because those are never part of a title;
//   - a number goes only if it's the book's number in its series, and a
//     prefix only if it's the series' name;
//   - a title that spells out its series with a book number — "(The Expanse
//     Book 9)", "The Kingkiller #01 - …" — gives that series to a book that
//     has none, and the title keeps just its own name.
// So "1984", "Catch-22" and "Fahrenheit 451" are left alone, and so is a
// series named without a number, which could just as well be a subtitle.
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

// A series spelled out in the title, with a book number:
//   "Leviathan Falls (The Expanse Book 9)"       → Leviathan Falls · The Expanse #9
//   "The Kingkiller #01 - The Name of the Wind"  → The Name of the Wind · The Kingkiller #1
//   "A Memory Of Light: Wheel of Time Book 14"   → A Memory Of Light · Wheel of Time #14
function seriesInTitle(t) {
  let m = new RegExp(`^(.+?)\\s*[[(]\\s*([^\\])]+?)\\s*,?\\s*${MARK}${N}\\s*[\\])]$`, 'i').exec(t);
  if (m) return { title: m[1], series: m[2], number: Number(m[3]) };
  m = new RegExp(`^(.+?)\\s*${MARK}${N}${SEP}(.+)$`, 'i').exec(t);
  if (m && /\p{L}/u.test(m[1])) return { title: m[3], series: m[1], number: Number(m[2]) };
  m = new RegExp(`^(.+?)\\s*:\\s*(.+?)\\s+${MARK}${N}$`, 'i').exec(t);
  if (m) return { title: m[1], series: m[2], number: Number(m[3]) };
  return null;
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
    let title = stripClutter(String(b.title).trim());
    const plan = { id: b.id, from: b.title };
    if (!b.series) {
      const s = seriesInTitle(title);
      if (s && s.title.trim() && s.series.trim()) {
        title = s.title.trim();
        plan.series = s.series.trim();
        plan.seriesIndex = s.number;
      }
    }
    plan.title = title;
    plans.set(b.id, plan);
  }
  // 2. Series names now known (from books' own details and from step 1).
  const known = new Map();
  for (const b of books) if (b.series) known.set(Series.key(b.series), Series.split(b.series).name);
  for (const p of plans.values()) if (p.series) known.set(Series.key(p.series), p.series);
  for (const b of books) {
    const p = plans.get(b.id);
    if (!p) continue;
    if (b.series) {
      const hit = withoutKnownSeries(p.title, Series.key(b.series), numberOf(b));
      if (hit?.title.trim()) p.title = hit.title.trim();
    } else if (!p.series) {
      // No series anywhere for this book: only a prefix naming a series another book has.
      const m = new RegExp(`^(.+?)\\s*,?\\s*${MARK}?${N}${SEP}(.+)$`, 'i').exec(p.title);
      if (m && known.has(Series.key(m[1])) && m[3].trim()) {
        p.title = m[3].trim();
        p.series = known.get(Series.key(m[1]));
        p.seriesIndex = Number(m[2]);
      }
    }
  }
  return [...plans.values()].filter((p) => p.title !== p.from || p.series);
}

// The tidied title of one book being added (other books give the series names it may carry).
function tidyOne(book, books = []) {
  return planTidy([...books.filter((b) => b.id !== book.id), book]).find((p) => p.id === book.id) || null;
}

module.exports = { planTidy, tidyOne, stripClutter, seriesInTitle };
