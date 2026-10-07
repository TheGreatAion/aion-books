// Small books in the formats besides EPUB: Kindle MOBI, FictionBook (FB2),
// a comic (CBZ) and a PDF. Each is written by hand, byte by byte, so the tests
// don't depend on any converter being installed.
const JSZip = require('jszip');

const TEXT = [
  'The garden had gone quiet in the way gardens do at the end of summer, when the bees grow slow and heavy.',
  'She walked the old path between the beds, past the foxgloves that had already gone to seed.',
  'There was a letter in her pocket, and she meant to read it again beneath the pear tree.',
  'Somewhere beyond the wall a dog barked twice and then thought better of it.',
];
const CHAPTERS = ['Frost on the Glass', 'The Long Table', 'Lanterns'];
const paragraphs = (n, seed) => Array.from({ length: n }, (_, k) => `${TEXT[(seed + k) % 4]} ${TEXT[(seed + k + 1) % 4]}`);
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

// ---------- MOBI (version 6, uncompressed) ----------
function mobi({ title, author }) {
  // The text: a contents page, then one section per chapter, split at page breaks.
  // Links use byte offsets ("filepos"), padded to a fixed width so they can be filled in afterwards.
  const pad = (n) => String(n).padStart(10, '0');
  let html = '<html><head><guide><reference type="toc" title="Contents" filepos=TOCPOS__00 /></guide></head><body>';
  html += '<h2 id="toc">Contents</h2>' + CHAPTERS.map((c, i) => `<p><a filepos=CHPOS_${i}___>${c}</a></p>`).join('');
  html += CHAPTERS.map((c, i) => `<mbp:pagebreak/><h2>${c}</h2>${paragraphs(10, i).map((p) => `<p>${p}</p>`).join('')}`).join('');
  html += '</body></html>';
  html = html.replace('TOCPOS__00', pad(html.indexOf('<h2 id="toc">')));
  let at = 0;
  CHAPTERS.forEach((c, i) => {
    at = html.indexOf(`<h2>${c}</h2>`, at);
    html = html.replace(`CHPOS_${i}___`, pad(at));
  });
  const text = Buffer.from(html, 'ascii');

  const textRecords = [];
  for (let i = 0; i < text.length; i += 4096) textRecords.push(text.subarray(i, i + 4096));

  // EXTH: author (100) and title (503)
  const exthRec = (type, value) => {
    const data = Buffer.from(value, 'utf8');
    const head = Buffer.alloc(8);
    head.writeUInt32BE(type, 0);
    head.writeUInt32BE(8 + data.length, 4);
    return Buffer.concat([head, data]);
  };
  const recs = [exthRec(100, author), exthRec(503, title)];
  let exthBody = Buffer.concat(recs);
  const exthPad = (4 - ((12 + exthBody.length) % 4)) % 4;
  const exthHead = Buffer.alloc(12);
  exthHead.write('EXTH', 0, 'ascii');
  exthHead.writeUInt32BE(12 + exthBody.length, 4);
  exthHead.writeUInt32BE(recs.length, 8);
  const exth = Buffer.concat([exthHead, exthBody, Buffer.alloc(exthPad)]);

  const MOBI_LEN = 232;
  const rec0 = Buffer.alloc(16 + MOBI_LEN);
  rec0.writeUInt16BE(1, 0); // no compression
  rec0.writeUInt32BE(text.length, 4);
  rec0.writeUInt16BE(textRecords.length, 8);
  rec0.writeUInt16BE(4096, 10);
  rec0.write('MOBI', 16, 'ascii');
  rec0.writeUInt32BE(MOBI_LEN, 20);
  rec0.writeUInt32BE(2, 24); // a book
  rec0.writeUInt32BE(65001, 28); // UTF-8
  rec0.writeUInt32BE(0x5eed, 32);
  rec0.writeUInt32BE(6, 36); // MOBI 6
  const titleBytes = Buffer.from(title, 'utf8');
  rec0.writeUInt32BE(16 + MOBI_LEN + exth.length, 84);
  rec0.writeUInt32BE(titleBytes.length, 88);
  rec0.writeUInt32BE(1 + textRecords.length, 108); // first resource: none
  rec0.writeUInt32BE(0x40, 128); // has EXTH
  rec0.writeUInt32BE(0xffffffff, 244); // no index
  const record0 = Buffer.concat([rec0, exth, titleBytes, Buffer.alloc(4)]);

  const records = [record0, ...textRecords];
  const header = Buffer.alloc(78 + records.length * 8 + 2);
  header.write(title.replace(/\W+/g, '_').slice(0, 31), 0, 'ascii');
  header.write('BOOK', 60, 'ascii');
  header.write('MOBI', 64, 'ascii');
  header.writeUInt16BE(records.length, 76);
  let offset = header.length;
  records.forEach((r, i) => {
    header.writeUInt32BE(offset, 78 + i * 8);
    header.writeUInt32BE(i * 2, 78 + i * 8 + 4);
    offset += r.length;
  });
  return Buffer.concat([header, ...records]);
}

