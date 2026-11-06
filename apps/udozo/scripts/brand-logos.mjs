// Writes udozo.com's bundled brand logos (`public/brand-logos/<brand slug>.svg`) from Simple Icons (CC0; the marks stay
// their owners'), for the brands listed in `brand-logos.json` (Udozo's slug: Simple Icons' slug and colour). Each mark is
// drawn in its brand colour, or near-black where that colour is too light to see on white.
//
//   npm pack simple-icons && tar xzf simple-icons-*.tgz   (in a folder of its own)
//   node apps/udozo/scripts/brand-logos.mjs <that folder>/package
//
// The brands come from the API's registry (migration 20270204000000_classified_brands sets `logo_file` to the slug); a
// brand added later gets its logo by an admin's upload, or an entry here and a migration setting its `logo_file`.
// An entry with `own` is a mark the brand publishes itself (its `source`), not in Simple Icons: its file is kept as
// committed, never rewritten or removed.
import { readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const source = process.argv[2];
if (!source) throw new Error('Give the Simple Icons package folder.');
const map = JSON.parse(readFileSync(join(here, 'brand-logos.json'), 'utf8'));
const out = join(here, '..', 'public', 'brand-logos');

const luminance = hex => {
  const [r, g, b] = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

for (const file of readdirSync(out)) if (!(file.replace(/\.svg$/, '') in map)) rmSync(join(out, file));
for (const [slug, { icon, hex, own }] of Object.entries(map)) {
  if (own) continue;
  const fill = luminance(hex) > 0.7 ? '#1F2937' : `#${hex.toUpperCase()}`;
  const svg = readFileSync(join(source, 'icons', `${icon}.svg`), 'utf8')
    .replace(/<title>[^<]*<\/title>/, '')
    .replace('<svg ', `<svg fill="${fill}" `);
  writeFileSync(join(out, `${slug}.svg`), svg);
}
console.log(`${Object.keys(map).length} logos written to ${out}`);
