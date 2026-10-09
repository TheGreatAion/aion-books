// Finding a book's series on Wikidata (Wikipedia's free, open database of
// facts) when nothing in the library says. Only the title and the author's
// surname are sent.
//
// Wikidata records a novel's series as "part of the series" (P179), with the
// book's number in it as "series ordinal" (P1545). It also lists every book
// in a series, which is how the series page knows which ones you're missing,
// and how the other books of a series are placed without looking each one up.
//
// This uses Wikidata's regular API (the one Wikipedia uses), which answers in
// a fraction of a second; its query service is far slower and often busy.
const Series = require('../src/series.js');
const { surnameOf } = require('./authors');

// Wikimedia asks apps to say who they are (and how to reach whoever made them).
const VERSION = (() => {
  try {
    return require('../package.json').version;
  } catch {
    return '1';
  }
})();
const USER_AGENT = `AionBooks/${VERSION} (https://github.com/TheGreatAion/aion-books; desktop e-book reader)`;
const API = 'https://www.wikidata.org/w/api.php';
// Wikimedia allows 200 requests a minute; we keep to about two a second, one at a time.
const SPACING = 500;

class RateLimited extends Error {
  constructor(seconds) {
    super('Wikidata asked us to slow down');
    this.wait = (seconds || 60) * 1000; // how long it asked us to wait
  }
}

let nextAt = 0;
async function api(params) {
  const now = Date.now();
  const at = Math.max(now, nextAt);
  nextAt = at + SPACING;
  if (at > now) await new Promise((r) => setTimeout(r, at - now));
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(`${API}?${new URLSearchParams({ format: 'json', ...params })}`, {
      signal: ctrl.signal,
      headers: { 'User-Agent': USER_AGENT, 'Api-User-Agent': USER_AGENT },
    });
    if (res.status === 429 || res.status === 503) throw new RateLimited(Number(res.headers.get('retry-after')) || 60);
    if (!res.ok) throw new Error(`Wikidata answered ${res.status}`);
    const json = await res.json();
    if (json.error) throw new Error(json.error.info || json.error.code);
    return json;
  } finally {
    clearTimeout(timer);
  }
}

// Items matching a search ("haswbstatement:P50" = has an author, and so on).
async function search(text, limit = 10) {
  const json = await api({ action: 'query', list: 'search', srsearch: text, srlimit: String(limit), srnamespace: '0' });
  return (json.query?.search || []).map((s) => s.title).filter((id) => /^Q\d+$/.test(id));
}

// Items' English names, and their statements; 50 at a time.
async function entities(ids, props = 'labels|aliases|claims') {
  const out = {};
  const list = [...new Set(ids)].filter((id) => /^Q\d+$/.test(id));
  for (let i = 0; i < list.length; i += 50) {
    const json = await api({ action: 'wbgetentities', ids: list.slice(i, i + 50).join('|'), props, languages: 'en|mul' });
    Object.assign(out, json.entities || {});
  }
  return out;
}

// English, or the name Wikidata gives in every language ("mul").
const label = (e) => e?.labels?.en?.value || e?.labels?.mul?.value || '';
const names = (e) => [label(e), ...[...(e?.aliases?.en || []), ...(e?.aliases?.mul || [])].map((a) => a.value)].filter(Boolean);
const targets = (e, prop) => (e?.claims?.[prop] || []).map((c) => ({ id: c.mainsnak?.datavalue?.value?.id, ord: c.qualifiers?.P1545?.[0]?.datavalue?.value })).filter((t) => t.id);
const same = (a, b) => Series.key(a) === Series.key(b);

// The kinds of thing a book series is on Wikidata.
const SERIES_KINDS = ['Q277759', 'Q1667921', 'Q7725310', 'Q13593966', 'Q53815'];
const isSeries = (e) => targets(e, 'P31').some((t) => SERIES_KINDS.includes(t.id));

// Authors whose names include the surname.
async function writtenBy(items, surname) {
  if (!surname) return items;
  const authors = await entities(items.flatMap((e) => targets(e, 'P50').map((t) => t.id)), 'labels');
  const s = surname.toLowerCase();
  return items.filter((e) => targets(e, 'P50').some((t) => label(authors[t.id]).toLowerCase().includes(s)));
}

// The ways a book's title may be written on Wikidata.
function titleVariants(title) {
  const t = String(title || '').trim();
  const out = new Set([t]);
  const beforeColon = t.split(/\s*:\s+/)[0];
  if (beforeColon.length >= 3) out.add(beforeColon);
  // "Words of Radiance (Stormlight Archive, The)": the series in brackets isn't part of the title.
  const unbracketed = t.replace(/\s*[([][^)\]]*[)\]]\s*$/, '').trim();
  if (unbracketed.length >= 2 && unbracketed !== t) out.add(unbracketed);
  return [...out].filter((v) => v.length >= 2).slice(0, 3);
}

// { "<lowercased title>": { series, ord, qid, parts: [[ord, title], …], also: [{ series, ord, qid }] } } — for tests.
let fixtureData = null;
const fixture = () => (fixtureData ||= JSON.parse(require('fs').readFileSync(process.env.AION_WIKIDATA_FIXTURE, 'utf8')));

/**
 * The series a book belongs to, according to Wikidata.
 * @param book         { title, author }
 * @param knownSeries  series names already in the library, preferred when Wikidata offers several
 * @returns { series, number, qid, sure } or null — sure when the author matched and no other series fits as well
 */
