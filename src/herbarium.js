// Pressed flowers: every book you finish leaves a sprig from the garden,
// pressed on a sheet with a small label, like a herbarium of what you've read.
(function () {
  const { $, esc, State } = window.UI;

  const pressedOn = (t) =>
    new Date(t).toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' });

  function finished() {
    return State.books.filter((b) => b.finished).sort((a, b) => (b.finishedAt || 0) - (a.finishedAt || 0));
  }

  function sheet(b) {
    return (
      `<button class="herb-sheet" data-herb="${esc(b.id)}" title="${esc(b.title)}">` +
      `<span class="herb-specimen">${window.Painted.pressed(b.id)}</span>` +
      `<span class="herb-label"><span class="herb-title">${esc(b.title)}</span>` +
      (b.author ? `<span class="herb-by">${esc(b.author)}</span>` : '') +
      (b.finishedAt ? `<span class="herb-date">Pressed ${esc(pressedOn(b.finishedAt))}</span>` : '') +
      `</span></button>`
    );
  }

  function render() {
    const panel = $('#herbariumPanel');
    const books = finished();
    if (!books.length) {
      panel.innerHTML =
        `<div class="cp-empty">${window.Painted.divider()}<h3>Nothing pressed yet</h3>` +
        `<p>When you finish a book, a sprig from the garden is pressed here for it, with its name and the day you finished.</p></div>`;
      return;
    }
    panel.innerHTML =
      `<p class="herb-note">One for each book you’ve finished, ${books.length === 1 ? 'the first of many' : `${books.length} so far`}.</p>` +
      `<div class="herbarium">${books.map(sheet).join('')}</div>`;
  }

  function bind() {
    $('#herbariumPanel').addEventListener('click', (e) => {
      const s = e.target.closest('[data-herb]');
      if (s) window.Finished.show(s.dataset.herb);
    });
  }

  window.Herbarium = { render, bind };
})();
