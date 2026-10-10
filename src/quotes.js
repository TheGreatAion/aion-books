// The quote beside Continue reading: a different one each time AionBooks opens.
//
// Quotes come from public-domain books (src/quote-list.js), and now and then
// from the passages you've highlighted yourself. They're dealt like a shuffled
// deck, so none comes round again until you've seen them all. The quote stays
// the same until AionBooks is closed.
(function () {
  const BAG = 'aion.quoteBag';
  const MINE_EVERY = 4; // about one open in four shows one of your highlights
  const MAX_MINE = 180; // characters: a highlight longer than this won't fit beside the hero

  const store = {
    get(key) {
      try {
        return JSON.parse(localStorage.getItem(key) || 'null');
      } catch {
        return null;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch {
        /* private or full storage: the deck just starts afresh next time */
      }
    },
  };

  // The next card from the shuffled deck (a fresh shuffle once it's used up).
  function draw(count) {
    let bag = store.get(BAG);
    if (!Array.isArray(bag) || !bag.length || bag.some((i) => i >= count)) {
      bag = [...Array(count).keys()];
      for (let i = bag.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [bag[i], bag[j]] = [bag[j], bag[i]];
      }
    }
    const next = bag.shift();
    store.set(BAG, bag);
    return next;
  }

  // One of your own highlights that's short enough to sit beside the hero.
  function fromYourBooks(books) {
    const mine = [];
    for (const b of books) {
      for (const h of b.highlights || []) {
        const text = String(h.text || '').trim();
        if (text.length >= 20 && text.length <= MAX_MINE) mine.push({ text, author: b.author, source: b.title, book: b.id, cfi: h.cfi, mine: true });
      }
    }
    return mine.length ? mine[Math.floor(Math.random() * mine.length)] : null;
  }

  let chosen;
  /** This session's quote: { text, author, source?, mine?, book?, cfi? } or null. */
  function today(books = []) {
    if (chosen !== undefined) return chosen;
    const list = window.QUOTE_LIST || [];
    const mine = Math.random() < 1 / MINE_EVERY ? fromYourBooks(books) : null;
    chosen = mine || (list.length ? list[draw(list.length)] : fromYourBooks(books));
    return chosen;
  }

  window.Quotes = { today };
})();
