// The settings page, shown in the library's main column.
(function () {
  const { $, esc, State, setSettings, toast, confirmBox, Fonts, coverHtml } = window.UI;
  const { icon } = window.Ornaments;

  const THEMES = [
    ['linen', 'Linen', '#f2eadb', '#3b2f25'],
    ['parchment', 'Parchment', '#ead7b3', '#38271a'],
    ['dusk', 'Dusk', '#27221d', '#e7dac3'],
  ];
  const CHOICES = {
    motion: [
      ['full', 'Full'],
      ['gentle', 'Gentle'],
      ['still', 'Still'],
    ],
    lineHeight: [
      [1.4, 'Snug'],
      [1.6, 'Airy'],
      [1.85, 'Open'],
    ],
    margin: [
      ['narrow', 'Narrow'],
      ['comfortable', 'Balanced'],
      ['wide', 'Wide'],
    ],
    layout: [
      ['single', 'Single page'],
      ['auto', 'Two pages'],
      ['scroll', 'Scroll'],
    ],
    footerInfo: [
      ['time', 'Time left'],
      ['pages', 'Pages left'],
      ['percent', 'Just the percentage'],
    ],
  };

  const SHORTCUTS = [
    ['Library', 'Ctrl O', 'Add books'],
    ['Library', 'Ctrl F  or  /', 'Search'],
    ['Anywhere', 'Ctrl ,', 'Settings'],
    ['Anywhere', '?', 'These shortcuts'],
    ['Reader', '← →  PgUp PgDn  Space', 'Turn pages'],
    ['Reader', 'T', 'Contents & notes'],
    ['Reader', 'B', 'Bookmark this page'],
    ['Reader', 'Ctrl F', 'Search this book'],
    ['Reader', 'R', 'Read aloud — play / pause'],
    ['Reader', 'Ctrl +  Ctrl −', 'Text size'],
    ['Reader', 'F11', 'Full screen'],
    ['Reader', 'Esc', 'Close panel, then back to library'],
  ];

  let info = null;

  const chips = (key, list, val) =>
    `<div class="chips">${list
      .map(
        ([v, label]) =>
          `<button class="chip ${String(v) === String(val) ? 'is-on' : ''}" data-set="${key}" data-v="${esc(v)}"${
            key === 'fontFamily' && v !== 'Original' ? ` style="font-family:'${v}',serif"` : ''
          }>${label}</button>`
      )
      .join('')}</div>`;

  const toggle = (key, on) =>
    `<button class="switch ${on ? 'is-on' : ''}" role="switch" aria-checked="${on}" data-toggle="${key}"><i></i></button>`;

  const row = (title, desc, control, cls = '') =>
    `<div class="set-row ${cls}"><div class="set-text"><div class="set-title">${title}</div>${
      desc ? `<div class="set-desc">${desc}</div>` : ''
    }</div><div class="set-control">${control}</div></div>`;

  function stats() {
    const b = State.books;
    const hl = b.reduce((n, x) => n + (x.highlights || []).length, 0);
    const bm = b.reduce((n, x) => n + (x.bookmarks || []).length, 0);
    const fin = b.filter((x) => x.finished).length;
    return `${b.length} ${b.length === 1 ? 'book' : 'books'} · ${fin} finished · ${hl} ${hl === 1 ? 'highlight' : 'highlights'} · ${bm} ${bm === 1 ? 'bookmark' : 'bookmarks'}`;
  }

  // ---------- typefaces (bundled + the user's own) ----------
  function fontChips(val) {
    const items = Fonts.choices()
      .map(([v, label, custom]) => {
        const on = String(v) === String(val) ? 'is-on' : '';
        const face = v !== 'Original' ? ` style="font-family:'${esc(v)}',serif"` : '';
        if (!custom) return `<button class="chip ${on}" data-set="fontFamily" data-v="${esc(v)}"${face}>${esc(label)}</button>`;
        return (
          `<span class="chip-wrap"><button class="chip custom ${on}" data-set="fontFamily" data-v="${esc(v)}"${face}>${esc(label)}</button>` +
          `<button class="chip-x" data-remove-font="${esc(v)}" title="Remove ${esc(v)}">${icon('close')}</button></span>`
        );
      })
      .join('');
    return `<div class="chips">${items}<button class="chip add" data-action="add-font">${icon('plus')}Add a font…</button></div>`;
  }

  // ---------- updates ----------
  let update = { state: 'idle' };
  function updateText() {
    switch (update.state) {
      case 'checking':
        return 'Checking for a new version…';
      case 'current':
        return 'You have the latest version.';
      case 'downloading':
        return `Downloading version ${esc(update.version || '')}${update.percent ? ` — ${update.percent}%` : '…'}`;
      case 'ready':
        return `Version ${esc(update.version)} is downloaded and ready to install.`;
      case 'error':
        return `Couldn’t check for updates — ${esc(update.message || 'unknown error')}`;
      case 'unsupported':
        return 'This copy can’t update itself. Install Aion Books with the setup program from GitHub and it will keep itself up to date.';
      default:
        return 'Updates come from github.com/TheGreatAion/aion-books.';
    }
  }

  // ---------- read-aloud voices ----------
  function voiceSelect(current) {
    const voices = window.speechSynthesis?.getVoices() || [];
    if (!voices.length) return `<span class="set-desc">No voices found on this computer.</span>`;
    const opts = [`<option value="">System default</option>`]
      .concat(voices.map((v) => `<option value="${esc(v.name)}" ${v.name === current ? 'selected' : ''}>${esc(v.name.replace(/^Microsoft /, ''))} — ${esc(v.lang)}</option>`))
      .join('');
    return `<select class="set-select" data-select="ttsVoice">${opts}</select>`;
  }

  function sample() {
    if (!window.speechSynthesis) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance('The garden had gone quiet in the way gardens do at the end of summer.');
    const v = speechSynthesis.getVoices().find((x) => x.name === State.settings.ttsVoice);
    if (v) u.voice = v;
    u.rate = State.settings.ttsRate || 1;
    speechSynthesis.speak(u);
  }

  // ---------- reading stats ----------
  let statData = null;
  const DAY = 86400000;
  const keyOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  function fmtTime(ms) {
    const min = Math.round(ms / 60000);
    if (min < 1) return ms > 0 ? '< 1 min' : '0 min';
    if (min < 60) return `${min} min`;
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m ? `${h} h ${m} min` : `${h} h`;
  }

  function computeStats() {
    const days = statData?.days || {};
    const read = (k) => (days[k]?.ms || 0) >= 60000;
    const now = new Date();
    // Current streak: consecutive days with at least a minute read, ending today or yesterday.
    let streak = 0;
    let d = new Date(now);
    if (!read(keyOf(d))) d = new Date(d.getTime() - DAY);
    while (read(keyOf(d))) {
      streak++;
      d = new Date(d.getTime() - DAY);
    }
    let longest = 0;
    let run = 0;
    let prev = null;
    for (const k of Object.keys(days).filter(read).sort()) {
      const t = new Date(`${k}T12:00:00`).getTime();
      run = prev && Math.round((t - prev) / DAY) === 1 ? run + 1 : 1;
      longest = Math.max(longest, run);
      prev = t;
    }
    const vals = Object.values(days);
    const totalMs = vals.reduce((n, v) => n + (v.ms || 0), 0);
    const pages = vals.reduce((n, v) => n + (v.pages || 0), 0);
    const readingDays = vals.filter((v) => v.ms >= 60000).length;
    const year = now.getFullYear();
    const finished = State.books.filter((b) => b.finished);
    const finishedYear = finished.filter((b) => b.finishedAt && new Date(b.finishedAt).getFullYear() === year).length;
    const last14 = [];
    for (let i = 13; i >= 0; i--) {
      const day = new Date(now.getTime() - i * DAY);
      const k = keyOf(day);
      last14.push({ day, key: k, ms: days[k]?.ms || 0, pages: days[k]?.pages || 0, today: i === 0 });
    }
    const top = [...State.books].filter((b) => b.readingMs > 30000).sort((a, b) => b.readingMs - a.readingMs).slice(0, 3);
    const highlights = State.books.reduce((n, b) => n + (b.highlights || []).length, 0);
    return { streak, longest, totalMs, pages, readingDays, finished: finished.length, finishedYear, last14, top, highlights, year };
  }

  function statsHtml() {
    const st = computeStats();
    const tiles = [
      [fmtTime(st.totalMs), 'time spent reading', st.readingDays ? `about ${fmtTime(st.totalMs / st.readingDays)} a reading day` : ''],
      [`${st.streak} ${st.streak === 1 ? 'day' : 'days'}`, 'current streak', `longest ${st.longest} ${st.longest === 1 ? 'day' : 'days'}`],
      [String(st.finishedYear), `finished in ${st.year}`, `${st.finished} finished in all`],
      [String(st.pages), 'pages turned', `${st.highlights} ${st.highlights === 1 ? 'highlight' : 'highlights'} made`],
    ];
    const max = Math.max(...st.last14.map((d) => d.ms), 60000);
    const bars = st.last14
      .map((d) => {
        const h = d.ms ? Math.max(3, Math.round((d.ms / max) * 100)) : 0;
        const label = d.day.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
        return (
          `<div class="col${d.today ? ' today' : ''}" data-tip="${esc(label)}" data-val="${esc(d.ms ? `${fmtTime(d.ms)} · ${d.pages} ${d.pages === 1 ? 'page' : 'pages'}` : 'No reading')}">` +
          `<div class="plot"><i style="height:${h}%"></i></div><span>${d.day.toLocaleDateString(undefined, { weekday: 'narrow' })}</span></div>`
        );
      })
      .join('');
    const table = st.last14.map((d) => `<tr><th>${esc(d.key)}</th><td>${Math.round(d.ms / 60000)} min</td><td>${d.pages} pages</td></tr>`).join('');
    const top = st.top.length
      ? `<div class="top-books"><div class="set-title">Most time with</div>${st.top
          .map(
            (b) =>
              `<div class="top-book"><div class="tb-cover">${coverHtml(b)}</div><div class="tb-text"><div class="t">${esc(b.title)}</div><div class="a">${esc(
                b.author
              )}</div></div><div class="tb-time">${fmtTime(b.readingMs)}</div></div>`
          )
          .join('')}</div>`
      : '';
    return (
      `<div class="stat-tiles">${tiles
        .map(([n, l, sub]) => `<div class="stat"><div class="n">${esc(n)}</div><div class="l">${esc(l)}</div>${sub ? `<div class="s">${esc(sub)}</div>` : ''}</div>`)
        .join('')}</div>` +
      `<div class="chart-card"><div class="chart-head"><span class="set-title">Reading time, last 14 days</span><span class="chart-max">tallest bar ${esc(
        fmtTime(max)
      )}</span></div>` +
      `<div class="bars" role="img" aria-label="Minutes read on each of the last 14 days">${bars}</div>` +
      `<table class="sr-only"><caption>Reading time, last 14 days</caption>${table}</table>` +
      `<div class="chart-tip" id="chartTip" hidden></div></div>` +
      (st.totalMs || st.pages ? '' : `<p class="set-note">Open a book and your reading time will start gathering here.</p>`) +
      top +
      `<div class="set-row">` +
      `<div class="set-text"><div class="set-title">Daily reading goal</div><div class="set-desc">A small ring in the sidebar fills as you read each day.</div></div>` +
      `<div class="set-control">${chips('dailyGoal', [[0, 'Off'], [10, '10 min'], [20, '20 min'], [30, '30 min'], [45, '45 min'], [60, '1 hour']], State.settings.dailyGoal ?? 20)}</div></div>`
    );
  }

  async function refreshStats() {
    statData = await window.aion.getStats();
    const g = $('#statsGroup');
    if (g && !$('#statsPanel').hidden) g.innerHTML = statsHtml();
  }

  // ---------- the "Your reading" page ----------
  function renderStats() {
    $('#statsPanel').innerHTML = `<section class="set-group" id="statsGroup">${statsHtml()}</section>`;
    refreshStats();
  }

  // ---------- keyboard shortcuts (press ?) ----------
  function showShortcuts() {
    return window.UI.openModal(
      `<h3>Keyboard shortcuts</h3>` +
        `<table class="keys">${SHORTCUTS.map(
          ([where, keys, what]) => `<tr><td class="where">${where}</td><td><kbd>${esc(keys)}</kbd></td><td>${esc(what)}</td></tr>`
        ).join('')}</table>` +
        `<div class="actions"><button class="solid-btn" data-ok>Done</button></div>`,
      {
        wide: true,
        onMount(m, close) {
          $('[data-ok]', m).onclick = () => close(true);
          $('[data-ok]', m).focus();
        },
      }
    );
  }

  function render() {
    const s = State.settings;
    const panel = $('#settingsPanel');
    const scroll = $('#libScroll').scrollTop;
    const previewSize = Math.round(17 * (s.fontSize / 100) * 10) / 10;
    const previewFont = s.fontFamily === 'Original' ? 'var(--serif)' : `'${s.fontFamily}', serif`;
    const busy = update.state === 'unsupported' || update.state === 'checking' || update.state === 'downloading';

    panel.innerHTML = `
      <section class="set-group" data-group="reading">
        <h2>Reading</h2>
        <p class="set-note">Your defaults for every book. You can still adjust them from <b>Aa</b> while reading.</p>
        <div class="set-preview" style="font-family:${previewFont};font-size:${previewSize}px;line-height:${s.lineHeight}">
          The garden had gone quiet in the way gardens do at the end of summer, when the bees grow slow and heavy
          and the light comes in sideways through the hedges.
        </div>
        ${row(
          'Paper',
          'The colour of the app and the reading page.',
          `<div class="swatches set-swatches">${THEMES.map(
            ([k, label, bg, ink]) =>
              `<button class="swatch ${s.theme === k ? 'is-on' : ''}" data-set="theme" data-v="${k}">
                 <span class="mini" style="background:${bg};color:${ink}"><b></b><b></b><b></b></span>${label}</button>`
          ).join('')}</div>`,
          'wide'
        )}
        ${row('Typeface', 'Add your own .ttf, .otf, .woff or .woff2 files — add each weight and italic of a family and they’re grouped together.', fontChips(s.fontFamily), 'wide')}
        ${row(
          'Text size',
          '',
          `<div class="stepper"><button data-step="-1" aria-label="Smaller text">A</button><span>${s.fontSize}%</span><button data-step="1" aria-label="Larger text" class="big">A</button></div>`
        )}
        ${row('Line spacing', '', chips('lineHeight', CHOICES.lineHeight, s.lineHeight))}
        ${row('Margins', '', chips('margin', CHOICES.margin, s.margin))}
        ${row('Page layout', 'Two pages switches to a single page when the window is narrow.', chips('layout', CHOICES.layout, s.layout))}
        <div class="set-actions"><button class="ghost-btn" data-action="reset-reading">${icon('reset')}<span>Restore reading defaults</span></button></div>
      </section>

      <section class="set-group" data-group="pages">
        <h2>Turning pages &amp; the page</h2>
        ${row('At the foot of the page', 'Time left is learned from how fast you read.', chips('footerInfo', CHOICES.footerInfo, s.footerInfo || 'time'))}
        ${row(
          'Page numbers & running heads',
          'The book’s title, the chapter and a page number around each page, like a printed book.',
          toggle('runningHeads', s.runningHeads !== false)
        )}
        ${row('Turn pages with the scroll wheel', 'Scroll down for the next page, up for the previous one.', toggle('wheelTurns', s.wheelTurns !== false))}
        ${row('Click page edges to turn', 'Click the left or right third of the page to go back or forward.', toggle('tapZones', !!s.tapZones))}
        ${row('Hide controls while reading', 'The top and bottom bars fade away until you move the mouse.', toggle('autoHideBars', s.autoHideBars !== false))}
      </section>

      <section class="set-group" data-group="read-aloud">
        <h2>Read aloud</h2>
        <p class="set-note">Press <b>R</b> or the speaker button while reading. Uses the voices installed in Windows, so it works offline.</p>
        ${row(
          'Voice',
          '',
          `<div class="btn-row">${voiceSelect(s.ttsVoice)}<button class="ghost-btn bordered" data-action="tts-sample" title="Hear a sample">${icon('speaker')}<span>Sample</span></button></div>`
        )}
        ${row(
          'Speed',
          '',
          `<div class="stepper"><button data-rate="-0.1" aria-label="Slower">−</button><span>${(s.ttsRate || 1).toFixed(1)}×</span><button data-rate="0.1" aria-label="Faster">+</button></div>`
        )}
      </section>

      <section class="set-group" data-group="library">
        <h2>Library</h2>
        ${row(
          'Watch a folder',
          s.watchFolder
            ? `New EPUBs saved here are added automatically.<br><span class="path">${esc(s.watchFolder)}</span>`
            : 'Choose a folder, and any EPUB you save there is added to your library automatically.',
          `<div class="btn-row">${
            s.watchFolder ? `<button class="ghost-btn bordered" data-action="unwatch">Stop watching</button>` : ''
          }<button class="ghost-btn bordered" data-action="watch">${icon('folder')}<span>${s.watchFolder ? 'Change…' : 'Choose…'}</span></button></div>`
        )}
      </section>

      <section class="set-group" data-group="data">
        <h2>Your data</h2>
        <p class="set-note">${stats()}</p>
        ${row(
          'Highlights & notes',
          'Save every highlight, margin note and bookmark as a Markdown file.',
          `<button class="ghost-btn bordered" data-action="export">${icon('export')}<span>Export…</span></button>`
        )}
        ${row(
          'Back up',
          'Save your whole library — books, covers, progress, highlights, shelves and fonts — into one file.',
          `<button class="ghost-btn bordered" data-action="backup">${icon('export')}<span>Back up…</span></button>`
        )}
        ${row(
          'Restore',
          'Bring a library back from a backup file. Your current library is set aside, not deleted.',
          `<button class="ghost-btn bordered" data-action="restore">${icon('reset')}<span>Restore…</span></button>`
        )}
        ${row(
          'Library location',
          (info ? `<span class="path">${esc(info.dataDir)}</span><br>` : '') +
            'Keep it in a OneDrive or Dropbox folder to have the same library and progress on every PC.',
          `<div class="btn-row"><button class="ghost-btn bordered" data-action="open-data">${icon('folder')}<span>Open</span></button>` +
            `<button class="ghost-btn bordered" data-action="move-library">Move…</button>${
              info?.customLocation ? `<button class="ghost-btn bordered" data-action="default-location">Use default</button>` : ''
            }</div>`
        )}
      </section>

      <section class="set-group" data-group="app">
        <h2>App</h2>
        ${row(
          'Motion',
          'Full plays every stop-motion flourish. Gentle keeps things quiet: no leaf gusts or petal bursts, and the vines are already grown. Still turns animation off.',
          chips('motion', CHOICES.motion, s.motion)
        )}
        ${row('Botanical decorations', 'The painted vines, lemon bough and olive sprigs.', toggle('flora', s.flora !== false))}
        ${row(
          'Updates',
          updateText(),
          update.state === 'ready'
            ? `<button class="solid-btn" data-action="install-update">Restart to update</button>`
            : `<button class="ghost-btn bordered" data-action="check-update" ${busy ? 'disabled' : ''}>${icon('reset')}<span>Check now</span></button>`
        )}
        ${row(
          'Check for updates automatically',
          'New versions download quietly in the background and install the next time you restart.',
          toggle('autoUpdate', s.autoUpdate !== false)
        )}
        ${row(
          'Reset all settings',
          'Puts every setting on this page back to how it started. Your books and notes are untouched.',
          `<button class="ghost-btn bordered" data-action="reset-all">${icon('reset')}<span>Reset</span></button>`
        )}
      </section>

      <footer class="set-about">
        <button class="ghost-btn" data-action="shortcuts">Keyboard shortcuts <kbd>?</kbd></button>
        <span>Aion Books ${info ? esc(info.version) : ''}</span>
      </footer>`;
    $('#libScroll').scrollTop = scroll;
  }

  // Redraw whichever of the two pages is showing.
  function rerender() {
    if (!$('#settingsPanel').hidden) render();
    if (!$('#statsPanel').hidden) renderStats();
  }

  async function change(patch) {
    await setSettings(patch);
    rerender();
  }

  function bind() {
    Fonts.listeners.add(() => {
      if (!$('#settingsPanel').hidden) render();
    });
    const panels = [$('#settingsPanel'), $('#statsPanel')];
    const on = (type, fn) => panels.forEach((p) => p.addEventListener(type, fn));
    on('change', (e) => {
      const sel = e.target.closest('[data-select]');
      if (sel) change({ [sel.dataset.select]: sel.value });
    });
    if (window.speechSynthesis) {
      speechSynthesis.addEventListener('voiceschanged', () => {
        if (!$('#settingsPanel').hidden) render();
      });
    }
    // Hover read-out for the reading chart.
    on('mouseover', (e) => {
      const tip = $('#chartTip');
      if (!tip) return;
      const col = e.target.closest('.bars .col');
      if (!col) {
        tip.hidden = true;
        return;
      }
      tip.innerHTML = `<b>${esc(col.dataset.tip)}</b><span>${esc(col.dataset.val)}</span>`;
      tip.hidden = false;
      const card = tip.parentElement.getBoundingClientRect();
      const r = col.getBoundingClientRect();
      const bar = col.querySelector('.plot i').getBoundingClientRect();
      const top = (bar.height ? bar.top : r.top + 100) - card.top - tip.offsetHeight - 8;
      tip.style.left = `${r.left - card.left + r.width / 2}px`;
      tip.style.top = `${Math.max(4, top)}px`;
    });
    window.aion.updateStatus().then((s) => (update = s));
    window.aion.onUpdateStatus((s) => {
      update = s;
      if (!$('#settingsPanel').hidden) render();
    });
    window.aion.appInfo().then((i) => {
      info = i;
      if (!$('#settingsPanel').hidden) render();
    });

    on('click', async (e) => {
      const set = e.target.closest('[data-set]');
      if (set) {
        const key = set.dataset.set;
        let v = set.dataset.v;
        if (key === 'lineHeight' || key === 'dailyGoal') v = Number(v);
        await change({ [key]: v });
        if (key === 'dailyGoal') window.Library.refreshGoal();
        return;
      }
      const rate = e.target.closest('[data-rate]');
      if (rate) {
        const r = Math.round(Math.max(0.6, Math.min(2, (State.settings.ttsRate || 1) + Number(rate.dataset.rate))) * 10) / 10;
        return change({ ttsRate: r });
      }
      const tog = e.target.closest('[data-toggle]');
      if (tog) {
        const key = tog.dataset.toggle;
        return change({ [key]: State.settings[key] === false });
      }
      const step = e.target.closest('[data-step]');
      if (step) {
        const size = Math.max(70, Math.min(200, (State.settings.fontSize || 100) + Number(step.dataset.step) * 6));
        return change({ fontSize: size });
      }
      const removeBtn = e.target.closest('[data-remove-font]');
      if (removeBtn) {
        const family = removeBtn.dataset.removeFont;
        const ok = await confirmBox({
          title: 'Remove this font?',
          sub: `<em>${esc(family)}</em> will be removed from Aion Books. If you’re reading in it, the book switches back to Garamond.`,
          okLabel: 'Remove',
        });
        if (!ok) return;
        State.set(await window.aion.removeFont(family));
        render();
        return;
      }
      const act = e.target.closest('[data-action]')?.dataset.action;
      if (act === 'add-font') {
        const res = await window.aion.addFonts();
        if (!res) return;
        State.set(res.library);
        if (res.added.length) {
          await change({ fontFamily: res.added[res.added.length - 1] });
          toast(`Added ${esc(res.added.join(', '))}`, 2400);
        }
        if (res.failed.length) toast(`Couldn’t add ${esc(res.failed.map((f) => `${f.name} (${f.reason})`).join(', '))}`, 4200);
        return;
      }
      if (act === 'tts-sample') return sample();
      if (act === 'shortcuts') return showShortcuts();
      if (act === 'check-update') {
        update = { state: 'checking' };
        render();
        update = await window.aion.checkForUpdates();
        return render();
      }
      if (act === 'install-update') return window.aion.installUpdate();
      if (act === 'watch') {
        const s = await window.aion.chooseWatchFolder();
        if (s) {
          State.settings = s;
          render();
          toast('Watching that folder for new books', 2200);
        }
        return;
      }
      if (act === 'unwatch') {
        State.settings = await window.aion.clearWatchFolder();
        return render();
      }
      if (act === 'backup') {
        toast('Backing up…', 0);
        const res = await window.aion.backup();
        if (res) toast(`Backed up ${res.books} ${res.books === 1 ? 'book' : 'books'}`, 2400);
        else $('#toast').hidden = true;
        return;
      }
      if (act === 'restore') {
        const ok = await confirmBox({
          title: 'Restore from a backup?',
          sub: 'Your library will be replaced by the one in the backup, and Aion Books will restart. The current library is kept in a folder beside it, just in case.',
          okLabel: 'Choose backup…',
        });
        if (!ok) return;
        const res = await window.aion.restore();
        if (res?.error) toast(esc(res.error), 3200);
        else if (res?.ok) toast('Restored — restarting…', 0);
        return;
      }
      if (act === 'move-library') {
        const pick = await window.aion.pickLocation();
        if (!pick || pick.same) return;
        const ok = await confirmBox(
          pick.hasLibrary
            ? {
                title: 'Use the library in that folder?',
                sub: `There’s already an Aion Books library in <em>${esc(pick.folder)}</em> — perhaps from another PC. Aion Books will restart and open it. Your current library stays where it is.`,
                okLabel: 'Use it',
              }
            : {
                title: 'Move your library here?',
                sub: `Your books, progress and notes will be copied to <em>${esc(pick.folder)}</em> and Aion Books will restart. The old copy stays where it is until you delete it.`,
                okLabel: 'Move',
              }
        );
        if (!ok) return;
        const res = await window.aion.setLocation(pick.folder, pick.hasLibrary ? 'use' : 'move');
        if (res?.error) toast(esc(res.error), 3000);
        else toast('Restarting…', 0);
        return;
      }
      if (act === 'default-location') {
        const ok = await confirmBox({
          title: 'Go back to the default location?',
          sub: 'Aion Books will restart and use the library in its own app folder. Nothing is copied or deleted.',
          okLabel: 'Restart',
        });
        if (ok) window.aion.resetLocation();
        return;
      }
      if (act === 'export') {
        const res = await window.aion.exportNotes();
        if (res.empty) toast('No highlights or bookmarks to export yet', 2200);
        else if (res.written) toast(`Exported notes from ${res.count} ${res.count === 1 ? 'book' : 'books'}`, 2200);
      } else if (act === 'open-data') {
        window.aion.openDataFolder();
      } else if (act === 'reset-reading') {
        State.settings = await window.aion.resetSettings('reading');
        render();
        toast('Reading defaults restored', 1600);
      } else if (act === 'reset-all') {
        const ok = await confirmBox({
          title: 'Reset all settings?',
          sub: 'Reading, page, read-aloud and app preferences go back to their defaults. Your books, highlights and notes stay as they are.',
          okLabel: 'Reset',
        });
        if (!ok) return;
        State.settings = await window.aion.resetSettings('all');
        window.UI.applyRoot(State.settings);
        render();
        toast('Settings reset', 1600);
      }
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key !== '?' || e.ctrlKey || e.altKey || !$('#modalBack').hidden) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)) return;
    e.preventDefault();
    showShortcuts();
  });

  window.Settings = { render, renderStats, refreshStats, showShortcuts, bind };
})();
