// Two copies of one book: the same title (give or take a subtitle, brackets,
// a leading "The" and punctuation) by the same author. Used to ask, when books
// are added, whether a new one is one you already have.
const { surnameOf } = require('./authors');

function titleKey(raw) {
  return String(raw || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s*[([][^)\]]*[)\]]\s*/g, ' ')
    .split(/\s*:\s+/)[0]
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/^(the|a|an)\s+/, '');
}

function dupKey(book) {
  const t = titleKey(book.title);
  return t ? `${t}|${(surnameOf(book.author) || '').toLowerCase()}` : '';
}

module.exports = { dupKey, titleKey };
