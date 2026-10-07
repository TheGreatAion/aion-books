// "Who is this?" online: what Wikipedia says about a character. Only ever
// called when the reader asks for it, behind a warning that it may hold spoilers.

const USER_AGENT = 'AionBooks/1.0 (desktop e-book reader; github.com/TheGreatAion/aion-books)';

// Node's fetch first; Electron's network stack (which follows system proxy settings) as a fallback.
async function webGet(url, ms = 8000) {
  const opts = () => {
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), ms);
    return { signal: ctrl.signal, headers: { 'User-Agent': USER_AGENT } };
  };
  try {
    return await fetch(url, opts());
  } catch {
    return require('electron').net.fetch(url, opts());
  }
}

class RateLimited extends Error {}
async function getJson(url) {
  const res = await webGet(url);
  if (res.status === 429) throw new RateLimited();
  return res.ok ? res.json() : null;
}

const stripHtml = (html) =>
  String(html || '')
    .replace(/<(style|script|sup)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\[\d+\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const fold = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
const api = (query) => `https://en.wikipedia.org/w/api.php?format=json&formatversion=2&${query}`;
const pageUrl = (title, anchor) => `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}${anchor ? `#${encodeURIComponent(anchor)}` : ''}`;
// "Mistborn: The Final Empire [Kindle Edition] (Mistborn, Book 1)" → "mistborn: the final empire"
const shortTitle = (t) => fold(String(t || '').replace(/\s*[[(][^\])]*[\])]/g, '').trim());

// An article's sections, as [{ heading, anchor, html }], from one request.
async function sections(title) {
  const data = await getJson(api(`action=parse&prop=text&disableeditsection=1&redirects=1&page=${encodeURIComponent(title)}`));
  const html = data?.parse?.text || '';
  const parts = html.split(/(?=<div class="mw-heading|<h[234][\s>])/i);
  return parts.map((part) => {
    const h = /<h([234])[^>]*?(?:id="([^"]*)")?[^>]*>([\s\S]*?)<\/h\1>/i.exec(part);
    return { heading: h ? stripHtml(h[3]) : '', level: h ? Number(h[1]) : 1, anchor: h?.[2] || '', html: part };
  });
}

// The paragraphs or list items of some article HTML that mention a name.
function entriesNaming(html, name) {
  const words = fold(name).split(/\s+/);
  // Entries that begin with the name (the character's own) before ones that only mention them.
  const opens = (t) => words.every((w) => fold(t.slice(0, 50)).includes(w));
  return [...html.matchAll(/<(li|p|dd)[^>]*>([\s\S]*?)<\/\1>/gi)]
    .map((m) => stripHtml(m[2]))
    .filter((t) => t.length > 20 && words.every((w) => fold(t).includes(w)))
    .sort((a, b) => Number(opens(b)) - Number(opens(a)));
}

const trim = (t, max = 900) => (t.length > max ? `${t.slice(0, max - 20).replace(/\s+\S*$/, '')}…` : t);

// A character's entry in a "List of … characters" page, or in the "Characters"
// part of a book's article (never its plot summary).
async function fromArticle(title, name, { listPage }) {
  const secs = await sections(title);
  const isChars = (s) => /\b(characters?|cast|protagonists)\b/i.test(s.heading);
  // In a list of characters, the character often has a heading of their own.
  if (listPage) {
    const words = fold(name).split(/\s+/);
    const own = secs.find((s) => s.heading && words.every((w) => fold(s.heading).includes(w)));
    if (own) {
      const paras = [...own.html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map((m) => stripHtml(m[1])).filter((t) => t.length > 30);
      if (paras.length) return { title: own.heading, description: title, extract: trim(paras.slice(0, 2).join('\n\n'), 1400), url: pageUrl(title, own.anchor) };
    }
  }
  // Otherwise, the item that names them in a characters section (and its subsections).
  const i = secs.findIndex(isChars);
  const pool = listPage ? secs : i < 0 ? [] : [secs[i], ...secs.slice(i + 1).filter((s, k, a) => a.slice(0, k + 1).every((x) => x.level > secs[i].level))];
  for (const s of pool) {
    const [entry] = entriesNaming(s.html, name);
    if (entry) return { title: name, description: `From “${title}” on Wikipedia`, extract: trim(entry), url: pageUrl(title, s.anchor) };
  }
  return null;
}

const cache = new Map(); // answers for this session, so asking twice doesn't ask Wikipedia twice

// What Wikipedia says about a character:
//   1. their own article, if they have one;
//   2. their entry in a "List of … characters" page;
//   3. their entry in the "Characters" part of the book's (or series') article,
//      the article about the book you're reading first.
//   name     what the reader selected, e.g. "Mat Cauthon"
//   context  { series, title } of the book being read
async function lookupCharacter(name, context = {}) {
  const n = String(name || '').trim().slice(0, 80);
  if (!n) return { none: true };
  const { series = '', title = '' } = typeof context === 'string' ? { series: context } : context;
  const key = `${fold(n)}|${fold(series)}|${fold(title)}`;
  if (cache.has(key)) return cache.get(key);
  try {
    const q = `"${n}" ${String(series || shortTitle(title)).slice(0, 120)}`.trim();
    const data = await getJson(api(`action=query&list=search&srlimit=8&srsearch=${encodeURIComponent(q)}`));
    if (!data) return { error: 'Wikipedia isn’t answering right now' };
    const hits = (data.query?.search || []).map((h) => h.title);
    let result = null;

    const own = hits.find((t) => fold(t).startsWith(fold(n)) || fold(t.replace(/\s*\(.*\)$/, '')) === fold(n));
    if (own) {
      const d = await getJson(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(own.replace(/ /g, '_'))}`);
      if (d && d.type !== 'disambiguation' && d.extract) result = { title: d.title, description: d.description || '', extract: d.extract, url: d.content_urls?.desktop?.page };
    }
    const list = hits.find((t) => /\bcharacters\b/i.test(t));
    if (!result && list) result = await fromArticle(list, n, { listPage: true });
    if (!result) {
      // The article about this very book first: later books' articles give more away.
      const book = shortTitle(title);
      const articles = hits
        .filter((t) => t !== list && t !== own)
        .sort((a, b) => Number(!!book && fold(b).includes(book.split(':').pop().trim())) - Number(!!book && fold(a).includes(book.split(':').pop().trim())))
        .slice(0, 3);
      for (const a of articles) if ((result = await fromArticle(a, n, { listPage: false }))) break;
    }
    result ||= { none: true };
    cache.set(key, result);
    return result;
  } catch (err) {
    if (err instanceof RateLimited) return { error: 'Wikipedia asked for a pause — try again in a minute' };
    return { error: 'Couldn’t reach Wikipedia' };
  }
}

const isWikipediaUrl = (url) => /^https:\/\/en\.wikipedia\.org\/wiki\//.test(String(url));

module.exports = { lookupCharacter, isWikipediaUrl };
