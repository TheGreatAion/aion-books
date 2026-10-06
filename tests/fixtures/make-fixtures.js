// Generates small EPUBs that exercise the awkward cases real books throw at a
// reader: series metadata, covers, footnotes, every chapter in one file, and
// text sized in rem or points. Output: tests/fixtures/books/*.epub
const JSZip = require('jszip');
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, 'books');

const SENTENCES = [
  'The garden had gone quiet in the way gardens do at the end of summer, when the bees grow slow and heavy.',
  'She walked the old path between the beds, past the foxgloves that had already gone to seed.',
  'There was a letter in her pocket, and she meant to read it again beneath the pear tree.',
  'Somewhere beyond the wall a dog barked twice and then thought better of it.',
  'When at last she sat, the bench gave its familiar complaint, a dry creak of old oak.',
];
const para = (i) => `<p>${SENTENCES[i % 5]} ${SENTENCES[(i + 2) % 5]} ${SENTENCES[(i + 4) % 5]}</p>`;
const paras = (n, seed = 0) => Array.from({ length: n }, (_, k) => para(seed + k)).join('\n');
const CHAPTERS = ['The Pear Tree', 'A Letter Unfolded', 'Windfall', 'The Hedge Path', 'Late Roses', 'Seed Heads'];

function png(w, h, [r, g, b]) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set([r, g, b], y * (w * 3 + 1) + 1 + x * 3);
  const table = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const x of buf) c = table[(c ^ x) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const xhtml = (title, body, css = '') =>
  `<?xml version="1.0" encoding="utf-8"?><!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>${title}</title>${
    css ? '<link rel="stylesheet" href="style.css" type="text/css"/>' : ''
  }</head><body>${body}</body></html>`;

async function makeBook(file, o) {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file('META-INF/container.xml', `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`);
  const items = [];
  const spine = [];
  const nav = [];
  if (o.css) {
    zip.file('OEBPS/style.css', o.css);
    items.push('<item id="css" href="style.css" media-type="text/css"/>');
  }
  if (o.singleFile) {
    // Every chapter in one file, marked by anchors — common in converted books.
    const body = o.chapters
      .map((t, i) => `<h1 id="chap${i + 1}">Chapter ${i + 1}: ${t}</h1>${paras(o.paras, i * 7)}`)
      .join('\n');
    zip.file('OEBPS/text.xhtml', xhtml(o.title, body, o.css));
    items.push('<item id="text" href="text.xhtml" media-type="application/xhtml+xml"/>');
    spine.push('<itemref idref="text"/>');
    o.chapters.forEach((t, i) => nav.push(`<li><a href="text.xhtml#chap${i + 1}">Chapter ${i + 1}: ${t}</a></li>`));
  } else {
    o.chapters.forEach((t, i) => {
      let body = `<h1>${t}</h1>${paras(o.paras, i * 7)}`;
      if (o.notes && i === 0) {
        body +=
          '<p>The pear tree was planted the year the war ended.<a epub:type="noteref" href="notes.xhtml#n1">1</a> ' +
          'Nobody remembered who had chosen it.<sup><a href="#fn2">2</a></sup></p>' +
          '<aside epub:type="footnote" id="fn2"><p>Possibly the gardener, who kept no records.</p></aside>';
      }
      zip.file(`OEBPS/ch${i + 1}.xhtml`, xhtml(t, body, o.css));
      items.push(`<item id="ch${i + 1}" href="ch${i + 1}.xhtml" media-type="application/xhtml+xml"/>`);
      spine.push(`<itemref idref="ch${i + 1}"/>`);
      nav.push(`<li><a href="ch${i + 1}.xhtml">${t}</a></li>`);
    });
  }
  if (o.notes) {
    zip.file('OEBPS/notes.xhtml', xhtml('Notes', '<aside epub:type="endnote" id="n1"><p><a href="ch1.xhtml">1.</a> The armistice of 1918; the tree was a gift from the village.</p></aside>'));
    items.push('<item id="notes" href="notes.xhtml" media-type="application/xhtml+xml"/>');
    spine.push('<itemref idref="notes" linear="no"/>');
  }
  zip.file('OEBPS/nav.xhtml', xhtml('Contents', `<nav epub:type="toc"><ol>${nav.join('')}</ol></nav>`));
  items.push('<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>');
  if (o.cover) {
    zip.file('OEBPS/cover.png', png(60, 90, o.cover));
    items.push('<item id="cover" href="cover.png" media-type="image/png" properties="cover-image"/>');
  }
  const series = o.series ? `<meta name="calibre:series" content="${o.series}"/><meta name="calibre:series_index" content="${o.seriesIndex}"/>` : '';
  zip.file(
    'OEBPS/content.opf',
    `<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="uid">urn:aion-test:${path.basename(file)}</dc:identifier><dc:title>${o.title}</dc:title><dc:creator>${o.author}</dc:creator><dc:language>en</dc:language><dc:description>${o.description || ''}</dc:description>${series}</metadata><manifest>${items.join('')}</manifest><spine>${spine.join('')}</spine></package>`
  );
  fs.writeFileSync(file, await zip.generateAsync({ type: 'nodebuffer', mimeType: 'application/epub+zip' }));
}

const BOOKS = {
  'pear-tree.epub': { title: 'The Pear Tree Letters', author: 'Margaret Ashdown', chapters: CHAPTERS, paras: 24, cover: [70, 95, 78], series: 'The Orchard Years', seriesIndex: 1, notes: true, description: 'A quiet novel of a garden and a letter.' },
  'hedge-path.epub': { title: 'Along the Hedge Path', author: 'Eleanor Vale', chapters: CHAPTERS.slice(0, 3), paras: 20, series: 'The Orchard Years', seriesIndex: 2 },
  'single-file.epub': {
    title: 'One Long Afternoon: An Illustrated Edition [Special] (Orchard Classics)',
    author: 'Isobel Marsh',
    chapters: CHAPTERS.slice(0, 4),
    paras: 18,
    singleFile: true,
    css: 'html { font-size: 16px; } p { font-size: 1rem; margin: 0; text-indent: 1.2em; } h1 { font-size: 1.6rem; }',
  },
  'point-sized.epub': { title: 'Late Roses', author: 'Thomas Wren', chapters: CHAPTERS.slice(0, 3), paras: 20, cover: [150, 90, 70], css: 'p { font-size: 12pt; } h1 { font-size: 20pt; }' },
};

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  for (const [name, o] of Object.entries(BOOKS)) await makeBook(path.join(OUT, name), o);
  return Object.keys(BOOKS).map((n) => path.join(OUT, n));
}

module.exports = { main, BOOKS, OUT };
if (require.main === module) main().then((files) => console.log(`wrote ${files.length} fixtures to ${OUT}`));
