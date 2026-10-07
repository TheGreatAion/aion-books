// The bundled typefaces, as @font-face rules that load from aion-font:// (see
// main.js). The app window and every book page share one copy of each font,
// instead of each chapter carrying the files inline in its stylesheet.
const path = require('path');

const FONTS = [
  { family: 'IM Fell English', pkg: 'im-fell-english', faces: [[400, 'normal'], [400, 'italic']] },
  { family: 'EB Garamond', pkg: 'eb-garamond', faces: [[400, 'normal'], [500, 'normal'], [600, 'normal'], [400, 'italic']] },
  { family: 'Literata', pkg: 'literata', faces: [[400, 'normal'], [600, 'normal'], [400, 'italic']] },
  { family: 'Lora', pkg: 'lora', faces: [[400, 'normal'], [600, 'normal'], [400, 'italic']] },
];

const fileName = (pkg, weight, style) => `${pkg}-latin-${weight}-${style}.woff2`;

let cached = null;
function buildFontCss() {
  if (cached) return cached;
  cached = FONTS.flatMap((font) =>
    font.faces.map(
      ([weight, style]) =>
        `@font-face{font-family:'${font.family}';font-style:${style};font-weight:${weight};` +
        `font-display:swap;src:url(aion-font://app/${fileName(font.pkg, weight, style)}) format('woff2');}`
    )
  ).join('\n');
  return cached;
}

// The file behind aion-font://app/<name>, or null if it isn't one of ours.
function bundledFontFile(appRoot, name) {
  for (const font of FONTS) {
    for (const [weight, style] of font.faces) {
      if (name === fileName(font.pkg, weight, style)) return path.join(appRoot, 'node_modules', '@fontsource', font.pkg, 'files', name);
    }
  }
  return null;
}

module.exports = { buildFontCss, bundledFontFile };
