// The page curl: a page that peels from its bottom corner and rolls over.
//
// Just before a turn we take a picture of the page being turned and lay it,
// on a canvas, exactly over the real page; the real turn then happens
// underneath, out of sight. Each frame, a fold line sweeps from the corner
// across the page: what's past the fold is cut away (showing the new page
// beneath) and drawn folded back over as a flap — the back of the sheet, with
// the old page showing faintly through it, mirrored, as it does with real
// paper. The flap rolls with a highlight, casts a soft shadow, and the new
// page is shaded where the sheet still hangs over it.
//
// The geometry is the classic page-peel: the corner moves along a path, the
// fold is the line halfway between where the corner was and where it is, and
// the corner is kept within reach of the spine so the paper never stretches.
(function () {
  let DURATION = 320; // ms for the page to come over (tests can slow it down)
  const FADE = 90; // ms for the landed sheet to give way to the real new page

  let current = null; // the canvas on screen, if any
  let seq = 0; // bumped whenever a turn is cut short, so older turns know to stop

  const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
  // Starts briskly, eases as it lands — like a page let go of.
  const ease = (t) => 1 - Math.pow(1 - t, 2.2);

  // ---------- geometry ----------
  const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
  const dot = (a, b) => a.x * b.x + a.y * b.y;
  const len = (a) => Math.hypot(a.x, a.y);

  // The part of a convex polygon on one side of a line (through m, normal n).
  function clip(poly, m, n, positive) {
    const side = (p) => dot(sub(p, m), n) * (positive ? 1 : -1);
    const out = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const sa = side(a);
      const sb = side(b);
      if (sa >= 0) out.push(a);
      if (sa >= 0 !== sb >= 0) {
        const t = sa / (sa - sb);
        out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      }
    }
    return out;
  }
  const reflect = (p, m, n) => {
    const d = 2 * dot(sub(p, m), n);
    return { x: p.x - d * n.x, y: p.y - d * n.y };
  };
  function trace(ctx, poly) {
    ctx.beginPath();
    poly.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
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
   * @param stage  the element the curl is drawn in
   * @param turn   starts the real turn; resolves true once the new page is showing, false if nothing turned
   */
  async function turn({ dir, box, stage, turn }) {
    finish();
    const id = seq;
    const stale = () => id !== seq;
    const W = box.right - box.left;
    const H = box.bottom - box.top;
    if (W < 40 || H < 40) return turn();

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
    URL.revokeObjectURL(url); // decoded: the image keeps its pixels
    if (stale()) return turn(); // a newer turn (or closing the book) came along

    // The canvas covers the whole stage, so the page can swing out past its edges.
    const sr = stage.getBoundingClientRect();
    const dpr = devicePixelRatio || 1;
    const canvas = document.createElement('canvas');
    canvas.className = 'curl-layer';
    canvas.width = Math.round(sr.width * dpr);
    canvas.height = Math.round(sr.height * dpr);
    Object.assign(canvas.style, { left: '0px', top: '0px', width: `${sr.width}px`, height: `${sr.height}px` });
    const ctx = canvas.getContext('2d');

    // Everything below in stage coordinates.
    const left = box.left - sr.left;
    const right = box.right - sr.left;
    const top = box.top - sr.top;
    const bottom = box.bottom - sr.top;
    const spine = (box.spine ?? (dir > 0 ? box.left : box.right)) - sr.left;
    const outer = dir > 0 ? right : left;
    const leafW = Math.abs(outer - spine);
    const leaf = [
      { x: Math.min(spine, outer), y: top },
      { x: Math.max(spine, outer), y: top },
      { x: Math.max(spine, outer), y: bottom },
      { x: Math.min(spine, outer), y: bottom },
    ];
    const far = box.spine != null ? { x0: dir > 0 ? left : spine, x1: dir > 0 ? spine : right } : null;
    const corner = { x: outer, y: bottom };
    const spineBottom = { x: spine, y: bottom };
    const spineTop = { x: spine, y: top };
    const diagonal = Math.hypot(leafW, H);
    const paper = getComputedStyle(document.body).backgroundColor || '#f2eadb';
    const dark = document.documentElement.dataset.theme === 'dusk';

    const page = (x0, x1) => ctx.drawImage(img, x0 - left, 0, x1 - x0, H, x0, top, x1 - x0, H);

    // One frame, t from 0 (flat) to 1 (landed on the far side of the spine).
    function draw(t) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, sr.width, sr.height);
      if (far) page(far.x0, far.x1);
      const e = ease(t);
      if (e <= 0.001) return page(leaf[0].x, leaf[1].x);

      // Where the corner has got to: across and back down, lifted on the way.
      const d = {
        x: outer + (spine - dir * leafW - outer) * e,
        y: bottom - Math.min(H * 0.3, leafW * 0.42) * Math.sin(Math.PI * Math.min(1, e * 1.08)),
      };
      // Keep it within reach of the spine, so the page never stretches.
      const fromBottom = sub(d, spineBottom);
      if (len(fromBottom) > leafW) {
        const k = leafW / len(fromBottom);
        d.x = spineBottom.x + fromBottom.x * k;
        d.y = spineBottom.y + fromBottom.y * k;
      }
      const fromTop = sub(d, spineTop);
      if (len(fromTop) > diagonal) {
        const k = diagonal / len(fromTop);
        d.x = spineTop.x + fromTop.x * k;
        d.y = spineTop.y + fromTop.y * k;
      }
      // The fold: halfway between the corner's start and where it is now.
      const c = sub(corner, d);
      const cl = len(c) || 1;
      const n = { x: c.x / cl, y: c.y / cl }; // points into the part that has turned
      const m = { x: (corner.x + d.x) / 2, y: (corner.y + d.y) / 2 };
      const flat = clip(leaf, m, n, false); // still lying on the page
      const lifted = clip(leaf, m, n, true); // turned over: the new page shows here
      const flap = lifted.map((p) => reflect(p, m, n));
      const swing = Math.sin(Math.PI * Math.min(1, e));

      // The page still lying flat.
      if (flat.length > 2) {
        ctx.save();
        trace(ctx, flat);
        ctx.clip();
        page(leaf[0].x, leaf[1].x);
        ctx.restore();
      }
      if (flap.length < 3) return;

      // Shade on the new page, under the sheet that's still over it.
      if (lifted.length > 2) {
        const reach = 24 + 70 * swing;
        const g = ctx.createLinearGradient(m.x, m.y, m.x + n.x * reach, m.y + n.y * reach);
        g.addColorStop(0, `rgba(0,0,0,${dark ? 0.42 : 0.22})`);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.save();
        trace(ctx, lifted);
        ctx.clip();
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, sr.width, sr.height);
        ctx.restore();
      }

      // The flap: the back of the sheet, casting a soft shadow.
      ctx.save();
      ctx.shadowColor = `rgba(0,0,0,${dark ? 0.5 : 0.24})`;
      ctx.shadowBlur = 10 + 22 * swing;
      trace(ctx, flap);
      ctx.fillStyle = paper;
      ctx.fill();
      ctx.restore();

      ctx.save();
      trace(ctx, flap);
      ctx.clip();
      // The old page, faintly through the paper, mirrored as it would be.
      const k = 2 * dot(m, n);
      ctx.globalAlpha = dark ? 0.055 : 0.07;
      ctx.setTransform(
        dpr * (1 - 2 * n.x * n.x),
        dpr * (-2 * n.x * n.y),
        dpr * (-2 * n.x * n.y),
        dpr * (1 - 2 * n.y * n.y),
        dpr * k * n.x,
        dpr * k * n.y
      );
      ctx.drawImage(img, left, top, W, H);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalAlpha = 1;
      // The roll: a crease, a highlight where the paper turns to the light,
      // and a gentle darkening across the flap — all fading as the sheet
      // settles flat on the far side.
      const s = Math.max(0, swing);
      const depth = Math.max(...flap.map((p) => -dot(sub(p, m), n)), 1);
      const g = ctx.createLinearGradient(m.x, m.y, m.x - n.x * depth, m.y - n.y * depth);
      const at = (px) => Math.min(0.95, px / depth);
      g.addColorStop(0, `rgba(0,0,0,${(dark ? 0.32 : 0.16) * s})`);
      g.addColorStop(at(5), `rgba(255,255,255,${(dark ? 0.08 : 0.32) * s})`);
      g.addColorStop(at(26), `rgba(255,255,255,${(dark ? 0.03 : 0.1) * s})`);
      g.addColorStop(Math.max(at(26) + 0.01, 0.55), `rgba(0,0,0,${0.04 * s})`);
      g.addColorStop(1, `rgba(0,0,0,${(dark ? 0.22 : 0.1) * s})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, sr.width, sr.height);
      ctx.restore();
    }

    draw(0);
    stage.appendChild(canvas);
    current = canvas;
    await frame();

    // Turn the real page underneath, out of sight.
    let turned = false;
    try {
      turned = await turn();
    } catch (_) {
      turned = false;
    }
    const done = () => {
      canvas.remove();
      if (current === canvas) current = null;
    };
    if (stale() || !turned) {
      done();
      return turned;
    }
    await frame();

    // Bring the page over, then let the landed sheet give way to the real one.
    const start = performance.now();
    await new Promise((resolve) => {
      const step = (now) => {
        if (stale()) return resolve();
        const t = Math.min(1, (now - start) / DURATION);
        draw(t);
        // With one page there's nowhere for it to land: it fades as it leaves.
        if (!far) canvas.style.opacity = String(Math.min(1, (1 - t) / 0.3));
        if (t < 1) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });
    if (!stale() && far) {
      const from = performance.now();
      await new Promise((resolve) => {
        const step = (now) => {
          if (stale()) return resolve();
          const f = Math.min(1, (now - from) / FADE);
          canvas.style.opacity = String(1 - f);
          if (f < 1) requestAnimationFrame(step);
          else resolve();
        };
        requestAnimationFrame(step);
      });
    }
    done();
    return true;
  }

  window.PageCurl = {
    turn,
    finish,
    busy: () => !!current,
    // For looking at it frame by frame: 10 makes it ten times slower.
    slowMotion: (factor = 1) => (DURATION = 320 * factor),
  };
})();