// ---------- FB2 ----------
function fb2({ title, first, last }) {
  const sections = CHAPTERS.map((c, i) => `<section><title><p>${c}</p></title>${paragraphs(10, i).map((p) => `<p>${esc(p)}</p>`).join('')}</section>`).join('');
  return Buffer.from(
    `<?xml version="1.0" encoding="utf-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">
<description><title-info><genre>prose</genre><author><first-name>${first}</first-name><last-name>${last}</last-name></author>
<book-title>${esc(title)}</book-title><annotation><p>A winter book.</p></annotation><lang>en</lang></title-info>
<document-info><id>aion-fixture-fb2</id></document-info></description>
<body>${sections}</body></FictionBook>`,
    'utf8'
  );
}

// ---------- CBZ (a zip of page images) ----------
async function cbz(png) {
  const zip = new JSZip();
  const colors = [[120, 90, 60], [70, 95, 78], [150, 90, 70], [60, 70, 100]];
  colors.forEach((rgb, i) => zip.file(`page${String(i + 1).padStart(2, '0')}.png`, png(300, 450, rgb)));
  return zip.generateAsync({ type: 'nodebuffer' });
}

// ---------- PDF ----------
function pdf({ title, author }) {
  const pages = CHAPTERS.map((c, i) => [c, ...paragraphs(6, i)]);
  const objs = [];
  const add = (body) => objs.push(body) && objs.length;
  const catalog = add(null);
  const pagesObj = add(null);
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman >>');
  const kids = [];
  for (const [heading, ...ps] of pages) {
    const lines = [];
    // Wrap the paragraphs to about 80 characters a line.
    for (const p of ps) {
      let line = '';
      for (const w of p.split(' ')) {
        if ((line + w).length > 80) lines.push(line.trim()), (line = '');
        line += w + ' ';
      }
      lines.push(line.trim(), '');
    }
    const pdfStr = (s) => s.replace(/[\\()]/g, (m) => `\\${m}`);
    let stream = `BT /F1 22 Tf 72 720 Td (${pdfStr(heading)}) Tj ET\nBT /F1 12 Tf 72 680 Td 16 TL\n`;
    stream += lines.map((l) => `(${pdfStr(l)}) Tj T*`).join('\n') + '\nET';
    const content = add(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`));
  }
  objs[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
  objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
  const info = add(`<< /Title (${title}) /Author (${author}) >>`);

  let out = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

const OTHER_BOOKS = {
  'winter-light.mobi': () => mobi({ title: 'Winter Light', author: 'Clara Holm' }),
  'the-long-table.fb2': () => fb2({ title: 'The Long Table', first: 'Ivo', last: 'Brandt' }),
  'panels.cbz': ({ png }) => cbz(png),
  'lantern-notes.pdf': () => pdf({ title: 'Lantern Notes', author: 'Ada Fenwick' }),
};

module.exports = { OTHER_BOOKS };
