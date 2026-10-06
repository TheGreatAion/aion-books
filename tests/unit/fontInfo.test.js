const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { fontInfo } = require('../../lib/fontInfo');

const FS = path.join(__dirname, '../../node_modules/@fontsource');

test('reads family, weight and style from a WOFF file', () => {
  const file = path.join(FS, 'lora/files/lora-latin-700-normal.woff');
  assert.deepEqual(fontInfo(fs.readFileSync(file), file), { family: 'Lora', weight: 700, style: 'normal' });
});

test('reads italic from a WOFF file', () => {
  const file = path.join(FS, 'eb-garamond/files/eb-garamond-latin-400-italic.woff');
  const info = fontInfo(fs.readFileSync(file), file);
  assert.equal(info.style, 'italic');
  assert.equal(info.weight, 400);
  assert.match(info.family, /EB Garamond/);
});

test('falls back to the file name for WOFF2', () => {
  const file = path.join(FS, 'lora/files/lora-latin-400-italic.woff2');
  assert.deepEqual(fontInfo(fs.readFileSync(file), file), { family: 'Lora', weight: 400, style: 'italic' });
});

test('cleans up file names like MyFont-SemiBoldItalic.ttf', () => {
  const info = fontInfo(Buffer.from('not a real font'), 'C:/fonts/Hoefler_Text-SemiBold-Italic.ttf');
  assert.deepEqual(info, { family: 'Hoefler Text', weight: 600, style: 'italic' });
});
