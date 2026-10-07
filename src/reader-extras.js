// Reader extras: search inside the book, time-left estimates, running heads and
// page numbers, daily goal, footnote pop-ups, dictionary look-up, tap-to-turn
// and read-aloud. Built on the foliate-js view set up in reader.js.
(function () {
  const { $, esc, State, toast, pct, setSettings } = window.UI;
  const { icon } = window.Ornaments;
  const R = window.Reader;

  const DEFAULT_MS_PER_LOC = 60000; // ~250 words a minute for a 1,500-byte location
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const dayKey = (d = new Date()) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  // "Harry Potter and the Philosopher's Stone: Illustrated [Kindle in Motion] (…)" → "Harry Potter and the Philosopher's Stone"
  const shortTitle = (t) => t.replace(/\s*[[(][^\])]*[\])]/g, '').split(/\s*[:|]\s+/)[0].trim() || t;

  function fmtLeft(ms) {
    const m = Math.round(ms / 60000);
    if (m < 1) return 'under a minute';
    if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60);
    const mm = m % 60;
    return mm ? `${h} h ${mm} min` : `${h} h`;
  }

  const _next = R.next;
  const _prev = R.prev;

  Object.assign(R, {
    // ---------- lifecycle ----------
    async afterOpen() {
      this.prevLoc = null;
      this.chapterEnds = new Map();
      $('#bookSearch').value = '';
      $('#searchResults').innerHTML = '';
      $('#searchStatus').textContent = '';
      const st = await window.aion.getStats();
      const sp = st.speed;
      this.speed = sp && sp.locs >= 15 ? clamp(sp.ms / sp.locs, 12000, 240000) : DEFAULT_MS_PER_LOC;
      this.todayKey = st.today;
      this.todayMs = st.days[st.today]?.ms || 0;
      if (this.loc) $('#rPercent').textContent = this.footerText(this.loc);
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
      if (this.tts?.playing && !this.tts.paused) this.ttsRestartAfterMove = true;
    },

    // ---------- time left ----------
    // foliate measures the book in "locations" of ~1,500 bytes, straight from
    // the file sizes — no need to lay the whole book out first.
    footerText(detail) {
      const p = pct(this.progress);
      if (this.atEnd()) return `The end · ${p}`;
      const loc = detail.location;
      const show = State.settings.footerInfo || 'time';
      if (show === 'percent' || !loc?.total) return p;
      const end = this.chapterEndFraction(detail);
      if (show === 'pages') {
        const perBook = this.pagesPerBook(detail);
        if (!perBook || end == null) return p;
        const left = Math.max(0, Math.round((end - this.hereFraction(detail)) * perBook));
        return left <= 1 ? `Last page in chapter · ${p}` : `${left} pages left in chapter · ${p}`;
      }
      const speed = this.speed || DEFAULT_MS_PER_LOC;
      const parts = [];
      if (end != null) parts.push(`${fmtLeft(Math.max(0, end * loc.total - loc.current) * speed)} left in chapter`);
      parts.push(`${fmtLeft(Math.max(0, loc.total - loc.current) * speed)} in book`);
      return `${parts.join(' · ')} · ${p}`;
    },

    // Where the next contents entry begins, as a fraction of the whole book —
    // the first one after where we are (so a cover or title page still counts
    // down to chapter one).
    chapterEndFraction(detail) {
      const id = detail.tocItem?.aionId;
      const from = id != null ? this.flatToc.findIndex((t) => t.id === id) + 1 : 0;
      for (let i = Math.max(0, from); i < this.flatToc.length; i++) {
        const f = this.tocFraction(this.flatToc[i], detail);
        if (f != null && f > this.hereFraction(detail) + 1e-6) return f;
      }
      return 1;
    },

    // Where we are, kept inside the file on screen: on a chapter's last spread
    // the engine can report the very start of the next file, which would make
    // the countdown skip ahead a chapter.
    hereFraction(detail) {
      const f = detail.fraction ?? 0;
      const sf = this.view?.getSectionFractions?.();
      const next = sf?.[(detail.section?.current ?? -2) + 1];
      return next != null ? Math.min(f, next - 1e-5) : f;
    },

    // A contents entry's position in the book: its file's start, or for an
    // anchor inside the file on screen, how far into that file it sits.
    tocFraction(item, detail) {
      this.chapterEnds ||= new Map();
      if (this.chapterEnds.has(item.id)) return this.chapterEnds.get(item.id);
      let frac = null;
      let exact = false;
      try {
        const { index, anchor } = this.view.resolveNavigation(item.href) || {};
        const sf = this.view.getSectionFractions();
        if (index == null) return null;
        const doc = index === detail.section?.current ? this.contents().find((c) => c.index === index)?.doc : null;
        const target = doc && anchor?.(doc);
        if (target) {
          const range = doc.createRange();
          range.setStart(doc.body, 0);
          if (target instanceof Range) range.setEnd(target.startContainer, target.startOffset);
          else range.setEndBefore(target);
          const within = range.toString().length / Math.max(1, doc.body.textContent.length);
          frac = sf[index] + within * (sf[index + 1] - sf[index]);
          exact = true;
        } else if (!doc) {
          frac = sf[index]; // another file: its start (good enough for an estimate)
          exact = !item.href.includes('#'); // exact when the entry is the start of that file
        }
      } catch (_) {
        frac = null;
      }
      // Remember exact positions; approximate ones are worked out again once that file is on screen.
      if (frac != null && exact) this.chapterEnds.set(item.id, frac);
      return frac;
    },

    // ---------- running heads & page numbers ----------
    // The paginator gives each column a head and a foot. Page numbers count
    // columns; whole-book numbers are estimated from this chapter's page count
    // and its share of the book's size (they shift if you resize the text).
    // Roughly how many printed pages (columns) the whole book would fill,
    // judged from the section on screen at the current size and layout.
    pagesPerBook(detail) {
      const r = this.renderer;
      const idx = detail.section?.current ?? 0;
      const sf = this.view?.getSectionFractions?.();
      if (!r?.pages || !sf) return null;
      const share = sf[idx + 1] - sf[idx];
      const cols = r.heads?.length || 1;
      return share > 0 ? (Math.max(1, r.pages - 2) * cols) / share : null;
    },

    // ---------- the page as a physical thing ----------
    // Where the page is on screen: its outer edges sit a little outside the
    // text, and for two pages, the spine runs down the middle of the gap.
    pageBox() {
      const stage = $('#stage').getBoundingClientRect();
      const wrap = $('.viewer-wrap').getBoundingClientRect();
      const cols = [...(this.renderer?.heads || [])].map((h) => h.getBoundingClientRect()).filter((r) => r.width > 0);
      const PAD = 44;
      let left = wrap.left;
      let right = wrap.right;
      let spine = null;
      if (cols.length) {
        left = Math.max(stage.left + 20, Math.min(...cols.map((r) => r.left)) - PAD);
        right = Math.min(stage.right - 20, Math.max(...cols.map((r) => r.right)) + PAD);
        if (cols.length > 1) spine = (cols[0].right + cols[1].left) / 2;
      }
      return { left, right, top: stage.top, bottom: stage.bottom, spine };
    },

    // A stack of page edges either side: the pages you've read on the left,
    // the pages to come on the right, thicker for a longer book.
    renderEdges() {
      const L = $('#edgeL');
      const R = $('#edgeR');
      const total = this.loc?.location?.total;
      const on = State.settings.bookEdges !== false && !!this.view && !!total && State.settings.layout !== 'scroll';
      L.classList.toggle('is-on', on);
      R.classList.toggle('is-on', on);
      if (!on) return;
      const box = this.pageBox();
      const stage = $('#stage').getBoundingClientRect();
      const thick = Math.max(7, Math.min(18, 5 + total / 30));
      const f = Math.max(0, Math.min(1, this.progress || 0));
      const read = Math.round(thick * f * 2) / 2;
      const ahead = Math.round(thick * (1 - f) * 2) / 2;
      Object.assign(L.style, { left: `${box.left - stage.left - read}px`, width: `${read}px` });
      Object.assign(R.style, { left: `${box.right - stage.left}px`, width: `${ahead}px` });
      L.hidden = read < 1;
      R.hidden = ahead < 1;
    },

    renderRunning(detail) {
      const r = this.renderer;
      const heads = r?.heads;
      const feet = r?.feet;
      if (!heads || !feet) return;
      if (State.settings.runningHeads === false) {
        [...heads, ...feet].forEach((el) => (el.textContent = ''));
        return;
      }
      const cols = heads.length;
      const title = shortTitle(this.record?.title || '');
      const chapter = this.chapter;

      let first = null;
      try {
        const idx = detail.section?.current ?? 0;
        const sf = this.view.getSectionFractions();
        const perBook = this.pagesPerBook(detail);
        if (perBook) first = Math.round(sf[idx] * perBook) + (r.page - 1) * cols + 1;
      } catch (_) {
        first = null;
      }

      for (let c = 0; c < cols; c++) {
        const n = first != null ? first + c : null;
        if (cols > 1) heads[c].textContent = c === 0 ? title : chapter || title;
        else heads[c].textContent = n != null && n % 2 === 0 ? title : chapter || title;
        feet[c].textContent = n != null ? String(n) : '';
      }
    },

    afterRelocate(detail) {
      const cur = detail.location?.current;
      if (typeof cur === 'number') {
        // Small forward steps are real reading; jumps (contents, search) aren't.
        if (this.prevLoc != null && this.track) {
          const d = cur - this.prevLoc;
          if (d > 0 && d <= 3) this.track.locs += d;
        }
        this.prevLoc = cur;
      }
      this.renderRunning(detail);
      this.renderEdges();
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
      this.view?.clearSearch();
      if (q.length < 2) {
        status.textContent = q ? 'Type at least two letters' : '';
        return;
      }
      if (!this.view) return;
      status.textContent = 'Searching…';
      let count = 0;
      const { Overlayer } = this.engine;
      // Outline every match in ochre as the results arrive.
      const opts = { query: q, draw: Overlayer.outline, drawOptions: { color: 'rgb(214,165,70)', width: 2, radius: 3 } };
      for await (const result of this.view.search(opts)) {
        if (token !== this.searchToken) return;
        if (result === 'done') break;
        if (!result.subitems) continue;
        let html = result.label ? `<li class="sr-chapter">${esc(result.label)}</li>` : '';
        for (const { cfi, excerpt } of result.subitems.slice(0, 60)) {
          const pre = (excerpt?.pre || '').replace(/\s+/g, ' ');
          const post = (excerpt?.post || '').replace(/\s+/g, ' ');
          html += `<li><button class="sr-hit" data-cfi="${esc(cfi)}">${esc(pre)}<mark>${esc(excerpt?.match || q)}</mark>${esc(post)}</button></li>`;
        }
        list.insertAdjacentHTML('beforeend', html);
        count += result.subitems.length;
        status.textContent = `${count} ${count === 1 ? 'match' : 'matches'}…`;
        if (count >= 500) break;
      }
      if (token === this.searchToken) {
        status.textContent = count ? `${count}${count >= 500 ? '+' : ''} ${count === 1 ? 'match' : 'matches'}` : `Nothing found for “${q}”`;
      }
    },

    goToHit(cfi) {
      this.closePanels();
      this.markJump();
      return this.view?.goTo(cfi);
    },

    // ---------- clicks inside the page: tap zones ----------
    extendDoc(doc) {
      doc.addEventListener('click', (e) => {
        if (e.target.closest?.('a[href]')) return;
        if (!State.settings.tapZones || State.settings.layout === 'scroll') return;
        const sel = doc.getSelection();
        if (sel && !sel.isCollapsed) return;
        const frame = doc.defaultView.frameElement.getBoundingClientRect();
        const wrap = $('.viewer-wrap').getBoundingClientRect();
        const rel = (frame.left + e.clientX - wrap.left) / wrap.width;
        if (rel < 0.3) this.prev();
        else if (rel > 0.7) this.next();
      });
    },

    // ---------- footnotes ----------
    isNoteRef(a) {
      const href = a.getAttribute('href') || '';
      if (!href.includes('#') || /^[a-z][a-z0-9+.-]*:/i.test(href)) return false;
      const type = `${a.getAttribute('epub:type') || a.getAttributeNS('http://www.idpf.org/2007/ops', 'type') || ''} ${a.getAttribute('role') || ''}`;
      if (/noteref/i.test(type)) return true;
      if (/backlink/i.test(type)) return false;
      const t = a.textContent.trim();
      return /^[\[(]?(\d{1,3}|[*†‡§¶])[\])]?$/.test(t) || (!!a.closest('sup') && t.length <= 4);
    },

    async showNote(a, href) {
      let target = null;
      try {
        const { index, anchor } = this.view.book.resolveHref(href) || {};
        if (index != null) {
          const doc = this.contents().find((c) => c.index === index)?.doc || (await this.view.book.sections[index].createDocument());
          const found = anchor?.(doc);
          target = found instanceof Range ? found.startContainer.parentElement : found;
        }
      } catch (_) {
        target = null;
      }
      if (!target) {
        this.markJump();
        this.view.goTo(href);
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
      const range = a.ownerDocument.createRange();
      range.selectNodeContents(a);
      const r = this.rectOf(range) || { left: innerWidth / 2, width: 0, top: innerHeight / 2, bottom: innerHeight / 2 };
      this.notePendingHref = href;
      this.showPop(
        r.left + r.width / 2,
        r.top,
        r.bottom,
        `<div class="np-label">Note</div><div class="np-body">${text.map((t) => `<p>${esc(t)}</p>`).join('')}</div>` +
          `<div class="np-actions"><button data-np="go">Go to the note</button></div>`
      );
    },

    // Shared floating card for notes and definitions.
    showPop(x, yTop, yBottom, html) {
      const pop = $('#notePop');
      pop.dataset.kind = ''; // the "Who is this?" card marks itself afterwards
      pop.classList.remove('wide');
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
      const c = this.contents()[0];
      if (!c || !this.loc) return;
      speechSynthesis.cancel();
      this.tts = { playing: true, paused: false };
      this.ttsLoad(c, this.loc.range?.startContainer || null);
      this.ttsUi();
      this.ttsNext();
    },

    ttsLoad({ doc, index }, startNode) {
      const t = this.tts;
      const blocks = [...doc.body.querySelectorAll('p,h1,h2,h3,h4,h5,h6,li,blockquote,dd,dt,figcaption,pre')].filter(
        (b) => b.textContent.trim() && !b.querySelector('p,li,blockquote,h1,h2,h3,h4,h5,h6,dd,dt')
      );
      let start = 0;
      if (startNode) {
        const i = blocks.findIndex((b) => b.contains(startNode) || startNode.compareDocumentPosition(b) & 4);
        start = i < 0 ? blocks.length : i;
      }
      Object.assign(t, { doc, index, blocks: blocks.slice(start), bi: 0, sentences: [], si: 0, block: null });
    },

    ttsLang() {
      const l = this.view?.book?.metadata?.language;
      return (Array.isArray(l) ? l[0] : l) || 'en';
    },

    ttsSentences(block) {
      const text = block.textContent;
      let segs;
      try {
        segs = [...new Intl.Segmenter(this.ttsLang(), { granularity: 'sentence' }).segment(text)];
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
      u.lang = v?.lang || this.ttsLang();
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
      this.ttsMark(null);
      const before = t.index;
      await this.renderer.nextSection();
      if (t !== this.tts || !t.playing) return;
      const c = this.contents()[0];
      if (!c || c.index === before) {
        this.ttsStop();
        toast('Reached the end of the book', 2000);
        return;
      }
      this.ttsLoad(c, null);
      this.ttsNext();
    },

    ttsMark(range) {
      const t = this.tts;
      const win = t?.doc?.defaultView;
      try {
        if (win?.CSS?.highlights) {
          if (range) win.CSS.highlights.set('aion-tts', new win.Highlight(range));
          else win.CSS.highlights.delete('aion-tts');
        }
      } catch (_) {}
      if (!range) return;
      // Keep the sentence being read on screen: turn the page once it runs past the end.
      const visible = this.loc?.range;
      let past = true;
      try {
        past = !visible || visible.comparePoint(range.startContainer, range.startOffset) === 1;
      } catch (_) {
        past = true;
      }
      if (past) this.renderer?.scrollToAnchor?.(range);
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
        t.doc?.defaultView?.CSS?.highlights?.delete('aion-tts');
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
        st = setTimeout(() => this.runSearch(e.target.value), 350);
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
          this.markJump();
          this.view?.goTo(this.notePendingHref);
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
