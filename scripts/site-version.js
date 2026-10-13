// Brings the website up to the version in package.json: the version search
// engines read, and the sitemap's date. npm runs this after `npm version`.
// docs/index.html is edited by hand; everything else on it stays as it is.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const { version } = require(path.join(root, 'package.json'));

const page = path.join(root, 'docs/index.html');
const html = fs.readFileSync(page, 'utf8');
const next = html.replace(/("softwareVersion":\s*")[^"]*(")/, `$1${version}$2`);
if (next === html && !html.includes(`"softwareVersion": "${version}"`)) throw new Error('softwareVersion not found in docs/index.html');
fs.writeFileSync(page, next);

const today = new Date().toISOString().slice(0, 10);
const sitemap = path.join(root, 'docs/sitemap.xml');
fs.writeFileSync(sitemap, fs.readFileSync(sitemap, 'utf8').replace(/<lastmod>[^<]*<\/lastmod>/, `<lastmod>${today}</lastmod>`));

console.log(`site: ${version}, ${today}`);
