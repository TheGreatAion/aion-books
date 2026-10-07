// The page curl: a stop-motion page turn.
//
// Just before a turn we take a picture of the page being turned. That picture
// becomes a paper leaf laid exactly over the real page, and the real turn
// happens underneath it, out of sight. The leaf then lifts from its outer
// edge, bends and folds over the spine in a handful of held frames, uncovering
// the new page beneath. Its back shows the old page faintly through the paper.
(function () {
  const STRIPS = 12; // vertical bands the leaf bends along
  const FRAMES = 7; // held drawings, stop-motion style
  let FRAME_MS = 52; // (tests slow this down to look at each frame)
  const LAG = 0.3; // how far the spine edge trails the free edge

  let current = null; // the leaf on screen, if any
  let seq = 0; // bumped whenever a turn is cut short, so older turns know to stop

  const clamp01 = (x) => Math.max(0, Math.min(1, x));
  const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const frame = () => new Promise((r) => requestAnimationFrame(() => r()));

  function el(cls, parent, style = {}) {
    const d = document.createElement('div');
    d.className = cls;
    Object.assign(d.style, style);
    parent?.appendChild(d);
    return d;
  }

  // Ends a turn at once (for a quick run of page turns, or leaving the book).
  function finish() {
    seq++;
    current?.remove();
    current = null;
  }

  /**
   * Turn the page with a curl.
   * @param dir    1 when the page goes right-to-left (forward in most books), -1 the other way
   * @param box    the page area, in window coordinates: { left, right, top, bottom, spine }
   *               (spine is null for a single page)
   * @param stage  the element the leaf is drawn in
   * @param turn   starts the real turn; resolves true once the new page is showing, false if nothing turned
   */
  async function turn({ dir, box, stage, turn }) {
    finish();
    const id = seq;
    const stale = () => id !== seq;
    const W = box.right - box.left;
    const H = box.bottom - box.top;
    // The leaf: for two pages, the half on the side we're turning from; for one page, all of it.
    const spine = box.spine ?? (dir > 0 ? box.left : box.right);
    const leafL = dir > 0 ? spine : box.left;
    const leafR = dir > 0 ? box.right : spine;
    const leafW = leafR - leafL;
    if (W < 40 || H < 40 || leafW < 40) return turn();

    const buf = await window.aion.snapshot({ x: box.left, y: box.top, width: W, height: H }).catch(() => null);
    if (!buf) return turn();
    const url = URL.createObjectURL(new Blob([buf], { type: 'image/jpeg' }));
    const img = new Image();
    img.src = url;
    try {
      await img.decode();
    } catch (_) {
      URL.revokeObjectURL(url);
      return turn();
    }
    // A newer turn (or closing the book) came along while we were taking the picture.
    if (stale()) {
      URL.revokeObjectURL(url);
      return turn();
    }

    const sr = stage.getBoundingClientRect();
    const layer = el('curl-layer', null, {
      left: `${box.left - sr.left}px`,
      top: `${box.top - sr.top}px`,
      width: `${W}px`,
      height: `${H}px`,
      perspectiveOrigin: `${spine - box.left}px 50%`,
    });
    current = layer;
    const picture = (node, x) => {
      node.style.backgroundImage = `url(${url})`;
      node.style.backgroundSize = `${W}px ${H}px`;
      node.style.backgroundPosition = `${-x}px 0`;
    };

    // The far page (two-page spread only) stays as it was until the leaf lands on it.
    let far = null;
    if (box.spine != null) {
      const farL = dir > 0 ? box.left : spine;
      const farR = dir > 0 ? spine : box.right;
      far = el('curl-still', layer, { left: `${farL - box.left}px`, width: `${farR - farL}px` });
      picture(far, farL - box.left);
      far.shade = el('curl-shade', far, { background: `linear-gradient(${dir > 0 ? 270 : 90}deg, rgba(var(--stain), .32), transparent 45%)` });
    }

    // Shadow the lifted leaf casts on the newly uncovered page.
    const cast = el('curl-cast', layer, {
      left: `${leafL - box.left}px`,
      width: `${leafW}px`,
      background: `linear-gradient(${dir > 0 ? 90 : 270}deg, rgba(var(--stain), .30), rgba(var(--stain), .08) 40%, transparent 75%)`,
    });

    // The leaf: strips nested one inside the next, so each bends a little further than the last.
    const sw = leafW / STRIPS;
    const root = el('curl-leaf', layer, { left: `${leafL - box.left}px`, width: `${leafW}px` });
    const strips = [];
    let parent = root;
    for (let i = 0; i < STRIPS; i++) {
      // Strip 0 sits at the spine; the last one is the free edge.
      const s = el('curl-strip', parent, {
        width: `${sw}px`,
        [dir > 0 ? 'left' : 'right']: i === 0 ? '0px' : `${sw}px`,
        transformOrigin: dir > 0 ? 'left center' : 'right center',
      });
      const x = dir > 0 ? leafL - box.left + i * sw : leafR - box.left - (i + 1) * sw;
      const front = el('curl-face front', s);
      picture(front, x);
      const back = el('curl-face back', s);
      const ghost = el('curl-ghost', back);
      picture(ghost, x);
      s.frontShade = el('curl-shade', front);
      s.backShade = el('curl-shade', back);
      strips.push(s);
      parent = s;
    }

    const draw = (t) => {
      let prev = 0;
      strips.forEach((s, i) => {
        // The free edge leads; the spine edge follows.
        const lead = 1 - i / (STRIPS - 1);
        const p = clamp01((t - lead * LAG) / (1 - LAG));
        const a = 180 * ease(p) * (dir > 0 ? -1 : 1);
        s.style.transform = `rotateY(${(a - prev).toFixed(2)}deg)`;
        prev = a;
        const lit = Math.abs(Math.sin((a * Math.PI) / 180));
        s.frontShade.style.opacity = (lit * 0.45).toFixed(3);
        s.backShade.style.opacity = (lit * 0.35).toFixed(3);
      });
      cast.style.opacity = (Math.sin(Math.PI * clamp01(t * 1.2)) * 0.9).toFixed(3);
      if (far) far.shade.style.opacity = (clamp01((t - 0.45) / 0.55) * Math.sin(Math.PI * t) * 1.6).toFixed(3);
    };
    draw(0);
    stage.appendChild(layer);
    await frame();
    await frame();

    // Turn the real page underneath, out of sight.
    let turned = false;
    try {
      turned = await turn();
    } catch (_) {
      turned = false;
    }
    const done = () => {
      layer.remove();
      if (current === layer) current = null;
      URL.revokeObjectURL(url);
    };
    if (stale() || !turned) {
      done();
      return turned;
    }
    await frame();
    await frame();

    for (let f = 1; f <= FRAMES && !stale(); f++) {
      draw(f / FRAMES);
      await wait(FRAME_MS);
    }
    done();
    return true;
  }

  window.PageCurl = { turn, finish, busy: () => !!current, setFrameMs: (ms) => (FRAME_MS = ms) };
})();
