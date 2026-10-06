// Reads title/author/description/cover out of an EPUB without rendering it.
const JSZip = require('jszip');
const { XMLParser } = require('fast-xml-parser');
const path = require('path');

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  removeNSPrefix: true,
  textNodeName: '#text',
  isArray: (name) => ['item', 'meta', 'creator', 'title', 'rootfile', 'subject', 'identifier'].includes(name),
});

const asArray = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);

function text(v) {
  if (v == null) return '';
  if (Array.isArray(v)) return text(v[0]);
  if (typeof v === 'object') return String(v['#text'] ?? '').trim();
  return String(v).trim();
}

function stripHtml(s) {
  return s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function resolveHref(opfPath, href) {
  const dir = path.posix.dirname(opfPath);
  const decoded = decodeURIComponent(href.split('#')[0]);
  return path.posix.normalize(dir === '.' ? decoded : `${dir}/${decoded}`);
}

async function readEpubMeta(buffer) {
  const zip = await JSZip.loadAsync(buffer);

  const containerFile = zip.file('META-INF/container.xml');
  if (!containerFile) throw new Error('Not a valid EPUB (missing container.xml)');
  const container = parser.parse(await containerFile.async('string'));
  const rootfile = asArray(container?.container?.rootfiles?.rootfile)[0];
  const opfPath = rootfile?.['@full-path'];
  if (!opfPath || !zip.file(opfPath)) throw new Error('Not a valid EPUB (missing package file)');

  const opf = parser.parse(await zip.file(opfPath).async('string'));
  const pkg = opf.package || {};
  const md = pkg.metadata || {};
  const items = asArray(pkg.manifest?.item);
  const metas = asArray(md.meta);

  const title = text(md.title) || 'Untitled';
  const creators = asArray(md.creator).map(text).filter(Boolean);
  const description = stripHtml(text(md.description));

  // Locate the cover image: EPUB3 property, EPUB2 <meta name="cover">, then heuristics.
  let coverItem = items.find((i) => String(i['@properties'] || '').split(/\s+/).includes('cover-image'));
  if (!coverItem) {
    const coverMeta = metas.find((m) => m['@name'] === 'cover');
    const id = coverMeta?.['@content'];
    if (id) coverItem = items.find((i) => i['@id'] === id);
  }
  if (!coverItem) {
    coverItem = items.find(
      (i) => /image\//.test(i['@media-type'] || '') && /cover/i.test(`${i['@id']} ${i['@href']}`)
    );
  }

  let cover = null;
  if (coverItem && /image\//.test(coverItem['@media-type'] || '')) {
    const file = zip.file(resolveHref(opfPath, coverItem['@href']));
    if (file) {
      cover = {
        data: await file.async('nodebuffer'),
        ext: (path.extname(coverItem['@href']) || '.jpg').toLowerCase(),
      };
    }
  }

  const subjects = asArray(md.subject).map(text).filter(Boolean);

  // Series: Calibre's <meta name="calibre:series">, or EPUB3 belongs-to-collection.
  let series = '';
  let seriesIndex = null;
  const cal = metas.find((m) => m['@name'] === 'calibre:series');
  if (cal) {
    series = String(cal['@content'] || '').trim();
    const idx = metas.find((m) => m['@name'] === 'calibre:series_index');
    if (idx) seriesIndex = parseFloat(idx['@content']);
  } else {
    const coll = metas.find((m) => m['@property'] === 'belongs-to-collection');
    if (coll) {
      series = text(coll);
      const id = coll['@id'];
      const pos = id && metas.find((m) => m['@refines'] === `#${id}` && m['@property'] === 'group-position');
      if (pos) seriesIndex = parseFloat(text(pos));
    }
  }
  if (Number.isNaN(seriesIndex)) seriesIndex = null;

  return {
    series,
    seriesIndex,
    title,
    author: creators.join(', ') || 'Unknown author',
    description,
    publisher: text(md.publisher),
    language: text(md.language),
    published: text(md.date).slice(0, 10),
    subjects,
    cover,
  };
}

module.exports = { readEpubMeta };
