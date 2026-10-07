// Two pages about what you've read rather than what you're reading:
// the commonplace book (every passage you've highlighted, gathered together)
// and the reading timeline (your year, month by month).
(function () {
  const { $, esc, State, coverHtml, toast } = window.UI;
  const { icon } = window.Ornaments;

  const COLORS = [
    ['rose', 'Rose'],
    ['sage', 'Sage'],
    ['ochre', 'Ochre'],
  ];
  const MONTH = (y, m) => new Date(y, m, 1).toLocaleDateString(undefined, { month: 'long' });
  const MON = (y, m) => new Date(y, m, 1).toLocaleDateString(undefined, { month: 'short' });
  const fmtDate = (t) => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

  function fmtTime(ms) {
    const min = Math.round(ms / 60000);
    if (min < 60) return `${min} min`;
    const h = Math.floor(min / 60);
    return min % 60 ? `${h} h ${min % 60} min` : `${h} h`;
  }

  const starsHtml = (r) =>
    r ? `<span class="tl-stars" aria-label="Rated ${r} out of 5">${'★'.repeat(r)}<i>${'★'.repeat(5 - r)}</i></span>` : '';

  // ================================================================
  // The commonplace book
  // ================================================================
  const cp = { q: '', color: '', group: 'book', notesOnly: false };
  let featured = null; // a passage at random, picked when the page opens

  function passages() {
    const out = [];
    for (const b of State.books) for (const h of b.highlights || []) if (h.text) out.push({ ...h, book: b });
    return out;
  }

  // Passages from one book in the order they appear in it.
  function inBookOrder(list) {
    const cmp = window.Reader?.cfiCmp?.bind(window.Reader);
    return [...list].sort((a, b) => {
      try {
        if (cmp) return cmp(a.cfi, b.cfi);
      } catch (_) {}
      return (a.createdAt || 0) - (b.createdAt || 0);
    });
  }

  function entryHtml(p, { withBook }) {
    const where = [
      withBook ? `<b>${esc(p.book.title)}</b>` : '',
      withBook && p.book.author ? esc(p.book.author) : '',
      p.chapter ? esc(p.chapter) : '',
      p.createdAt ? fmtDate(p.createdAt) : '',
    ].filter(Boolean);
    return (
      `<article class="cp-entry" data-color="${esc(p.color || 'rose')}" data-book="${esc(p.book.id)}" data-cfi="${esc(p.cfi)}">` +
      `<blockquote>${esc(p.text)}</blockquote>` +
      (p.note ? `<p class="cp-note">${esc(p.note)}</p>` : '') +
      `<footer><span class="cp-where">${where.join(' · ')}</span><span class="cp-actions">` +
      `<button class="ghost-btn" data-cp="copy" title="Copy the passage">${icon('copy')}<span>Copy</span></button>` +
      `<button class="ghost-btn" data-cp="open" title="Open the book at this passage">${icon('reading')}<span>Open in the book</span></button>` +
      `</span></footer></article>`
    );
  }

  function matches(p) {
    if (cp.color && p.color !== cp.color) return false;
    if (cp.notesOnly && !p.note) return false;
    if (!cp.q) return true;
    const q = cp.q.toLowerCase();
    return [p.text, p.note, p.book.title, p.book.author, p.chapter].some((s) => s && s.toLowerCase().includes(q));
  }

  function listHtml(all) {
    const shown = all.filter(matches);
    if (!shown.length) return `<p class="cp-none">No passages match${cp.q ? ` “${esc(cp.q)}”` : ''}.</p>`;
    if (cp.group === 'date') {
      const months = new Map();
      for (const p of [...shown].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))) {
        const d = new Date(p.createdAt || 0);
        const key = p.createdAt ? `${MONTH(d.getFullYear(), d.getMonth())} ${d.getFullYear()}` : 'Undated';
        if (!months.has(key)) months.set(key, []);
        months.get(key).push(p);
      }
      return [...months]
        .map(([label, list]) => `<section class="cp-group"><h3 class="cp-month">${esc(label)}</h3>${list.map((p) => entryHtml(p, { withBook: true })).join('')}</section>`)
        .join('');
    }
    // By book: the book you marked most recently first, its passages in reading order.
    const books = new Map();
    for (const p of shown) {
      if (!books.has(p.book.id)) books.set(p.book.id, []);
      books.get(p.book.id).push(p);
    }
    const latest = (list) => Math.max(...list.map((p) => p.createdAt || 0));
    return [...books.values()]
      .sort((a, b) => latest(b) - latest(a))
      .map((list) => {
        const b = list[0].book;
        return (
          `<section class="cp-group"><header class="cp-book" data-book="${esc(b.id)}"><div class="cp-cover">${coverHtml(b)}</div>` +
          `<div><h3>${esc(b.title)}</h3><div class="a">${esc(b.author || '')}</div><div class="n">${list.length} ${list.length === 1 ? 'passage' : 'passages'}</div></div></header>` +
          inBookOrder(list).map((p) => entryHtml(p, { withBook: false })).join('') +
          `</section>`
        );
      })
      .join('');
  }

  function featuredHtml(all) {
    if (all.length < 2) return '';
    if (!featured || !all.some((p) => p.cfi === featured.cfi && p.book.id === featured.book.id)) featured = all[Math.floor(Math.random() * all.length)];
    const p = featured;
    return (
      `<figure class="cp-featured" data-book="${esc(p.book.id)}" data-cfi="${esc(p.cfi)}">` +
      `<blockquote>${esc(p.text.length > 420 ? `${p.text.slice(0, 400).replace(/\s+\S*$/, '')}…` : p.text)}</blockquote>` +
      `<figcaption>— ${esc(p.book.author ? `${p.book.author}, ` : '')}<i>${esc(p.book.title)}</i>` +
      `<button class="ghost-btn" data-cp="another" title="Another passage">${icon('reset')}<span>Another</span></button></figcaption></figure>`
    );
  }

  function renderCommonplace() {
    const panel = $('#commonplacePanel');
    const all = passages();
    if (!all.length) {
      panel.innerHTML =
        `<div class="cp-empty">${window.Painted.divider()}<h3>Nothing copied out yet</h3>` +
        `<p>Highlight a passage while you read and it’s gathered here, with any note you write beside it — a commonplace book that keeps itself.</p></div>`;
      return;
    }
    const colorBtns = [['', 'All']].concat(COLORS).map(
      ([c, label]) => `<button class="chip ${cp.color === c ? 'is-on' : ''}" data-cp-color="${c}">${c ? `<i class="cp-dot" data-color="${c}"></i>` : ''}${label}</button>`
    );
    panel.innerHTML =
      featuredHtml(all) +
      `<div class="cp-tools">` +
      `<label class="cp-search">${icon('search')}<input type="search" id="cpSearch" placeholder="Search passages and notes" value="${esc(cp.q)}" spellcheck="false"></label>` +
      `<div class="chips">${colorBtns.join('')}</div>` +
      `<div class="chips"><button class="chip ${cp.group === 'book' ? 'is-on' : ''}" data-cp-group="book">By book</button><button class="chip ${cp.group === 'date' ? 'is-on' : ''}" data-cp-group="date">By date</button>` +
      `<button class="chip ${cp.notesOnly ? 'is-on' : ''}" data-cp-notes>With notes</button></div>` +
      `<button class="ghost-btn bordered" data-cp="export" title="Save every passage and note as a Markdown file">${icon('export')}<span>Export…</span></button>` +
      `</div><div id="cpList">${listHtml(all)}</div>`;
    $('#viewCount').textContent = `${all.length} ${all.length === 1 ? 'passage' : 'passages'}`;
  }

  const renderList = () => {
    const el = $('#cpList');
    if (el) el.innerHTML = listHtml(passages());
  };

  async function openAt(id, cfi) {
    await window.Reader.open(id);
    if (cfi && window.Reader.view) await window.Reader.goTo(cfi);
  }

  // ================================================================
  // The reading timeline
  // ================================================================
  let tlYear = new Date().getFullYear();
  let tlStats = null;

  const yearOf = (t) => (t ? new Date(t).getFullYear() : null);

  function timelineYears() {
    const years = new Set([new Date().getFullYear()]);
    for (const b of State.books) {
      if (b.finishedAt) years.add(yearOf(b.finishedAt));
      if (b.startedAt) years.add(yearOf(b.startedAt));
    }
    for (const k of Object.keys(tlStats?.days || {})) if ((tlStats.days[k].ms || 0) >= 60000) years.add(Number(k.slice(0, 4)));
    return [...years].filter(Boolean).sort((a, b) => b - a);
  }

  function took(b) {
    if (!b.startedAt || !b.finishedAt || b.finishedAt < b.startedAt) return '';
    const days = Math.max(1, Math.round((b.finishedAt - b.startedAt) / 86400000));
    if (days === 1) return 'in a day';
    if (days < 14) return `in ${days} days`;
    if (days < 60) return `over ${Math.round(days / 7)} weeks`;
    return `over ${Math.round(days / 30)} months`;
  }

  function timelineHtml() {
    const years = timelineYears();
    if (!years.includes(tlYear)) tlYear = years[0];
    const y = tlYear;
    const now = new Date();
    const lastMonth = y === now.getFullYear() ? now.getMonth() : 11;
    const days = tlStats?.days || {};

    const months = Array.from({ length: lastMonth + 1 }, (_, m) => ({ m, ms: 0, readDays: 0, finished: [], began: [] }));
    for (const [k, v] of Object.entries(days)) {
      if (Number(k.slice(0, 4)) !== y) continue;
      const mo = months[Number(k.slice(5, 7)) - 1];
      if (!mo) continue;
      mo.ms += v.ms || 0;
      if ((v.ms || 0) >= 60000) mo.readDays++;
    }
    for (const b of State.books) {
      const f = b.finishedAt && new Date(b.finishedAt);
      if (f && f.getFullYear() === y && months[f.getMonth()]) months[f.getMonth()].finished.push(b);
      const s = b.startedAt && new Date(b.startedAt);
      const finishedSameMonth = f && s && f.getFullYear() === s.getFullYear() && f.getMonth() === s.getMonth();
      if (s && s.getFullYear() === y && months[s.getMonth()] && !finishedSameMonth) months[s.getMonth()].began.push(b);
    }
    for (const mo of months) mo.finished.sort((a, b) => a.finishedAt - b.finishedAt);

    const finished = months.flatMap((mo) => mo.finished);
    const totalMs = months.reduce((n, mo) => n + mo.ms, 0);
    const readDays = months.reduce((n, mo) => n + mo.readDays, 0);
    const maxMs = Math.max(...months.map((mo) => mo.ms), 1);
    const best = [...finished].filter((b) => b.rating).sort((a, b) => b.rating - a.rating || b.finishedAt - a.finishedAt)[0];
    const longest = [...finished].sort((a, b) => (b.readingMs || 0) - (a.readingMs || 0))[0];

    const summary = [
      `<b>${finished.length}</b> ${finished.length === 1 ? 'book' : 'books'} finished`,
      totalMs >= 60000 ? `<b>${fmtTime(totalMs)}</b> spent reading` : '',
      readDays ? `on <b>${readDays}</b> ${readDays === 1 ? 'day' : 'days'}` : '',
    ].filter(Boolean);
    const notes = [
      best ? `Your favorite: <i>${esc(best.title)}</i> ${starsHtml(best.rating)}` : '',
      longest?.readingMs > 30 * 60000 && longest !== best ? `The longest with you: <i>${esc(longest.title)}</i>, ${fmtTime(longest.readingMs)}` : '',
    ].filter(Boolean);

    // The most recent month first; a run of months with nothing in them folds into one line.
    const quietMonth = (mo) => mo.ms < 60000 && !mo.finished.length && !mo.began.length;
    const runs = [];
    for (const mo of months.slice().reverse()) {
      const last = runs[runs.length - 1];
      if (quietMonth(mo) && last?.quiet) last.months.push(mo);
      else runs.push({ quiet: quietMonth(mo), months: [mo] });
    }
    const rows = runs
      .map(({ quiet, months: run }) => {
        if (quiet) {
          const newest = MONTH(y, run[0].m);
          const oldest = MONTH(y, run[run.length - 1].m);
          const label = run.length === 1 ? newest : `${MON(y, run[run.length - 1].m)} – ${MON(y, run[0].m)}`;
          return `<div class="tl-month quiet"><div class="tl-label">${esc(label)}</div><div class="tl-body"><div class="tl-rest">${run.length === 1 ? 'A quiet month' : 'Quiet months'}</div></div></div>`;
        }
        const mo = run[0];
        const bar = mo.ms >= 60000
          ? `<div class="tl-bar" title="${esc(fmtTime(mo.ms))} on ${mo.readDays} ${mo.readDays === 1 ? 'day' : 'days'}"><i style="width:${Math.max(3, (mo.ms / maxMs) * 100).toFixed(1)}%"></i><span>${esc(fmtTime(mo.ms))}</span></div>`
          : '';
        const books = mo.finished
          .map(
            (b) =>
              `<button class="tl-book" data-open-book="${esc(b.id)}" title="${esc(b.title)}"><div class="tl-cover">${coverHtml(b)}</div>` +
              `<div class="tl-text"><div class="t">${esc(b.title)}</div>${b.author ? `<div class="a">${esc(b.author)}</div>` : ''}` +
              `<div class="m">${[starsHtml(b.rating), took(b) && esc(took(b)), b.readingMs > 60000 && `${esc(fmtTime(b.readingMs))} reading`].filter(Boolean).join(' · ')}</div></div></button>`
          )
          .join('');
        const began = mo.began.length
          ? `<div class="tl-began">Began ${mo.began.map((b) => `<i>${esc(b.title)}</i>`).join(', ')}</div>`
          : '';
        return (
          `<div class="tl-month"><div class="tl-label">${esc(MONTH(y, mo.m))}</div>` +
          `<div class="tl-body">${bar}${books ? `<div class="tl-books">${books}</div>` : ''}${began}</div></div>`
        );
      })
      .join('');

    return (
      `<div class="tl-head"><h2>Your year in books</h2>${
        years.length > 1 ? `<div class="chips">${years.map((yy) => `<button class="chip ${yy === y ? 'is-on' : ''}" data-tl-year="${yy}">${yy}</button>`).join('')}</div>` : ''
      }</div>` +
      `<p class="tl-summary">${summary.join(' · ')}</p>` +
      (notes.length ? `<p class="tl-notes">${notes.join('<br>')}</p>` : '') +
      `<div class="tl-months">${rows}</div>` +
      (finished.some((b) => !b.startedAt) ? `<p class="set-note">How long a book took shows for books you begin from now on.</p>` : '')
    );
  }

  async function renderTimeline() {
    const el = $('#timelineGroup');
    if (!el) return;
    tlStats = await window.aion.getStats();
    el.innerHTML = timelineHtml();
  }

  // ================================================================
  function bind() {
    const cpPanel = $('#commonplacePanel');
    cpPanel.addEventListener('input', (e) => {
      if (e.target.id !== 'cpSearch') return;
      cp.q = e.target.value.trim();
      renderList();
    });
    cpPanel.addEventListener('click', async (e) => {
      const color = e.target.closest('[data-cp-color]');
      if (color) {
        cp.color = color.dataset.cpColor;
        return renderCommonplace();
      }
      const group = e.target.closest('[data-cp-group]');
      if (group) {
        cp.group = group.dataset.cpGroup;
        return renderCommonplace();
      }
      if (e.target.closest('[data-cp-notes]')) {
        cp.notesOnly = !cp.notesOnly;
        return renderCommonplace();
      }
      const act = e.target.closest('[data-cp]')?.dataset.cp;
      if (act === 'another') {
        const all = passages().filter((p) => p !== featured);
        let next = featured;
        while (all.length > 1 && next && next.cfi === featured.cfi) next = all[Math.floor(Math.random() * all.length)];
        featured = next;
        return renderCommonplace();
      }
      if (act === 'export') {
        const res = await window.aion.exportNotes();
        if (res.written) toast(`Exported notes from ${res.count} ${res.count === 1 ? 'book' : 'books'}`, 2200);
        return;
      }
      const entry = e.target.closest('.cp-entry, .cp-featured');
      if (act === 'copy' && entry) {
        const p = passages().find((x) => x.book.id === entry.dataset.book && x.cfi === entry.dataset.cfi);
        if (p) {
          await navigator.clipboard.writeText(`${p.text}\n— ${p.book.author ? `${p.book.author}, ` : ''}${p.book.title}`);
          toast('Copied', 1200);
        }
        return;
      }
      if (act === 'open' || (entry && e.target.closest('blockquote'))) return openAt(entry.dataset.book, entry.dataset.cfi);
      const book = e.target.closest('.cp-book');
      if (book) return openAt(book.dataset.book);
    });

    $('#statsPanel').addEventListener('click', (e) => {
      const yr = e.target.closest('[data-tl-year]');
      if (yr) {
        tlYear = Number(yr.dataset.tlYear);
        $('#timelineGroup').innerHTML = timelineHtml();
        return;
      }
      const b = e.target.closest('[data-open-book]');
      if (b) window.Reader.open(b.dataset.openBook);
    });
  }

  window.Journal = { renderCommonplace, renderTimeline, bind };
})();
