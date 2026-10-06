// Reader extras: search inside the book, time-left estimates, daily goal,
// footnote pop-ups, dictionary look-up, tap-to-turn and read-aloud.
(function () {
  const { $, esc, State, toast, pct, setSettings } = window.UI;
  const { icon } = window.Ornaments;
  const R = window.Reader;

  const DEFAULT_MS_PER_LOC = 55000; // ~250 words a minute for 1,200 characters
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const dayKey = (d = new Date()) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  function fmtLeft(ms) {
    const m = Math.round(ms / 60000);
    if (m < 1) return 'under a minute';
    if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60);
    const mm = m % 60;
    return mm ? `${h} h ${mm} min` : `${h} h`;
  }

  // "Harry Potter and the Philosopher's Stone: Illustrated [Kindle in Motion] (…)" → "Harry Potter and the Philosopher's Stone"
  const shortTitle = (t) => t.replace(/\s*[[(][^\])]*[\])]/g, '').split(/\s*[:|]\s+/)[0].trim() || t;

  const _next = R.next;
  const _prev = R.prev;

  Object.assign(R, {
    // ---------- lifecycle ----------
    async afterOpen() {
      this.prevLoc = null;
      this.locIndex = null;
      this.searchMark = null;
      $('#bookSearch').value = '';
      $('#searchResults').innerHTML = '';
      $('#searchStatus').textContent = '';
      const st = await window.aion.getStats();
      const sp = st.speed;
      this.speed = sp && sp.locs >= 15 ? clamp(sp.ms / sp.locs, 12000, 240000) : DEFAULT_MS_PER_LOC;
      this.todayKey = st.today;
      this.todayMs = st.days[st.today]?.ms || 0;
      if (this.loc) $('#rPercent').textContent = this.footerText(this.loc, '');
    },

    beforeClose() {
      this.ttsStop();
      this.hideNote();
      this.searchToken = (this.searchToken || 0) + 1;
    },

    next() {
      this.userTurn();
      return _next.call(this);
    },
    prev() {
      this.userTurn();
      return _prev.call(this);
    },
    userTurn() {
      this.hideNote();
      this.clearSearchMark();
      if (this.tts?.playing && !this.tts.paused) this.ttsRestartAfterMove = true;
    },

    // ---------- time left ----------
    onLocationsReady() {
      const L = this.book.locations;
      const n = L.length();
      const map = new Map();
      for (let i = 0; i < n; i++) {
        let sp;
        try {
          sp = new window.ePub.CFI(L.cfiFromLocation(i)).spinePos;
        } catch (_) {
          continue;
        }
        const e = map.get(sp);
        if (e) e.end = i;
        else map.set(sp, { start: i, end: i });
      }
      this.locIndex = map;
      this.locTotal = n;
    },

    currentLoc(loc) {
      if (!this.locationsReady) return null;
      const cur = this.book.locations.locationFromCfi(loc.start.cfi);
      return typeof cur === 'number' && cur >= 0 ? cur : null;
    },

    footerText(loc, leftTxt) {
      const p = pct(this.progress);
      if (loc.atEnd) return `The end · ${p}`;
      const cur = this.currentLoc(loc);
      if (State.settings.timeLeft === false || cur == null || !this.locTotal) return `${leftTxt}${p}`;
      const speed = this.speed || DEFAULT_MS_PER_LOC;
      const sec = this.locIndex?.get(loc.start.index);
      const parts = [];
      // The chapter ends at the next contents entry — which may be an anchor in the same file.
      const chapterEnd = this.nextChapterLoc(loc.start.index, loc.start.cfi) ?? (sec ? sec.end + 1 : null);
      if (chapterEnd != null) parts.push(`${fmtLeft(Math.max(0, chapterEnd - cur) * speed)} left in chapter`);
      parts.push(`${fmtLeft(Math.max(0, this.locTotal - cur) * speed)} in book`);
      return `${parts.join(' · ')} · ${p}`;
    },

    // ---------- running heads & page numbers ----------
    // epub.js counts each column as a page: in a spread, start.page is the left
    // column and end.page the right. Whole-book numbers are estimated from the
    // book's length in locations at the current text size and layout.
    renderRunning(loc) {
      const L = $('#rhLeft');
      const Rt = $('#rhRight');
      const fL = $('#folioLeft');
      const fR = $('#folioRight');
      if (!$('#reader').classList.contains('has-folios') || !loc) return;
      const gap = this.rendition?.manager?.layout?.gap;
      if (gap) $('.viewer-wrap').style.setProperty('--col-gap', `${gap}px`);

      const title = shortTitle(this.record?.title || '');
      const chapter = this.chapter || '';
      // The right page shows the chapter that page belongs to (a new one may begin on it).
      const rightChapter = this.chapterAt(loc.end.index, loc.end.cfi)?.label || chapter;
      const leftCol = loc.start.displayed?.page || 1;
      const rightCol = loc.end.displayed?.page || leftCol;
      const cols = loc.start.displayed?.total || 1;
      const spread = this.spread;

      let leftNum = '';
      let rightNum = '';
      const sec = this.locIndex?.get(loc.start.index);
      if (sec && this.locTotal) {
        const perLoc = cols / (sec.end - sec.start + 1); // pages per location in this chapter
        const first = Math.round(sec.start * perLoc); // pages before this chapter
        leftNum = String(first + leftCol);
        if (spread && rightCol > leftCol && rightCol <= cols) rightNum = String(first + rightCol);
      }

      if (spread) {
        // Classic book: title on the left, chapter on the right; no head on a chapter's opening page.
        L.textContent = leftCol === 1 ? '' : title;
        Rt.textContent = rightNum ? rightChapter || title : '';
      } else {
        // One page at a time: alternate like a printed book's verso and recto.
        const n = Number(leftNum) || leftCol;
        L.textContent = leftCol === 1 ? '' : n % 2 === 0 ? title : chapter || title;
      }
      fL.textContent = leftNum;
      fR.textContent = rightNum;
    },

    afterRelocate(loc) {
      this.renderRunning(loc);
      const cur = this.currentLoc(loc);
      if (cur != null) {
        // Small forward steps are real reading; jumps (contents, search) aren't.
        if (this.prevLoc != null && this.track) {
          const d = cur - this.prevLoc;
          if (d > 0 && d <= 3) this.track.locs += d;
        }
        this.prevLoc = cur;
      }
      if (this.ttsRestartAfterMove) {
        this.ttsRestartAfterMove = false;
        this.ttsStop(true);
        this.ttsStart();
      }
    },

    // ---------- daily goal ----------
    onLogged(ms) {
      const key = dayKey();
      if (key !== this.todayKey) {
        this.todayKey = key;
        this.todayMs = 0;
      }
      const goal = (State.settings.dailyGoal || 0) * 60000;
      const before = this.todayMs || 0;
      this.todayMs = before + ms;
      window.Library?.refreshGoal(this.todayMs);
      if (goal && before < goal && this.todayMs >= goal) {
        toast(`Today’s goal reached — ${State.settings.dailyGoal} minutes of reading`, 3400);
        window.UI.burst(innerWidth / 2, innerHeight - 60);
      }
    },

    // ---------- search inside the book ----------
    openSearch() {
      if ($('#drawer').classList.contains('open') && this.activeTab === 'search') {
        $('#bookSearch').focus();
        $('#bookSearch').select();
      } else {
        this.toggleDrawer('search');
      }
    },

    async runSearch(raw) {
      const token = (this.searchToken = (this.searchToken || 0) + 1);
      const list = $('#searchResults');
      const status = $('#searchStatus');
      list.innerHTML = '';
      const q = raw.trim();
      if (q.length < 2) {
        status.textContent = q ? 'Type at least two letters' : '';
        return;
      }
      const book = this.book;
      if (!book) return;
      status.textContent = 'Searching…';
      const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      let count = 0;
      this.lastSearchChapter = null;
      for (const section of book.spine.spineItems) {
        if (token !== this.searchToken || book !== this.book) return;
        let hits = [];
        try {
          await section.load(book.load.bind(book));
          hits = section.find(q) || [];
        } catch (_) {
          hits = [];
        } finally {
          try {
            section.unload();
          } catch (_) {}
        }
        if (token !== this.searchToken) return;
        if (!hits.length) continue;
        let html = '';
        for (const h of hits.slice(0, 60)) {
          // Head each run of results with its chapter (books often keep several chapters per file).
          const chapter = this.chapterAt(section.index, h.cfi)?.label || '';
          if (chapter && chapter !== this.lastSearchChapter) html += `<li class="sr-chapter">${esc(chapter)}</li>`;
          this.lastSearchChapter = chapter;
          const ex = esc(h.excerpt.replace(/\s+/g, ' ').trim()).replace(rx, (m) => `<mark>${m}</mark>`);
          html += `<li><button class="sr-hit" data-cfi="${esc(h.cfi)}">${ex}</button></li>`;
        }
        list.insertAdjacentHTML('beforeend', html);
        count += hits.length;
        status.textContent = `${count} ${count === 1 ? 'match' : 'matches'}…`;
        if (count >= 500) break;
        await new Promise((r) => setTimeout(r)); // keep the UI responsive
      }
      if (token === this.searchToken) {
        status.textContent = count ? `${count}${count >= 500 ? '+' : ''} ${count === 1 ? 'match' : 'matches'}` : `Nothing found for “${q}”`;
      }
    },

    async goToHit(cfi) {
      this.closePanels();
      this.clearSearchMark();
      await this.rendition.display(cfi);
      try {
        this.rendition.annotations.highlight(cfi, {}, null, 'aion-search', {
          fill: 'rgb(226,178,84)',
          'fill-opacity': '0.5',
          'mix-blend-mode': State.settings.theme === 'dusk' ? 'screen' : 'multiply',
        });
        this.searchMark = cfi;
      } catch (_) {}
    },

    clearSearchMark() {
      if (this.searchMark && this.rendition) {
        try {
          this.rendition.annotations.remove(this.searchMark, 'highlight');
        } catch (_) {}
        // A user highlight at the same spot shares the key, so put those back.
        if ((this.record?.highlights || []).some((h) => h.cfi === this.searchMark)) this.applyHighlights();
      }
      this.searchMark = null;
    },

    // ---------- clicks inside the page: footnotes & tap zones ----------
    extendContents(contents) {
      const doc = contents.document;
      doc.addEventListener('click', (e) => this.onPageClick(e, contents), true);
      doc.addEventListener('mousedown', () => this.hideNote());
    },

    onPageClick(e, contents) {
      const a = e.target.closest?.('a[href]');
      if (a) {
        if (this.isNoteRef(a)) {
          e.preventDefault();
          e.stopPropagation();
          this.showNote(a, contents);
        }
        return;
      }
      if (!State.settings.tapZones || State.settings.layout === 'scroll') return;
      const sel = contents.window.getSelection();
      if (sel && !sel.isCollapsed) return;
      const frame = contents.document.defaultView.frameElement.getBoundingClientRect();
      const wrap = $('.viewer-wrap').getBoundingClientRect();
      const rel = (frame.left + e.clientX - wrap.left) / wrap.width;
      if (rel < 0.3) this.prev();
      else if (rel > 0.7) this.next();
    },

    isNoteRef(a) {
      const href = a.getAttribute('href') || '';
      if (!href.includes('#') || /^[a-z][a-z0-9+.-]*:/i.test(href)) return false;
      const type = `${a.getAttribute('epub:type') || a.getAttributeNS('http://www.idpf.org/2007/ops', 'type') || ''} ${a.getAttribute('role') || ''}`;
      if (/noteref/i.test(type)) return true;
      if (/backlink/i.test(type)) return false;
      const t = a.textContent.trim();
      return /^[\[(]?(\d{1,3}|[*†‡§¶])[\])]?$/.test(t) || (!!a.closest('sup') && t.length <= 4);
    },

    async showNote(a, contents) {
      const href = a.getAttribute('href');
      const [file, id] = href.split('#');
      let target = null;
      let goHref = href;
      try {
        if (!file) {
          target = contents.document.getElementById(id);
          const sec = this.book.spine.get(contents.sectionIndex);
          goHref = `${sec?.href || ''}#${id}`;
        } else {
          const base = this.book.spine.get(contents.sectionIndex)?.href || '';
          const resolved = decodeURIComponent(new URL(file, `https://book/${base}`).pathname.slice(1));
          const sec = this.book.spine.get(resolved) || this.sectionFor(resolved);
          if (sec) {
            goHref = `${sec.href}#${id}`;
            await sec.load(this.book.load.bind(this.book));
            target = sec.document?.getElementById(id) || null;
          }
        }
      } catch (_) {
        target = null;
      }
      if (!target) {
        this.rendition.display(goHref);
        return;
      }
      let block = target;
      if (/^(a|span|sup|sub|em|i|b|strong|small)$/i.test(block.tagName)) {
        block = block.closest('aside, li, p, div, section, dd, td, blockquote') || block.parentElement;
      }
      const clone = block.cloneNode(true);
      clone.querySelectorAll('a').forEach((x) => {
        const t = x.textContent.trim();
        const ty = x.getAttribute('epub:type') || x.getAttribute('role') || '';
        if (/backlink/i.test(ty) || /^(\[?\d{1,3}\]?\.?|↩︎?|↑|\^|back)$/i.test(t)) x.remove();
      });
      const paras = [...clone.querySelectorAll('p')].map((p) => p.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean);
      const text = paras.length ? paras : [clone.textContent.replace(/\s+/g, ' ').trim()];
      const r = a.getBoundingClientRect();
      const f = contents.document.defaultView.frameElement.getBoundingClientRect();
      this.notePendingHref = goHref;
      this.showPop(
        f.left + r.left + r.width / 2,
        f.top + r.top,
        f.top + r.bottom,
        `<div class="np-label">Note</div><div class="np-body">${text.map((t) => `<p>${esc(t)}</p>`).join('')}</div>` +
          `<div class="np-actions"><button data-np="go">Go to the note</button></div>`
      );
    },

    // Shared floating card for notes and definitions.
    showPop(x, yTop, yBottom, html) {
      const pop = $('#notePop');
      pop.innerHTML = html;
      pop.hidden = false;
      const w = pop.offsetWidth;
      const h = pop.offsetHeight;
      const left = clamp(x - w / 2, 16, innerWidth - w - 16);
      const above = yTop - h - 12;
      const top = above > 60 ? above : Math.min(yBottom + 12, innerHeight - h - 16);
      pop.style.left = `${left}px`;
      pop.style.top = `${top}px`;
    },
    hideNote() {
      const pop = $('#notePop');
      if (pop) pop.hidden = true;
    },

    // ---------- dictionary ----------
    async define(sel) {
      if (!sel) return;
      const bar = $('#selBar').getBoundingClientRect();
      const word = sel.text.trim().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
      this.hideSel();
      const x = bar.left + bar.width / 2;
      if (!word || word.split(/\s+/).length > 3) {
        this.showPop(x, bar.top, bar.bottom, `<div class="np-label">Dictionary</div><p class="np-muted">Select a single word to look it up.</p>`);
        return;
      }
      this.defineWord = word;
      this.showPop(x, bar.top, bar.bottom, `<div class="np-label">Dictionary</div><p class="np-muted">Looking up “${esc(word)}”…</p>`);
      const res = await window.aion.define(word);
      if (this.defineWord !== word || $('#notePop').hidden) return;
      const web = `<div class="np-actions"><button data-np="web">More on Wiktionary</button></div>`;
      let body;
      if (res.error) body = `<p class="np-muted">${esc(res.error)} — the dictionary needs an internet connection.</p>`;
      else if (!res.entries.length) body = `<p class="np-muted">No definition found for “${esc(word)}”.</p>`;
      else {
        const e = res.entries[0];
        body =
          `<div class="np-word">${esc(e.word)}${e.phonetic ? ` <span class="np-phon">${esc(e.phonetic)}</span>` : ''}</div>` +
          e.meanings
            .map(
              (m) =>
                `<div class="np-part">${esc(m.part)}</div><ol>${m.defs
                  .map((d) => `<li>${esc(d.text)}${d.example ? `<div class="np-ex">“${esc(d.example)}”</div>` : ''}</li>`)
                  .join('')}</ol>`
            )
            .join('');
      }
      this.showPop(x, bar.top, bar.bottom, `<div class="np-label">Dictionary</div><div class="np-body">${body}</div>${web}`);
    },

    // ---------- read aloud ----------
    ttsVoice() {
      const voices = window.speechSynthesis?.getVoices() || [];
      const want = State.settings.ttsVoice;
      return (want && voices.find((v) => v.name === want)) || null;
    },

    ttsToggle() {
      if (!this.tts?.playing) this.ttsStart();
      else if (this.tts.paused) this.ttsResume();
      else this.ttsPause();
    },

    ttsStart() {
      if (!window.speechSynthesis) {
        toast('Read aloud isn’t available on this computer', 2600);
        return;
      }
      if (!this.loc || !this.rendition) return;
      const all = this.rendition.getContents();
      const contents = all.find((c) => c.sectionIndex === this.loc.start.index) || all[0];
      if (!contents) return;
      let startNode = null;
      try {
        startNode = contents.range(this.loc.start.cfi).startContainer;
      } catch (_) {}
      speechSynthesis.cancel();
      this.tts = { playing: true, paused: false };
      this.ttsLoad(contents, startNode);
      this.ttsUi();
      this.ttsNext();
    },

    ttsLoad(contents, startNode) {
      const t = this.tts;
      const blocks = [...contents.document.body.querySelectorAll('p,h1,h2,h3,h4,h5,h6,li,blockquote,dd,dt,figcaption,pre')].filter(
        (b) => b.textContent.trim() && !b.querySelector('p,li,blockquote,h1,h2,h3,h4,h5,h6,dd,dt')
      );
      let start = 0;
      if (startNode) {
        const i = blocks.findIndex((b) => b.contains(startNode) || startNode.compareDocumentPosition(b) & 4);
        start = i < 0 ? blocks.length : i;
      }
      Object.assign(t, { contents, section: contents.sectionIndex, blocks: blocks.slice(start), bi: 0, sentences: [], si: 0, block: null });
    },

    ttsSentences(block) {
      const text = block.textContent;
      const lang = this.book?.packaging?.metadata?.language || 'en';
      let segs;
      try {
        segs = [...new Intl.Segmenter(lang, { granularity: 'sentence' }).segment(text)];
      } catch (_) {
        segs = [{ segment: text, index: 0 }];
      }
      return segs.filter((s) => s.segment.trim()).map((s) => ({ start: s.index, end: s.index + s.segment.length, text: s.segment.trim() }));
    },

    rangeFor(block, start, end) {
      const doc = block.ownerDocument;
      const walker = doc.createTreeWalker(block, 4);
      const range = doc.createRange();
      let pos = 0;
      let started = false;
      let node;
      while ((node = walker.nextNode())) {
        const len = node.textContent.length;
        if (!started && start <= pos + len) {
          range.setStart(node, Math.max(0, start - pos));
          started = true;
        }
        if (started && end <= pos + len) {
          range.setEnd(node, Math.max(0, end - pos));
          return range;
        }
        pos += len;
      }
      return started ? range : null;
    },

    ttsNext() {
      const t = this.tts;
      if (!t || !t.playing || t.paused) return;
      while (t.si >= t.sentences.length) {
        if (t.bi >= t.blocks.length) {
          this.ttsNextSection();
          return;
        }
        t.block = t.blocks[t.bi++];
        t.sentences = this.ttsSentences(t.block);
        t.si = 0;
      }
      const s = t.sentences[t.si++];
      this.ttsMark(this.rangeFor(t.block, s.start, s.end));
      const u = new SpeechSynthesisUtterance(s.text);
      const v = this.ttsVoice();
      if (v) u.voice = v;
      u.lang = v?.lang || this.book?.packaging?.metadata?.language || 'en';
      u.rate = State.settings.ttsRate || 1;
      u.onend = () => {
        if (t === this.tts && t.playing && !t.paused) this.ttsNext();
      };
      u.onerror = (e) => {
        if (t === this.tts && t.playing && !t.paused && !/interrupted|canceled/.test(e.error)) setTimeout(() => this.ttsNext(), 50);
      };
      t.utter = u; // keep a reference so it isn't garbage-collected mid-sentence
      speechSynthesis.speak(u);
    },

    async ttsNextSection() {
      const t = this.tts;
      const nextIdx = t.section + 1;
      const sec = this.book?.spine.get(nextIdx);
      if (!sec) {
        this.ttsStop();
        toast('Reached the end of the book', 2000);
        return;
      }
      this.ttsMark(null);
      await this.rendition.display(sec.href);
      if (t !== this.tts || !t.playing) return;
      const contents = this.rendition.getContents().find((c) => c.sectionIndex === nextIdx);
      if (!contents) {
        t.section = nextIdx;
        t.blocks = [];
        t.bi = 0;
        t.sentences = [];
        t.si = 0;
        return this.ttsNextSection();
      }
      this.ttsLoad(contents, null);
      this.ttsNext();
    },

    ttsMark(range) {
      const t = this.tts;
      const win = t?.contents?.window;
      try {
        if (win?.CSS?.highlights) {
          if (range) win.CSS.highlights.set('aion-tts', new win.Highlight(range));
          else win.CSS.highlights.delete('aion-tts');
        }
      } catch (_) {}
      if (!range) return;
      // Keep the sentence being read on screen.
      if (State.settings.layout === 'scroll') {
        range.startContainer.parentElement?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        return;
      }
      try {
        const cfi = t.contents.cfiFromRange(range);
        if (this.loc && this.cfiCmp(cfi, this.loc.end.cfi) > 0) this.rendition.display(cfi);
      } catch (_) {}
    },

    ttsPause() {
      const t = this.tts;
      if (!t) return;
      t.paused = true;
      t.si = Math.max(0, t.si - 1); // replay the interrupted sentence on resume
      speechSynthesis.cancel();
      this.ttsUi();
    },
    ttsResume() {
      const t = this.tts;
      if (!t) return;
      t.paused = false;
      this.ttsUi();
      this.ttsNext();
    },
    ttsStop(silent) {
      const t = this.tts;
      if (!t) return;
      t.playing = false;
      try {
        speechSynthesis.cancel();
      } catch (_) {}
      try {
        t.contents?.window?.CSS?.highlights?.delete('aion-tts');
      } catch (_) {}
      this.tts = null;
      if (!silent) this.ttsUi();
    },
    async ttsRate(delta) {
      const rate = Math.round(clamp((State.settings.ttsRate || 1) + delta, 0.6, 2) * 10) / 10;
      await setSettings({ ttsRate: rate });
      this.ttsUi();
      if (this.tts?.playing && !this.tts.paused) {
        this.ttsPause();
        this.ttsResume();
      }
    },
    ttsUi() {
      const t = this.tts;
      const on = !!t?.playing;
      $('#ttsBar').hidden = !on;
      $('#rListen').classList.toggle('is-on', on);
      $('#ttsPlay').innerHTML = icon(on && !t.paused ? 'pause' : 'play');
      $('#ttsPlay').title = on && !t.paused ? 'Pause (R)' : 'Resume (R)';
      $('#ttsRateVal').textContent = `${(State.settings.ttsRate || 1).toFixed(1)}×`;
    },

    bindExtras() {
      $('#rSearch').innerHTML = icon('search');
      $('#rListen').innerHTML = icon('speaker');
      $('#bookSearchIcon').outerHTML = icon('search');
      $('#ttsStop').innerHTML = icon('stop');
      this.ttsUi();
      $('#rSearch').onclick = () => this.openSearch();
      $('#rListen').onclick = () => this.ttsToggle();
      $('#ttsPlay').onclick = () => this.ttsToggle();
      $('#ttsStop').onclick = () => this.ttsStop();
      $('#ttsSlower').onclick = () => this.ttsRate(-0.1);
      $('#ttsFaster').onclick = () => this.ttsRate(0.1);
      window.speechSynthesis?.getVoices(); // warm up the voice list

      let st;
      $('#bookSearch').addEventListener('input', (e) => {
        clearTimeout(st);
        st = setTimeout(() => this.runSearch(e.target.value), 300);
      });
      $('#bookSearch').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          clearTimeout(st);
          this.runSearch(e.target.value);
        } else if (e.key === 'Escape') {
          this.closePanels();
        }
      });
      $('#searchResults').addEventListener('click', (e) => {
        const b = e.target.closest('.sr-hit');
        if (b) this.goToHit(b.dataset.cfi);
      });
      $('#notePop').addEventListener('click', (e) => {
        const act = e.target.closest('[data-np]')?.dataset.np;
        if (act === 'go') {
          this.hideNote();
          this.rendition?.display(this.notePendingHref);
        } else if (act === 'web') {
          window.aion.lookupWeb(this.defineWord);
        }
      });
      document.addEventListener('mousedown', (e) => {
        if (!e.target.closest('#notePop') && !e.target.closest('#selBar')) this.hideNote();
      });
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') this.hideNote();
      });
    },
  });
})();
