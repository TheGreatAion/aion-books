// Builds an @font-face stylesheet with the bundled fonts inlined as data URLs,
// so it works both in the app window and inside the sandboxed book iframes.
const fs = require('fs');
const path = require('path');

const FONTS = [
  { family: 'IM Fell English', pkg: 'im-fell-english', faces: [[400, 'normal'], [400, 'italic']] },
  { family: 'EB Garamond', pkg: 'eb-garamond', faces: [[400, 'normal'], [500, 'normal'], [600, 'normal'], [400, 'italic']] },
  { family: 'Literata', pkg: 'literata', faces: [[400, 'normal'], [600, 'normal'], [400, 'italic']] },
  { family: 'Lora', pkg: 'lora', faces: [[400, 'normal'], [600, 'normal'], [400, 'italic']] },
];

let cached = null;

function buildFontCss(appRoot) {
  if (cached) return cached;
  const rules = [];
  for (const font of FONTS) {
    for (const [weight, style] of font.faces) {
      const file = path.join(
        appRoot, 'node_modules', '@fontsource', font.pkg, 'files',
        `${font.pkg}-latin-${weight}-${style}.woff2`
      );
      if (!fs.existsSync(file)) continue;
      const b64 = fs.readFileSync(file).toString('base64');
      rules.push(
        `@font-face{font-family:'${font.family}';font-style:${style};font-weight:${weight};` +
          `font-display:swap;src:url(data:font/woff2;base64,${b64}) format('woff2');}`
      );
    }
  }
  cached = rules.join('\n');
  return cached;
}

module.exports = { buildFontCss };
