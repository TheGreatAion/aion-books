// The book formats Aion Books can read, and how to tell them apart by file name.
const path = require('path');

// Kindle files (MOBI, AZW, AZW3, PRC), FictionBook (FB2, FBZ / .fb2.zip), comics (CBZ) and PDF, besides EPUB.
const BOOK_EXTENSIONS = ['epub', 'mobi', 'azw', 'azw3', 'prc', 'fb2', 'fbz', 'cbz', 'pdf'];
const BOOK_FILE = /\.(epub|mobi|azw3?|prc|fb2|fbz|fb2\.zip|cbz|pdf)$/i;

// The format a file is stored as. The reading engine tells formats apart by
// extension, so FictionBook in a zip is kept as .fbz and every Kindle file as
// .mobi (it reads the AZW3/KF8 part from inside either way).
function formatOf(file) {
  const name = path.basename(file).toLowerCase();
  if (name.endsWith('.fb2.zip') || name.endsWith('.fbz')) return 'fbz';
  const ext = path.extname(name).slice(1);
  if (['mobi', 'azw', 'azw3', 'prc'].includes(ext)) return 'mobi';
  return BOOK_EXTENSIONS.includes(ext) ? ext : 'epub';
}

// A readable title (and, when the name carries one, an author) from a file name:
//   "the_long-table.fb2"                                   → "The long table"
//   "Macroeconomics, 8e -- Olivier Blanchard -- 2019.pdf"  → "Macroeconomics, 8e" by Olivier Blanchard
function detailsFromFilename(file) {
  const base = path.basename(file).replace(/\.fb2\.zip$/i, '').replace(/\.[^.]+$/, '');
  const parts = base.split(/\s+--\s+/).map((s) => s.trim()).filter(Boolean);
  if (parts.length >= 2 && /[a-z]/i.test(parts[1]) && !/\d{4}/.test(parts[1])) return { title: parts[0], author: parts[1] };
  const words = base.replace(/_+/g, ' ').replace(/(?<=\w)-(?=\w)/g, ' ').replace(/\s+/g, ' ').trim();
  return { title: words ? words[0].toUpperCase() + words.slice(1) : 'Untitled', author: '' };
}

module.exports = { BOOK_EXTENSIONS, BOOK_FILE, formatOf, detailsFromFilename };
