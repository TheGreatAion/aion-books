// The page after the last page. Turning on from a book's final page closes it
// and opens this: you finished it, how long it took, stars to rate it, and,
// for a book in a series, the next one a click away.
(function () {
  const { $, esc, State, coverHtml, stars } = window.UI;
  const { icon } = window.Ornaments;

  const el = () => $('#finished');

  function took(b) {
    const parts = [];
    if (b.startedAt && b.finishedAt) {
      const days = Math.max(1, Math.round((b.finishedAt - b.startedAt) / 864e5));
      parts.push(days === 1 ? 'Read in a day' : `Read in ${days} days`);
    }
    if (b.readingMs >= 60000) {
      const m = Math.round(b.readingMs / 60000);
      const h = Math.floor(m / 60);
      parts.push(h ? `${h} h${m % 60 ? ` ${m % 60} min` : ''} of reading` : `${m} min of reading`);
    }
    return parts.join(' · ');
  }

  function show(id) {
    const b = State.book(id);
    if (!b) return;
    const next = window.Library?.nextInSeries(b);
    const series = b.seriesId ? State.books.filter((x) => x.seriesId === b.seriesId) : [];
    const seriesDone = series.length > 1 && !next && series.every((x) => x.finished || x.id === b.id);
    const line = took(b);
    const after = next
      ? `<div class="fin-next"><div class="eyebrow">Continue the series</div>` +
        `<button class="fin-book" data-fin-open="${esc(next.id)}">` +
        `<span class="fin-book-cover">${coverHtml(next)}</span>` +
        `<span class="fin-book-text"><span class="fin-book-ser">${next.seriesNo != null ? `Book ${esc(String(next.seriesNo))} · ` : ''}${esc(next.seriesName || '')}</span>` +
        `<span class="fin-book-title">${esc(next.title)}</span>` +
        `<span class="solid-btn">${next.progress > 0 ? 'Continue reading' : 'Begin reading'} ${icon('next')}</span></span></button></div>`
      : seriesDone
        ? `<div class="fin-next"><div class="eyebrow">${esc(b.seriesName)}</div><p class="fin-done">That’s the whole series, every book read.</p></div>`
        : '';
    el().innerHTML =
      `<div class="fin-page">` +
      `<div class="fin-wreath" aria-hidden="true">${window.Painted?.wreath?.() || ''}</div>` +
      `<div class="eyebrow">Finished</div>` +
      `<div class="fin-cover">${coverHtml(b)}</div>` +
      `<h1>${esc(b.title)}</h1>` +
      (b.author ? `<div class="fin-by">${esc(b.author)}</div>` : '') +
      (line ? `<div class="fin-took">${line}</div>` : '') +
      `<div class="fin-rate"><span>How was it?</span>${stars(b.rating || 0, { id: b.id, interactive: true, cls: 'big' })}</div>` +
      after +
      `<button class="ghost-btn fin-back" data-fin-close>${next ? 'Not now, back to your library' : 'Back to your library'}</button>` +
      `</div>`;
    el().hidden = false;
    requestAnimationFrame(() => el().classList.add('is-open'));
    (el().querySelector('[data-fin-open]') || el().querySelector('[data-fin-close]'))?.focus({ focusVisible: false });
  }

  function hide() {
    el().classList.remove('is-open');
    el().hidden = true;
    el().innerHTML = '';
  }

  function bind() {
    el().addEventListener('click', (e) => {
      const open = e.target.closest('[data-fin-open]');
      if (open) {
        hide();
        return window.Reader.open(open.dataset.finOpen);
      }
      if (e.target.closest('[data-fin-close]')) hide();
    });
    document.addEventListener(
      'keydown',
      (e) => {
        if (e.key === 'Escape' && !el().hidden) {
          e.stopPropagation();
          hide();
        }
      },
      true
    );
  }

  window.Finished = { show, hide, bind };
  bind();
})();
