// The reading room: epub.js rendition, contents, bookmarks, highlights, settings.
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
  const MEASURE = {
    single: { narrow: 920, comfortable: 740, wide: 600 },
    spread: { narrow: 1560, comfortable: 1280, wide: 1080 },
  };

  let fontCss = '';
  window.aion.fontCss().then((css) => {
    fontCss = css;
    const s = document.createElement('style');
    s.textContent = css;
    document.head.appendChild(s);
  });

  const Reader = {
    id: null,
    book: null,
    rendition: null,
    loc: null,
    toc: [],
    flatToc: [],
    chapter: '',
    progress: 0,
    locationsReady: false,
    pendingSel: null,
    saveTimer: null,
    idleTimer: null,
    wheelLock: 0,
    spread: false,
    openToken: 0,

    get record() {
      return State.book(this.id);
    },

    // What's on screen, independent of the rendering engine. Used by the app tests.
    probe() {
      const loc = this.loc;
      let textPx = null;
      for (const c of this.rendition?.getContents?.() || []) {
        const p = [...c.document.querySelectorAll('p')].find((x) => x.textContent.trim().length > 40);
        if (p) {
          textPx = parseFloat(c.window.getComputedStyle(p).fontSize);
          break;
        }
      }
      const text = (id) => document.getElementById(id)?.textContent || '';
      return {
        open: !!this.book && $('#rLoading').classList.contains('gone'),
        bookId: this.id,
        position: this.anchorCfi || loc?.start?.cfi || null,
        fraction: this.progress,
        measured: this.locationsReady,
        chapter: this.chapter,
        textPx,
        heads: [text('rhLeft'), text('rhRight')],
        folios: [text('folioLeft'), text('folioRight')],
        footer: text('rPercent'),
      };
    },

    // ---------- open / close ----------
    async open(id) {
      const rec = State.book(id);
      if (!rec) return;
      if (this.book) await this.close({ silent: true });
      const token = ++this.openToken;
      this.id = id;
      this.locationsReady = false;
      this.progress = rec.progress || 0;

      $('#library').classList.remove('is-active');
      $('#reader').classList.add('is-active');
      $('#rTitle').textContent = rec.title;
      $('#rAuthor').textContent = rec.author;
      $('#rLoading').classList.remove('gone');
      $('#rChapter').textContent = '';
      $('#rPercent').textContent = '';
      this.setSlider(this.progress);
      $('#rProgress').disabled = true;
      this.closePanels();
      document.title = `${rec.title} — Aion Books`;
      $('#vineBR').innerHTML = '';

      try {
        const data = await window.aion.bookData(id);
        if (token !== this.openToken) return;
        const buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
        this.book = window.ePub(buf);
        await this.book.ready;
        const nav = await this.book.loaded.navigation;
        this.toc = nav.toc || [];
        this.flatToc = [];
        this.flatten(this.toc, 0);
        this.renderToc();

        await this.buildRendition(rec.location);
        if (token !== this.openToken) return;
        $('#rLoading').classList.add('gone');
        // Fresh vines each time, so they grow in around the page.
        $('#vineBR').innerHTML = readerSprig();
        updateBook(id, { lastOpenedAt: Date.now() }, { quiet: true });
        this.trackStart();
        this.afterOpen();
        this.prepareLocations(token);
        this.renderMarks();
        this.poke();
      } catch (err) {
        console.error(err);
        toast(`Couldn’t open this book — ${esc(err.message || err)}`, 4200);
        this.close({ silent: true });
      }
    },

    async close({ silent = false } = {}) {
      this.beforeClose();
      this.openToken++;
      this.trackStop();
      this.flushSave();
      this.closePanels();
      this.hideSel();
      this.destroyRendition();
      try {
        this.book?.destroy();
      } catch (_) {}
      this.anchorCfi = null;
      this.rendition = null;
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
        const sec = this.sectionFor(item.href);
        const frag = (item.href || '').split('#')[1] || '';
        // cfi is filled in when the chapter's file is laid out (see markTocAnchors).
        this.flatToc.push({ id: item.id, label: (item.label || '').trim(), href: item.href, depth, index: sec ? sec.index : -1, frag, cfi: null });
        if (item.subitems?.length) this.flatten(item.subitems, depth + 1);
      }
    },

    // Many books keep several chapters in one file, marked by anchors. Record where
    // each chapter heading sits so we can tell which chapter a page belongs to.
    markTocAnchors(contents) {
      for (const item of this.flatToc) {
        if (item.index !== contents.sectionIndex || !item.frag || item.cfi) continue;
        let el = null;
        try {
          el = contents.document.getElementById(decodeURIComponent(item.frag));
        } catch (_) {}
        if (!el) continue;
        try {
          item.cfi = contents.cfiFromNode(el);
        } catch (_) {}
      }
    },

    // The chapter (table-of-contents entry) a position belongs to.
    chapterAt(index, cfi) {
      let current = null;
      for (const item of this.flatToc) {
        if (item.index === -1 || item.index > index) continue;
        if (item.index === index && item.frag) {
          // An anchored chapter counts once we've reached its heading.
          if (!item.cfi || !cfi || this.cfiCmp(item.cfi, cfi) > 0) continue;
        }
        if (!current || item.index >= current.index) current = item;
      }
      return current;
    },

    // Where the chapter after the given position begins, as a location number.
    nextChapterLoc(index, cfi) {
      if (!this.locationsReady) return null;
      const L = this.book.locations;
      let best = null;
      for (const item of this.flatToc) {
        let at = null;
        if (item.index > index) at = this.locIndex?.get(item.index)?.start ?? null;
        else if (item.index === index && item.cfi && cfi && this.cfiCmp(item.cfi, cfi) > 0) at = L.locationFromCfi(item.cfi);
        if (typeof at === 'number' && at >= 0 && (best == null || at < best)) best = at;
      }
      return best;
    },

    sectionFor(href) {
      if (!href || !this.book) return null;
      const bare = href.split('#')[0];
      let sec = this.book.spine.get(bare);
      if (!sec) {
        const name = decodeURIComponent(bare.split('/').pop());
        sec = this.book.spine.spineItems.find((s) => decodeURIComponent(s.href).endsWith(name));
      }
      return sec || null;
    },

    // ---------- rendition ----------
    async buildRendition(target) {
      const s = State.settings;
      const scroll = s.layout === 'scroll';
      this.applyMeasure();
      $('#viewer').innerHTML = '';

      const r = this.book.renderTo('viewer', {
        width: '100%',
        height: '100%',
        flow: scroll ? 'scrolled' : 'paginated',
        manager: scroll ? 'continuous' : 'default',
        spread: this.spread ? 'auto' : 'none',
        minSpreadWidth: 700,
        allowScriptedContent: false,
      });
      this.rendition = r;

      r.hooks.content.register((contents) => this.onContents(contents));
      r.on('relocated', (loc) => this.onRelocated(loc));
      r.on('selected', (cfiRange, contents) => this.onSelected(cfiRange, contents));
      r.on('rendered', () => this.hideSel());

      try {
        await r.display(target || undefined);
      } catch (_) {
        await r.display();
      }
      this.applyHighlights();
    },

    onContents(contents) {
      const doc = contents.document;
      // Text size is applied at the root, so it reaches rem-, em- and %-based
      // sizes alike. Remember the book's own root size to scale from it.
      const base = parseFloat(contents.window.getComputedStyle(doc.documentElement).fontSize) || 16;
      doc.documentElement.dataset.aionBase = base;
      this.relativizeFontSizes(doc, base);
      const style = doc.createElement('style');
      style.id = 'aion-style';
      style.textContent = this.contentCss(base);
      doc.head.appendChild(style);
      this.markTocAnchors(contents);

      doc.addEventListener('keydown', (e) => this.onKey(e));
      doc.addEventListener('mousemove', () => this.poke());
      doc.addEventListener('wheel', (e) => this.onWheel(e), { passive: true });
      doc.addEventListener('mousedown', () => this.hideSel());
      doc.addEventListener('click', () => this.closePanels());
      // External links open in the browser.
      doc.addEventListener('click', (e) => {
        const a = e.target.closest?.('a[href]');
        if (a && /^https?:/i.test(a.getAttribute('href'))) {
          e.preventDefault();
          window.open(a.href);
        }
      });
      this.extendContents(contents);
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
        body img, body svg image { mix-blend-mode: ${t.blend}; ${s.theme === 'dusk' ? 'filter: brightness(.85) sepia(.15);' : ''} }
        body hr { border-color: ${t.ink}33 !important; }
        ::selection { background: ${s.theme === 'dusk' ? 'rgba(205,120,110,.35)' : 'rgba(214,140,130,.35)'}; }
        ::highlight(aion-tts) { background-color: ${s.theme === 'dusk' ? 'rgba(140,165,110,.32)' : 'rgba(140,168,108,.32)'}; }
      `;
    },

    refreshStyles() {
      if (!this.rendition) return;
      for (const c of this.rendition.getContents()) {
        const el = c.document.getElementById('aion-style');
        const base = Number(c.document.documentElement.dataset.aionBase) || 16;
        if (el) el.textContent = this.contentCss(base);
      }
      const cfi = this.anchorCfi || this.loc?.start?.cfi;
      requestAnimationFrame(() => {
        if (!this.rendition) return;
        this.relayouting = true;
        try {
          this.rendition.resize();
        } catch (_) {}
        if (cfi) this.displayAnchored(cfi);
        else this.relayouting = false;
      });
    },

    // Re-show the reading anchor after a relayout, and make sure it's actually on
    // screen (epub.js can land a page early when columns shift).
    async displayAnchored(cfi) {
      if (!this.rendition || !cfi) return;
      this.relayouting = true;
      try {
        await this.rendition.display(cfi);
        for (let i = 0; i < 3; i++) {
          await new Promise((r) => setTimeout(r, 80));
          const end = this.loc?.end?.cfi;
          if (!end || this.cfiCmp(end, cfi) >= 0 || this.loc.atEnd) break;
          await this.rendition.next();
        }
      } finally {
        setTimeout(() => (this.relayouting = false), 120);
      }
    },

    // Tear a rendition down without its in-flight hooks firing afterwards.
    destroyRendition() {
      const r = this.rendition;
      if (!r) return;
      try {
        for (const h of Object.values(r.hooks || {})) if (Array.isArray(h?.hooks)) h.hooks.length = 0;
      } catch (_) {}
      try {
        r.destroy();
      } catch (_) {}
    },

    applyMeasure() {
      const s = State.settings;
      const stage = $('#stage');
      const wide = stage.clientWidth || innerWidth;
      this.spread = s.layout === 'auto' && wide >= 1100;
      const m = (this.spread ? MEASURE.spread : MEASURE.single)[s.margin] || 740;
      // epub.js paginates by whole pixels; an even integer width keeps columns from drifting.
      const w = Math.floor(Math.min(wide - 150, m) / 2) * 2;
      $('.viewer-wrap').style.setProperty('--measure', `${w}px`);
      $('#reader').classList.toggle('spread', this.spread);
      $('#reader').classList.toggle('scroll', s.layout === 'scroll');
      // Must be set before epub.js measures the page: it reserves the head and foot space.
      $('#reader').classList.toggle('has-folios', s.runningHeads !== false && s.layout !== 'scroll');
    },

    onResize() {
      if (!this.rendition) return;
      this.relayouting = true;
      clearTimeout(this.relayoutTimer);
      this.relayoutTimer = setTimeout(() => (this.relayouting = false), 600);
      const was = this.spread;
      this.applyMeasure();
      if (was !== this.spread && State.settings.layout !== 'scroll') {
        this.rendition.spread(this.spread ? 'auto' : 'none', 700);
      }
      try {
        this.rendition.resize();
      } catch (_) {}
    },

    // ---------- locations / progress ----------
    async prepareLocations(token) {
      const cached = await window.aion.getLocations(this.id);
      if (token !== this.openToken || !this.book) return;
      if (cached) {
        try {
          this.book.locations.load(cached);
          this.markLocationsReady();
          return;
        } catch (_) {}
      }
      $('#rProgress').title = 'Measuring the book…';
      const id = this.id;
      const book = this.book;
      await book.locations.generate(1200);
      if (token !== this.openToken) return;
      window.aion.saveLocations(id, book.locations.save());
      this.markLocationsReady();
    },

    markLocationsReady() {
      this.locationsReady = true;
      this.onLocationsReady();
      $('#rProgress').disabled = false;
      $('#rProgress').title = '';
      if (this.loc) this.onRelocated(this.loc);
    },

    onRelocated(loc) {
      this.loc = loc;
      // The reading anchor only moves when the reader moves — not when a relayout
      // re-paginates around it — so layout and font changes never creep backwards.
      if (!this.relayouting) this.anchorCfi = loc.start.cfi;
      this.hideSel();
      if (this.turnDir) {
        this.shuffle(this.turnDir);
        if (this.track) {
          this.track.pages++;
          this.track.active = Date.now();
        }
        this.turnDir = 0;
      }
      const cfi = loc.start.cfi;
      if (this.locationsReady) {
        const p = this.book.locations.percentageFromCfi(cfi);
        if (typeof p === 'number' && !Number.isNaN(p)) this.progress = loc.atEnd ? 1 : p;
      }
      this.setSlider(this.progress);

      // chapter
      const current = this.chapterAt(loc.start.index, loc.start.cfi);
      this.chapter = current?.label || '';
      $('#rChapter').textContent = this.chapter;
      $$('.toc-item').forEach((el) => el.classList.toggle('is-current', !!current && el.dataset.id === String(current.id)));

      const d = loc.start.displayed;
      const left = d && d.total ? d.total - d.page : null;
      const leftTxt =
        State.settings.layout !== 'scroll' && State.settings.pagesLeft !== false && left != null
          ? left === 0
            ? 'last page in chapter · '
            : `${left} page${left === 1 ? '' : 's'} left in chapter · `
          : '';
      $('#rPercent').textContent = this.footerText(loc, leftTxt);

      this.updateBookmarkBtn();
      this.queueSave(loc.atEnd);
      this.afterRelocate(loc);
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
        location: this.anchorCfi || this.loc.start.cfi,
        progress: this.progress,
        chapter: this.chapter,
        lastOpenedAt: Date.now(),
      };
      if (atEnd && this.locationsReady && rec && !rec.finished) {
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
      this.turnDir = 1;
      this.rendition?.next();
    },
    prev() {
      this.turnDir = -1;
      this.rendition?.prev();
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
      this.rendition?.display(target);
    },

    onWheel(e) {
      if (!this.rendition || State.settings.layout === 'scroll' || State.settings.wheelTurns === false) return;
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
        if (!this.panelsOpen() && this.book) r.classList.add('idle');
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
            return `<li><button class="toc-item" data-id="${esc(it.id)}" data-href="${esc(it.href)}">${esc((it.label || '').trim() || 'Untitled')}</button>${kids}</li>`;
          })
          .join('');
      $('#tocList').innerHTML = this.toc.length
        ? build(this.toc)
        : `<div class="marks-empty">${divider()}This book has no table of contents.</div>`;
    },

    // ---------- bookmarks ----------
    cfiCmp(a, b) {
      try {
        return new window.ePub.CFI().compare(a, b);
      } catch (_) {
        return 0;
      }
    },
    bookmarksHere() {
      const rec = this.record;
      if (!rec || !this.loc) return [];
      const { start, end } = this.loc;
      return (rec.bookmarks || []).filter(
        (bm) => this.cfiCmp(bm.cfi, start.cfi) >= 0 && this.cfiCmp(bm.cfi, end.cfi) <= 0
      );
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
        toast('Bookmark removed', 1600);
      } else {
        bookmarks = [...bookmarks, { cfi: this.loc.start.cfi, chapter: this.chapter, progress: this.progress, createdAt: Date.now() }];
        toast('Page bookmarked', 1600);
      }
      await updateBook(this.id, { bookmarks }, { quiet: true });
      this.updateBookmarkBtn();
      this.renderMarks();
    },

    // ---------- highlights ----------
    onSelected(cfiRange, contents) {
      const sel = contents.window.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount) return;
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      const frame = contents.document.defaultView.frameElement.getBoundingClientRect();
      const bar = $('#selBar');
      const x = Math.max(140, Math.min(innerWidth - 140, frame.left + rect.left + rect.width / 2));
      let y = frame.top + rect.top - 12;
      bar.style.transform = 'translate(-50%, -100%)';
      if (y < 110) {
        y = frame.top + rect.bottom + 12;
        bar.style.transform = 'translate(-50%, 0)';
      }
      bar.style.left = `${x}px`;
      bar.style.top = `${y}px`;
      bar.hidden = false;
      this.pendingSel = { cfiRange, contents, text: sel.toString() };
    },
    hideSel() {
      $('#selBar').hidden = true;
      this.pendingSel = null;
    },
    hlStyle(color) {
      const dark = State.settings.theme === 'dusk';
      const c = HL[color] || HL.rose;
      return {
        fill: dark ? c.dark : c.light,
        'fill-opacity': String(dark ? c.opacity.dark : c.opacity.light),
        'mix-blend-mode': dark ? 'screen' : 'multiply',
      };
    },
    applyHighlights() {
      if (!this.rendition) return;
      for (const h of this.record?.highlights || []) {
        try {
          this.rendition.annotations.remove(h.cfi, 'highlight');
        } catch (_) {}
        try {
          this.rendition.annotations.highlight(h.cfi, { cfi: h.cfi }, (e) => this.onHighlightClick(h.cfi, e), 'aion-hl', this.hlStyle(h.color));
        } catch (_) {}
      }
    },
    async addHighlight(color, note = '') {
      const sel = this.pendingSel;
      if (!sel) return;
      const rec = this.record;
      const text = (sel.text || '').replace(/\s+/g, ' ').trim();
      const h = { cfi: sel.cfiRange, text, color, note, chapter: this.chapter, createdAt: Date.now() };
      try {
        sel.contents.window.getSelection().removeAllRanges();
      } catch (_) {}
      this.hideSel();
      const highlights = [...(rec.highlights || []).filter((x) => x.cfi !== h.cfi), h];
      await updateBook(this.id, { highlights }, { quiet: true });
      this.applyHighlights();
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
      this.applyHighlights();
      this.renderMarks();
    },
    async removeHighlight(cfi) {
      try {
        this.rendition?.annotations.remove(cfi, 'highlight');
      } catch (_) {}
      const highlights = (this.record.highlights || []).filter((x) => x.cfi !== cfi);
      await updateBook(this.id, { highlights }, { quiet: true });
      this.renderMarks();
    },
    async removeBookmark(cfi) {
      const bookmarks = (this.record.bookmarks || []).filter((x) => x.cfi !== cfi);
      await updateBook(this.id, { bookmarks }, { quiet: true });
      this.updateBookmarkBtn();
      this.renderMarks();
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
      const prev = { ...State.settings };
      await setSettings(patch);
      this.renderTypePop();
      if (!this.rendition) return;
      if (patch.layout && patch.layout !== prev.layout) {
        const cfi = this.anchorCfi || this.loc?.start?.cfi;
        this.relayouting = true;
        this.destroyRendition();
        await this.buildRendition(cfi);
        await this.displayAnchored(cfi);
        return;
      }
      if (patch.margin) {
        const was = this.spread;
        this.applyMeasure();
        if (was !== this.spread) this.rendition.spread(this.spread ? 'auto' : 'none', 700);
      }
      if (patch.theme) this.applyHighlights();
      this.refreshStyles();
    },
    stepFont(dir) {
      const size = Math.max(70, Math.min(200, (State.settings.fontSize || 100) + dir * 6));
      this.change({ fontSize: size });
    },

    bind() {
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
      range.addEventListener('change', () => {
        if (!this.locationsReady) return;
        const cfi = this.book.locations.cfiFromPercentage(range.value / 1000);
        if (cfi) this.rendition.display(cfi);
      });

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
        else if (act === 'define') {
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
        rt = setTimeout(() => this.onResize(), 120);
        this.hideSel();
      });
      window.addEventListener('beforeunload', () => {
        this.trackStop();
        this.flushSave();
      });
      Fonts.listeners.add(() => {
        if (this.rendition) this.refreshStyles();
        if (!$('#typePop').hidden) this.renderTypePop();
      });
    },
  };

  window.Reader = Reader;
})();
