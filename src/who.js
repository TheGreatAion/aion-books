// "Who is this again?" Select a name and see where you've met them, from the
// pages you've already read: where they first appeared, where you last saw
// them, and how often they've come up. If they don't appear earlier in this
// book, the earlier books in the series are searched too. It only ever looks
// backwards from your place, so it can't give anything away.
//
// Wikipedia is offered as well, but only when asked for, behind a warning.
(function () {
  const { $, esc, State } = window.UI;
  const R = window.Reader;

  const BLOCK = 'p, li, blockquote, dd, dt, td, th, h1, h2, h3, h4, h5, h6, figcaption, pre, div, section, article, body';
  const MAX_BOOKS_CACHED = 16;
  const otherBooks = new Map(); // bookId → { title, sections: [{ label, paras: [string] }] }, for earlier books in a series
  let thisBook = null; // { id, docs: Map(index → doc) } for the open book

  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // The name as a whole word, any apostrophe style ("al'Thor" / "al’Thor").
  const nameRe = (name) =>
    new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(name).replace(/['’]/g, "['’]")}(?![\\p{L}\\p{N}])`, 'gu');

  // The paragraphs of a document, each with the text nodes it's made of, so
  // a match can be turned back into a position in the book.
  function paragraphs(doc) {
    const out = [];
    const body = doc.body || doc.documentElement;
    if (!body) return out;
    const walker = doc.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    let cur = null;
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.data.trim() && !cur) continue;
      const block = n.parentElement?.closest(BLOCK) || body;
      if (!cur || cur.el !== block) out.push((cur = { el: block, nodes: [], text: '' }));
      cur.nodes.push({ node: n, start: cur.text.length });
      cur.text += n.data;
    }
    return out.filter((p) => p.text.trim());
  }

  // A passage around a match: from the start of its sentence to the end of a
  // sentence after it, up to about `max` characters.
  function passage(text, at, len, max = 420) {
    const clean = (s) => s.replace(/\s+/g, ' ');
    let start = 0;
    let end = text.length;
    let cutStart = false;
    if (text.length > max) {
      start = Math.max(0, at - Math.floor(max * 0.4));
      const ends = [...text.slice(start, at).matchAll(/[.!?]["”’)]?\s+/g)];
      const last = ends[ends.length - 1];
      if (last) start += last.index + last[0].length;
      else cutStart = start > 0;
      end = Math.min(text.length, start + max);
      const stops = [...text.slice(at + len, end).matchAll(/[.!?]["”’)]?(?=\s|$)/g)];
      const stop = stops[stops.length - 1];
      if (stop) end = at + len + stop.index + stop[0].length;
    }
    return {
      pre: (cutStart ? '…' : '') + clean(text.slice(start, at)).trimStart(),
      match: text.slice(at, at + len),
      post: clean(text.slice(at + len, end)).trimEnd() + (end < text.length ? '…' : ''),
    };
  }

  // The contents entry each section falls under.
  function sectionLabels(book, resolve) {
    const labels = [];
    const flat = [];
    const walk = (items) => items?.forEach((t) => (flat.push(t), walk(t.subitems)));
    walk(book.toc);
    const at = [];
    for (const t of flat) {
      try {
        const i = resolve(t.href)?.index;
        if (typeof i === 'number' && !(i in at)) at[i] = (t.label || '').trim();
      } catch (_) {}
    }
    let last = '';
    for (let i = 0; i < book.sections.length; i++) labels.push((last = at[i] ?? last));
    // Some books label chapters with just a number.
    return labels.map((l) => (/^\d+$/.test(l) ? `Chapter ${l}` : l));
  }

  // ---------- this book, up to your place ----------
  async function searchThisBook(name, here) {
    const view = R.view;
    const book = view.book;
    if (thisBook?.id !== R.id) thisBook = { id: R.id, docs: new Map() };
    const re = nameRe(name);
    const labels = sectionLabels(book, (href) => view.resolveNavigation(href));
    const hits = [];
    const upTo = here.section ?? book.sections.length - 1;
    for (let i = 0; i <= upTo; i++) {
      const section = book.sections[i];
      if (!section?.createDocument || section.linear === 'no') continue;
      let doc = thisBook.docs.get(i);
      if (!doc) {
        try {
          doc = await section.createDocument();
        } catch (_) {
          continue;
        }
        thisBook.docs.set(i, doc);
      }
      for (const p of paragraphs(doc)) {
        for (const m of p.text.matchAll(re)) {
          const k = p.nodes.findLastIndex((x) => x.start <= m.index);
          const { node, start } = p.nodes[k];
          const range = doc.createRange();
          range.setStart(node, m.index - start);
          range.setEnd(node, Math.min(node.data.length, m.index - start + m[0].length));
          const cfi = view.getCFI(i, range);
          // In the chapter you're in, only what comes before this page.
          if (i === upTo && here.cfi && R.cfiCmp(cfi, here.cfi) >= 0) continue;
          hits.push({ section: i, chapter: labels[i] || '', cfi, ...passage(p.text, m.index, m[0].length) });
        }
      }
    }
    return hits;
  }

  // ---------- earlier books in the series ----------
  async function loadOtherBook(rec) {
    if (otherBooks.has(rec.id)) return otherBooks.get(rec.id);
    const book = await R.engine.makeBook(await R.bookFile(rec));
    const labels = sectionLabels(book, (href) => book.resolveHref?.(href));
    const sections = [];
    try {
      for (let i = 0; i < book.sections.length; i++) {
        const s = book.sections[i];
        if (!s.createDocument || s.linear === 'no') continue;
        try {
          const doc = await s.createDocument();
          sections.push({ label: labels[i] || '', paras: paragraphs(doc).map((p) => p.text) });
        } catch (_) {}
      }
    } finally {
      book.destroy?.();
    }
    const entry = { title: rec.title, sections };
    otherBooks.set(rec.id, entry);
    if (otherBooks.size > MAX_BOOKS_CACHED) otherBooks.delete(otherBooks.keys().next().value);
    return entry;
  }

  function searchOtherBook(entry, name) {
    const re = nameRe(name);
    const hits = [];
    for (const s of entry.sections) {
      for (const text of s.paras) {
        for (const m of text.matchAll(re)) hits.push({ chapter: s.label, ...passage(text, m.index, m[0].length) });
      }
    }
    return hits;
  }

  // The earlier books in this book's series, first book first.
  function earlierInSeries() {
    const me = State.book(R.id);
    if (!me?.seriesId || me.seriesNo == null) return [];
    return State.books
      .filter((b) => b.seriesId === me.seriesId && b.id !== me.id && b.seriesNo != null && b.seriesNo < me.seriesNo && b.format !== 'pdf' && b.format !== 'cbz')
      .sort((a, b) => a.seriesNo - b.seriesNo);
  }

  // ---------- the card ----------
  const quote = (h) => `<blockquote class="who-quote">${esc(h.pre)}<b>${esc(h.match)}</b>${esc(h.post)}</blockquote>`;

  function cardHtml(s) {
    const name = esc(s.name);
    let body = '';
    if (s.notName) {
      body = `<p class="np-muted">Select a name — a word or two — to see where you’ve met them before.</p>`;
    } else if (s.fixed) {
      body = `<p class="np-muted">This only works in books with text to search, not page images like PDFs and comics.</p>`;
    } else {
      const here = s.here || [];
      const first = s.earlier?.first || here[0];
      const last = here[here.length - 1];
      if (s.searching && !here.length && !s.earlier?.first) body += `<p class="np-muted">Looking back through what you’ve read…</p>`;
      if (first) {
        const where = first.book ? `in <i>${esc(first.book)}</i>${first.chapter ? ` · ${esc(first.chapter)}` : ''}` : esc(first.chapter || 'earlier in this book');
        body +=
          `<div class="who-head">First mentioned <span>${where}</span>` +
          (first.cfi ? `<button class="who-go" data-who-go="${esc(first.cfi)}">Go there</button>` : '') +
          `</div>${quote(first)}`;
      }
      if (last && last !== first) {
        body +=
          `<div class="who-head">Last seen <span>${esc(last.chapter || 'earlier in this book')}</span>` +
          `<button class="who-go" data-who-go="${esc(last.cfi)}">Go there</button></div>${quote(last)}`;
      }
      const counts = [];
      if (here.length) counts.push(`${here.length} ${here.length === 1 ? 'time' : 'times'} so far in this book`);
      if (s.earlier?.count) counts.push(`${s.earlier.count} in ${s.earlier.books} earlier ${s.earlier.books === 1 ? 'book' : 'books'}`);
      if (counts.length) body += `<p class="who-count">Mentioned ${counts.join(', and ')}.</p>`;
      if (here.length > 2) {
        body +=
          `<details class="who-all"><summary>Every mention in this book</summary><ol>` +
          [...here]
            .reverse()
            .map((h) => `<li><button data-who-go="${esc(h.cfi)}"><span class="ch">${esc(h.chapter || '')}</span>${esc(h.pre.slice(-60))}<b>${esc(h.match)}</b>${esc(h.post.slice(0, 60))}</button></li>`)
            .join('') +
          `</ol></details>`;
      }
      if (s.status) body += `<p class="np-muted who-status">${esc(s.status)}</p>`;
      if (!s.searching && !first) {
        body += `<p class="np-muted">“${name}” hasn’t come up before this page${s.seriesSearched ? ', or in the earlier books' : ''}. They may be new — or known by another name.</p>`;
      }
    }
    const web = s.notName
      ? ''
      : s.web
        ? s.web.loading
          ? `<p class="np-muted">Asking Wikipedia…</p>`
          : s.web.error
            ? `<p class="np-muted">${esc(s.web.error)}</p>`
            : s.web.none
              ? `<p class="np-muted">Wikipedia doesn’t seem to have an entry for “${name}”.</p>`
              : `<div class="who-wiki"><div class="who-head">${esc(s.web.title)}${s.web.description ? ` <span>${esc(s.web.description)}</span>` : ''}</div>` +
                `${s.web.extract.split('\n\n').map((p) => `<p>${esc(p)}</p>`).join('')}` +
                (s.web.url ? `<div class="np-actions"><button data-who-wiki-open>Read more on Wikipedia</button></div>` : '') +
                `</div>`
        : `<div class="who-online"><button data-who-wiki>Look it up on Wikipedia</button><span>May give away what happens later.</span></div>`;
    return `<div class="np-label">Who is this?</div><div class="who-name">${name}</div>${body}${web}`;
  }

  let current = null; // the card's state

  function draw() {
    const pop = $('#notePop');
    if (!current || pop.hidden || pop.dataset.kind !== 'who') return;
    const scroll = pop.scrollTop;
    pop.innerHTML = cardHtml(current);
    pop.scrollTop = scroll;
  }

  Object.assign(R, {
    async whoIsThis(sel) {
      if (!sel) return;
      const bar = $('#selBar').getBoundingClientRect();
      const name = sel.text.trim().replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '').replace(/['’]s$/u, '');
      this.hideSel();
      const s = (current = { name, searching: true });
      const show = () => {
        this.showPop(bar.left + bar.width / 2, bar.top, bar.bottom, cardHtml(s));
        $('#notePop').dataset.kind = 'who';
        $('#notePop').classList.add('wide');
      };
      if (!name || name.split(/\s+/).length > 4 || name.length > 60) {
        s.notName = true;
        return show();
      }
      if (this.view?.isFixedLayout) {
        s.fixed = true;
        return show();
      }
      show();

      const here = { section: this.loc?.section?.current, cfi: this.startCfi() };
      try {
        s.here = await searchThisBook(name, here);
      } catch (err) {
        console.warn('Who is this:', err);
        s.here = [];
      }
      if (current !== s) return;
      const earlier = earlierInSeries();
      // Not met in this book yet, or met only once — look in the earlier books for where they began.
      if (earlier.length) {
        s.status = 'Looking through the earlier books…';
        draw();
        s.earlier = { first: null, count: 0, books: 0 };
        for (const rec of earlier) {
          if (current !== s) return;
          s.status = `Looking through ${rec.seriesNo != null ? `book ${rec.seriesNo}, ` : ''}${rec.title}…`;
          draw();
          try {
            const hits = searchOtherBook(await loadOtherBook(rec), name);
            if (hits.length) {
              s.earlier.count += hits.length;
              s.earlier.books += 1;
              if (!s.earlier.first) s.earlier.first = { ...hits[0], book: rec.title };
            }
          } catch (err) {
            console.warn(`Who is this: couldn't search ${rec.title}`, err);
          }
        }
        s.seriesSearched = true;
      }
      s.status = '';
      s.searching = false;
      if (current === s) draw();
    },

    async whoOnline() {
      const s = current;
      if (!s) return;
      s.web = { loading: true };
      draw();
      const me = State.book(this.id);
      s.web = await window.aion.lookupCharacter(s.name, { series: me?.seriesName || '', title: me?.title || '' });
      if (current === s) draw();
    },

    // A new book: forget the documents kept for searching the last one.
    whoReset() {
      thisBook = null;
      current = null;
    },
  });

  // Clicks inside the card (the pop-up is shared with footnotes and the dictionary).
  const pop = document.getElementById('notePop');
  pop.addEventListener('click', (e) => {
    if (pop.dataset.kind !== 'who') return;
    const go = e.target.closest('[data-who-go]');
    if (go) {
      R.hideNote();
      R.goTo(go.dataset.whoGo);
      return;
    }
    if (e.target.closest('[data-who-wiki]')) return R.whoOnline();
    if (e.target.closest('[data-who-wiki-open]') && current?.web?.url) window.aion.openWikipedia(current.web.url);
  });
})();
