// Paper sounds: a soft rustle for a page turn and a quick riffle for a longer
// jump. Made on the spot with the Web Audio API (no sound files), and each one
// a little different, so it never sounds like the same recording on repeat.
(function () {
  let ctx = null;
  let noise = null;

  function audio() {
    if (!ctx) {
      ctx = new AudioContext();
      // A second of pink noise (Paul Kellet's filter): softer than white noise, closer to paper.
      const len = ctx.sampleRate;
      noise = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = noise.getChannelData(0);
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + w * 0.0555179;
        b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856;
        b4 = 0.55 * b4 + w * 0.5329522;
        b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
      }
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  const rand = (a, b) => a + Math.random() * (b - a);
  const on = () => window.UI?.State?.settings?.paperSounds === true;

  // One sheet moving through the air: a band of rustle that sweeps as the page
  // swings over, a small swell as it lands, and a breath of air beneath it.
  function sheet(at, { len = 0.3, gain = 1, from = 3200, to = 1300 } = {}) {
    const c = audio();
    const src = c.createBufferSource();
    src.buffer = noise;

    const band = c.createBiquadFilter();
    band.type = 'bandpass';
    band.Q.value = 0.8;
    band.frequency.setValueAtTime(from, at);
    band.frequency.exponentialRampToValueAtTime(to, at + len);
    const rustle = c.createGain();
    rustle.gain.setValueAtTime(0.0001, at);
    rustle.gain.exponentialRampToValueAtTime(0.22 * gain, at + len * 0.14);
    rustle.gain.exponentialRampToValueAtTime(0.1 * gain, at + len * 0.45);
    rustle.gain.exponentialRampToValueAtTime(0.16 * gain, at + len * 0.62);
    rustle.gain.exponentialRampToValueAtTime(0.0001, at + len);
    src.connect(band).connect(rustle).connect(c.destination);

    const low = c.createBiquadFilter();
    low.type = 'lowpass';
    low.frequency.value = 260;
    const air = c.createGain();
    air.gain.setValueAtTime(0.0001, at);
    air.gain.exponentialRampToValueAtTime(0.35 * gain, at + len * 0.25);
    air.gain.exponentialRampToValueAtTime(0.0001, at + len * 0.9);
    src.connect(low).connect(air).connect(c.destination);

    src.start(at, Math.random() * 0.6, len + 0.05);
  }

  // A page turned; back sweeps the other way, as the page swings from the other side.
  function turn(back = false) {
    if (!on()) return;
    const c = audio();
    const len = rand(0.26, 0.34);
    sheet(c.currentTime + 0.005, {
      len,
      gain: rand(0.85, 1.1),
      from: back ? rand(1200, 1500) : rand(2900, 3500),
      to: back ? rand(2800, 3300) : rand(1200, 1500),
    });
  }

  // A jump further on or back: pages fanned past the thumb, then one that settles.
  function riffle() {
    if (!on()) return;
    const c = audio();
    const n = Math.round(rand(6, 9));
    let t = c.currentTime + 0.005;
    for (let i = 0; i < n; i++) {
      sheet(t, { len: rand(0.07, 0.1), gain: (1 - (i / n) * 0.6) * 0.7, from: rand(3500, 4500), to: rand(1800, 2400) });
      t += rand(0.028, 0.045);
    }
    sheet(t, { len: 0.24, gain: 0.6 });
  }

  window.PaperSound = { turn, riffle };
})();
