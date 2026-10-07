// Author names as people write them: "Brandon Sanderson", not "Sanderson,
// Brandon" (the catalog order some files use). Turned round only when it's
// clearly "Surname, Given names" — never a list of several authors.
const PARTICLES = new Set(['le', 'la', 'de', 'du', 'del', 'della', 'di', 'da', 'van', 'von', 'der', 'den', 'ter', 'st.', 'saint', 'mac', 'al', 'el', 'bin', 'ibn']);

function naturalAuthor(name) {
  const a = String(name || '').trim().replace(/\s+/g, ' ');
  const m = /^([^,;&]+),\s*([^,;&]+)$/.exec(a);
  if (!m || /\band\b/i.test(a)) return a;
  const [, last, first] = m;
  const lastWords = last.trim().split(' ');
  // "Sanderson", "Le Guin", "van Gogh" — a surname, not someone's full name.
  const surnameLike = lastWords.length === 1 || (lastWords.length === 2 && PARTICLES.has(lastWords[0].toLowerCase()));
  // "Brandon", "Ursula K.", "J. R. R." — given names, and not "Jr." or "PhD".
  const givenLike = first.trim().split(' ').length <= 3 && !/^(jr|sr|ii|iii|iv|phd|md)\.?$/i.test(first.trim());
  return surnameLike && givenLike ? `${first.trim()} ${last.trim()}` : a;
}

// The surname of the first author named, for looking a book up.
function surnameOf(name) {
  const first = naturalAuthor(name).split(/\s*(?:,|&|;|\band\b)\s*/i)[0] || '';
  const words = first
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .split(/\s+/)
    .filter((w) => w && !/^(jr|sr|ii|iii|iv)\.?$/i.test(w));
  return words.length ? words[words.length - 1].replace(/[^\p{L}'-]/gu, '') : '';
}

module.exports = { naturalAuthor, surnameOf };
