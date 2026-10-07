// Shared UI helpers: state, menus, modals, toasts, covers.
(function () {
  const { icon, wreath } = window.Ornaments;

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  // User-added fonts: @font-face CSS per family, injected into the app and into book pages.
  const Fonts = {
    css: {},
    listeners: new Set(),
    BUNDLED: [
      ['EB Garamond', 'Garamond'],
      ['Literata', 'Literata'],
      ['Lora', 'Lora'],
      ['IM Fell English', 'Fell'],
    ],
    async refresh() {
      this.css = await window.aion.customFontCss();
      let el = document.getElementById('custom-fonts');
      if (!el) {
        el = document.createElement('style');
        el.id = 'custom-fonts';
        document.head.appendChild(el);
      }
      el.textContent = Object.values(this.css).join('\n');
      for (const fn of this.listeners) fn();
    },
    custom() {
      return (State.fonts || []).map((f) => f.family);
    },
    // [value, label, isCustom] for every choosable typeface
    choices() {
      return [...this.BUNDLED, ...this.custom().map((f) => [f, f, true]), ['Original', 'Publisher’s']];
    },
    faceCss(family) {
      return this.css[family] || '';
    },
  };

  const State = {
    books: [],
    shelves: [],
    orders: {},
    fonts: [],
    settings: {},
    listeners: new Set(),
    hidden: new Set(), // removed, but the Undo is still on offer
    set(snapshot) {
      if (snapshot.books) this.books = window.Series.group(snapshot.books.filter((b) => !this.hidden.has(b.id)));
      if (snapshot.shelves) this.shelves = snapshot.shelves;
      if (snapshot.settings) this.settings = snapshot.settings;
      if (snapshot.orders) this.orders = snapshot.orders;
      if (snapshot.seriesInfo) this.seriesInfo = snapshot.seriesInfo;
      if (snapshot.fonts) {
        const changed = JSON.stringify(snapshot.fonts) !== JSON.stringify(this.fonts);
        this.fonts = snapshot.fonts;
        if (changed) Fonts.refresh();
      }
      this.emit();
    },
    patchBook(updated) {
      if (!updated) return;
      const i = this.books.findIndex((b) => b.id === updated.id);
      if (i >= 0) this.books[i] = updated;
      window.Series.group(this.books);
      this.emit();
    },
    book(id) {
      return this.books.find((b) => b.id === id);
    },
    on(fn) {
      this.listeners.add(fn);
    },
    emit() {
      for (const fn of this.listeners) fn();
    },
  };

  async function updateBook(id, patch, { quiet = false } = {}) {
    const updated = await window.aion.updateBook(id, patch);
    if (!updated) return;
    if (quiet) {
      const i = State.books.findIndex((b) => b.id === id);
      if (i >= 0) State.books[i] = updated;
      window.Series.group(State.books); // keep it in its series
    } else {
      State.patchBook(updated);
    }
    return updated;
  }

  // Reflect app-wide settings on <html> so CSS can respond (theme, motion, decorations).
  function applyRoot(s) {
    const root = document.documentElement;
    root.dataset.theme = s.theme || 'linen';
    root.dataset.motion = s.motion || 'full';
    root.dataset.flora = s.flora === false ? 'off' : 'on';
  }

  async function setSettings(patch) {
    State.settings = await window.aion.setSettings(patch);
    applyRoot(State.settings);
    return State.settings;
  }

  // Full motion unless the user (or Windows) asked for less.
  const fullMotion = () => !reduceMotion.matches && (State.settings.motion || 'full') === 'full';

  // ---------- covers ----------
  const CLOTHS = ['#7b896a', '#99674f', '#5d6d77', '#8a5858', '#6e6a4c', '#9b7b4f', '#4f6658', '#7a5f73'];
  function hash(s) {
    let h = 0;
    for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) | 0;
    return Math.abs(h);
  }

  function coverHtml(book) {
    if (book.coverUrl) {
      return `<div class="cover"><img src="${esc(book.coverUrl)}" alt="" loading="lazy" decoding="async" draggable="false"></div>`;
    }
    const cloth = CLOTHS[hash(book.title + book.author) % CLOTHS.length];
    return (
      `<div class="cover blank" style="--cloth:${cloth}">${wreath()}` +
      `<div class="bt">${esc(book.title)}</div><div class="ba">${esc(book.author)}</div></div>`
    );
  }

  // ---------- toast ----------
  let toastTimer = null;
  function toast(html, ms = 2600) {
    const t = $('#toast');
    t.innerHTML = html;
    t.hidden = false;
    t.style.animation = 'none';
    void t.offsetWidth;
    t.style.animation = '';
    clearTimeout(toastTimer);
    if (ms) toastTimer = setTimeout(() => (t.hidden = true), ms);
  }

  // ---------- undo ----------
  // "Removed · Undo" instead of "Are you sure?": the change shows at once, and
  // is made final (commit) only when the moment to undo it has passed.
  let pendingUndo = null;
  function undoToast(html, { undo, commit, ms = 6000 } = {}) {
    settleUndo();
    const p = { undo, commit };
    p.timer = setTimeout(() => settleUndo(p), ms);
    pendingUndo = p;
    toast(`${html} <button class="toast-btn" data-undo>Undo</button>`, ms);
  }
  function settleUndo(p = pendingUndo) {
    if (!p || p !== pendingUndo) return;
    pendingUndo = null;
    clearTimeout(p.timer);
    p.commit?.();
  }
  $('#toast').addEventListener('click', (e) => {
    if (!e.target.closest('[data-undo]') || !pendingUndo) return;
    const p = pendingUndo;
    pendingUndo = null;
    clearTimeout(p.timer);
    $('#toast').hidden = true;
    p.undo?.();
  });
  // Closing the window makes anything pending final.
  window.addEventListener('beforeunload', () => settleUndo());

  // ---------- context menu ----------
  function openMenu(x, y, items) {
    const m = $('#menu');
    m.innerHTML = '';
    for (const it of items) {
      if (it === '-') {
        m.appendChild(document.createElement('hr'));
        continue;
      }
      if (it.stars) {
        const row = document.createElement('div');
        row.className = 'menu-stars';
        row.innerHTML = `<span>${esc(it.label || 'Your rating')}</span>${stars(State.book(it.stars)?.rating, { id: it.stars, interactive: true })}`;
        row.addEventListener('click', (e) => {
          if (e.target.closest('.star')) setTimeout(closeMenu, 260);
        });
        m.appendChild(row);
        continue;
      }
      const b = document.createElement('button');
      b.className = it.danger ? 'danger' : '';
      b.innerHTML = `${icon(it.icon || 'more')}<span>${esc(it.label)}</span>`;
      b.addEventListener('click', () => {
        closeMenu();
        it.run();
      });
      m.appendChild(b);
    }
    m.hidden = false;
    const r = m.getBoundingClientRect();
    m.style.left = `${Math.min(x, innerWidth - r.width - 10)}px`;
    m.style.top = `${Math.min(y, innerHeight - r.height - 10)}px`;
  }
  function closeMenu() {
    $('#menu').hidden = true;
  }
  document.addEventListener('mousedown', (e) => {
    if (!$('#menu').hidden && !e.target.closest('#menu')) closeMenu();
  });
  window.addEventListener('blur', closeMenu);

  // ---------- modal ----------
  let modalResolve = null;
  function openModal(html, { onMount, wide } = {}) {
    const back = $('#modalBack');
    const modal = $('#modal');
    modal.innerHTML = html;
    modal.style.width = wide ? 'min(720px, calc(100vw - 60px))' : '';
    back.hidden = false;
    return new Promise((resolve) => {
      modalResolve = resolve;
      onMount?.(modal, closeModal);
    });
  }
  function closeModal(value) {
    $('#modalBack').hidden = true;
    $('#modal').innerHTML = '';
    const r = modalResolve;
    modalResolve = null;
    r?.(value);
  }
  $('#modalBack').addEventListener('mousedown', (e) => {
    if (e.target.id === 'modalBack') closeModal(null);
  });

  function promptText({ title, sub = '', value = '', placeholder = '', okLabel = 'Save', multiline = false }) {
    const field = multiline
      ? `<textarea id="mInput" placeholder="${esc(placeholder)}">${esc(value)}</textarea>`
      : `<input type="text" id="mInput" value="${esc(value)}" placeholder="${esc(placeholder)}" spellcheck="false">`;
    return openModal(
      `<h3>${esc(title)}</h3>${sub ? `<div class="sub">${sub}</div>` : ''}${field}` +
        `<div class="actions"><button class="ghost-btn" data-x>Cancel</button><button class="solid-btn" data-ok>${esc(okLabel)}</button></div>`,
      {
        onMount(m, close) {
          const input = $('#mInput', m);
          input.focus();
          input.select?.();
          const ok = () => close(input.value);
          $('[data-ok]', m).onclick = ok;
          $('[data-x]', m).onclick = () => close(null);
          input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && (!multiline || e.ctrlKey)) ok();
          });
        },
      }
    );
  }

  function confirmBox({ title, sub, okLabel = 'Confirm' }) {
    return openModal(
      `<h3>${esc(title)}</h3><div class="sub">${sub}</div>` +
        `<div class="actions"><button class="ghost-btn" data-x>Cancel</button><button class="solid-btn" data-ok>${esc(okLabel)}</button></div>`,
      {
        onMount(m, close) {
          $('[data-ok]', m).onclick = () => close(true);
          $('[data-x]', m).onclick = () => close(false);
          $('[data-ok]', m).focus();
        },
      }
    );
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!$('#menu').hidden) {
        closeMenu();
        e.stopImmediatePropagation();
      } else if (!$('#modalBack').hidden) {
        closeModal(null);
        e.stopImmediatePropagation();
      }
    }
  }, true);

  const pct = (p) => `${Math.round((p || 0) * 100)}%`;

  // ---------- star ratings ----------
  const STAR = 'M12 3.6l2.5 5.3 5.8.7-4.3 4 1.1 5.7L12 16.5l-5.1 2.8 1.1-5.7-4.3-4 5.8-.7z';
  function stars(rating, { id = '', interactive = false, cls = '' } = {}) {
    const r = Math.max(0, Math.min(5, Math.round(rating || 0)));
    let out = '';
    for (let n = 1; n <= 5; n++) {
      const svg = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${STAR}"/></svg>`;
      out += interactive
        ? `<button class="star ${n <= r ? 'on' : ''}" data-star="${n}" aria-label="${n} star${n > 1 ? 's' : ''}">${svg}</button>`
        : `<span class="star ${n <= r ? 'on' : ''}">${svg}</span>`;
    }
    const label = r ? `Rated ${r} out of 5` : 'Not rated';
    return `<span class="stars ${interactive ? 'rate' : ''} ${cls}" data-rate-id="${id}" role="${interactive ? 'group' : 'img'}" aria-label="${label}" title="${interactive ? (r ? `${label} — click the same star to clear` : 'Rate this book') : label}">${out}</span>`;
  }

  function paintStars(group, r) {
    group.querySelectorAll('.star').forEach((s) => s.classList.toggle('on', Number(s.dataset.star) <= r));
  }

  // One handler for every interactive star row in the app.
  document.addEventListener('click', async (e) => {
    const star = e.target.closest('.stars.rate .star');
    if (!star) return;
    e.stopPropagation();
    const group = star.closest('.stars');
    const id = group.dataset.rateId;
    const book = State.book(id);
    if (!book) return;
    const n = Number(star.dataset.star);
    const rating = (book.rating || 0) === n ? 0 : n;
    paintStars(group, rating);
    await updateBook(id, { rating });
    // Keep every other visible star row for this book in sync.
    document.querySelectorAll(`.stars[data-rate-id="${id}"]`).forEach((g) => paintStars(g, rating));
  });
  document.addEventListener('mouseover', (e) => {
    const star = e.target.closest('.stars.rate .star');
    if (star) paintStars(star.closest('.stars'), Number(star.dataset.star));
  });
  document.addEventListener('mouseout', (e) => {
    const group = e.target.closest('.stars.rate');
    if (group && !group.contains(e.relatedTarget)) paintStars(group, State.book(group.dataset.rateId)?.rating || 0);
  });

  // ---------- stop-motion cut-outs ----------
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

  function cutoutLayer() {
    const layer = document.createElement('div');
    layer.className = 'cutout-layer';
    document.body.appendChild(layer);
    return layer;
  }

  // A gust of painted leaves and bougainvillea tumbling across the page.
  function flurry() {
    if (!fullMotion()) return;
    const layer = cutoutLayer();
    const W = innerWidth;
    const H = innerHeight;
    const kinds = ['ivy', 'ivy', 'bract', 'olive', 'ivy', 'bract', 'olive', 'ivy'];
    const n = 8;
    let done = 0;
    for (let i = 0; i < n; i++) {
      const el = document.createElement('div');
      el.className = 'cutout';
      el.innerHTML = window.Painted.piece(kinds[i % kinds.length], 100 + i);
      const size = 34 + Math.random() * 30;
      el.style.width = el.style.height = `${size}px`;
      layer.appendChild(el);
      const x0 = -80 + Math.random() * W * 0.35;
      const y0 = H * (0.55 + Math.random() * 0.5);
      const x1 = x0 + W * (0.75 + Math.random() * 0.35);
      const y1 = -100 - Math.random() * H * 0.3;
      const r0 = Math.random() * 360;
      const spin = (Math.random() < 0.5 ? -1 : 1) * (200 + Math.random() * 280);
      const mx = lerpN(x0, x1, 0.5) + (Math.random() - 0.5) * 160;
      const my = lerpN(y0, y1, 0.5) - 60 + Math.random() * 120;
      el.animate(
        [
          { transform: `translate(${x0}px, ${y0}px) rotate(${r0}deg)` },
          { transform: `translate(${mx}px, ${my}px) rotate(${r0 + spin / 2}deg) scale(1.08)` },
          { transform: `translate(${x1}px, ${y1}px) rotate(${r0 + spin}deg)` },
        ],
        { duration: 1000 + Math.random() * 300, delay: i * 35, easing: 'steps(11, end)', fill: 'both' }
      ).finished.then(() => {
        if (++done === n) layer.remove();
      });
    }
  }
  const lerpN = (a, b, t) => a + (b - a) * t;

  // A little burst of painted petals from a point (e.g. the favorite heart).
  function burst(x, y) {
    if (!fullMotion()) return;
    const layer = cutoutLayer();
    const n = 8;
    let done = 0;
    for (let i = 0; i < n; i++) {
      const el = document.createElement('div');
      el.className = 'cutout';
      el.innerHTML = window.Painted.piece(i % 3 ? 'bract' : 'petal', 300 + i);
      el.style.width = el.style.height = '22px';
      layer.appendChild(el);
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.5;
      const d = 34 + Math.random() * 26;
      const r0 = Math.random() * 360;
      el.animate(
        [
          { transform: `translate(${x - 11}px, ${y - 11}px) rotate(${r0}deg) scale(.3)`, opacity: 1 },
          { transform: `translate(${x - 11 + Math.cos(a) * d * 0.7}px, ${y - 11 + Math.sin(a) * d * 0.7}px) rotate(${r0 + 90}deg) scale(1)`, opacity: 1 },
          { transform: `translate(${x - 11 + Math.cos(a) * d}px, ${y - 11 + Math.sin(a) * d + 16}px) rotate(${r0 + 160}deg) scale(.8)`, opacity: 0 },
        ],
        { duration: 620, easing: 'steps(6, end)', fill: 'both' }
      ).finished.then(() => {
        if (++done === n) layer.remove();
      });
    }
  }

  window.UI = {
    $, $$, esc, State, updateBook, setSettings, coverHtml, toast, undoToast, settleUndo,
    openMenu, closeMenu, openModal, closeModal, promptText, confirmBox, pct, flurry, burst, applyRoot, fullMotion, Fonts, stars,
  };
})();
