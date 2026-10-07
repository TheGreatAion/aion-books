// Finding a book's series on Wikidata (Wikipedia's free, open database of
// facts) when the book's own file doesn't say. Only the title and the author's
// surname are sent. What's found is a suggestion: it waits for you to approve it.
//
// Wikidata records a novel's series as "part of the series" (P179), with the
// book's number in it as "series ordinal" (P1545). It also lists every book
// in a series, which is how the series page knows which ones you're missing.
const Series = require('../src/series.js');
const { surnameOf } = require('./authors');

const USER_AGENT = 'AionBooks/1.0 (desktop e-book reader; github.com/TheGreatAion/aion-books)';
const ENDPOINT = 'https://query.wikidata.org/sparql';

class RateLimited extends Error {}

async function sparql(query) {
  // Tests replay answers from a file instead of going online.
  if (process.env.AION_WIKIDATA_FIXTURE) return fixture(query);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(`${ENDPOINT}?query=${encodeURIComponent(query)}`, {
      signal: ctrl.signal,
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/sparql-results+json' },
    });
    if (res.status === 429) throw new RateLimited();
    if (!res.ok) throw new Error(`Wikidata answered ${res.status}`);
    return (await res.json()).results.bindings;
  } finally {
    clearTimeout(timer);
  }
}

// { "<lowercased title>": { series, ord, qid, parts: [[ord, title], …] } } — for tests.
let fixtureData = null;
function fixture(query) {
  fixtureData ||= JSON.parse(require('fs').readFileSync(process.env.AION_WIKIDATA_FIXTURE, 'utf8'));
  const parts = /wd:(Q\w+)\s*\./.exec(query);
  if (/# parts/.test(query) && parts) {
    const hit = Object.values(fixtureData).find((x) => x.qid === parts[1]);
    return (hit?.parts || []).map(([ord, title]) => ({ ord: { value: String(ord) }, wLabel: { value: title } }));
  }
  const titles = [...query.matchAll(/"((?:[^"\\]|\\.)*)"@en/g)].map((m) => m[1].replace(/\\"/g, '"').toLowerCase());
  const hit = titles.map((t) => fixtureData[t]).find(Boolean);
  if (!hit) return [];
  return [{ series: { value: `http://www.wikidata.org/entity/${hit.qid}` }, seriesLabel: { value: hit.series }, ...(hit.ord != null ? { ord: { value: String(hit.ord) } } : {}) }];
}

const lit = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"@en`;

// The ways a book's title may be written on Wikidata.
function titleVariants(title) {
  const t = String(title || '').trim();
  const out = new Set([t]);
  const beforeColon = t.split(/\s*:\s+/)[0];
  if (beforeColon.length >= 3) out.add(beforeColon);
  // "Words of Radiance (Stormlight Archive, The)": the series in brackets isn't part of the title.
  const unbracketed = t.replace(/\s*[([][^)\]]*[)\]]\s*$/, '').trim();
  if (unbracketed.length >= 2 && unbracketed !== t) out.add(unbracketed);
  // "the hobbit" → "The Hobbit"? Wikidata labels follow the book's own capitals,
  // which the file usually has too; also try the plain title-case form.
  for (const v of [...out]) out.add(v.replace(/\b([a-z])/g, (c) => c.toUpperCase()));
  return [...out].filter((v) => v.length >= 2).slice(0, 6);
}

/**
 * The series a book belongs to, according to Wikidata.
 * @param book         { title, author }
 * @param knownSeries  series names already in the library, preferred when Wikidata offers several
 * @returns { series, number, qid } or null
 */
async function findSeries(book, knownSeries = []) {
  const surname = surnameOf(book.author);
  const variants = titleVariants(book.title);
  if (!variants.length) return null;
  const query = `SELECT ?series ?seriesLabel ?ord WHERE {
    VALUES ?t { ${variants.map(lit).join(' ')} }
    ?item rdfs:label ?t.
    # The book names its series ("part of the series")…
    { ?item p:P179 ?st. ?st ps:P179 ?series. OPTIONAL { ?st pq:P1545 ?ord. } }
    # …or the series lists the book among its parts ("has part(s)")…
    UNION { ?series p:P527 ?st. ?st ps:P527 ?item. ?series wdt:P31 ?kind. VALUES ?kind { wd:Q277759 wd:Q1667921 wd:Q7725310 } OPTIONAL { ?st pq:P1545 ?ord. } }
    # …or the book is "part of" a book series.
    UNION { ?item p:P361 ?st. ?st ps:P361 ?series. ?series wdt:P31 ?kind. VALUES ?kind { wd:Q277759 wd:Q1667921 wd:Q7725310 } OPTIONAL { ?st pq:P1545 ?ord. } }
    ${surname ? `?item wdt:P50 ?au. ?au rdfs:label ?al. FILTER(LANG(?al) = "en" && CONTAINS(LCASE(?al), ${lit(surname.toLowerCase()).replace(/@en$/, '')}))` : ''}
    SERVICE wikibase:label { bd:serviceParam wikibase:language "en,mul". }
  } LIMIT 12`;
  const rows = await sparql(query);
  const options = rows
    .map((r) => ({
      qid: r.series.value.split('/').pop(),
      series: r.seriesLabel?.value || '',
      number: r.ord ? Number(String(r.ord.value).replace(/[^\d.]/g, '')) || null : null,
    }))
    // Unnamed series (Wikidata shows just an id) are no use as a name.
    .filter((o) => o.series && !/^Q\d+$/.test(o.series));
  if (!options.length) return null;
  const known = new Set(knownSeries.map((s) => Series.key(s)));
  const score = (o) => (known.has(Series.key(o.series)) ? 4 : 0) + (o.number != null ? 2 : 0) - o.series.length / 1000;
  options.sort((a, b) => score(b) - score(a));
  return options[0];
}

/** Every book Wikidata lists in a series, as [{ number, title }] in order. */
async function seriesParts(qid) {
  if (!/^Q\d+$/.test(qid)) return [];
  const rows = await sparql(`# parts
    SELECT ?w ?wLabel ?ord WHERE {
      ?w p:P179 ?st. ?st ps:P179 wd:${qid}.
      ?st pq:P1545 ?ord.
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en,mul". }
    } LIMIT 80`);
  const seen = new Map();
  for (const r of rows) {
    const number = Number(String(r.ord?.value || '').replace(/[^\d.]/g, ''));
    const title = r.wLabel?.value || '';
    if (!number || !title || /^Q\d+$/.test(title) || seen.has(number)) continue;
    seen.set(number, title);
  }
  return [...seen].sort((a, b) => a[0] - b[0]).map(([number, title]) => ({ number, title }));
}

module.exports = { findSeries, seriesParts, titleVariants, RateLimited };
