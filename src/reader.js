// The reading room. Books are rendered by foliate-js (src/vendor/foliate-js):
// a <foliate-view> lays the book out in columns and reports where we are;
// this file supplies the styling, controls, bookmarks, highlights and settings.
(function () {
  const { $, $$, esc, State, updateBook, setSettings, toast, openMenu, promptText, pct } = window.UI;
  const { icon } = window.Ornaments;
  const { divider, bloom, readerSprig } = window.Painted;

  const Fonts = window.UI.Fonts;
  const LINE_HEIGHTS = [
    [1.4, 'Snug'],
    [1.6, 'Airy'],
    [1.85, 'Open'],
  ];
  const MARGINS = [
    ['narrow', 'Narrow'],
    ['comfortable', 'Balanced'],
    ['wide', 'Wide'],
  ];
  const LAYOUTS = [
    ['single', 'Single page'],
    ['auto', 'Two pages'],
    ['scroll', 'Scroll'],
  ];
  const THEMES = {
    linen: { label: 'Linen', swatch: '#f2eadb', ink: '#3b2f25', link: '#8e5b3c', blend: 'multiply' },
    parchment: { label: 'Parchment', swatch: '#ead7b3', ink: '#38271a', link: '#994e29', blend: 'multiply' },
    dusk: { label: 'Dusk', swatch: '#27221d', ink: '#e2d5bf', link: '#d49c6f', blend: 'normal' },
  };
  const HL = {
    rose: { light: 'rgb(214,140,130)', dark: 'rgb(205,120,110)', opacity: { light: 0.38, dark: 0.35 } },
    sage: { light: 'rgb(140,168,108)', dark: 'rgb(140,165,110)', opacity: { light: 0.4, dark: 0.33 } },
    ochre: { light: 'rgb(226,178,84)', dark: 'rgb(214,170,80)', opacity: { light: 0.42, dark: 0.33 } },
  };
  // Widest a column of text may be, per margin setting. Two-page mode appears
  // automatically when the window fits two such columns.
  const COLUMN = { narrow: 760, comfortable: 640, wide: 540 };

  let fontCss = '';
  window.aion.fontCss().then((css) => {
    fontCss = css;
    const s = document.createElement('style');
    s.textContent = css;
    document.head.appendChild(s);
  });

  // Books converted from Kindle format sometimes still wrap their fonts in
  // Amazon's "FONT" container (a header, an XOR-scrambled first kilobyte and
  // zlib compression), which no e-book reader can use. Unwrap them as they load.
  async function unwrapKindleFont(data) {
    const buf = data instanceof Blob ? await data.arrayBuffer() : data instanceof ArrayBuffer ? data : null;
    if (!buf || buf.byteLength < 24 || new TextDecoder().decode(buf.slice(0, 4)) !== 'FONT') return data;
    const v = new DataView(buf);
    const flags = v.getUint32(8);
    const dataStart = v.getUint32(12);
    const keyLength = v.getUint32(16);
    const keyStart = v.getUint32(20);
    let bytes = new Uint8Array(buf.slice(dataStart));
    if (flags & 0b10 && keyLength) {
      const key = new Uint8Array(buf.slice(keyStart, keyStart + keyLength));
      const n = Math.min(keyLength === 16 ? 1024 : 1040, bytes.length);
      for (let i = 0; i < n; i++) bytes[i] ^= key[i % keyLength];
    }
    if (flags & 0b1) {
      // The compressed data is followed by padding, which the browser's own
      // decompressor rejects; fflate (as foliate uses for Kindle books) doesn't mind.
      const { unzlibSync } = await import('./vendor/foliate-js/vendor/fflate.js');
      bytes = unzlibSync(bytes);
    }
    return bytes;
  }

  // foliate-js is a set of ES modules; load them once, on first use.
  const engine = {};
  const loadEngine = () =>
    (engine.ready ||= Promise.all([
      import('./vendor/foliate-js/view.js'),
      import('./vendor/foliate-js/epubcfi.js'),
      import('./vendor/foliate-js/overlayer.js'),
    ]).then(([{ makeBook }, CFI, { Overlayer }]) => Object.assign(engine, { makeBook, CFI, Overlayer })));

  // A book's file as the engine sees it: something with a size that hands over
  // any range of its bytes. The bytes are read from disk only when asked for
  // (a zip's index, one chapter, one PDF page), so even a 100 MB book opens
  // without being copied into the window first. The engine tells formats
  // apart by file name, so each one carries its format's extension.
  class BookFile {
    constructor(id, name, type, start, end) {
      Object.assign(this, { id, name, type, start, end, size: end - start });
    }
    slice(from = 0, to = this.size, type = '') {
      const at = (x) => (x < 0 ? Math.max(this.size + x, 0) : Math.min(x, this.size));
      const s = at(from);
      return new BookFile(this.id, this.name, type || this.type, this.start + s, this.start + Math.max(s, at(to)));
    }
    async arrayBuffer() {
      if (!this.size) return new ArrayBuffer(0);
      const bytes = await window.aion.readBook(this.id, this.start, this.end);
      return bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? bytes.buffer : bytes.slice().buffer;
    }
    async text() {
      return new TextDecoder().decode(await this.arrayBuffer());
    }
  }
  async function bookFile(rec) {
    const size = await window.aion.bookSize(rec.id);
    const epub = !rec.format || rec.format === 'epub';
    return new BookFile(rec.id, `${rec.id}.${rec.format || 'epub'}`, epub ? 'application/epub+zip' : '', 0, size || 0);
  }

  // Plain text from whatever shape a format gives its details in: a string, a
  // { name } object, a map of languages, or a list of any of those.
  const metaText = (v) => {
    if (v == null) return '';
    if (typeof v === 'string') return v;
    if (Array.isArray(v)) return v.map(metaText).filter(Boolean).join(', ');
    if (typeof v === 'object') return metaText(v.name ?? Object.values(v)[0]);
    return String(v);
  };
  const stripTags = (html) => {
    const d = document.createElement('div');
    d.innerHTML = html;
    return d.textContent.replace(/\s+/g, ' ').trim();
  };
  const sniffImage = (b) =>
    b[0] === 0x89 && b[1] === 0x50 ? 'image/png'
      : b[0] === 0xff && b[1] === 0xd8 ? 'image/jpeg'
      : b[0] === 0x47 && b[1] === 0x49 ? 'image/gif'
      : b[8] === 0x57 && b[9] === 0x45 ? 'image/webp'
      : /^\s*(<\?xml|<svg)/.test(new TextDecoder().decode(b.subarray(0, 64))) ? 'image/svg+xml'
      : 'image/jpeg';

  const Reader = {
    id: null,
    view: null, // <foliate-view>
    book: null, // the parsed book (view.book)
    loc: null, // last 'relocate' detail
    toc: [],
    flatToc: [],
    chapter: '',
    progress: 0,
    pendingSel: null,
    saveTimer: null,
    idleTimer: null,
    wheelLock: 0,
    spread: false,
    openToken: 0,

    get record() {
      return State.book(this.id);
    },
    get renderer() {
      return this.view?.renderer;
    },
    // The documents currently laid out: [{ doc, index, overlayer }]
    contents() {
      return this.renderer?.getContents?.() || [];
    },

    // What's on screen, independent of the rendering engine. Used by the app tests.
    probe() {
      let textPx = null;
      for (const { doc } of this.contents()) {
        const p = [...doc.querySelectorAll('p')].find((x) => x.textContent.trim().length > 40);
        if (p) {
          textPx = parseFloat(doc.defaultView.getComputedStyle(p).fontSize);
          break;
        }
      }
      const texts = (els) => (els || []).map((e) => e.textContent);
      return {
        open: !!this.view && !!this.loc && $('#rLoading').classList.contains('gone'),
        bookId: this.id,
        position: this.startCfi(),
        fraction: this.progress,
        measured: !!this.loc,
        chapter: this.chapter,
        textPx,
        heads: texts(this.renderer?.heads),
        folios: texts(this.renderer?.feet),
        footer: $('#rPercent').textContent,
      };
    },

    // ---------- open / close ----------
    async open(id) {
      const rec = State.book(id);
      if (!rec) return;
      if (this.view) await this.close({ silent: true });
      const token = ++this.openToken;
      this.id = id;
      this.whoReset?.();
      this.loc = null;
      this.progress = rec.progress || 0;

      $('#library').classList.remove('is-active');
      $('#reader').classList.add('is-active');
      $('#rTitle').textContent = rec.title;
      $('#rAuthor').textContent = rec.author;
      $('#rLoading').classList.remove('gone');
      $('#rChapter').textContent = '';
      $('#rPercent').textContent = '';
      this.setSlider(this.progress);
      this.closePanels();
      document.title = `${rec.title} — Aion Books`;
      $('#vineBR').innerHTML = '';

      try {
        await loadEngine();
        const file = await bookFile(rec);
        if (token !== this.openToken) return;

        const view = document.createElement('foliate-view');
        view.id = 'book-view';
        $('#viewer').replaceChildren(view);
        this.view = view;
        this.wireView(view);
        await view.open(file);
        if (token !== this.openToken) return;
        this.book = view.book;
        this.book.transformTarget?.addEventListener('data', ({ detail }) => {
          if (/font|\.(ttf|otf|woff2?)$/i.test(`${detail.type} ${detail.name}`)) {
            const original = Promise.resolve(detail.data);
            detail.data = original.then(unwrapKindleFont).catch((e) => {
              console.warn(`Couldn't unwrap font ${detail.name}:`, e);
              return original;
            });
          }
        });
        // Comics list each page by its image file ("page01.png"); call them pages instead.
        // (Renamed in place: the engine reports the current entry from this same list.)
        if (rec.format === 'cbz') (this.book.toc || []).forEach((t, i) => (t.label = `Page ${i + 1}`));
        this.toc = this.book.toc || [];
        this.flatToc = [];
        this.flatten(this.toc, 0);
        this.renderToc();

        this.applyLayout();
        this.applyStyles();
        await view.init({ lastLocation: rec.location || undefined, showTextStart: !rec.location });
        if (token !== this.openToken) return;
        $('#rLoading').classList.add('gone');
        $('#vineBR').innerHTML = readerSprig();
        updateBook(id, { lastOpenedAt: Date.now() }, { quiet: true });
        this.trackStart();
        this.afterOpen();
        this.renderMarks();
        this.poke();
      } catch (err) {
        console.error(err);
        toast(`Couldn’t open this book — ${esc(err.message || err)}`, 4200);
        this.close({ silent: true });
      }
    },

    async close({ silent = false } = {}) {
      window.PageCurl.finish();
      this.beforeClose();
      this.openToken++;
      this.trackStop();
      this.flushSave();
      this.closePanels();
      this.hideSel();
      try {
        this.view?.close();
      } catch (_) {}
      this.view?.remove();
      this.view = null;
      this.book = null;
      this.loc = null;
      $('#viewer').innerHTML = '';
      document.title = 'Aion Books';
      const lib = $('#library');
      lib.dataset.visit = String(Number(lib.dataset.visit || 0) + 1);
      $('#reader').classList.remove('is-active');
      $('#library').classList.add('is-active');
      State.emit();
    },

    flatten(items, depth) {
      for (const item of items) {
        this.flatToc.push({ id: String(this.flatToc.length), label: (item.label || '').trim(), href: item.href, depth });
        item.aionId = this.flatToc[this.flatToc.length - 1].id;
        if (item.subitems?.length) this.flatten(item.subitems, depth + 1);
      }
    },

    // Event wiring for one <foliate-view>.
    wireView(view) {
      view.addEventListener('relocate', (e) => this.onRelocated(e.detail));
      view.addEventListener('load', (e) => this.onDocLoad(e.detail));
      // Highlights: draw them when their chapter is laid out, and handle clicks on them.
      view.addEventListener('create-overlay', (e) => this.drawHighlightsFor(e.detail.index));
      view.addEventListener('draw-annotation', (e) => {
        const { draw, annotation } = e.detail;
        const h = (this.record?.highlights || []).find((x) => x.cfi === annotation.value);
        const s = this.hlStyle(h?.color);
        draw(engine.Overlayer.highlight, { color: s.fill, opacity: s.opacity });
      });
      view.addEventListener('show-annotation', (e) => {
        const r = this.rectOf(e.detail.range);
        this.onHighlightClick(e.detail.value, r ? { clientX: r.left + r.width / 2, clientY: r.bottom } : null);
      });
      // Footnotes open in a pop-up instead of jumping away.
      view.addEventListener('link', (e) => {
        if (this.isNoteRef(e.detail.a)) {
          e.preventDefault();
          this.showNote(e.detail.a, e.detail.href);
        }
      });
    },

    // Every chapter document, as it's laid out.
    onDocLoad({ doc, index }) {
      // Pages that are pictures (PDFs, comics, fixed-layout books) keep their
      // own look: text size, typeface and paper don't apply to them.
      if (!this.view?.isFixedLayout) {
        // Text size is applied at the root, so it reaches rem-, em- and %-based
        // sizes alike. Remember the book's own root size to scale from it.
        const base = parseFloat(doc.defaultView.getComputedStyle(doc.documentElement).fontSize) || 16;
        doc.documentElement.dataset.aionBase = base;
        this.relativizeFontSizes(doc, base);
        this.keepPictureShapes(doc);
        const style = doc.createElement('style');
        style.id = 'aion-style';
        style.textContent = this.contentCss(base);
        doc.head?.appendChild(style);
      }

      doc.addEventListener('keydown', (e) => {
        // The main window's "?" listener can't hear keys pressed inside the book.
        if (e.key === '?' && !e.ctrlKey && $('#modalBack').hidden) {
          e.preventDefault();
          return window.Settings.showShortcuts();
        }
        this.onKey(e);
      });
      doc.addEventListener('mousemove', () => this.poke());
      doc.addEventListener('wheel', (e) => this.onWheel(e), { passive: true });
      doc.addEventListener('mousedown', () => {
        this.hideSel();
        this.hideNote();
      });
      doc.addEventListener('click', (e) => {
        if (!e.target.closest?.('a[href]')) this.closePanels();
      });
      // Selections: show the highlight / define / copy bar once the mouse is released.
      doc.addEventListener('mouseup', () => setTimeout(() => this.onSelected(doc, index), 10));
      this.extendDoc(doc, index);
    },

    // Covers made by Calibre (and some other converters) draw the picture as an
    // SVG told to stretch to fill the page (preserveAspectRatio="none"), so it
    // takes whatever shape the page happens to be: squashed in a wide window, a
    // thin strip in a narrow one. Scale such pictures to fit instead, keeping
    // their true proportions. (Drawings, with shapes of their own, are left be.)
    keepPictureShapes(doc) {
      for (const svg of doc.querySelectorAll('svg[preserveAspectRatio="none" i]')) {
        const onlyPictures = svg.querySelector('image') && !svg.querySelector('path, rect, circle, ellipse, line, polyline, polygon, text');
        if (onlyPictures) svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
      }
    },

    // Some books fix text sizes in px, pt or keywords like "small", which a root
    // size can't reach. Rewrite those as rem, relative to the book's own root
    // size, so they look the same at 100% and scale with everything else.
    relativizeFontSizes(doc, base) {
      const KEYWORDS = { 'xx-small': 9, 'x-small': 10, small: 13, medium: 16, large: 18, 'x-large': 24, 'xx-large': 32, 'xxx-large': 48 };
      const toRem = (value) => {
        const v = String(value || '').trim().toLowerCase();
        const m = /^([\d.]+)(px|pt)$/.exec(v);
        const px = m ? (m[2] === 'pt' ? parseFloat(m[1]) * (4 / 3) : parseFloat(m[1])) : KEYWORDS[v];
        return px ? `${(px / base).toFixed(4)}rem` : null;
      };
      const fix = (style) => {
        const rem = toRem(style.fontSize);
        if (rem) style.setProperty('font-size', rem, style.getPropertyPriority('font-size'));
      };
      const walk = (rules) => {
        for (const rule of rules) {
          if (rule.style && rule.style.fontSize && !/^\s*(html|:root)\s*$/i.test(rule.selectorText || '')) fix(rule.style);
          if (rule.cssRules) walk(rule.cssRules);
        }
      };
      for (const sheet of doc.styleSheets) {
        try {
          walk(sheet.cssRules);
        } catch (_) {
          /* unreadable sheet */
        }
      }
      doc.querySelectorAll('body [style*="font-size"]').forEach((el) => fix(el.style));
    },

    contentCss(base = 16) {
      const s = State.settings;
      const t = THEMES[s.theme] || THEMES.linen;
      const family =
        s.fontFamily && s.fontFamily !== 'Original'
          ? `body, body p, body div, body span, body li, body blockquote, body td, body dd, body dt,
             body h1, body h2, body h3, body h4, body h5, body h6, body em, body i, body cite {
               font-family: '${s.fontFamily}', Georgia, serif !important; }`
          : '';
      return `${fontCss}
        ${Fonts.faceCss(s.fontFamily)}
        html, body { background: transparent !important; color: ${t.ink} !important; }
        html { font-size: ${((base * (s.fontSize || 100)) / 100).toFixed(2)}px !important; }
        body * { color: inherit !important; background-color: transparent !important; }
        body a, body a * { color: ${t.link} !important; text-decoration-color: ${t.link}66 !important; }
        ${family}
        body p, body li, body blockquote, body dd { line-height: ${s.lineHeight} !important; }
        body p { hyphens: auto; -webkit-hyphens: auto; }
        /* A picture squeezed into a box of the wrong shape keeps its own. */
        body img { object-fit: contain; }
        body img, body svg image { mix-blend-mode: ${t.blend}; ${s.theme === 'dusk' ? 'filter: brightness(.85) sepia(.15);' : ''} }
        body hr { border-color: ${t.ink}33 !important; }
        ::selection { background: ${s.theme === 'dusk' ? 'rgba(205,120,110,.35)' : 'rgba(214,140,130,.35)'}; }
        ::highlight(aion-tts) { background-color: ${s.theme === 'dusk' ? 'rgba(140,165,110,.32)' : 'rgba(140,168,108,.32)'}; }
      `;
    },

    // Re-style the laid-out chapter after a text, font or paper change.
    applyStyles() {
      for (const { doc } of this.contents()) {
        const el = doc.getElementById('aion-style');
        const base = Number(doc.documentElement.dataset.aionBase) || 16;
        if (el) el.textContent = this.contentCss(base);
      }
    },

    // Columns, margins and flow live on the paginator as attributes. Changing
    // them re-lays out the book around the current spot — no reload, no drift.
    applyLayout() {
      const s = State.settings;
      const r = this.renderer;
      if (!r || this.view.isFixedLayout) return;
      const scroll = s.layout === 'scroll';
      r.setAttribute('flow', scroll ? 'scrolled' : 'paginated');
      r.setAttribute('max-column-count', s.layout === 'auto' ? '2' : '1');
      r.setAttribute('max-inline-size', `${COLUMN[s.margin] || COLUMN.comfortable}px`);
      r.setAttribute('gap', '6%');
      // Room above and below the text for the running heads and page numbers.
      r.setAttribute('margin', s.runningHeads === false || scroll ? '28px' : '52px');
      $('#reader').classList.toggle('scroll', scroll);
      this.updateSpread();
    },

    updateSpread() {
      this.spread = (this.renderer?.heads?.length || 1) > 1;
      $('#reader').classList.toggle('spread', this.spread);
    },

    // Books that aren't EPUBs arrive with only a title from their file name.
    // Open each one quietly, read its real title, author and cover, and save them.
    async fillMissingMeta() {
      if (this.fillingMeta) return;
      this.fillingMeta = true;
      this.metaTried ||= new Set();
      try {
        await loadEngine();
        let rec;
        while ((rec = State.books.find((b) => b.needsMeta && !this.metaTried.has(b.id)))) {
          this.metaTried.add(rec.id);
          let book = null;
          try {
            const file = await bookFile(rec);
            if (!file.size) continue;
            book = await engine.makeBook(file);
            const m = book.metadata || {};
            let title = metaText(m.title).trim();
            if (!title || title === file.name) title = ''; // comics are only named after their file
            const meta = {
              title,
              author: metaText(m.author),
              publisher: metaText(m.publisher),
              language: metaText(Array.isArray(m.language) ? m.language[0] : m.language),
              published: metaText(m.published),
              description: m.description ? stripTags(metaText(m.description)).slice(0, 4000) : '',
              subjects: [].concat(m.subject || []).map(metaText).filter(Boolean),
              series: metaText(m.belongsTo?.series?.name ?? m.belongsTo?.series),
              seriesIndex: m.belongsTo?.series?.position,
            };
            let cover = null;
            try {
              const blob = await book.getCover?.();
              if (blob?.size) {
                const bytes = new Uint8Array(await blob.arrayBuffer());
                cover = { data: bytes, type: blob.type && blob.type.startsWith('image/') ? blob.type : sniffImage(bytes) };
              }
            } catch (_) {
              /* no cover: the card shows its painted placeholder */
            }
            await window.aion.setBookMeta(rec.id, meta, cover);
          } catch (err) {
            console.warn(`Couldn't read the details of ${rec.title}:`, err);
            await window.aion.setBookMeta(rec.id, {}, null);
          } finally {
            try {
              book?.destroy?.();
            } catch (_) {}
          }
        }
      } finally {
        this.fillingMeta = false;
      }
    },

    onResize() {
      window.PageCurl.finish();
      this.updateSpread();
      if (this.loc) this.renderRunning(this.loc);
      this.renderEdges();
    },

    // ---------- where we are ----------
    // Where we are, for saving: the CFI of the whole visible passage. Saving a single
    // point (the first character on the page) is ambiguous when a page starts
    // mid-paragraph — it can resolve to the end of the previous page.
    placeCfi() {
      return this.loc?.cfi || null;
    },
    // Collapsed CFIs for the start and end of what's on screen.
    startCfi() {
      if (!this.loc?.cfi || !engine.CFI) return null;
      return engine.CFI.collapse(this.loc.cfi);
    },
    endCfi() {
      if (!this.loc?.cfi || !engine.CFI) return null;
      return engine.CFI.collapse(this.loc.cfi, true);
    },

    onRelocated(detail) {
      this.loc = detail;
      this.hideSel();
      if (this.turnDir) {
        if (!this.curlOn()) this.shuffle(this.turnDir);
        if (this.track) {
          this.track.pages++;
          this.track.active = Date.now();
        }
        this.turnDir = 0;
      }
      if (typeof detail.fraction === 'number') this.progress = detail.fraction;
      this.setSlider(this.progress);

      this.chapter = detail.tocItem?.label?.trim() || '';
      $('#rChapter').textContent = this.chapter;
      const currentId = detail.tocItem?.aionId;
      $$('.toc-item').forEach((el) => el.classList.toggle('is-current', !!currentId && el.dataset.id === currentId));

      $('#rPercent').textContent = this.footerText(detail);
      this.updateSpread();
      this.updateBookmarkBtn();
      this.queueSave(this.atEnd());
      this.afterRelocate(detail);
    },

    atEnd() {
      return this.progress > 0.995 || !!this.renderer?.atEnd;
    },

    setSlider(p) {
      const r = $('#rProgress');
      r.value = Math.round((p || 0) * 1000);
      r.style.setProperty('--p', `${(p || 0) * 100}%`);
    },

    queueSave(atEnd) {
      clearTimeout(this.saveTimer);
      this.saveTimer = setTimeout(() => this.flushSave(atEnd), 500);
    },

    flushSave(atEnd) {
      clearTimeout(this.saveTimer);
      if (!this.id || !this.loc) return;
      const rec = this.record;
      const patch = {
        location: this.placeCfi(),
        progress: this.progress,
        chapter: this.chapter,
        lastOpenedAt: Date.now(),
      };
      if (atEnd && rec && !rec.finished) {
        patch.finished = true;
        const next = window.Library?.nextInSeries(rec);
        toast(
          `Finished <em>${esc(rec.title)}</em> — how was it? ${window.UI.stars(rec.rating, { id: rec.id, interactive: true, cls: 'on-ink' })}` +
            (next ? ` <button class="toast-btn" data-open="${next.id}">Next: ${esc(next.title)}</button>` : ''),
          9000
        );
        window.UI.burst(innerWidth / 2, innerHeight - 50);
      }
      updateBook(this.id, patch, { quiet: true });
    },

    // ---------- navigation ----------
    next() {
      this.turnPage(1);
    },
    prev() {
      this.turnPage(-1);
    },
    // dir 1 turns toward the right-hand page (forward in most books), -1 the other way.
    turnPage(dir) {
      if (!this.view) return;
      const go = () => (dir > 0 ? this.view.goRight() : this.view.goLeft());
      this.turnDir = dir;
      if (!this.curlOn()) return go();
      const view = this.view;
      return window.PageCurl.turn({
        dir,
        box: this.pageBox(),
        stage: $('#stage'),
        // Resolves true once the new page is showing, false if there was nowhere to go.
        turn: () =>
          new Promise((resolve) => {
            let done = false;
            const end = (ok) => {
              if (done) return;
              done = true;
              view.removeEventListener('relocate', onMove);
              resolve(ok);
            };
            const onMove = () => end(true);
            view.addEventListener('relocate', onMove);
            Promise.resolve(go())
              .catch(() => {})
              .then(() => setTimeout(() => end(false), 80));
          }),
      });
    },
    curlOn() {
      return (
        State.settings.pageCurl !== false &&
        State.settings.motion !== 'still' &&
        State.settings.layout !== 'scroll' &&
        !matchMedia('(prefers-reduced-motion: reduce)').matches
      );
    },
    // A tiny stop-motion nudge of the page, as if the sheet were slid by hand.
    shuffle(dir) {
      if (State.settings.layout === 'scroll' || !window.UI.fullMotion()) return;
      $('.viewer-wrap').animate(
        [
          { transform: `translateX(${dir * 7}px) rotate(${dir * 0.25}deg)` },
          { transform: `translateX(${-dir * 2}px) rotate(${-dir * 0.08}deg)` },
          { transform: 'none' },
        ],
        { duration: 210, easing: 'steps(3, end)' }
      );
    },
    goTo(target) {
      this.closePanels();
      return this.view?.goTo(target);
    },

    onWheel(e) {
      if (!this.view || State.settings.layout === 'scroll' || State.settings.wheelTurns === false) return;
      if (Math.abs(e.deltaY) < 8 && Math.abs(e.deltaX) < 8) return;
      const now = Date.now();
      if (now < this.wheelLock) return;
      this.wheelLock = now + 380;
      const d = Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
      d > 0 ? this.next() : this.prev();
    },

    onKey(e) {
      if (!$('#reader').classList.contains('is-active')) return;
      if (!$('#modalBack').hidden) return;
      if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName) && e.target.type !== 'range') return;
      const k = e.key;
      if (k === 'ArrowRight' || k === 'PageDown' || (k === ' ' && !e.shiftKey)) {
        if (State.settings.layout === 'scroll' && k === ' ') return;
        e.preventDefault();
        this.next();
      } else if (k === 'ArrowLeft' || k === 'PageUp' || (k === ' ' && e.shiftKey)) {
        e.preventDefault();
        this.prev();
      } else if (k === 'Escape') {
        if (this.panelsOpen()) this.closePanels();
        else this.close();
      } else if (e.ctrlKey && (k === 'f' || k === 'F')) {
        e.preventDefault();
        this.openSearch();
      } else if ((k === 'r' || k === 'R') && !e.ctrlKey) {
        this.ttsToggle();
      } else if (k === 't' || k === 'T') {
        this.toggleDrawer();
      } else if (k === 'b' || k === 'B') {
        this.toggleBookmark();
      } else if (k === 'F11') {
        e.preventDefault();
        window.aion.toggleFullscreen();
      } else if (e.ctrlKey && (k === '=' || k === '+')) {
        e.preventDefault();
        this.stepFont(1);
      } else if (e.ctrlKey && k === '-') {
        e.preventDefault();
        this.stepFont(-1);
      }
      this.poke();
    },

    // ---------- reading time ----------
    // Time counts only while the window is focused and the reader has been
    // active in the last two minutes; it's logged in small batches.
    trackStart() {
      this.track = { ms: 0, pages: 0, locs: 0, last: Date.now(), active: Date.now() };
      clearInterval(this.trackTimer);
      this.trackTimer = setInterval(() => this.trackTick(), 5000);
    },
    trackTick(flush = false) {
      const t = this.track;
      if (!t || !this.id) return;
      const now = Date.now();
      // Listening to read-aloud counts as reading, even without mouse activity.
      const listening = this.tts?.playing && !this.tts?.paused;
      if ((document.hasFocus() || listening) && (now - t.active < 120000 || listening)) t.ms += Math.min(now - t.last, 6000);
      t.last = now;
      if (flush || t.ms >= 30000 || t.pages >= 10) {
        if (t.ms || t.pages) {
          window.aion.logReading(this.id, Math.round(t.ms), t.pages, t.locs);
          this.onLogged(t.ms);
        }
        t.ms = 0;
        t.pages = 0;
        t.locs = 0;
      }
    },
    trackStop() {
      this.trackTick(true);
      clearInterval(this.trackTimer);
      this.track = null;
    },

    poke() {
      if (this.track) this.track.active = Date.now();
      const r = $('#reader');
      r.classList.remove('idle');
      clearTimeout(this.idleTimer);
      if (State.settings.autoHideBars === false) return;
      this.idleTimer = setTimeout(() => {
        if (!this.panelsOpen() && this.view) r.classList.add('idle');
      }, 2800);
    },

    // ---------- panels ----------
    panelsOpen() {
      return $('#drawer').classList.contains('open') || !$('#typePop').hidden || !$('#notePop').hidden;
    },
    closePanels() {
      $('#notePop').hidden = true;
      $('#drawer').classList.remove('open');
      $('#scrim').classList.remove('on');
      $('#typePop').hidden = true;
      $('#rType').classList.remove('is-on');
      $('#rToc').classList.remove('is-on');
    },
    toggleDrawer(tab) {
      const open = !$('#drawer').classList.contains('open') || (tab && tab !== this.activeTab);
      $('#typePop').hidden = true;
      $('#rType').classList.remove('is-on');
      if (tab) this.showTab(tab);
      $('#drawer').classList.toggle('open', open);
      $('#scrim').classList.toggle('on', open);
      $('#rToc').classList.toggle('is-on', open);
      if (open) $('.toc-item.is-current')?.scrollIntoView({ block: 'center' });
    },
    showTab(tab) {
      this.activeTab = tab;
      $$('.tab').forEach((t) => t.classList.toggle('is-active', t.dataset.tab === tab));
      $('#tocList').hidden = tab !== 'toc';
      $('#marksList').hidden = tab !== 'marks';
      $('#searchPanel').hidden = tab !== 'search';
      if (tab === 'search') setTimeout(() => $('#bookSearch').focus(), 50);
    },
    toggleType() {
      const pop = $('#typePop');
      const show = pop.hidden;
      this.closePanels();
      pop.hidden = !show;
      $('#rType').classList.toggle('is-on', show);
      if (show) this.renderTypePop();
    },

    renderToc() {
      const build = (items) =>
        items
          .map((it) => {
            const kids = it.subitems?.length ? `<ol>${build(it.subitems)}</ol>` : '';
            return `<li><button class="toc-item" data-id="${esc(it.aionId)}" data-href="${esc(it.href)}">${esc((it.label || '').trim() || 'Untitled')}</button>${kids}</li>`;
          })
          .join('');
      $('#tocList').innerHTML = this.toc.length
        ? build(this.toc)
        : `<div class="marks-empty">${divider()}This book has no table of contents.</div>`;
    },

    // ---------- bookmarks ----------
    cfiCmp(a, b) {
      try {
        return engine.CFI.compare(a, b);
      } catch (_) {
        return 0;
      }
    },
    bookmarksHere() {
      const rec = this.record;
      const start = this.startCfi();
      const end = this.endCfi();
      if (!rec || !start || !end) return [];
      return (rec.bookmarks || []).filter((bm) => {
        const at = engine.CFI.collapse(bm.cfi); // bookmarks may store a passage or a point
        return this.cfiCmp(at, start) >= 0 && this.cfiCmp(at, end) <= 0;
      });
    },
    updateBookmarkBtn() {
      const on = this.bookmarksHere().length > 0;
      const b = $('#rBookmark');
      b.classList.toggle('is-on', on);
      b.innerHTML = icon('bookmark', on ? 'filled' : '');
    },
    async toggleBookmark() {
      const rec = this.record;
      if (!rec || !this.loc) return;
      const here = this.bookmarksHere();
      let bookmarks = rec.bookmarks || [];
      if (here.length) {
        bookmarks = bookmarks.filter((bm) => !here.includes(bm));
        this.offerBookmarksBack(this.id, here);
      } else {
        bookmarks = [...bookmarks, { cfi: this.placeCfi(), chapter: this.chapter, progress: this.progress, createdAt: Date.now() }];
        toast('Page bookmarked', 1600);
      }
      await updateBook(this.id, { bookmarks }, { quiet: true });
      this.updateBookmarkBtn();
      this.renderMarks();
    },

    // ---------- highlights ----------
    // Where a range in a book document sits on screen.
    rectOf(range) {
      try {
        const r = range.getBoundingClientRect();
        const f = range.startContainer.ownerDocument.defaultView.frameElement.getBoundingClientRect();
        return { left: f.left + r.left, top: f.top + r.top, right: f.left + r.right, bottom: f.top + r.bottom, width: r.width, height: r.height };
      } catch (_) {
        return null;
      }
    },
    onSelected(doc, index) {
      const sel = doc.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount || !sel.toString().trim()) return;
      const range = sel.getRangeAt(0);
      const rect = this.rectOf(range);
      if (!rect) return;
      const bar = $('#selBar');
      const x = Math.max(140, Math.min(innerWidth - 140, rect.left + rect.width / 2));
      let y = rect.top - 12;
      bar.style.transform = 'translate(-50%, -100%)';
      if (y < 110) {
        y = rect.bottom + 12;
        bar.style.transform = 'translate(-50%, 0)';
      }
      bar.style.left = `${x}px`;
      bar.style.top = `${y}px`;
      bar.hidden = false;
      this.pendingSel = { cfiRange: this.view.getCFI(index, range), doc, text: sel.toString() };
    },
    hideSel() {
      $('#selBar').hidden = true;
      this.pendingSel = null;
    },
    hlStyle(color) {
      const dark = State.settings.theme === 'dusk';
      const c = HL[color] || HL.rose;
      return { fill: dark ? c.dark : c.light, opacity: dark ? c.opacity.dark : c.opacity.light };
    },
    // Draw saved highlights belonging to the chapter that was just laid out.
    drawHighlightsFor(index) {
      for (const h of this.record?.highlights || []) {
        try {
          if (this.view.resolveNavigation(h.cfi)?.index === index) this.view.addAnnotation({ value: h.cfi });
        } catch (_) {}
      }
    },
    applyHighlights() {
      for (const { index } of this.contents()) {
        for (const h of this.record?.highlights || []) {
          try {
            if (this.view.resolveNavigation(h.cfi)?.index !== index) continue;
            this.view.deleteAnnotation({ value: h.cfi });
            this.view.addAnnotation({ value: h.cfi });
          } catch (_) {}
        }
      }
    },
    async addHighlight(color, note = '') {
      const sel = this.pendingSel;
      if (!sel) return;
      const rec = this.record;
      const text = (sel.text || '').replace(/\s+/g, ' ').trim();
      const h = { cfi: sel.cfiRange, text, color, note, chapter: this.chapter, createdAt: Date.now() };
      try {
        sel.doc.getSelection().removeAllRanges();
      } catch (_) {}
      this.hideSel();
      const highlights = [...(rec.highlights || []).filter((x) => x.cfi !== h.cfi), h];
      await updateBook(this.id, { highlights }, { quiet: true });
      this.view.addAnnotation({ value: h.cfi });
      this.renderMarks();
    },
    onHighlightClick(cfi, e) {
      const h = (this.record?.highlights || []).find((x) => x.cfi === cfi);
      if (!h) return;
      const x = e?.clientX ?? innerWidth / 2;
      const y = e?.clientY ?? innerHeight / 2;
      openMenu(x, y, [
        { label: h.note ? 'Edit note' : 'Add a note', icon: 'pen', run: () => this.editNote(cfi) },
        { label: 'Copy passage', icon: 'copy', run: () => this.copy(h.text) },
        ...Object.keys(HL)
          .filter((c) => c !== h.color)
          .map((c) => ({ label: `Make it ${c}`, icon: 'edit', run: () => this.recolor(cfi, c) })),
        '-',
        { label: 'Remove highlight', icon: 'trash', danger: true, run: () => this.removeHighlight(cfi) },
      ]);
    },
    async editNote(cfi) {
      const h = (this.record?.highlights || []).find((x) => x.cfi === cfi);
      if (!h) return;
      const note = await promptText({
        title: 'A note in the margin',
        sub: `“${esc(h.text.slice(0, 160))}${h.text.length > 160 ? '…' : ''}”`,
        value: h.note || '',
        placeholder: 'Write a thought…',
        multiline: true,
      });
      if (note == null) return;
      const highlights = this.record.highlights.map((x) => (x.cfi === cfi ? { ...x, note: note.trim() } : x));
      await updateBook(this.id, { highlights }, { quiet: true });
      this.renderMarks();
    },
    async recolor(cfi, color) {
      const highlights = this.record.highlights.map((x) => (x.cfi === cfi ? { ...x, color } : x));
      await updateBook(this.id, { highlights }, { quiet: true });
      this.view.deleteAnnotation({ value: cfi });
      this.view.addAnnotation({ value: cfi });
      this.renderMarks();
    },
    async removeHighlight(cfi) {
      const id = this.id;
      const gone = (this.record.highlights || []).find((x) => x.cfi === cfi);
      try {
        this.view?.deleteAnnotation({ value: cfi });
      } catch (_) {}
      const highlights = (this.record.highlights || []).filter((x) => x.cfi !== cfi);
      await updateBook(id, { highlights }, { quiet: true });
      this.renderMarks();
      if (gone) {
        window.UI.undoToast(gone.note ? 'Highlight and note removed' : 'Highlight removed', {
          undo: async () => {
            const rec = State.book(id);
            await updateBook(id, { highlights: [...(rec.highlights || []).filter((x) => x.cfi !== cfi), gone] }, { quiet: true });
            if (this.id === id) {
              this.view?.addAnnotation({ value: cfi });
              this.renderMarks();
            }
          },
        });
      }
    },
    async removeBookmark(cfi) {
      const id = this.id;
      const gone = (this.record.bookmarks || []).filter((x) => x.cfi === cfi);
      const bookmarks = (this.record.bookmarks || []).filter((x) => x.cfi !== cfi);
      await updateBook(id, { bookmarks }, { quiet: true });
      this.updateBookmarkBtn();
      this.renderMarks();
      if (gone.length) this.offerBookmarksBack(id, gone);
    },
    // "Bookmark removed · Undo"
    offerBookmarksBack(id, gone) {
      window.UI.undoToast('Bookmark removed', {
        undo: async () => {
          const rec = State.book(id);
          await updateBook(id, { bookmarks: [...(rec.bookmarks || []), ...gone] }, { quiet: true });
          if (this.id === id) {
            this.updateBookmarkBtn();
            this.renderMarks();
          }
        },
      });
    },
    copy(text) {
      navigator.clipboard.writeText(text || '').then(() => toast('Copied to clipboard', 1400));
    },

    renderMarks() {
      const rec = this.record;
      if (!rec) return;
      const sortByCfi = (a, b) => this.cfiCmp(a.cfi, b.cfi);
      const bms = [...(rec.bookmarks || [])].sort(sortByCfi);
      const hls = [...(rec.highlights || [])].sort(sortByCfi);
      if (!bms.length && !hls.length) {
        $('#marksList').innerHTML =
          `<div class="marks-empty">${divider()}No marks yet.<br>Select a passage to highlight it,<br>or press <b>B</b> to bookmark a page.</div>`;
        return;
      }
      const x = `<span class="x" role="button" title="Remove">${icon('close')}</span>`;
      let html = '';
      if (bms.length) {
        html += `<div class="marks-group"><h4>Bookmarks</h4>${bms
          .map(
            (b) =>
              `<button class="mark" data-kind="bm" data-cfi="${esc(b.cfi)}"><div class="bm">${icon('bookmark')}${esc(
                b.chapter || 'Bookmark'
              )}</div><div class="where">${pct(b.progress)} through · ${new Date(b.createdAt).toLocaleDateString()}</div>${x}</button>`
          )
          .join('')}</div>`;
      }
      if (hls.length) {
        html += `<div class="marks-group"><h4>Highlights</h4>${hls
          .map(
            (h) =>
              `<button class="mark" data-kind="hl" data-cfi="${esc(h.cfi)}" style="--hl:${(HL[h.color] || HL.rose).light}"><div class="quote">${esc(
                h.text
              )}</div>${h.note ? `<div class="note">${esc(h.note)}</div>` : ''}<div class="where">${esc(h.chapter || '')}</div>${x}</button>`
          )
          .join('')}</div>`;
      }
      $('#marksList').innerHTML = html;
    },

    // ---------- typography popover ----------
    renderTypePop() {
      const s = State.settings;
      $('#fontSizeVal').textContent = `${s.fontSize}%`;
      const chips = (list, val) =>
        list.map(([v, label]) => `<button class="chip ${String(v) === String(val) ? 'is-on' : ''}" data-v="${esc(v)}">${esc(label)}</button>`).join('');
      $('#fontChips').innerHTML = chips(Fonts.choices(), s.fontFamily);
      $$('#fontChips .chip').forEach((c) => {
        if (c.dataset.v !== 'Original') c.style.fontFamily = `'${c.dataset.v}', serif`;
      });
      $('#lhChips').innerHTML = chips(LINE_HEIGHTS, s.lineHeight);
      $('#marginChips').innerHTML = chips(MARGINS, s.margin);
      $('#layoutChips').innerHTML = chips(LAYOUTS, s.layout);
      $('#themeSwatches').innerHTML = Object.entries(THEMES)
        .map(([k, t]) => `<button class="swatch ${s.theme === k ? 'is-on' : ''}" data-v="${k}"><i style="background:${t.swatch}"></i>${t.label}</button>`)
        .join('');
    },
    async change(patch) {
      await setSettings(patch);
      this.renderTypePop();
      if (!this.view) return;
      if ('layout' in patch || 'margin' in patch || 'runningHeads' in patch) this.applyLayout();
      if ('bookEdges' in patch) this.renderEdges();
      this.applyStyles();
      if (patch.theme) this.applyHighlights();
    },
    stepFont(dir) {
      const size = Math.max(70, Math.min(200, (State.settings.fontSize || 100) + dir * 6));
      this.change({ fontSize: size });
    },

    bind() {
      loadEngine(); // start fetching the engine before the first book is opened
      State.on(() => {
        if (State.books.some((b) => b.needsMeta)) this.fillMissingMeta();
      });
      $('#rBack').innerHTML = icon('back');
      $('#rToc').innerHTML = icon('toc');
      $('#rType').innerHTML = icon('type');
      $('#rFull').innerHTML = icon('expand');
      $('#rPrev').innerHTML = icon('prev');
      $('#rNext').innerHTML = icon('next');
      $('#loadingBloom').innerHTML = bloom();
      this.updateBookmarkBtn();

      $('#rBack').onclick = () => this.close();
      $('#rToc').onclick = () => this.toggleDrawer();
      $('#rType').onclick = () => this.toggleType();
      $('#rFull').onclick = () => window.aion.toggleFullscreen();
      $('#rBookmark').onclick = () => this.toggleBookmark();
      $('#rPrev').onclick = () => this.prev();
      $('#rNext').onclick = () => this.next();
      $('#scrim').onclick = () => this.closePanels();
      $('#moreSettings').onclick = () => window.Library.openSettings();

      $$('.tab').forEach((t) => (t.onclick = () => this.showTab(t.dataset.tab)));
      this.showTab('toc');

      $('#tocList').addEventListener('click', (e) => {
        const b = e.target.closest('.toc-item');
        if (b) this.goTo(b.dataset.href);
      });
      $('#marksList').addEventListener('click', (e) => {
        const m = e.target.closest('.mark');
        if (!m) return;
        if (e.target.closest('.x')) {
          m.dataset.kind === 'bm' ? this.removeBookmark(m.dataset.cfi) : this.removeHighlight(m.dataset.cfi);
          return;
        }
        this.goTo(m.dataset.cfi);
      });

      const range = $('#rProgress');
      range.addEventListener('input', () => {
        range.style.setProperty('--p', `${range.value / 10}%`);
        $('#rPercent').textContent = `${Math.round(range.value / 10)}%`;
      });
      range.addEventListener('change', () => this.view?.goToFraction(range.value / 1000));

      $('#fontDown').onclick = () => this.stepFont(-1);
      $('#fontUp').onclick = () => this.stepFont(1);
      $('#fontChips').onclick = (e) => {
        const c = e.target.closest('.chip');
        if (c) this.change({ fontFamily: c.dataset.v });
      };
      $('#lhChips').onclick = (e) => {
        const c = e.target.closest('.chip');
        if (c) this.change({ lineHeight: Number(c.dataset.v) });
      };
      $('#marginChips').onclick = (e) => {
        const c = e.target.closest('.chip');
        if (c) this.change({ margin: c.dataset.v });
      };
      $('#layoutChips').onclick = (e) => {
        const c = e.target.closest('.chip');
        if (c) this.change({ layout: c.dataset.v });
      };
      $('#themeSwatches').onclick = (e) => {
        const c = e.target.closest('.swatch');
        if (c) this.change({ theme: c.dataset.v });
      };

      $('#selBar').addEventListener('mousedown', (e) => e.preventDefault());
      $('#selBar').addEventListener('click', (e) => {
        const dot = e.target.closest('.hl-dot');
        const act = e.target.closest('.sel-btn')?.dataset.act;
        if (dot) this.addHighlight(dot.dataset.color);
        else if (act === 'who') {
          this.whoIsThis(this.pendingSel);
        } else if (act === 'define') {
          this.define(this.pendingSel);
        } else if (act === 'copy') {
          this.copy(this.pendingSel?.text);
          this.hideSel();
        } else if (act === 'note') {
          const sel = this.pendingSel;
          promptText({
            title: 'A note in the margin',
            sub: `“${esc((sel?.text || '').slice(0, 160))}”`,
            placeholder: 'Write a thought…',
            multiline: true,
          }).then((note) => {
            if (note == null) return;
            this.pendingSel = sel;
            this.addHighlight('rose', note.trim());
          });
        }
      });

      document.addEventListener('keydown', (e) => this.onKey(e));
      this.bindExtras();
      $('#reader').addEventListener('mousemove', () => this.poke());
      $('#stage').addEventListener('wheel', (e) => this.onWheel(e), { passive: true });
      let rt;
      window.addEventListener('resize', () => {
        clearTimeout(rt);
        rt = setTimeout(() => this.onResize(), 150);
        this.hideSel();
      });
      window.addEventListener('beforeunload', () => {
        this.trackStop();
        this.flushSave();
      });
      Fonts.listeners.add(() => {
        if (this.view) this.applyStyles();
        if (!$('#typePop').hidden) this.renderTypePop();
      });
    },
  };

  Reader.engine = engine;
  Reader.bookFile = bookFile;
  window.Reader = Reader;
})();