async function findSeries(book, knownSeries = []) {
  const surname = surnameOf(book.author);
  const variants = titleVariants(book.title);
  if (!variants.length) return null;
  let options;
  if (process.env.AION_WIKIDATA_FIXTURE) {
    const hit = variants.map((v) => fixture()[v.toLowerCase()]).find(Boolean);
    options = hit ? [hit, ...(hit.also || [])].map((h) => ({ qid: h.qid, series: h.series, number: h.ord ?? null, named: true })) : [];
  } else {
    // Books by that title (with an author on record).
    const ids = new Set();
    for (const v of variants) {
      (await search(`"${v.replace(/"/g, '')}" haswbstatement:P50`)).forEach((id) => ids.add(id));
      if (ids.size >= 6) break;
    }
    if (!ids.size) return null;
    let books = Object.values(await entities([...ids])).filter((e) => names(e).some((n) => variants.some((v) => same(n, v) || n.toLowerCase() === v.toLowerCase())));
    books = await writtenBy(books, surname);
    // Their series: "part of the series", or "part of" something that is a series.
    const links = books.flatMap((e) => [...targets(e, 'P179').map((t) => ({ ...t, named: true })), ...targets(e, 'P361')]);
    if (!links.length) return null;
    const series = await entities(links.map((l) => l.id), 'labels|claims');
    options = links
      .filter((l) => l.named || isSeries(series[l.id]))
      .map((l) => ({ qid: l.id, series: label(series[l.id]), number: l.ord ? Number(String(l.ord).replace(/[^\d.]/g, '')) || null : null, named: !!l.named }));
  }
  // Unnamed series (Wikidata shows just an id) are no use as a name.
  options = options.filter((o) => o.series && !/^Q\d+$/.test(o.series));
  if (!options.length) return null;
  const known = new Set(knownSeries.map((s) => Series.key(s)));
  const score = (o) => (known.has(Series.key(o.series)) ? 4 : 0) + (o.number != null ? 2 : 0) - o.series.length / 1000;
  options.sort((a, b) => score(b) - score(a));
  const rivals = options.filter((o) => o.qid !== options[0].qid && score(o) >= score(options[0]) - 1);
  // Only "part of the series" is said plainly enough to act on; a looser "part of" waits for a look.
  const { named, ...best } = options[0];
  return { ...best, sure: !!surname && named && !rivals.length };
}

/**
 * A series in the library, found on Wikidata by its name (and its author),
 * to learn which books it holds.
 * @returns { series, qid } or null
 */
async function findSeriesByName(name, author) {
  const base = Series.split(name).name.trim();
  if (!base) return null;
  if (process.env.AION_WIKIDATA_FIXTURE) {
    const hit = Object.values(fixture()).find((x) => same(x.series, base));
    return hit ? { series: hit.series, qid: hit.qid } : null;
  }
  // "The Kingkiller" is "The Kingkiller Chronicle" there; "A Tale of Dunk and Egg", "Tales of Dunk and Egg".
  const words = (s) => Series.key(s).split(' ').map((w) => w.replace(/s$/, '')).filter((w) => !['of', 'and', 'the', 'chronicle', 'saga', 'cycle', 'sequence', 'book', 'novel'].includes(w));
  const want = words(base).join(' ');
  const ids = await search(`${Series.key(base)} haswbstatement:${SERIES_KINDS.map((k) => `P31=${k}`).join('|')}`, 8);
  if (!ids.length) return null;
  let found = Object.values(await entities(ids)).filter((e) => isSeries(e) && names(e).some((n) => words(n).join(' ') === want));
  // Written by the same author: the series says so, or one of its books does.
  const surname = surnameOf(author);
  if (surname && found.length) {
    const kept = [];
    for (const e of found) {
      if ((await writtenBy([e], surname)).length) {
        kept.push(e);
        continue;
      }
      const parts = await search(`haswbstatement:P179=${e.id}`, 3);
      if ((await writtenBy(Object.values(await entities(parts, 'claims')), surname)).length) kept.push(e);
    }
    found = kept;
  }
  return found[0] ? { series: label(found[0]), qid: found[0].id } : null;
}

/** Every book Wikidata lists in a series, as [{ number, title }] in order. */
async function seriesParts(qid) {
  if (!/^Q\d+$/.test(qid)) return [];
  if (process.env.AION_WIKIDATA_FIXTURE) {
    const hit = Object.values(fixture()).find((x) => x.qid === qid);
    return (hit?.parts || []).map(([number, title]) => ({ number, title }));
  }
  const seen = new Map();
  const add = (number, title) => {
    number = Number(String(number || '').replace(/[^\d.]/g, ''));
    if (number && title && !/^Q\d+$/.test(title) && !seen.has(number)) seen.set(number, title);
  };
  // The books that name this series, with their number in it…
  const ids = await search(`haswbstatement:P179=${qid}`, 100);
  const books = await entities(ids, 'labels|claims');
  const unnumbered = [];
  for (const e of Object.values(books)) {
    const st = targets(e, 'P179').find((t) => t.id === qid);
    if (st?.ord) add(st.ord, label(e));
    else if (st && label(e)) unnumbered.push(label(e));
  }
  // …and the books the series lists as its parts.
  const series = (await entities([qid], 'claims'))[qid];
  const listed = targets(series, 'P527').filter((t) => t.ord);
  if (listed.length) {
    const named = await entities(listed.map((t) => t.id), 'labels');
    for (const t of listed) add(t.ord, label(named[t.id]));
  }
  // Books in it without a number still belong to it (they just can't be put in order).
  const numbered = new Set(seen.values());
  return [
    ...[...seen].sort((a, b) => a[0] - b[0]).map(([number, title]) => ({ number, title })),
    ...[...new Set(unnumbered)].filter((t) => !numbered.has(t)).map((title) => ({ number: null, title })),
  ];
}

module.exports = { findSeries, findSeriesByName, seriesParts, titleVariants, RateLimited };
