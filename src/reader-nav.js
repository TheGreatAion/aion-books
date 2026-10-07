// Finding your way around a book without losing your place:
//   - after a jump (the contents, a search result, a footnote, a bookmark,
//     "Who is this?", a passage from the commonplace book, the progress bar),
//     a small button offers to take you back to where you were reading;
//   - dragging the progress bar shows which chapter you'd land in.
(function () {
  const { $, esc } = window.UI;
  const R = window.Reader;
  const _goTo = R.goTo;
  const _open = R.open;

  Object.assign(R, {
    // Remember where you were before a jump. A run of jumps (searching, then
    // checking a footnote) still leads back to where you were reading.
    markJump() {
      if (!this.view || !this.loc || this.returnTo) return;
      this.returnTo = { cfi: this.placeCfi(), chapter: this.chapter, pct: Math.round((this.progress || 0) * 100) };
      const pill = $('#backPill');
      $('[data-back] span', pill).textContent = [this.returnTo.chapter, `${this.returnTo.pct}%`].filter(Boolean).join(' · ');
      pill.hidden = false;
    },
    forgetJump() {
      this.returnTo = null;
      $('#backPill').hidden = true;
    },
    async backToReading() {
      const to = this.returnTo;
      this.forgetJump();
      if (to && this.view) await this.view.goTo(to.cfi);
    },

    goTo(target) {
      this.markJump();
      return _goTo.call(this, target);
    },
    async open(...args) {
      this.forgetJump();
      return _open.apply(this, args);
    },

    // ---------- the progress bar ----------
    // Each contents entry's place in the book, worked out when a drag begins.
    scrubStops() {
      const stops = [];
      for (const item of this.flatToc || []) {
        let f = null;
        try {
          f = this.tocFraction(item, this.loc || {});
        } catch (_) {}
        if (f != null) stops.push([f, item.label]);
      }
      return stops.sort((a, b) => a[0] - b[0]);
    },
    showScrubTip(fraction) {
      const tip = $('#scrubTip');
      const range = $('#rProgress');
      this.stops ||= this.scrubStops();
      let label = '';
      for (const [f, l] of this.stops) {
        if (f <= fraction + 1e-6) label = l;
        else break;
      }
      tip.innerHTML = `${label ? `<b>${esc(label)}</b>` : ''}<span>${Math.round(fraction * 100)}%</span>`;
      tip.hidden = false;
      const r = range.getBoundingClientRect();
      const foot = range.offsetParent?.getBoundingClientRect() || { left: 0, width: innerWidth };
      const x = r.left - foot.left + fraction * r.width;
      const half = tip.offsetWidth / 2;
      tip.style.left = `${Math.max(half + 8, Math.min(foot.width - half - 8, x))}px`;
    },
    hideScrubTip() {
      $('#scrubTip').hidden = true;
      this.stops = null;
    },
  });

  // ---------- wiring ----------
  $('#backPill').addEventListener('click', (e) => {
    if (e.target.closest('[data-back-x]')) return R.forgetJump();
    if (e.target.closest('[data-back]')) R.backToReading();
  });
  const range = $('#rProgress');
  range.addEventListener('pointerdown', () => (R.stops = null));
  range.addEventListener('input', () => R.showScrubTip(range.value / 1000));
  // Capture: note the place before the reader's own handler makes the jump.
  range.addEventListener('change', () => R.markJump(), true);
  range.addEventListener('change', () => R.hideScrubTip());
  range.addEventListener('pointerup', () => R.hideScrubTip());
  range.addEventListener('blur', () => R.hideScrubTip());
})();
