// Reads a font file's family name, weight and style from its 'name' and 'OS/2'
// tables (TTF, OTF and WOFF). WOFF2 tables are transformed, so for those we fall
// back to the file name.
const zlib = require('zlib');
const path = require('path');

function sfntTables(buf) {
  const sig = buf.toString('ascii', 0, 4);
  const tables = {};
  if (sig === 'wOFF') {
    const num = buf.readUInt16BE(12);
    for (let i = 0; i < num; i++) {
      const o = 44 + i * 20;
      const tag = buf.toString('ascii', o, o + 4);
      const off = buf.readUInt32BE(o + 4);
      const comp = buf.readUInt32BE(o + 8);
      const orig = buf.readUInt32BE(o + 12);
      tables[tag] = () => {
        const raw = buf.subarray(off, off + comp);
        return comp < orig ? zlib.inflateSync(raw) : raw;
      };
    }
    return tables;
  }
  const num = buf.readUInt16BE(4);
  for (let i = 0; i < num; i++) {
    const o = 12 + i * 16;
    const tag = buf.toString('ascii', o, o + 4);
    const off = buf.readUInt32BE(o + 8);
    const len = buf.readUInt32BE(o + 12);
    tables[tag] = () => buf.subarray(off, off + len);
  }
  return tables;
}

function readNames(t) {
  const count = t.readUInt16BE(2);
  const strOff = t.readUInt16BE(4);
  const names = {};
  for (let i = 0; i < count; i++) {
    const o = 6 + i * 12;
    const platform = t.readUInt16BE(o);
    const lang = t.readUInt16BE(o + 4);
    const id = t.readUInt16BE(o + 6);
    const len = t.readUInt16BE(o + 8);
    const off = t.readUInt16BE(o + 10);
    const raw = t.subarray(strOff + off, strOff + off + len);
    let str = null;
    let score = 0;
    if (platform === 3 || platform === 0) {
      const b = Buffer.from(raw);
      b.swap16();
      str = b.toString('utf16le');
      score = platform === 3 && lang === 0x409 ? 3 : 2;
    } else if (platform === 1) {
      str = raw.toString('latin1');
      score = 1;
    }
    if (str && (!names[id] || names[id].score < score)) names[id] = { str: str.replace(/\0/g, '').trim(), score };
  }
  return Object.fromEntries(Object.entries(names).map(([k, v]) => [k, v.str]));
}

function fromFileName(file) {
  const base = path.basename(file, path.extname(file));
  const style = /italic|oblique/i.test(base) ? 'italic' : 'normal';
  const num = base.match(/(?:^|[-_ ])([1-9]00)(?:[-_ ]|$)/);
  const weight = num ? Number(num[1]) : guessWeight(base);
  const words = base
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[-_ ]+/)
    .filter(
      (w) =>
        w &&
        !/^(thin|hairline|extralight|ultralight|light|regular|book|normal|medium|semibold|demibold|bold|extrabold|ultrabold|black|heavy|italic|oblique|[1-9]00|latin|ext|cyrillic|greek|vietnamese|variable|vf)$/i.test(w)
    );
  const family = words.map((w) => (w === w.toLowerCase() ? w[0].toUpperCase() + w.slice(1) : w)).join(' ');
  return { family: family || base, weight, style };
}

function guessWeight(s) {
  const m = s.toLowerCase();
  if (/thin|hairline/.test(m)) return 100;
  if (/extra ?light|ultra ?light/.test(m)) return 200;
  if (/semi ?bold|demi ?bold/.test(m)) return 600;
  if (/extra ?bold|ultra ?bold/.test(m)) return 800;
  if (/black|heavy/.test(m)) return 900;
  if (/light/.test(m)) return 300;
  if (/medium/.test(m)) return 500;
  if (/bold/.test(m)) return 700;
  return 400;
}

function fontInfo(buf, file) {
  try {
    const sig = buf.toString('ascii', 0, 4);
    if (sig === 'wOF2') return fromFileName(file);
    const tables = sfntTables(buf);
    if (!tables.name) return fromFileName(file);
    const names = readNames(tables.name());
    const family = names[16] || names[1];
    const sub = names[17] || names[2] || '';
    let weight = guessWeight(sub);
    let style = /italic|oblique/i.test(sub) ? 'italic' : 'normal';
    if (tables['OS/2']) {
      const os2 = tables['OS/2']();
      if (os2.length >= 64) {
        const w = os2.readUInt16BE(4);
        if (w >= 100 && w <= 1000) weight = w;
        if (os2.readUInt16BE(62) & 1) style = 'italic';
      }
    }
    if (!family) return fromFileName(file);
    return { family, weight, style };
  } catch {
    return fromFileName(file);
  }
}

const FORMATS = {
  '.ttf': ['truetype', 'font/ttf'],
  '.otf': ['opentype', 'font/otf'],
  '.woff': ['woff', 'font/woff'],
  '.woff2': ['woff2', 'font/woff2'],
};

module.exports = { fontInfo, FORMATS };
