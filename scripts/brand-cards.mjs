// Copies the bundled gift card art into the storefront: for every brand registry entry with `art`
// (apps/api/src/storefront/brand-registry.json), the named PNG from the card art pack in assets/ is converted to WebP and
// written to apps/storefront/public/brand-cards/<entry slug>.webp, which the API uses as the brand's card art when
// nothing was uploaded and the entry has no `card`. Files for entries without art are removed. Run after changing the
// pack or the registry:
//   node scripts/brand-cards.mjs
// The pack's SOURCES.csv lists each file's brand; brand marks and card designs remain their owners'.
import { mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([a-z]:)/i, '$1');
const pack = join(root, 'assets/BitoCard-Gift-Card-Art');
const out = join(root, 'apps/storefront/public/brand-cards');
const registry = JSON.parse(readFileSync(join(root, 'apps/api/src/storefront/brand-registry.json'), 'utf8'));

mkdirSync(out, { recursive: true });
const written = new Set();
for (const brand of registry.brands) {
  if (!brand.art) continue;
  const file = `${brand.slug}.webp`;
  try {
    // Metadata (and anything else embedded) is dropped: only the pixels are written.
    await sharp(join(pack, brand.art)).resize({ width: 600, withoutEnlargement: true }).webp({ quality: 85, alphaQuality: 90 }).toFile(join(out, file));
  } catch (error) {
    throw new Error(`${brand.slug} (${brand.art}): ${error.message}`);
  }
  written.add(file);
}
for (const file of readdirSync(out)) if (!written.has(file)) rmSync(join(out, file));
console.log(`Wrote ${written.size} card images to apps/storefront/public/brand-cards.`);
