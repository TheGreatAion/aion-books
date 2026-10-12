// A picture from a book, full size: click it in the page and it opens here.
// Zoom with the wheel, the buttons, + and −, or a double-click; drag to look
// around once it's bigger than the window. Esc, ×, or a click beside it closes.
(function () {
  const { $ } = window.UI;
  const { icon } = window.Ornaments;

  const MAX = 8; // times its full size
  let img = null;
  let natural = { w: 1, h: 1 };
  let fit = 1; // the scale at which it fits the window
  let scale = 1;
  let x = 0;
  let y = 0;

  const box = () => $('#lightbox');
  const stage = () => $('#lightbox .lb-stage');

  function fitScale() {
    const r = stage().getBoundingClientRect();
    return Math.min((r.width * 0.94) / natural.w, (r.height * 0.94) / natural.h, 3);
  }

  function paint(animate) {
    if (!img) return;
    img.style.transition = animate ? 'transform 0.18s ease-out' : 'none';
    img.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px) scale(${scale})`;
    $('#lightbox .lb-zoom').textContent = `${Math.round((scale / fit) * 100)}%`;
    box().classList.toggle('is-zoomed', scale > fit * 1.01);
  }

  // Keep the picture from wandering off: it can't be pushed past its edges.
  function clampPan() {
    const r = stage().getBoundingClientRect();
    const w = natural.w * scale;
    const h = natural.h * scale;
    const mx = Math.max(0, (w - r.width) / 2);
    const my = Math.max(0, (h - r.height) / 2);
    x = Math.max(-mx, Math.min(mx, x));
    y = Math.max(-my, Math.min(my, y));
  }

  // Zoom to a scale, keeping the point under (cx, cy) where it is.
  function zoomTo(next, cx, cy, animate = true) {
    next = Math.max(fit, Math.min(fit * MAX, next));
    const r = stage().getBoundingClientRect();
    const px = (cx ?? r.left + r.width / 2) - (r.left + r.width / 2);
    const py = (cy ?? r.top + r.height / 2) - (r.top + r.height / 2);
    x = px - ((px - x) * next) / scale;
    y = py - ((py - y) * next) / scale;
    scale = next;
    if (scale <= fit * 1.001) x = y = 0;
    clampPan();
    paint(animate);
  }

  function open(src, alt = '') {
    if (!src) return;
    const b = box();
    b.innerHTML =
      `<div class="lb-stage"><img alt=""></div>` +
      `<div class="lb-bar">` +
      `<button class="icon-btn" data-lb="out" title="Zoom out (−)">${icon('minus')}</button>` +
      `<span class="lb-zoom">100%</span>` +
      `<button class="icon-btn" data-lb="in" title="Zoom in (+)">${icon('plus')}</button>` +
      `<button class="icon-btn" data-lb="close" title="Close (Esc)">${icon('close')}</button>` +
      `</div>`;
    img = b.querySelector('img');
    img.alt = alt;
    img.draggable = false;
    img.onload = () => {
      natural = { w: img.naturalWidth || 1, h: img.naturalHeight || 1 };
      img.style.width = `${natural.w}px`;
      img.style.height = `${natural.h}px`;
      fit = fitScale();
      scale = fit;
      x = y = 0;
      paint(false);
      b.classList.add('is-open');
    };
    img.src = src;
    b.hidden = false;
  }

  function close() {
    const b = box();
    b.classList.remove('is-open', 'is-zoomed');
    b.hidden = true;
    b.innerHTML = '';
    img = null;
  }
  const isOpen = () => !box().hidden;

  function bind() {
    const b = box();
    b.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-lb]');
      if (btn?.dataset.lb === 'in') return zoomTo(scale * 1.5);
      if (btn?.dataset.lb === 'out') return zoomTo(scale / 1.5);
      if (btn?.dataset.lb === 'close') return close();
      // A click beside the picture (not after dragging it) closes.
      if (!moved && e.target.classList.contains('lb-stage')) close();
    });
    b.addEventListener('dblclick', (e) => {
      if (!e.target.closest('img')) return;
      if (scale > fit * 1.01) zoomTo(fit);
      else zoomTo(Math.max(fit * 2.5, 1), e.clientX, e.clientY);
    });
    b.addEventListener(
      'wheel',
      (e) => {
        if (!img) return;
        e.preventDefault();
        zoomTo(scale * Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY, false);
      },
      { passive: false }
    );
    // Drag to look around.
    let drag = null;
    let moved = false;
    b.addEventListener('pointerdown', (e) => {
      if (!img || e.button !== 0 || e.target.closest('.lb-bar')) return;
      drag = { sx: e.clientX, sy: e.clientY, x, y };
      moved = false;
    });
    window.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.sx;
      const dy = e.clientY - drag.sy;
      if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
      if (scale <= fit * 1.01) return;
      x = drag.x + dx;
      y = drag.y + dy;
      clampPan();
      paint(false);
    });
    window.addEventListener('pointerup', () => {
      drag = null;
      setTimeout(() => (moved = false), 0);
    });
    window.addEventListener('resize', () => {
      if (!img) return;
      const was = scale / fit;
      fit = fitScale();
      scale = fit * was;
      clampPan();
      paint(false);
    });
    document.addEventListener(
      'keydown',
      (e) => {
        if (!isOpen()) return;
        if (e.key === 'Escape') close();
        else if (e.key === '+' || e.key === '=') zoomTo(scale * 1.5);
        else if (e.key === '-') zoomTo(scale / 1.5);
        else if (e.key === '0') zoomTo(fit);
        else return;
        e.preventDefault();
        e.stopPropagation();
      },
      true
    );
  }

  window.Lightbox = { open, close, isOpen };
  bind();
})();
