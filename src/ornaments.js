// Hand-drawn botanical ornaments and line icons, built as inline SVG strings.
// Colours come from CSS variables so every theme recolours them for free.
(function () {
  const f = (n) => Math.round(n * 100) / 100;

  function leaf(x, y, angle, s = 1) {
    return (
      `<g transform="translate(${f(x)} ${f(y)}) rotate(${f(angle)}) scale(${f(s)})">` +
      `<path class="o-leaf" d="M0 0C5-6.5 13-6.5 20 0C13 5.5 5 5.5 0 0Z"/>` +
      `<path class="o-vein" d="M1.5 0C7-.6 12-.6 17 0"/></g>`
    );
  }

  function flower(x, y, r, rot = 0) {
    let petals = '';
    for (let k = 0; k < 5; k++) {
      petals += `<ellipse class="o-petal" cx="0" cy="${f(-r * 0.92)}" rx="${f(r * 0.55)}" ry="${f(r * 0.92)}" transform="rotate(${k * 72})"/>`;
    }
    return (
      `<g transform="translate(${f(x)} ${f(y)}) rotate(${rot})">${petals}` +
      `<circle class="o-heart" r="${f(r * 0.34)}"/></g>`
    );
  }

  function bud(x, y, angle, s = 1) {
    return (
      `<g transform="translate(${f(x)} ${f(y)}) rotate(${f(angle)}) scale(${f(s)})">` +
      `<path class="o-petal" d="M0 0C-3-4-3-9 0-13C3-9 3-4 0 0Z"/>` +
      `<path class="o-leaf" d="M0 0C-3-2-4.5-4-4.5-6.5C-2-5.5 0-3.5 0 0Z"/>` +
      `<path class="o-leaf" d="M0 0C3-2 4.5-4 4.5-6.5C2-5.5 0-3.5 0 0Z"/></g>`
    );
  }

  const dot = (x, y, r = 1.6) => `<circle class="o-berry" cx="${x}" cy="${y}" r="${r}"/>`;

  // A trailing corner sprig: stem from bottom-left sweeping to top-right.
  function sprig() {
    return (
      `<svg class="ornament sprig" viewBox="0 0 240 170" aria-hidden="true">` +
      `<path class="o-stem" d="M6 166C50 140 80 120 118 96C156 72 190 52 228 16"/>` +
      `<path class="o-stem thin" d="M118 96C132 104 142 114 149 124"/>` +
      `<path class="o-stem thin" d="M64 132C66 118 70 108 79 98"/>` +
      `<path class="o-stem thin" d="M176 56C186 46 192 36 194 26"/>` +
      leaf(28, 153, -95, 0.95) + leaf(36, 149, 18, 0.8) +
      leaf(88, 116, -88, 1.05) + leaf(98, 109, 22, 0.9) +
      leaf(140, 82, -80, 0.9) + leaf(160, 70, 28, 1) +
      leaf(205, 37, -70, 0.75) + leaf(132, 106, 62, 0.7) +
      leaf(68, 118, -130, 0.6) +
      bud(79, 98, 35, 1.05) + bud(194, 26, 8, 0.85) +
      flower(149, 126, 6.5, 12) + flower(229, 15, 9.5) +
      dot(214, 52) + dot(219, 46, 1.3) + dot(209, 57, 1.1) +
      `</svg>`
    );
  }

  function divider() {
    return (
      `<svg class="ornament divider" viewBox="0 0 220 26" aria-hidden="true">` +
      `<path class="o-stem thin" d="M14 13C40 9 66 17 96 13"/><path class="o-stem thin" d="M124 13C154 9 180 17 206 13"/>` +
      leaf(96, 13, 196, 0.75) + leaf(124, 13, -16, 0.75) +
      leaf(60, 13, -150, 0.45) + leaf(160, 13, -30, 0.45) +
      flower(110, 13, 5.2) + dot(10, 13, 1.5) + dot(210, 13, 1.5) +
      `</svg>`
    );
  }

  function wreath() {
    let leaves = '';
    const n = 15;
    for (let i = 0; i < n; i++) {
      const a = -90 + 30 + (i * 300) / (n - 1);
      const rad = (a * Math.PI) / 180;
      const x = 60 + Math.cos(rad) * 38;
      const y = 60 + Math.sin(rad) * 38;
      leaves += leaf(x, y, a + 120 + (i % 2 ? 26 : -8), 0.62);
    }
    return (
      `<svg class="ornament wreath" viewBox="0 0 120 120" aria-hidden="true">` +
      `<path class="o-stem thin" d="M41 27A38 38 0 1 0 79 27"/>${leaves}` +
      flower(60, 22, 5.5) + dot(50, 22, 1.3) + dot(70, 22, 1.3) +
      `</svg>`
    );
  }

  // Line icons: 24px grid, 1.5 stroke, slightly organic.
  const P = {
    books: '<path d="M4 19.5V5.5c0-.8.7-1.5 1.5-1.5H8v15.5"/><path d="M8 4h3.5v15.5H8"/><path d="M14 5.2l3-.8 3.6 13.8-3 .8z"/><path d="M3 19.5h18"/>',
    reading: '<path d="M3 5.5c3-1 6-.6 9 1.3 3-1.9 6-2.3 9-1.3v13c-3-1-6-.6-9 1.3-3-1.9-6-2.3-9-1.3z"/><path d="M12 6.8v13"/>',
    sprout: '<path d="M12 20v-8"/><path d="M12 12c0-3.5 2.5-6 6.5-6 0 3.7-2.6 6-6.5 6z"/><path d="M12 14.5c0-2.8-2.1-5-5.5-5 0 3 2.2 5 5.5 5z"/>',
    heart: '<path d="M12 19.5s-7-4.3-7-9.4C5 7.6 6.8 6 8.8 6c1.4 0 2.6.8 3.2 2 .6-1.2 1.8-2 3.2-2 2 0 3.8 1.6 3.8 4.1 0 5.1-7 9.4-7 9.4z"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
    shelf: '<path d="M4 7h16M4 17h16"/><path d="M6.5 7v10M17.5 7v10"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    folder: '<path d="M3.5 7.5c0-1.1.9-2 2-2h3.8l2 2h7.2c1.1 0 2 .9 2 2v7.5c0 1.1-.9 2-2 2h-13c-1.1 0-2-.9-2-2z"/>',
    search: '<circle cx="11" cy="11" r="6"/><path d="M15.5 15.5L20 20"/>',
    back: '<path d="M14.5 6l-6 6 6 6"/>',
    prev: '<path d="M14.5 6l-6 6 6 6"/>',
    next: '<path d="M9.5 6l6 6-6 6"/>',
    toc: '<path d="M8 7h12M8 12h12M8 17h12"/><circle cx="4.5" cy="7" r=".6"/><circle cx="4.5" cy="12" r=".6"/><circle cx="4.5" cy="17" r=".6"/>',
    bookmark: '<path d="M7 4.5h10v15.5l-5-3.8-5 3.8z"/>',
    type: '<path d="M4 18l4.5-12h1L14 18M5.6 14h6.8"/><path d="M15.5 18v-5.2c0-1.4 1-2.3 2.4-2.3s2.4.9 2.4 2.3V18M15.5 15.3h4.8"/>',
    expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    more: '<circle cx="5.5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="18.5" cy="12" r="1"/>',
    trash: '<path d="M5 7h14M10 7V4.5h4V7M6.5 7l1 12.5h9l1-12.5"/>',
    pen: '<path d="M4 20l1-4L16 5l3 3L8 19z"/><path d="M14 7l3 3"/>',
    copy: '<rect x="8" y="8" width="11" height="12" rx="1.5"/><path d="M5 15.5V5.5c0-.8.7-1.5 1.5-1.5H15"/>',
    info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.8v.2"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
    sort: '<path d="M7 5v14M4 16l3 3 3-3M17 19V5M14 8l3-3 3 3"/>',
    quote: '<path d="M5 17.5c2.6-1.1 3.9-3.2 3.9-6.3V7.5H5v4h3.9"/><path d="M14 17.5c2.6-1.1 3.9-3.2 3.9-6.3V7.5H14v4h3.9"/>',
    chart: '<path d="M4 19.5h16"/><path d="M7 16.5v-5M11 16.5V7M15 16.5v-7M19 16.5V12.5"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3.5v2.2M12 18.3v2.2M20.5 12h-2.2M5.7 12H3.5M18 6l-1.6 1.6M7.6 16.4 6 18M18 18l-1.6-1.6M7.6 7.6 6 6"/>',
    export: '<path d="M12 15V4M8 8l4-4 4 4"/><path d="M5 13v5.5c0 .8.7 1.5 1.5 1.5h11c.8 0 1.5-.7 1.5-1.5V13"/>',
    reset: '<path d="M5 12a7 7 0 1 0 2.1-5"/><path d="M5 4.5V8h3.5"/>',
    speaker: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4.2 4.2 0 0 1 0 6M18 6.5a7.8 7.8 0 0 1 0 11"/>',
    play: '<path d="M8 5.5v13l10.5-6.5z"/>',
    pause: '<path d="M8.5 5.5v13M15.5 5.5v13"/>',
    stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="1.5"/>',
    stack: '<rect x="7.5" y="3.5" width="10" height="13" rx="1"/><path d="M5 6.5v12c0 .6.4 1 1 1h9"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    image: '<rect x="4" y="5" width="16" height="14" rx="1.5"/><circle cx="9" cy="10" r="1.6"/><path d="M5 17l4.5-4.5 3 3 2.5-2.5 4 4"/>',
    eye: '<path d="M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6z"/><circle cx="12" cy="12" r="2.6"/>',
  };

  function icon(name, cls = '') {
    return `<svg class="icon ${cls}" viewBox="0 0 24 24" aria-hidden="true">${P[name] || ''}</svg>`;
  }

  window.Ornaments = { sprig, divider, wreath, icon, flower, leaf };
})();
