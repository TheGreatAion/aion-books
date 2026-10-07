// The library: navigation, shelves, search, grid, details, import.
(function () {
  const { $, $$, esc, State, updateBook, setSettings, coverHtml, toast, undoToast, openMenu, openModal, closeModal, promptText, confirmBox, pct, stars } =
    window.UI;
  const { icon } = window.Ornaments;
  const Painted = window.Painted;
  const Reader = window.Reader;

  const VIEWS = {
    all: { label: 'All books', icon: 'books', filter: () => true },
    reading: { label: 'Reading now', icon: 'reading', filter: (b) => b.progress > 0 && !b.finished },
    unread: { label: 'Not yet begun', icon: 'sprout', filter: (b) => !b.progress && !b.finished },
    favorites: { label: 'Favorites', icon: 'heart', filter: (b) => b.favorite },
    finished: { label: 'Finished', icon: 'check', filter: (b) => b.finished },
    series: { label: 'Series', icon: 'stack', filter: (b) => !!b.seriesId },
  };

  // ---------- series ----------
  // Books are grouped by seriesId, which treats different spellings of one
  // series as the same (see series.js); seriesName is how the group is shown.
  const seriesBooks = (id) =>
    State.books
      .filter((b) => b.seriesId === id)
      .sort((a, b) => (a.seriesNo ?? 1e9) - (b.seriesNo ?? 1e9) || sortKey(a.title).localeCompare(sortKey(b.title)));
  const seriesTitle = (id) => State.books.find((b) => b.seriesId === id)?.seriesName || '';

  function nextInSeries(book) {
    if (!book?.seriesId) return null;
    const list = seriesBooks(book.seriesId);
    const i = list.findIndex((b) => b.id === book.id);
    return list.slice(i + 1).find((b) => !b.finished) || null;
  }

  const seriesLabel = (b) =>
    b.seriesId ? `${b.seriesNo != null && !Number.isNaN(b.seriesNo) ? `Book ${String(b.seriesNo).replace(/\.0+$/, '')} · ` : ''}${b.seriesName}` : '';

  const EMPTY = {
    all: ['Your library awaits', 'Drop books anywhere on this page — EPUB, Kindle, PDF, comics or FB2 — or gather them from a folder.'],
    reading: ['Nothing open on the nightstand', 'Books you begin will rest here until you finish them.'],
    unread: ['Every book has been begun', 'A fine habit. Add something new to keep the shelves full.'],
    favorites: ['No favorites yet', 'Tap the little heart on a cover to keep it close.'],
    finished: ['No finished books — yet', 'Each book you complete will be pressed here like a flower.'],
    shelf: ['An empty shelf', 'Right-click any book and choose “Shelves…” to place it here.'],
    search: ['Nothing by that name', 'Try a different title or author.'],
  };

  let view = 'all';
  let query = '';

  // Shelves keep their own arrangement; every other view shares the library-wide one.
  const orderKey = () => (view.startsWith('shelf:') ? view : 'all');

  function contextBooks(key) {
    return key.startsWith('shelf:') ? State.books.filter((b) => (b.shelves || []).includes(key.slice(6))) : State.books;
  }

  function sortBooks(list, sort, key = orderKey()) {
    if (sort === 'custom') {
      const order = State.orders[key] || (key !== 'all' && State.orders.all) || [];
      const rank = new Map(order.map((id, i) => [id, i]));
      // Books not yet placed (e.g. newly added) go to the end, oldest first.
      return [...list].sort(
        (a, b) => (rank.get(a.id) ?? 1e9 + a.addedAt / 1e13) - (rank.get(b.id) ?? 1e9 + b.addedAt / 1e13)
      );
    }
    const by = {
      recent: (a, b) => (b.lastOpenedAt || 0) - (a.lastOpenedAt || 0) || b.addedAt - a.addedAt,
      added: (a, b) => b.addedAt - a.addedAt,
      title: (a, b) => sortKey(a.title).localeCompare(sortKey(b.title)),
      author: (a, b) => lastName(a.author).localeCompare(lastName(b.author)) || sortKey(a.title).localeCompare(sortKey(b.title)),
      progress: (a, b) => (b.finished ? 1.01 : b.progress || 0) - (a.finished ? 1.01 : a.progress || 0),
      rating: (a, b) => (b.rating || 0) - (a.rating || 0) || sortKey(a.title).localeCompare(sortKey(b.title)),
    }[sort] || (() => 0);
    return [...list].sort(by);
  }

  function visibleBooks() {
    let list = State.books;
    if (view.startsWith('series:')) {
      list = seriesBooks(view.slice(7));
      if (query) {
        const q = query.toLowerCase();
        list = list.filter((b) => `${b.title} ${b.author}`.toLowerCase().includes(q));
      }
      return list;
    }
    if (view.startsWith('shelf:')) {
      const id = view.slice(6);
      list = list.filter((b) => (b.shelves || []).includes(id));
    } else {
      list = list.filter(VIEWS[view].filter);
    }
    if (query) {
      const q = query.toLowerCase();
      list = list.filter((b) => `${b.title} ${b.author}`.toLowerCase().includes(q));
    }
    return sortBooks(list, State.settings.sort || 'recent');
  }

  // Commit a new arrangement of the books currently on screen. Books hidden by the
  // current view keep their places; the visible ones are re-dealt into their slots.
  async function commitOrder(visibleIds, settleId) {
    const key = orderKey();
    const prevSort = State.settings.sort || 'recent';
    const full = sortBooks(contextBooks(key), prevSort === 'custom' ? 'custom' : prevSort, key).map((b) => b.id);
    const shown = new Set(visibleIds);
    const queue = [...visibleIds];
    const next = full.map((id) => (shown.has(id) ? queue.shift() : id));
    State.orders = await window.aion.setOrder(key, next);
    if (prevSort !== 'custom') {
      await setSettings({ sort: 'custom' });
      $('#sort').value = 'custom';
      toast('Sorted by your own order — drag books to rearrange', 2600);
    }
    render();
    if (settleId) $(`#grid .card[data-id="${settleId}"]`)?.classList.add('settle');
  }

  function moveBook(id, where) {
    const ids = visibleBooks().map((b) => b.id).filter((x) => x !== id);
    if (where === 'start') ids.unshift(id);
    else ids.push(id);
    commitOrder(ids, id);
  }
  const sortKey = (t) => String(t || '').replace(/^(the|a|an)\s+/i, '').toLowerCase();
  const lastName = (a) => String(a || '').split(',')[0].trim().split(/\s+/).pop().toLowerCase();

  // ---------- rendering ----------
  function renderNav() {
    const counts = Object.fromEntries(Object.entries(VIEWS).map(([k, v]) => [k, State.books.filter(v.filter).length]));
    counts.series = new Set(State.books.filter((b) => b.seriesId).map((b) => b.seriesId)).size;
    $('#nav').innerHTML = Object.entries(VIEWS)
      .filter(([k]) => k !== 'series' || counts.series)
      .map(([k, v]) => {
        const active = view === k || (k === 'series' && view.startsWith('series:'));
        return `<button class="nav-item ${active ? 'is-active' : ''}" data-view="${k}">${icon(v.icon)}<span class="label">${v.label}</span><span class="n">${counts[k] || ''}</span></button>`;
      })
      .join('');

    $('#shelfNav').innerHTML = State.shelves.length
      ? State.shelves
          .map((s) => {
            const n = State.books.filter((b) => (b.shelves || []).includes(s.id)).length;
            return `<button class="nav-item ${view === `shelf:${s.id}` ? 'is-active' : ''}" data-view="shelf:${s.id}" data-shelf="${s.id}">${icon('shelf')}<span class="label">${esc(
              s.name
            )}</span><span class="n">${n || ''}</span></button>`;
          })
          .join('')
      : `<div class="shelf-empty">Make a shelf for a season, a mood, a someday.</div>`;
  }

  function renderHero() {
    const hero = $('#hero');
    const recent = State.books.filter((b) => b.lastOpenedAt).sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
    // Just finished a book in a series? Suggest the next one.
    const upNext = recent[0]?.finished ? nextInSeries(recent[0]) : null;
    const last = upNext || recent.find((b) => !b.finished);
    if (view !== 'all' || query || !last) {
      hero.hidden = true;
      return;
    }
    hero.hidden = false;
    if (!$('#heroArt').childElementCount) $('#heroArt').innerHTML = Painted.lemonBough();
    const where = upNext
      ? `<div class="where"><span>${esc(seriesLabel(upNext))}</span></div>`
      : `<div class="where">${last.chapter ? `<span>${esc(last.chapter)}</span>` : ''}` +
        `<div class="bar"><i style="width:${pct(last.progress)}"></i></div><span>${pct(last.progress)}</span></div>`;
    // Everything else currently on the go, most recently read first.
    const MAX_ALSO = 5;
    const others = recent.filter((b) => !b.finished && b.id !== last.id);
    const also = others.length
      ? `<div class="nightstand"><div class="ns-head"><span class="eyebrow">Also reading</span>${
          others.length > MAX_ALSO ? `<button class="crumb" data-goto="reading">See all ${others.length + 1}</button>` : ''
        }</div><div class="ns-row">${others
          .slice(0, MAX_ALSO)
          .map(
            (b) =>
              `<button class="ns-item" data-open="${b.id}" title="${esc(b.title)} — ${esc(b.author)}">` +
              `<span class="ns-cover">${coverHtml(b)}</span>` +
              `<span class="ns-text"><span class="ns-title">${esc(b.title)}</span><span class="ns-author">${esc(b.author)}</span>` +
              `<span class="ns-prog"><span class="bar"><i style="width:${pct(b.progress)}"></i></span>${pct(b.progress)}</span></span></button>`
          )
          .join('')}</div></div>`
      : '';
    $('#heroContent').innerHTML =
      `<div class="hero-main"><button class="hero-cover" data-open="${last.id}">${coverHtml(last)}</button>` +
      `<div class="hero-text"><div class="eyebrow">${upNext ? `Next in ${esc(upNext.seriesName)}` : 'Continue reading'}</div>` +
      `<h2>${esc(last.title)}</h2><div class="by">${esc(last.author)}</div>${where}` +
      `<button class="solid-btn" data-open="${last.id}">${upNext && !last.progress ? 'Begin reading' : 'Return to the page'} ${icon('next')}</button></div></div>` +
      also;
  }

  function renderSeriesGroups() {
    const groups = new Map();
    for (const b of State.books) if (b.seriesId) (groups.get(b.seriesId) || groups.set(b.seriesId, []).get(b.seriesId)).push(b);
    const names = [...groups.keys()].sort((a, b) => sortKey(seriesTitle(a)).localeCompare(sortKey(seriesTitle(b))));
    $('#viewTitle').textContent = 'Series';
    $('#viewCount').textContent = `${names.length} ${names.length === 1 ? 'series' : 'series'}`;
    $('#grid').innerHTML = names
      .map((name, i) => {
        const list = seriesBooks(name);
        const read = list.filter((b) => b.finished).length;
        const stack = list
          .slice(0, 3)
          .map((b, k) => `<div class="stack-item" style="--k:${k}">${coverHtml(b)}</div>`)
          .reverse()
          .join('');
        return (
          `<div class="card series-card enter" tabindex="0" data-series="${esc(name)}" style="--delay:${Math.min(i, 24) * 70}ms;--tilt:0">` +
          `<div class="stack">${stack}</div><div class="t">${esc(seriesTitle(name))}</div>` +
          `<div class="a">${list.length} ${list.length === 1 ? 'book' : 'books'}${read ? ` · ${read} read` : ''}</div></div>`
        );
      })
      .join('');
    $('#empty').hidden = true;
  }

  let gridKey = '';
  function renderGrid() {
    if (view === 'series' && !query) {
      gridKey = 'series';
      return renderSeriesGroups();
    }
    const books = visibleBooks();
    const inSeries = view.startsWith('series:');
    // Cards only do their cut-out drop when the shelf being shown changes.
    const key = `${view}|${query}|${State.settings.sort}|${$('#library').dataset.visit || 0}`;
    const enter = key !== gridKey;
    gridKey = key;
    const isShelf = view.startsWith('shelf:');
    const shelf = isShelf && State.shelves.find((s) => s.id === view.slice(6));
    $('#viewTitle').textContent = query ? `“${query}”` : isShelf ? shelf?.name || 'Shelf' : inSeries ? seriesTitle(view.slice(7)) : VIEWS[view].label;
    const n = books.length ? `${books.length} ${books.length === 1 ? 'book' : 'books'}` : '';
    $('#viewCount').innerHTML = inSeries ? `<button class="crumb" data-goto="series">${icon('back')}All series</button> · ${n}` : n;

    $('#grid').innerHTML = books
      .map((b, i) => {
        const meta = b.finished
          ? `<div class="meta done">${icon('check')}Finished</div>`
          : b.progress > 0
            ? `<div class="meta"><div class="bar"><i style="width:${pct(b.progress)}"></i></div><span>${pct(b.progress)}</span></div>`
            : `<div class="meta"><span>New</span></div>`;
        return (
          `<div class="card${enter ? ' enter' : ''}${selected.has(b.id) ? ' is-selected' : ''}" aria-selected="${selected.has(b.id)}" tabindex="0" draggable="${query || inSeries ? 'false' : 'true'}" data-id="${b.id}" style="--delay:${Math.min(i, 24) * 70}ms;--tilt:${((i * 37) % 7) - 3}">` +
          `<div style="position:relative">${coverHtml(b)}<button class="fav ${b.favorite ? 'is-on' : ''}" data-fav="${b.id}" title="Favorite">${icon('heart')}</button></div>` +
          `<div class="t">${esc(b.title)}</div><div class="a">${esc(b.author)}</div>` +
          `${b.rating ? stars(b.rating, { id: b.id, cls: 'tiny' }) : ''}` +
          `${b.seriesId ? `<div class="ser">${esc(seriesLabel(b))}</div>` : ''}${meta}</div>`
        );
      })
      .join('');

    const empty = !books.length;
    $('#empty').hidden = !empty;
    $('.heading-ornament').hidden = empty && !State.books.length;
    $('.lib-heading').hidden = empty && !State.books.length;
    if (empty) {
      const key = query ? 'search' : isShelf ? 'shelf' : State.books.length ? view : 'all';
      const [t, p] = EMPTY[key] || EMPTY.all;
      $('#emptyTitle').textContent = t;
      $('#emptyText').textContent = p;
      $('#emptyActions').hidden = !(key === 'all');
    }
  }

  function render() {
    if (view.startsWith('shelf:') && !State.shelves.some((s) => `shelf:${s.id}` === view)) view = 'all';
    if (view.startsWith('series:') && !State.books.some((b) => b.seriesId === view.slice(7))) view = 'series';
    if (view === 'series' && !State.books.some((b) => b.seriesId)) view = 'all';
    if (Date.now() - goalFetchedAt > 5000) refreshGoal();
    const page = PAGES[view];
    $('#libMain').classList.toggle('in-settings', !!page);
    $('#openSettings').classList.toggle('is-active', view === 'settings');
    $('#openStats').classList.toggle('is-active', view === 'stats');
    $('#openCommonplace').classList.toggle('is-active', view === 'commonplace');
    $('#settingsPanel').hidden = view !== 'settings';
    $('#statsPanel').hidden = view !== 'stats';
    $('#commonplacePanel').hidden = view !== 'commonplace';
    renderNav();
    if (page) {
      $('#hero').hidden = true;
      $('#grid').innerHTML = '';
      $('#empty').hidden = true;
      $('.lib-heading').hidden = false;
      $('.heading-ornament').hidden = false;
      $('#viewTitle').textContent = page.title;
      $('#viewCount').textContent = '';
      page.render();
      return;
    }
    renderHero();
    renderGrid();
    paintSelection();
  }

  // Pages that take over the main column instead of showing books.
  const PAGES = {
    settings: { title: 'Settings', render: () => window.Settings.render() },
    stats: { title: 'Your reading', render: () => window.Settings.renderStats() },
    commonplace: { title: 'Commonplace book', render: () => window.Journal.renderCommonplace() },
  };
  function openPage(name) {
    if ($('#reader').classList.contains('is-active')) Reader.close();
    view = name;
    $('#libScroll').scrollTop = 0;
    render();
  }
  const openSettings = () => openPage('settings');
  const openStats = () => openPage('stats');
  const openCommonplace = () => openPage('commonplace');

  // ---------- daily goal ring ----------
  let goalFetchedAt = 0;
  async function refreshGoal(ms) {
    if (ms == null) {
      goalFetchedAt = Date.now();
      const st = await window.aion.getStats();
      ms = st.days[st.today]?.ms || 0;
    }
    const goal = State.settings.dailyGoal || 0;
    const row = $('#goalRow');
    row.hidden = !goal;
    if (!goal) return;
    const frac = Math.min(1, ms / (goal * 60000));
    const C = 2 * Math.PI * 10;
    const min = Math.floor(ms / 60000);
    row.classList.toggle('done', frac >= 1);
    row.innerHTML =
      `<svg class="ring" viewBox="0 0 26 26" aria-hidden="true"><circle cx="13" cy="13" r="10" class="track"/>` +
      `<circle cx="13" cy="13" r="10" class="fill" stroke-dasharray="${(C * frac).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 13 13)"/></svg>` +
      `<span>${frac >= 1 ? `Today’s ${goal} minutes — done` : `${min} of ${goal} min read today`}</span>`;
    row.title = 'Daily reading goal — see your reading';
  }

  // ---------- actions ----------
  function openBook(id) {
    UI.flurry();
    setTimeout(() => Reader.open(id), 180);
  }

  async function addBooks(kind) {
    const res = kind === 'folder' ? await window.aion.importFolderDialog() : await window.aion.importDialog();
    if (res) afterImport(res);
  }

  function afterImport(res) {
    State.set(res.library);
    const msg = [];
    if (res.added) msg.push(`${res.added} ${res.added === 1 ? 'book' : 'books'} added to your library`);
    else if (res.found) msg.push('Those books are already on your shelves');
    else msg.push('No books found there');
    if (res.failed?.length) msg.push(`${res.failed.length} couldn’t be read`);
    toast(msg.join(' · '), 3200);
  }

  window.aion.onImportProgress((p) => {
    if (p.total < 3) return;
    if (p.finished) {
      if (/Gathering/.test($('#toast').textContent)) toast(`${p.total} books gathered`, 1800);
      return;
    }
    toast(`Gathering books… <div class="bar"><i style="width:${(p.done / p.total) * 100}%"></i></div> ${p.done}/${p.total}`, 0);
  });

  function bookMenu(id, x, y) {
    const b = State.book(id);
    if (!b) return;
    openMenu(x, y, [
      { stars: id, label: 'Your rating' },
      '-',
      { label: b.progress > 0 ? 'Continue reading' : 'Begin reading', icon: 'reading', run: () => openBook(id) },
      { label: 'Details', icon: 'info', run: () => showDetails(id) },
      ...(query || view.startsWith('series:')
        ? []
        : [
            { label: 'Move to start', icon: 'sort', run: () => moveBook(id, 'start') },
            { label: 'Move to end', icon: 'sort', run: () => moveBook(id, 'end') },
          ]),
      '-',
      { label: b.favorite ? 'Remove from favorites' : 'Add to favorites', icon: 'heart', run: () => updateBook(id, { favorite: !b.favorite }) },
      {
        label: b.finished ? 'Mark as unread' : 'Mark as finished',
        icon: 'check',
        run: () => updateBook(id, b.finished ? { finished: false, progress: 0, location: null, chapter: '' } : { finished: true }),
      },
      { label: 'Shelves…', icon: 'shelf', run: () => chooseShelves(id) },
      {
        label: 'Change cover…',
        icon: 'image',
        run: async () => {
          const snap = await window.aion.setCover(id);
          if (snap) State.set(snap);
        },
      },
      { label: 'Edit title & author', icon: 'edit', run: () => editMeta(id) },
      ...(b.originalTitle
        ? [{ label: 'Restore original title', icon: 'reset', run: async () => State.set(await window.aion.restoreTitle(id)) }]
        : []),
      { label: 'Show in folder', icon: 'folder', run: () => window.aion.showSource(id) },
      '-',
      { label: 'Remove from library', icon: 'trash', danger: true, run: () => removeBooks([id]) },
    ]);
  }

  // Books leave the shelves at once; they're really removed a few seconds
  // later, unless you press Undo. (The files on your computer are never touched.)
  function removeBooks(ids) {
    const books = ids.map((id) => State.book(id)).filter(Boolean);
    if (!books.length) return;
    for (const b of books) {
      State.hidden.add(b.id);
      selected.delete(b.id);
    }
    State.books = State.books.filter((b) => !State.hidden.has(b.id));
    State.emit();
    undoToast(books.length === 1 ? `Removed <em>${esc(books[0].title)}</em>` : `Removed ${books.length} books`, {
      undo: async () => {
        for (const b of books) State.hidden.delete(b.id);
        await State.getFresh();
      },
      commit: async () => {
        let snap = null;
        for (const b of books) snap = await window.aion.removeBook(b.id);
        for (const b of books) State.hidden.delete(b.id);
        if (snap) State.set(snap);
      },
    });
  }

  // ---------- choosing several books ----------
  // Ctrl-click adds or takes away a book, Shift-click takes in a run of them;
  // then shelve, finish, favorite or remove them together.
  const selected = new Set();
  let anchor = null; // where a Shift-click run starts
  const gridCards = () => [...$('#grid').querySelectorAll('.card[data-id]')];

  function select(id, { range = false, toggle = false } = {}) {
    if (range && anchor) {
      const ids = gridCards().map((c) => c.dataset.id);
      const [a, b] = [ids.indexOf(anchor), ids.indexOf(id)].sort((x, y) => x - y);
      if (a >= 0 && b >= 0) ids.slice(a, b + 1).forEach((x) => selected.add(x));
    } else if (toggle) {
      if (selected.has(id)) selected.delete(id);
      else selected.add(id);
      anchor = id;
    }
    paintSelection();
  }
  function clearSelection() {
    if (!selected.size) return;
    selected.clear();
    anchor = null;
    paintSelection();
  }
  function paintSelection() {
    for (const id of [...selected]) if (!State.book(id)) selected.delete(id);
    for (const c of gridCards()) {
      const on = selected.has(c.dataset.id);
      c.classList.toggle('is-selected', on);
      c.setAttribute('aria-selected', on);
    }
    const bar = $('#selectBar');
    bar.hidden = !selected.size;
    if (!selected.size) return;
    const books = [...selected].map((id) => State.book(id));
    const allFinished = books.every((b) => b.finished);
    const allFav = books.every((b) => b.favorite);
    bar.innerHTML =
      `<span class="sb-count">${selected.size} ${selected.size === 1 ? 'book' : 'books'} chosen</span>` +
      `<button class="ghost-btn" data-sel="shelf">${icon('shelf')}<span>Add to shelf</span></button>` +
      `<button class="ghost-btn" data-sel="finish">${icon('check')}<span>${allFinished ? 'Mark as unread' : 'Mark as finished'}</span></button>` +
      `<button class="ghost-btn" data-sel="fav">${icon('heart')}<span>${allFav ? 'Remove from favorites' : 'Add to favorites'}</span></button>` +
      `<button class="ghost-btn danger" data-sel="remove">${icon('trash')}<span>Remove</span></button>` +
      `<button class="icon-btn small" data-sel="clear" title="Clear (Esc)">${icon('close')}</button>`;
  }

  async function onSelectionAction(act, btn) {
    const ids = [...selected];
    const books = ids.map((id) => State.book(id)).filter(Boolean);
    if (act === 'clear') return clearSelection();
    if (act === 'remove') return removeBooks(ids);
    if (act === 'finish') {
      const finish = !books.every((b) => b.finished);
      for (const b of books) await updateBook(b.id, finish ? { finished: true } : { finished: false, progress: 0, location: null, chapter: '' }, { quiet: true });
      State.emit();
      return toast(`${books.length} ${books.length === 1 ? 'book' : 'books'} marked as ${finish ? 'finished' : 'unread'}`, 1800);
    }
    if (act === 'fav') {
      const fav = !books.every((b) => b.favorite);
      for (const b of books) await updateBook(b.id, { favorite: fav }, { quiet: true });
      return State.emit();
    }
    if (act === 'shelf') {
      const r = btn.getBoundingClientRect();
      const addTo = async (shelfId) => {
        for (const b of books) if (!(b.shelves || []).includes(shelfId)) await updateBook(b.id, { shelves: [...(b.shelves || []), shelfId] }, { quiet: true });
        State.emit();
        const s = State.shelves.find((x) => x.id === shelfId);
        toast(`Added to <em>${esc(s?.name || 'the shelf')}</em>`, 1800);
      };
      openMenu(r.left, r.top - 8, [
        ...State.shelves.map((s) => ({ label: s.name, icon: 'shelf', run: () => addTo(s.id) })),
        ...(State.shelves.length ? ['-'] : []),
        {
          label: 'New shelf…',
          icon: 'plus',
          run: async () => {
            const name = await promptText({ title: 'A new shelf', sub: `For the ${books.length} ${books.length === 1 ? 'book' : 'books'} you chose.`, placeholder: 'e.g. Autumn evenings', okLabel: 'Create' });
            if (!name?.trim()) return;
            const snap = await window.aion.createShelf(name);
            State.set(snap);
            await addTo(snap.shelves[snap.shelves.length - 1].id);
          },
        },
      ]);
    }
  }

  // ---------- moving around the grid with the keyboard ----------
  // Arrow keys move between books (up and down by row), Home and End to the
  // first and last, Enter opens, Space chooses, Delete removes.
  function moveFocus(card, key) {
    const cards = gridCards();
    const i = cards.indexOf(card);
    if (i < 0) return null;
    if (key === 'ArrowLeft') return cards[i - 1];
    if (key === 'ArrowRight') return cards[i + 1];
    if (key === 'Home') return cards[0];
    if (key === 'End') return cards[cards.length - 1];
    const here = card.getBoundingClientRect();
    const x = here.left + here.width / 2;
    const down = key === 'ArrowDown';
    // The nearest card, by column, in the next row up or down.
    let best = null;
    let bestScore = Infinity;
    for (const c of cards) {
      const r = c.getBoundingClientRect();
      const dy = down ? r.top - here.bottom : here.top - r.bottom;
      if (dy < -here.height / 2) continue;
      if (c === card || (down ? r.top <= here.top + 4 : r.top >= here.top - 4)) continue;
      const score = Math.abs(r.top - here.top) * 4 + Math.abs(r.left + r.width / 2 - x);
      if (score < bestScore) (bestScore = score), (best = c);
    }
    return best;
  }

  async function editMeta(id) {
    const b = State.book(id);
    await openModal(
      `<h3>Edit details</h3><div class="sub">How this book appears on your shelves.</div>` +
        `<input type="text" id="eTitle" value="${esc(b.title)}" placeholder="Title" spellcheck="false" style="margin-bottom:10px">` +
        `<input type="text" id="eAuthor" value="${esc(b.author)}" placeholder="Author" spellcheck="false">` +
        `<div class="actions"><button class="ghost-btn" data-x>Cancel</button><button class="solid-btn" data-ok>Save</button></div>`,
      {
        onMount(m, close) {
          $('#eTitle', m).focus();
          const save = async () => {
            const title = $('#eTitle', m).value.trim();
            const author = $('#eAuthor', m).value.trim();
            if (title) await updateBook(id, { title, author: author || 'Unknown author' });
            close(true);
          };
          $('[data-ok]', m).onclick = save;
          $('[data-x]', m).onclick = () => close(false);
          m.addEventListener('keydown', (e) => e.key === 'Enter' && save());
        },
      }
    );
  }

  async function chooseShelves(id) {
    const b = State.book(id);
    const rows = () =>
      State.shelves
        .map(
          (s) =>
            `<label class="check-row"><input type="checkbox" value="${s.id}" ${(b.shelves || []).includes(s.id) ? 'checked' : ''}>${esc(s.name)}</label>`
        )
        .join('') || `<div class="sub" style="padding:6px 10px">You have no shelves yet.</div>`;
    await openModal(
      `<h3>Shelves</h3><div class="sub">Where should <em>${esc(b.title)}</em> live?</div>` +
        `<div class="check-list" id="shelfChecks">${rows()}</div>` +
        `<div class="actions"><button class="ghost-btn" data-new style="margin-right:auto">${icon('plus')} New shelf</button><button class="solid-btn" data-ok>Done</button></div>`,
      {
        onMount(m, close) {
          $('[data-ok]', m).onclick = async () => {
            const shelves = $$('#shelfChecks input:checked', m).map((i) => i.value);
            await updateBook(id, { shelves });
            close(true);
          };
          $('[data-new]', m).onclick = async () => {
            const checked = $$('#shelfChecks input:checked', m).map((i) => i.value);
            close(false);
            const name = await promptText({ title: 'A new shelf', placeholder: 'e.g. Autumn evenings', okLabel: 'Create' });
            if (name && name.trim()) {
              const snap = await window.aion.createShelf(name);
              State.set(snap);
              const newShelf = snap.shelves[snap.shelves.length - 1];
              await updateBook(id, { shelves: [...checked, newShelf.id] });
              chooseShelves(id);
            }
          };
        },
      }
    );
  }

  function showDetails(id) {
    const b = State.book(id);
    const fmt = (t) => (t ? new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }) : '—');
    const rows = [
      ['Publisher', b.publisher],
      ['Published', b.published],
      ['Language', b.language],
      ['Added', fmt(b.addedAt)],
      ['Last read', b.lastOpenedAt ? fmt(b.lastOpenedAt) : 'Not yet'],
      ['Progress', b.finished ? 'Finished' : pct(b.progress)],
      ['Highlights', (b.highlights || []).length || '—'],
      ['Shelves', (b.shelves || []).map((s) => State.shelves.find((x) => x.id === s)?.name).filter(Boolean).join(', ') || '—'],
    ].filter(([, v]) => v);
    openModal(
      `<button class="icon-btn close" data-x>${icon('close')}</button>` +
        `<div class="details"><div>${coverHtml(b)}</div><div>` +
        `<h3>${esc(b.title)}</h3><div class="by">${esc(b.author)}</div>` +
        `<div class="detail-rating">${stars(b.rating, { id: b.id, interactive: true })}<span class="hint">${b.rating ? '' : 'Your rating'}</span></div>` +
        `${Painted.divider()}` +
        (b.description ? `<div class="desc">${esc(b.description)}</div>` : '') +
        `<dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl>` +
        `<div class="actions" style="justify-content:flex-start"><button class="solid-btn" data-read>${b.progress > 0 ? 'Continue reading' : 'Begin reading'}</button></div>` +
        `</div></div>`,
      {
        wide: true,
        onMount(m, close) {
          $('[data-x]', m).onclick = () => close();
          $('[data-read]', m).onclick = () => {
            close();
            openBook(id);
          };
        },
      }
    );
  }

  function shelfMenu(id, x, y) {
    const s = State.shelves.find((s) => s.id === id);
    openMenu(x, y, [
      {
        label: 'Rename shelf',
        icon: 'edit',
        run: async () => {
          const name = await promptText({ title: 'Rename shelf', value: s.name });
          if (name) State.set(await window.aion.renameShelf(id, name));
        },
      },
      {
        label: 'Delete shelf',
        icon: 'trash',
        danger: true,
        run: async () => {
          const ok = await confirmBox({
            title: 'Delete this shelf?',
            sub: `The shelf <em>${esc(s.name)}</em> will be taken down. Its books stay in your library.`,
            okLabel: 'Delete',
          });
          if (ok) State.set(await window.aion.deleteShelf(id));
        },
      },
    ]);
  }

  // ---------- wiring ----------
  function bind() {
    $('#addShelf').innerHTML = icon('plus');
    $('#openSettings').innerHTML = `${icon('gear')}<span>Settings</span>`;
    $('#openSettings').onclick = openSettings;
    $('#openStats').innerHTML = `${icon('chart')}<span>Your reading</span>`;
    $('#openStats').onclick = openStats;
    $('#goalRow').onclick = openStats;
    $('#openCommonplace').innerHTML = `${icon('quote')}<span>Commonplace book</span>`;
    $('#openCommonplace').onclick = openCommonplace;
    $('#addBooks').innerHTML = `${icon('plus')}<span>Add books</span>`;
    $('#addFolder').innerHTML = `${icon('folder')}<span>Add a folder</span>`;
    $('#searchIcon').outerHTML = icon('search');
    $('#wallClimber').innerHTML = Painted.wallClimber();
    $('#headingOrnament').innerHTML = Painted.divider();
    $('#emptyArt').innerHTML = Painted.wreath();
    $('#dropArt').innerHTML = Painted.wreath();

    $('#addBooks').onclick = () => addBooks('files');
    $('#addFolder').onclick = () => addBooks('folder');
    $('#emptyActions').onclick = (e) => {
      const a = e.target.closest('[data-action]')?.dataset.action;
      if (a === 'add-books') addBooks('files');
      if (a === 'add-folder') addBooks('folder');
    };
    $('#addShelf').onclick = async () => {
      const name = await promptText({ title: 'A new shelf', sub: 'Group books however you like.', placeholder: 'e.g. Autumn evenings', okLabel: 'Create' });
      if (name && name.trim()) {
        const snap = await window.aion.createShelf(name);
        view = `shelf:${snap.shelves[snap.shelves.length - 1].id}`;
        State.set(snap);
      }
    };

    const navClick = (e) => {
      const b = e.target.closest('.nav-item');
      if (!b) return;
      view = b.dataset.view;
      selected.clear();
      $('#libScroll').scrollTop = 0;
      render();
    };
    $('#nav').onclick = navClick;
    $('#shelfNav').onclick = navClick;
    $('#shelfNav').oncontextmenu = (e) => {
      const b = e.target.closest('[data-shelf]');
      if (b) {
        e.preventDefault();
        shelfMenu(b.dataset.shelf, e.clientX, e.clientY);
      }
    };

    let qt;
    $('#search').addEventListener('input', (e) => {
      clearTimeout(qt);
      qt = setTimeout(() => {
        query = e.target.value.trim();
        if (PAGES[view]) view = 'all';
        render();
      }, 120);
    });
    $('#sort').addEventListener('change', async (e) => {
      await setSettings({ sort: e.target.value });
      render();
    });

    $('#libMain').addEventListener('click', (e) => {
      const fav = e.target.closest('[data-fav]');
      if (fav) {
        e.stopPropagation();
        const b = State.book(fav.dataset.fav);
        if (!b.favorite) {
          const r = fav.getBoundingClientRect();
          UI.burst(r.left + r.width / 2, r.top + r.height / 2);
        }
        updateBook(b.id, { favorite: !b.favorite });
        return;
      }
      const crumb = e.target.closest('[data-goto]');
      if (crumb) {
        view = crumb.dataset.goto;
        return render();
      }
      const ser = e.target.closest('[data-series]');
      if (ser) {
        view = `series:${ser.dataset.series}`;
        $('#libScroll').scrollTop = 0;
        return render();
      }
      const open = e.target.closest('[data-open]');
      if (open) return openBook(open.dataset.open);
      const card = e.target.closest('.card');
      if (card?.dataset.id && (e.ctrlKey || e.metaKey || e.shiftKey)) {
        e.preventDefault();
        return select(card.dataset.id, { range: e.shiftKey, toggle: !e.shiftKey });
      }
      if (card) {
        clearSelection();
        openBook(card.dataset.id);
      }
    });
    $('#selectBar').addEventListener('click', (e) => {
      const b = e.target.closest('[data-sel]');
      if (b) onSelectionAction(b.dataset.sel, b);
    });
    $('#libMain').addEventListener('keydown', (e) => {
      const card = e.target.closest?.('.card');
      if (!card) return;
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) {
        const next = moveFocus(card, e.key);
        e.preventDefault();
        if (!next) return;
        next.focus({ preventScroll: true });
        next.scrollIntoView({ block: 'nearest' });
        if (e.shiftKey && next.dataset.id) {
          anchor ||= card.dataset.id;
          select(next.dataset.id, { range: true });
        }
        return;
      }
      if (e.key === ' ' && card.dataset.id) {
        e.preventDefault();
        return select(card.dataset.id, { toggle: true });
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && card.dataset.id) {
        e.preventDefault();
        return removeBooks(selected.size ? [...selected] : [card.dataset.id]);
      }
      if (e.key !== 'Enter') return;
      if (card.dataset.series) {
        view = `series:${card.dataset.series}`;
        render();
      } else openBook(card.dataset.id);
    });
    // Drag a book to rearrange the shelf. The card is moved live in the grid;
    // on drop the new order is saved and the sort switches to "My order".
    let dragged = null;
    let startOrder = '';
    const grid = $('#grid');
    const gridIds = () => [...grid.querySelectorAll('.card')].map((c) => c.dataset.id);
    grid.addEventListener('dragstart', (e) => {
      const card = e.target.closest('.card');
      if (!card || query) return e.preventDefault();
      dragged = card;
      startOrder = gridIds().join();
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('application/x-aion-book', card.dataset.id);
      requestAnimationFrame(() => card.classList.add('dragging'));
    });
    grid.addEventListener('dragover', (e) => {
      if (!dragged) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const over = e.target.closest('.card');
      if (!over || over === dragged) return;
      const r = over.getBoundingClientRect();
      const before = e.clientX < r.left + r.width / 2;
      const ref = before ? over : over.nextElementSibling;
      if (ref !== dragged && dragged.nextElementSibling !== ref) grid.insertBefore(dragged, ref);
    });
    grid.addEventListener('drop', (e) => {
      if (dragged) e.preventDefault();
    });
    grid.addEventListener('dragend', () => {
      if (!dragged) return;
      const card = dragged;
      dragged = null;
      card.classList.remove('dragging');
      const ids = gridIds();
      if (ids.join() === startOrder) return;
      commitOrder(ids, card.dataset.id);
    });

    $('#libMain').addEventListener('contextmenu', (e) => {
      const card = e.target.closest('.card, [data-open]');
      if (!card) return;
      e.preventDefault();
      bookMenu(card.dataset.id || card.dataset.open, e.clientX, e.clientY);
    });

    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.key === ',' && $('#modalBack').hidden) {
        e.preventDefault();
        return openSettings();
      }
      if (!$('#library').classList.contains('is-active') || !$('#modalBack').hidden) return;
      if ((e.ctrlKey && e.key === 'f') || (e.key === '/' && document.activeElement.tagName !== 'INPUT')) {
        e.preventDefault();
        $('#search').focus();
      } else if (e.ctrlKey && e.key === 'o') {
        e.preventDefault();
        addBooks('files');
      } else if (e.ctrlKey && e.key === 'a' && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) {
        e.preventDefault();
        gridCards().forEach((c) => selected.add(c.dataset.id));
        paintSelection();
      } else if (e.key === 'Escape' && selected.size && document.activeElement !== $('#search')) {
        clearSelection();
      } else if (e.key === 'Escape' && document.activeElement === $('#search')) {
        $('#search').value = '';
        query = '';
        $('#search').blur();
        render();
      }
    });

    // Drag & drop anywhere
    let depth = 0;
    const hasFiles = (e) => Array.from(e.dataTransfer?.types || []).includes('Files');
    window.addEventListener('dragenter', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth++;
      $('#dropZone').hidden = false;
    });
    window.addEventListener('dragover', (e) => {
      if (hasFiles(e)) e.preventDefault();
    });
    window.addEventListener('dragleave', () => {
      depth = Math.max(0, depth - 1);
      if (!depth) $('#dropZone').hidden = true;
    });
    window.addEventListener('drop', async (e) => {
      e.preventDefault();
      depth = 0;
      $('#dropZone').hidden = true;
      if (!e.dataTransfer?.files?.length) return;
      const res = await window.aion.importFiles(e.dataTransfer.files);
      afterImport(res);
    });

    // Library changed outside this window: watched folder, a synced copy, series backfill.
    window.aion.onLibraryChanged((snap) => State.set(snap));
    window.aion.onAutoImport(({ added }) => toast(`${added} new ${added === 1 ? 'book' : 'books'} from your watched folder`, 3000));
    window.aion.onUpdateStatus((s) => {
      if (s.state === 'ready') {
        toast(`Aion Books ${esc(s.version)} is ready <button class="toast-btn" data-update-install>Restart to update</button>`, 0);
      }
    });
    $('#toast').addEventListener('click', (e) => {
      if (e.target.closest('[data-update-install]')) return window.aion.installUpdate();
      const b = e.target.closest('[data-open]');
      if (!b) return;
      $('#toast').hidden = true;
      if ($('#reader').classList.contains('is-active')) Reader.open(b.dataset.open);
      else openBook(b.dataset.open);
    });

    window.aion.onOpenBook((id) => {
      State.getFresh().then(() => Reader.open(id));
    });
  }

  State.getFresh = async function () {
    State.set(await window.aion.getLibrary());
  };

  State.on(() => {
    if ($('#library').classList.contains('is-active')) render();
  });

  async function boot() {
    bind();
    Reader.bind();
    window.Settings.bind();
    window.Journal.bind();
    const snap = await window.aion.getLibrary();
    UI.applyRoot(snap.settings);
    $('#sort').value = snap.settings.sort || 'recent';
    State.set(snap);
    window.aion.ready();
  }

  window.Library = { openSettings, openStats, openCommonplace, refreshGoal, nextInSeries };
  boot();
})();
