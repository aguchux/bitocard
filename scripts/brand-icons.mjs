// Copies the bundled brand icons into the storefront: for every brand registry entry with an `icon`
// (apps/api/src/storefront/brand-registry.json), the named SVG from the icon pack in assets/ is cleaned up and written
// to apps/storefront/public/brand-icons/<entry slug>.svg, which the API uses as the brand's logo when nothing was
// uploaded. Files for entries without an icon are removed. Run after changing the pack or the registry:
//   node scripts/brand-icons.mjs
// The pack's SOURCES.csv records where each mark comes from and its rights note; brand marks remain their owners'.
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([a-z]:)/i, '$1');
const pack = join(root, 'assets/BitoCard-Brand-Icons-500x500/bitocard-brand-icons-500x500/svg');
const out = join(root, 'apps/storefront/public/brand-icons');
const registry = JSON.parse(readFileSync(join(root, 'apps/api/src/storefront/brand-registry.json'), 'utf8'));

// White marks made for dark backgrounds: drawn on the brand's colour, because the store shows logos on a white tile.
const onBrandColour = new Set(['telkom', 'qcell', 'africell']);

/** Plain SVG: no namespace prefixes, comments or source notes, nothing that could load or run anything. */
function cleanSvg(text, background) {
  const svg = text
    .replace(/<\?xml[^>]*>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/xmlns:ns0=/g, 'xmlns=')
    .replace(/(<\/?)ns0:/g, '$1')
    .replace(/<desc\b[^>]*>[\s\S]*?<\/desc>/g, '')
    .replace(/aria-labelledby="title desc"/g, 'aria-labelledby="title"')
    .replace(/>\s+</g, '><')
    .trim();
  if (!svg.startsWith('<svg')) throw new Error('not an SVG');
  if (background) return checked(svg.replace(/<\/title>/, `</title><rect width="500" height="500" rx="96" fill="${background}"/>`));
  return checked(svg);
}

function checked(svg) {
  if (/<script|<foreignObject|<!ENTITY|<image|\son[a-z]+=|javascript:|(?:xlink:)?href="(?!#)|url\((?!#)/i.test(svg)) throw new Error('unsafe content');
  return `${svg}\n`;
}

mkdirSync(out, { recursive: true });
const written = new Set();
for (const brand of registry.brands) {
  if (!brand.icon) continue;
  const file = `${brand.slug}.svg`;
  try {
    writeFileSync(join(out, file), cleanSvg(readFileSync(join(pack, brand.icon), 'utf8'), onBrandColour.has(brand.slug) ? brand.color : undefined));
  } catch (error) {
    throw new Error(`${brand.slug} (${brand.icon}): ${error.message}`);
  }
  written.add(file);
}
for (const file of readdirSync(out)) if (!written.has(file)) rmSync(join(out, file));
console.log(`Wrote ${written.size} brand icons to apps/storefront/public/brand-icons.`);
