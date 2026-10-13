// Painted Mediterranean botanicals — ivy, grapevine, bougainvillea, lemon and olive —
// drawn as clean vectors: gradient-shaded forms, a few soft translucent brush strokes,
// and a whisper of canvas grain. Stems grow and leaves pop in, stop-motion style
// (each element carries a --d delay; the CSS animates in held frames).
(function () {
  const f = (n) => Math.round(n * 10) / 10;
  const lerp = (a, b, t) => a + (b - a) * t;
  const DEG = Math.PI / 180;
  let uid = 0;

  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Leaf palettes: gradient id + [shadow stroke, lit stroke, highlight, outline]
  const LEAF = {
    ivy: { g: 'lg-ivy', c: ['#1f3a22', '#a3c27a', '#d6e2ad', '#22391f'] },
    grape: { g: 'lg-grape', c: ['#3a5226', '#c8d58a', '#ecefc0', '#3b4f25'] },
    olive: { g: 'lg-olive', c: ['#434b39', '#d3d7bd', '#eef0e0', '#434b39'] },
    lemon: { g: 'lg-lemon', c: ['#1c3820', '#97c172', '#cfe3a8', '#1d3620'] },
  };

  const stop = (o, c) => `<stop offset="${o}" stop-color="${c}"/>`;
  const DEFS = `
  <svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false">
    <defs>
      <linearGradient id="lg-ivy" x1="0" y1="0" x2=".9" y2="1">${stop(0, '#8fae66') + stop(0.45, '#567b42') + stop(1, '#2d492c')}</linearGradient>
      <linearGradient id="lg-grape" x1="0" y1="0" x2=".9" y2="1">${stop(0, '#b4c574') + stop(0.5, '#789242') + stop(1, '#4a6331')}</linearGradient>
      <linearGradient id="lg-olive" x1="0" y1="0" x2=".9" y2="1">${stop(0, '#c4c9ac') + stop(0.5, '#879172') + stop(1, '#555e48')}</linearGradient>
      <linearGradient id="lg-lemon" x1="0" y1="0" x2=".9" y2="1">${stop(0, '#88b466') + stop(0.5, '#477444') + stop(1, '#25442b')}</linearGradient>
      <radialGradient id="rg-lemon" cx=".36" cy=".3" r=".78">${stop(0, '#fff5c4') + stop(0.28, '#f7d55e') + stop(0.72, '#e1aa2d') + stop(1, '#b07619')}</radialGradient>
      <radialGradient id="rg-grape" cx=".34" cy=".3" r=".8">${stop(0, '#b9a2c9') + stop(0.42, '#6d4c80') + stop(1, '#2e1f3a')}</radialGradient>
      <radialGradient id="rg-bract" cx=".5" cy=".85" r=".95">${stop(0, '#f7bfd8') + stop(0.42, '#d4669e') + stop(1, '#8c2a5c')}</radialGradient>
      <radialGradient id="rg-blossom" cx=".5" cy=".8" r=".9">${stop(0, '#ffffff') + stop(0.6, '#f5eedf') + stop(1, '#d9cbab')}</radialGradient>
      <radialGradient id="rg-rose" cx=".5" cy=".8" r=".9">${stop(0, '#f5d8cf') + stop(0.6, '#d69c92') + stop(1, '#a5625a')}</radialGradient>
      <linearGradient id="lg-bark" x1="0" y1="0" x2="1" y2="0">${stop(0, '#7a5a40') + stop(1, '#4a3424')}</linearGradient>

      <!-- Canvas tooth: faint light and dark grain kept inside the painted shapes,
           plus a soft lift off the page. No displacement, no outline. -->
      <filter id="paint" x="-15%" y="-15%" width="130%" height="140%" color-interpolation-filters="sRGB">
        <feTurbulence type="fractalNoise" baseFrequency="0.7" numOctaves="2" seed="7" result="n"/>
        <feColorMatrix in="n" values="0 0 0 0 .1  0 0 0 0 .08  0 0 0 0 .05  .55 0 0 0 -.24" result="dk"/>
        <feComposite in="dk" in2="SourceGraphic" operator="in" result="dkIn"/>
        <feColorMatrix in="n" values="0 0 0 0 1  0 0 0 0 .97  0 0 0 0 .88  0 .5 0 0 -.24" result="lt"/>
        <feComposite in="lt" in2="SourceGraphic" operator="in" result="ltIn"/>
        <feMerge result="tex"><feMergeNode in="SourceGraphic"/><feMergeNode in="dkIn"/><feMergeNode in="ltIn"/></feMerge>
        <feDropShadow class="lift" in="tex" dx="0.5" dy="1.3" stdDeviation="1.3" flood-color="#3a2614" flood-opacity="0.18"/>
      </filter>
    </defs>
  </svg>`;
  document.body.insertAdjacentHTML('afterbegin', DEFS);

  // ---------- shapes ----------
  const IVY =
    'M0 0C-3-4-1-11 4-12C7-12.5 8-9 9.5-8C11-11 15-14 17-12C19-10 18-6 17.5-4.5C21-4 27-2 28 0' +
    'C27 2 21 4 17.5 4.5C18 6 19 10 17 12C15 14 11 11 9.5 8C8 9 7 12.5 4 12C-1 11-3 4 0 0Z';
  const ALMOND = 'M0 0C6-7 16-7.5 26 0C16 6.5 6 6 0 0Z';
  const BRACT = 'M0 0C-5-2-7.5-9-2.5-12.8C-.5-14 2-13.6 3.2-11.8C6.2-8 4.3-2.2 0 0Z';

  const pop = (d, inner) => `<g class="pop" style="--d:${Math.round(d)}ms">${inner}</g>`;
  const place = (x, y, a, s, inner) => `<g transform="translate(${f(x)} ${f(y)}) rotate(${f(a)}) scale(${s.toFixed(2)})">${inner}</g>`;
  const brush = (d, c, w, o) => `<path d="${d}" fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round" opacity="${o}"/>`;

  function ivyLeaf(pal, r) {
    const [sh, lit, hi, ol] = LEAF[pal].c;
    const j = () => f((r() - 0.5) * 1.6);
    return (
      `<path d="${IVY}" fill="url(#${LEAF[pal].g})"/>` +
      brush('M4 5C9 8.5 14 9.5 19 6', sh, 4.2, 0.22) +
      brush(`M3 -2.5C9 ${-7 + j()} 15 -8 22 -3`, lit, 4.4, 0.3) +
      brush('M10.5 -6C12.5 -9 15 -10.5 16.5 -9.5', lit, 2.2, 0.35) +
      brush('M1.5 0C9 -.4 17 -.4 25 0M2 0C7 -3 11 -6 15.5 -9.5M2 0C7 3 11 6 15.5 9.5', hi, 0.65, 0.45) +
      `<path d="${IVY}" fill="none" stroke="${ol}" stroke-width=".55" opacity=".45"/>`
    );
  }

  function almondLeaf(pal, r, slender = 1) {
    const [sh, lit, hi, ol] = LEAF[pal].c;
    const sy = (0.85 + r() * 0.15) * slender;
    return (
      `<g transform="scale(1 ${sy.toFixed(2)})">` +
      `<path d="${ALMOND}" fill="url(#${LEAF[pal].g})"/>` +
      brush('M5 2.8C11 4.6 17 4.2 22 1.6', sh, 2.6, 0.22) +
      brush('M3 -1.8C9 -4.8 16 -5 22.5 -1.4', lit, 2.8, 0.32) +
      brush('M1 0C9 -.5 17 -.5 24 0', hi, 0.6, 0.5) +
      `<path d="${ALMOND}" fill="none" stroke="${ol}" stroke-width=".5" opacity=".4"/>` +
      `</g>`
    );
  }

  function bougainvillea(x, y, s, d, r, n = 2) {
    let out = '';
    for (let k = 0; k < n; k++) {
      const a = r() * 360;
      const dist = k === 0 ? 0 : 9;
      let bloom = '';
      for (let b = 0; b < 3; b++) {
        bloom +=
          `<g transform="rotate(${f(b * 120 + r() * 14)})"><path d="${BRACT}" fill="url(#rg-bract)"/>` +
          brush('M0 -1.5C.3 -5 .2 -8.5 -.4 -11', '#f7cde0', 0.55, 0.55) +
          `<path d="${BRACT}" fill="none" stroke="#7a2350" stroke-width=".45" opacity=".4"/></g>`;
      }
      bloom += `<circle r="1.2" fill="#f6eed6"/><circle cx="1.5" cy=".5" r=".8" fill="#efe2b8"/>`;
      out += pop(d + k * 110, place(Math.cos(a * DEG) * dist, Math.sin(a * DEG) * dist, r() * 360, 0.85 + r() * 0.2, bloom));
    }
    return place(x, y, 0, s, out);
  }

  function grapes(x, y, s, d, r) {
    const rows = [4, 4, 3, 3, 2, 1];
    let out = pop(d, brush('M0 -5C.8 -2 .4 0 0 2.5', '#5d4330', 1.1, 1));
    let k = 0;
    rows.forEach((n, row) => {
      for (let j = 0; j < n; j++) {
        const cx = (j - (n - 1) / 2) * 5.4 + (r() - 0.5) * 1.2;
        const cy = 4 + row * 4.8 + (r() - 0.5);
        const rr = 3.1 + r() * 0.4;
        out += pop(
          d + k++ * 30,
          `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(rr)}" fill="url(#rg-grape)"/>` +
            `<circle cx="${f(cx - 1)}" cy="${f(cy - 1.1)}" r=".7" fill="#efe6f4" opacity=".55"/>`
        );
      }
    });
    return place(x, y, (r() - 0.5) * 12, s, out);
  }

  function lemon(x, y, a, s, d) {
    const inner =
      brush('M-9.5 -1C-11.5 -2.2 -13 -2.2 -14.5 -1.2', '#4f6b3a', 1.3, 1) +
      `<path d="M-10 0C-10 -5 -5 -7.4 0 -7.4C6 -7.4 9.6 -4 10.4 -.6C11.4 -.4 11.8 .4 10.6 .8C9.8 4.6 6 7.4 0 7.4C-5 7.4 -10 5 -10 0Z" fill="url(#rg-lemon)"/>` +
      brush('M-5.5 -3.8C-3.5 -5 -1 -5.2 1.4 -4.8', '#fffbe2', 1.3, 0.6) +
      brush('M2 5C5 4.6 7.6 3.2 9 1.2', '#a8701a', 1.4, 0.3) +
      `<path d="M-10 0C-10 -5 -5 -7.4 0 -7.4C6 -7.4 9.6 -4 10.4 -.6C11.4 -.4 11.8 .4 10.6 .8C9.8 4.6 6 7.4 0 7.4C-5 7.4 -10 5 -10 0Z" fill="none" stroke="#94631a" stroke-width=".5" opacity=".45"/>`;
    return place(x, y, a, s, pop(d, inner));
  }

  function blossom(x, y, rad, d, grad = 'rg-blossom') {
    let petals = '';
    for (let k = 0; k < 5; k++) {
      petals += `<ellipse transform="rotate(${k * 72})" cy="${f(-rad * 0.9)}" rx="${f(rad * 0.56)}" ry="${f(rad * 0.92)}" fill="url(#${grad})" stroke="#b9a684" stroke-width=".35" stroke-opacity=".6"/>`;
    }
    return place(x, y, 0, 1, pop(d, `${petals}<circle r="${f(rad * 0.3)}" fill="#e3b54a"/><circle cx="-.3" cy="-.4" r="${f(rad * 0.12)}" fill="#fbe7a6"/>`));
  }

  function tendril(x, y, a, s, d) {
    const pts = [];
    for (let i = 0; i <= 28; i++) {
      const t = i / 28;
      if (t < 0.35) pts.push([(t / 0.35) * 9, 0]);
      else {
        const ang = (t - 0.35) * 3.4 * Math.PI;
        const rad = 5 * (1 - (t - 0.35) * 1.1);
        pts.push([9 + Math.sin(ang) * rad, -(1 - Math.cos(ang)) * rad]);
      }
    }
    const dp = 'M' + pts.map((p) => `${f(p[0])} ${f(p[1])}`).join('L');
    return place(x, y, a, s, `<path class="g-grow" pathLength="1" style="--d:${Math.round(d)}ms" d="${dp}" fill="none" stroke="#6f7d4a" stroke-width=".85" stroke-linecap="round"/>`);
  }

  // ---------- vines ----------
  function resample(guide, step) {
    const out = [guide[0]];
    let acc = 0;
    for (let i = 1; i < guide.length; i++) {
      const [x0, y0] = guide[i - 1];
      const [x1, y1] = guide[i];
      const len = Math.hypot(x1 - x0, y1 - y0);
      let t = (step - acc) / len;
      while (t <= 1) {
        out.push([lerp(x0, x1, t), lerp(y0, y1, t)]);
        t += step / len;
      }
      acc = (acc + len) % step;
    }
    return out;
  }

  function smoothPath(pts) {
    let d = `M${f(pts[0][0])} ${f(pts[0][1])}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] || pts[i];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[i + 2] || p2;
      d +=
        `C${f(p1[0] + (p2[0] - p0[0]) / 6)} ${f(p1[1] + (p2[1] - p0[1]) / 6)} ` +
        `${f(p2[0] - (p3[0] - p1[0]) / 6)} ${f(p2[1] - (p3[1] - p1[1]) / 6)} ${f(p2[0])} ${f(p2[1])}`;
    }
    return d;
  }

  // Tapered stem as a filled outline (crisp at any size), revealed by a growing mask.
  function stem(pts, w0, w1, d0, dur) {
    const n = pts.length;
    const left = [];
    const right = [];
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(0, i - 1)];
      const b = pts[Math.min(n - 1, i + 1)];
      const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
      const w = lerp(w0, w1, i / (n - 1)) / 2;
      left.push([pts[i][0] - Math.sin(ang) * w, pts[i][1] + Math.cos(ang) * w]);
      right.push([pts[i][0] + Math.sin(ang) * w, pts[i][1] - Math.cos(ang) * w]);
    }
    const outline = smoothPath(left) + smoothPath([...right].reverse()).replace(/^M/, 'L') + 'Z';
    const id = `stem${++uid}`;
    const spine = smoothPath(pts);
    const hl = smoothPath(right.map((p, i) => [lerp(p[0], pts[i][0], 0.45), lerp(p[1], pts[i][1], 0.45)]));
    return (
      `<mask id="${id}" maskUnits="userSpaceOnUse"><path class="g-grow" pathLength="1" style="--d:${Math.round(d0)}ms;--dur:${Math.round(dur)}ms" d="${spine}" fill="none" stroke="#fff" stroke-width="${f(w0 + 4)}" stroke-linecap="round"/></mask>` +
      `<g mask="url(#${id})"><path d="${outline}" fill="url(#lg-bark)"/>` +
      `<path d="${hl}" fill="none" stroke="#a8896a" stroke-width="${f(Math.max(0.5, w0 * 0.22))}" stroke-linecap="round" opacity=".55"/></g>`
    );
  }

  /** Grow a vine along a guide polyline. */
  function vine(guide, o) {
    const r = rng(o.seed || 1);
    const step = o.step || 14;
    const base = resample(guide, step);
    const ph = r() * 6;
    const pts = base.map((p, i) => {
      const prev = base[Math.max(0, i - 1)];
      const next = base[Math.min(base.length - 1, i + 1)];
      const a = Math.atan2(next[1] - prev[1], next[0] - prev[0]);
      const off = Math.min(1, i / 3) * (o.amp ?? 4) * Math.sin(i * step * (o.freq ?? 0.03) + ph);
      return [p[0] - Math.sin(a) * off, p[1] + Math.cos(a) * off];
    });
    const n = pts.length;
    const seg = o.seg ?? 45;
    const d0 = o.delay || 0;
    let out = stem(pts, o.w0 ?? 3, o.w1 ?? 1, d0, n * seg);
    let leaves = '';
    let extra = '';
    const L = o.leaf || {};
    let side = r() < 0.5 ? 1 : -1;
    for (let i = 1; i < n; i++) {
      const p = pts[i];
      const q = pts[i - 1];
      const dir = Math.atan2(p[1] - q[1], p[0] - q[0]) / DEG;
      const d = d0 + i * seg + 60;
      if (L.every && i % L.every === 0) {
        side = -side;
        const a = dir + side * lerp(L.angle?.[0] ?? 50, L.angle?.[1] ?? 80, r());
        const size = lerp(L.size?.[0] ?? 0.8, L.size?.[1] ?? 1.1, r()) * (L.taper ? lerp(1, L.taper, i / n) : 1);
        const pet = 2 + size * 3;
        const bx = p[0] + Math.cos(a * DEG) * pet;
        const by = p[1] + Math.sin(a * DEG) * pet;
        const pal = L.pal2 && r() < 0.35 ? L.pal2 : L.pal || 'ivy';
        const body = L.kind === 'almond' ? almondLeaf(pal, r, L.slender || 1) : ivyLeaf(pal, r);
        leaves +=
          pop(d - 40, brush(`M${f(p[0])} ${f(p[1])}L${f(bx)} ${f(by)}`, '#5d4330', 0.8, 1)) +
          place(bx, by, a + (r() - 0.5) * 12, size, pop(d, body));
      }
      if (o.extra) extra += o.extra(p, i, dir, d + 100, side, r, n) || '';
    }
    if (o.curl) {
      const p = pts[n - 1];
      const q = pts[n - 2];
      leaves += tendril(p[0], p[1], Math.atan2(p[1] - q[1], p[0] - q[0]) / DEG, o.curl, d0 + n * seg);
    }
    return out + leaves + extra;
  }

  const svg = (vb, body, cls = '') =>
    `<svg class="painted ${cls}" viewBox="${vb}" aria-hidden="true"><g filter="url(#paint)">${body}</g></svg>`;

  // ---------- compositions ----------

  // A slender grapevine climbing the sidebar's edge.
  function wallClimber() {
    return svg(
      '0 0 120 560',
      vine([[60, 568], [55, 470], [63, 370], [56, 270], [61, 180], [68, 110]], {
        seed: 23, step: 16, amp: 5, w0: 3.4, w1: 1.1, seg: 55, curl: 1.2,
        leaf: { every: 3, kind: 'ivy', pal: 'ivy', pal2: 'grape', size: [1.05, 1.4], taper: 0.7 },
        extra: (p, i, dir, d, side, r) => {
          if (i === 10) return grapes(p[0] + 13, p[1] + 3, 1, d, r);
          if (i === 23) return bougainvillea(p[0] - 12, p[1] - 2, 1, d, r, 2);
          return '';
        },
      }),
      'wall-climber'
    );
  }

  // A lemon bough reaching in from the right of the hero.
  function lemonBough() {
    return svg(
      '0 0 330 170',
      vine([[340, 26], [290, 46], [236, 70], [186, 84], [140, 90]], {
        seed: 61, step: 19, amp: 3, w0: 4, w1: 1.4, seg: 70, delay: 150,
        leaf: { every: 1, kind: 'almond', pal: 'lemon', size: [1.35, 1.7], taper: 0.8, slender: 0.92, angle: [26, 50] },
        extra: (p, i, dir, d) => {
          if (i === 3) return lemon(p[0] + 2, p[1] + 17, 84, 1.25, d);
          if (i === 5) return lemon(p[0] - 3, p[1] + 15, 98, 1.1, d + 120);
          if (i === 7) return blossom(p[0], p[1] - 9, 5, d);
          if (i === 9) return blossom(p[0] + 4, p[1] + 9, 4.2, d);
          return '';
        },
      }),
      'lemon-bough'
    );
  }

  // A small olive sprig used as a divider.
  function divider() {
    return svg(
      '0 0 220 28',
      vine([[8, 14], [60, 11], [110, 15], [160, 11], [212, 14]], {
        seed: 3, step: 13, amp: 1.2, w0: 1.4, w1: 0.9, seg: 30,
        leaf: { every: 1, kind: 'almond', pal: 'olive', size: [0.5, 0.64], slender: 0.55, angle: [26, 40] },
        extra: (p, i, dir, d) => (i === 8 ? blossom(p[0], p[1], 4, d, 'rg-rose') : ''),
      }),
      'divider-p'
    );
  }

  // An olive wreath.
  function wreath() {
    const arc = (from, to, seed) => {
      const pts = [];
      for (let i = 0; i <= 14; i++) {
        const a = lerp(from, to, i / 14) * DEG;
        pts.push([60 + Math.cos(a) * 40, 62 + Math.sin(a) * 40]);
      }
      return vine(pts, {
        seed, step: 11, amp: 1, w0: 2, w1: 0.8, seg: 45,
        leaf: { every: 1, kind: 'almond', pal: 'olive', pal2: 'lemon', size: [0.6, 0.8], slender: 0.65, angle: [24, 40] },
      });
    };
    return svg('0 0 120 120', arc(100, 250, 19) + arc(80, -70, 12) + blossom(60, 102, 5, 600, 'rg-rose'), 'wreath-p');
  }

  // A single ivy sprig climbing into the reader's lower-right corner.
  function readerSprig() {
    return svg(
      '0 0 90 260',
      vine([[84, 268], [64, 200], [70, 130], [62, 70]], {
        seed: 44, step: 15, amp: 4, w0: 2.6, w1: 0.9, seg: 50, delay: 300, curl: 1,
        leaf: { every: 2, kind: 'ivy', pal: 'ivy', pal2: 'grape', size: [0.95, 1.2], taper: 0.75 },
      }),
      'reader-vine'
    );
  }

  function bloom() {
    return svg('-22 -22 44 44', blossom(0, 0, 10, 0, 'rg-rose'), 'bloom-p');
  }

  // Loose single pieces for the leaf flurry and petal burst.
  function piece(kind, seed) {
    const r = rng(seed);
    let body;
    if (kind === 'bract') body = `<g transform="translate(15 23)"><path d="${BRACT}" fill="url(#rg-bract)"/></g>`;
    else if (kind === 'olive') body = `<g transform="translate(2 15)">${almondLeaf('olive', r, 0.7)}</g>`;
    else if (kind === 'petal') body = `<g transform="translate(15 22)"><path d="${BRACT}" fill="url(#rg-rose)"/></g>`;
    else body = `<g transform="translate(1 15)">${ivyLeaf(r() < 0.5 ? 'ivy' : 'grape', r)}</g>`;
    return `<svg class="painted still" viewBox="0 0 30 30" aria-hidden="true"><g filter="url(#paint)">${body}</g></svg>`;
  }

  window.Painted = { wallClimber, lemonBough, divider, wreath, readerSprig, bloom, piece };
})();
