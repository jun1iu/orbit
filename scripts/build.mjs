// Builds the site into dist/: the English page as written, plus one static page per
// published locale in locales/*.json (e.g. /zh-hans/). No dependencies.
//
// A locale is published only if its file has "published": true. Unpublished locales are
// still checked, but get no page, no link in the language switch and no hreflang or
// sitemap entry; with none published, the switch is removed. To put a language on the
// live site, set "published": true and merge.
//
// Each locale lists translations as [English, translated] pairs. The build fails if an
// English string isn't found in index.html (so copy edits can't silently leave a page
// half-translated) or if visible English is left on a translated page that isn't on
// the locale's keep list (names, products, code).
//
//   node scripts/build.mjs        then serve dist/, e.g. python3 -m http.server -d dist 8000

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const SITE = 'https://orbit.jun-liu.net';
const STATIC = ['404.html', 'style.css', 'main.js', 'contact.js', 'robots.txt', 'og-image.png', 'vendor'];

const source = readFileSync(join(root, 'index.html'), 'utf8');
const localeDir = join(root, 'locales');
const locales = (existsSync(localeDir) ? readdirSync(localeDir) : [])
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(join(localeDir, f), 'utf8')));

const published = locales.filter((l) => l.published === true);
const hidden = locales.filter((l) => l.published !== true);

const problems = [];
const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

/** Take unpublished languages out of the head links and the switch. */
function hideUnpublished(html) {
  for (const l of hidden) {
    html = html
      .replace(new RegExp(`\\n<link rel="alternate" hreflang="${l.htmlLang}"[^>]*>`), '')
      .replace(new RegExp(`\\n\\s*<a href="${l.path}" hreflang=[^>]*>[^<]*</a>`), '');
  }
  if (!published.length) {
    html = html
      .replace(/\n<link rel="alternate" hreflang="[^"]*"[^>]*>/g, '')
      .replace(/\n\s*<nav class="lang"[\s\S]*?<\/nav>/, '');
  }
  return html;
}

/** Mark which language link is current. */
function setCurrent(html, path) {
  return html.replace(/(<nav class="lang"[\s\S]*?<\/nav>)/, (nav) =>
    nav
      .replace(/ aria-current="true"/g, '')
      .replace(new RegExp(`(<a href="${path.replace(/\//g, '\\/')}")`), '$1 aria-current="true"'),
  );
}

/** Visible text of a page, for the leftover-English check. */
function visibleText(html) {
  const attrs = [
    ...html.matchAll(/\s(?:aria-label|placeholder|title|alt|data-desc)="([^"]*)"/g),
    ...html.matchAll(/<meta (?:name="description"|property="og:(?:title|description)") content="([^"]*)"/g),
  ].map((m) => m[1]);
  const body = html
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/g, ' ')
    .replace(/<[^>]+>/g, ' ');
  return [body, ...attrs].join('\n').replace(/&amp;/g, '&').replace(/&[a-z]+;/g, ' ');
}

function buildLocale(loc) {
  let html = source;
  for (const [en, translated] of loc.pairs) {
    if (!html.includes(en)) {
      problems.push(`${loc.lang}: English text not found in index.html: “${en.slice(0, 70)}”`);
      continue;
    }
    html = html.split(en).join(translated);
  }

  const url = `${SITE}${loc.path}`;
  html = html
    .replace('<html lang="en">', `<html lang="${loc.htmlLang}">`)
    .replace(`<link rel="canonical" href="${SITE}/">`, `<link rel="canonical" href="${url}">`)
    .replace(`<meta property="og:url" content="${SITE}/">`, `<meta property="og:url" content="${url}">`)
    .replace('<meta property="og:locale" content="en_US">', `<meta property="og:locale" content="${loc.ogLocale}">`)
    .replace('</head>', `<script id="i18n" type="application/json">${JSON.stringify(loc.js)}</script>\n</head>`);
  html = setCurrent(hideUnpublished(html), loc.path);

  // Anything English left that isn't a name, product or code means a missing translation.
  let text = visibleText(html);
  for (const keep of [...loc.keep].sort((a, b) => b.length - a.length)) text = text.split(keep).join(' ');
  const leftovers = [...new Set(text.match(/[A-Za-z][A-Za-z’'-]{2,}(?:\s+[A-Za-z][A-Za-z’'-]+)*/g) ?? [])];
  for (const l of leftovers) problems.push(`${loc.lang}: untranslated English: “${l}”`);

  if (loc.published !== true) return; // checked, not written
  const dir = join(dist, loc.path);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.html'), html);
}

if (existsSync(dist)) rmSync(dist, { recursive: true, force: true });
mkdirSync(dist);
for (const f of STATIC) cpSync(join(root, f), join(dist, f), { recursive: true });
writeFileSync(join(dist, 'index.html'), setCurrent(hideUnpublished(source), '/'));
locales.forEach(buildLocale);

// Sitemap with every language version linked to the others
const pages = [{ path: '/', hreflang: 'en' }, ...published.map((l) => ({ path: l.path, hreflang: l.lang }))];
const alternates = (pages.length < 2 ? [] : pages).map((p) => `    <xhtml:link rel="alternate" hreflang="${p.hreflang}" href="${SITE}${p.path}"/>`).join('\n');
writeFileSync(
  join(dist, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${pages.map((p) => `  <url>\n    <loc>${escapeHtml(SITE + p.path)}</loc>${alternates ? `\n${alternates}` : ''}\n  </url>`).join('\n')}
</urlset>
`,
);

if (problems.length) {
  console.error(`Build failed:\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log(`Built dist/: ${pages.map((p) => p.path).join(', ')}${hidden.length ? ` (checked, not published: ${hidden.map((l) => l.path).join(', ')})` : ''}`);
