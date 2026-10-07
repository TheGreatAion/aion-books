// Reading parts of book files on request. The reader asks for the bytes it
// needs (a zip's index, one chapter, one PDF page) instead of copying a whole
// book — some are over 100 MB — into the window before showing anything.
//
// Files are kept open briefly between reads, then closed, so Windows never
// finds one still open when a book is removed or the library moves.
const fsp = require('fs/promises');

const IDLE_MS = 8000;
const MAX_OPEN = 6;
const open = new Map(); // path → { handle: Promise<FileHandle>, size, busy, timer }

function entry(p) {
  let e = open.get(p);
  if (e) open.delete(p); // re-insert below: most recently used last
  else {
    e = { handle: fsp.open(p, 'r'), size: null, busy: 0, timer: null };
    e.handle.catch(() => open.get(p) === e && open.delete(p));
  }
  open.set(p, e);
  if (open.size > MAX_OPEN) closeIdle(open.keys().next().value);
  return e;
}

function touch(p, e) {
  clearTimeout(e.timer);
  e.timer = setTimeout(() => closeIdle(p), IDLE_MS);
}

async function closeIdle(p) {
  const e = open.get(p);
  if (!e) return;
  if (e.busy) return touch(p, e); // still reading: try again later
  open.delete(p);
  clearTimeout(e.timer);
  try {
    await (await e.handle).close();
  } catch {}
}

async function use(p, fn) {
  const e = entry(p);
  e.busy++;
  try {
    const h = await e.handle;
    if (e.size == null) e.size = (await h.stat()).size;
    return await fn(h, e.size);
  } finally {
    e.busy--;
    touch(p, e);
  }
}

// Bytes [start, end) of a file.
function readRange(p, start, end) {
  return use(p, async (h, size) => {
    const s = Math.max(0, Math.min(size, Math.floor(Number(start) || 0)));
    const t = Math.max(s, Math.min(size, end == null ? size : Math.floor(Number(end))));
    const buf = Buffer.allocUnsafe(t - s);
    let off = 0;
    while (off < buf.length) {
      const { bytesRead } = await h.read(buf, off, buf.length - off, s + off);
      if (!bytesRead) break;
      off += bytesRead;
    }
    return buf.subarray(0, off);
  });
}

const sizeOf = (p) => use(p, async (_h, size) => size);

// Close one file now (before removing it), or every file (before moving or
// replacing the library).
async function closeFile(p) {
  const e = open.get(p);
  if (!e) return;
  open.delete(p);
  clearTimeout(e.timer);
  try {
    await (await e.handle).close();
  } catch {}
}
const closeAll = () => Promise.all([...open.keys()].map(closeFile));

module.exports = { readRange, sizeOf, closeFile, closeAll };
