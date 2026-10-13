// Paper sounds: real recordings of a page being turned (from Kenney's RPG Audio,
// CC0), one of three picked for each turn and played at a slightly different
// speed and volume, so it never sounds like the same clip on repeat. A longer
// jump flicks through a few pages at once.
(function () {
  const FILES = ['sounds/bookFlip1.ogg', 'sounds/bookFlip2.ogg', 'sounds/bookFlip3.ogg'];
  let ctx = null;
  let flips = null; // decoded recordings, loaded the first time they're needed
  let last = -1;

  function audio() {
    if (!ctx) {
      ctx = new AudioContext();
      flips = Promise.all(
        FILES.map((f) =>
          fetch(f)
            .then((r) => r.arrayBuffer())
            .then((b) => ctx.decodeAudioData(b))
            .catch(() => null)
        )
      ).then((all) => all.filter(Boolean));
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  const rand = (a, b) => a + Math.random() * (b - a);
  const on = () => window.UI?.State?.settings?.paperSounds === true;

  // One page: a different recording from the last one, a touch faster or slower.
  async function flip(delay = 0, { rate = 1, gain = 0.7 } = {}) {
    const c = audio();
    const all = await flips;
    if (!all.length) return;
    let i = Math.floor(Math.random() * all.length);
    if (all.length > 1 && i === last) i = (i + 1) % all.length;
    last = i;
    const src = c.createBufferSource();
    src.buffer = all[i];
    src.playbackRate.value = rate * rand(0.94, 1.06);
    const g = c.createGain();
    g.gain.value = gain * rand(0.85, 1);
    src.connect(g).connect(c.destination);
    src.start(c.currentTime + delay);
  }

  function turn(back = false) {
    if (on()) flip(0, { rate: back ? 0.96 : 1 });
  }

  // A jump further on or back: a few pages flicked past, quicker and lighter.
  function riffle() {
    if (!on()) return;
    const n = Math.random() < 0.5 ? 2 : 3;
    for (let k = 0; k < n; k++) flip(k * rand(0.07, 0.1), { rate: rand(1.15, 1.3), gain: 0.55 - k * 0.08 });
  }

  // How many recordings are ready to play (for the tests).
  const loaded = () => (audio(), flips.then((all) => all.length));

  window.PaperSound = { turn, riffle, loaded };
})();
