// Uploads brand logos and card art for the brand registry (src/storefront/brand-registry.json) to file storage, at
// fixed addresses: <SPACES_ROOT>/platform/brands/<slug>/logo.<ext> and .../card.<ext>. Needs `npm run build` first.
//
//   SPACES_KEY=... SPACES_SECRET=... SPACES_BUCKET=bitocard-media SPACES_REGION=nyc3 \
//     npm run brands:logos -w @bitocard/api -- ./logos --write
//
// The folder holds <slug>.svg|png|webp|jpg (the square logo or icon) and <slug>-card.png|webp|jpg (wide card art),
// named by a brand's registry slug or any slug it covers (psn-plus for PlayStation). Every file is checked like an
// upload in the admin app (really the image it claims to be; SVG only as a plain drawing). With --write, the registry's
// logo and card fields are set to the uploaded paths; commit the registry afterwards. --registry <file> edits another copy.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectImage } from '../dist/media/images.js';
import { encodeKey, signRequest } from '../dist/media/sigv4.js';

const args = process.argv.slice(2);
const folder = args.find(arg => !arg.startsWith('--') && args[args.indexOf(arg) - 1] !== '--registry');
const write = args.includes('--write');
const registryPath = args.includes('--registry') ? resolve(args[args.indexOf('--registry') + 1]) : fileURLToPath(new URL('../src/storefront/brand-registry.json', import.meta.url));
const { SPACES_KEY, SPACES_SECRET, SPACES_BUCKET, SPACES_REGION = 'nyc3', SPACES_ENDPOINT, SPACES_ROOT = 'bitocard' } = process.env;
if (!folder || !SPACES_KEY || !SPACES_SECRET || !SPACES_BUCKET) {
  console.error('Usage: SPACES_KEY=… SPACES_SECRET=… SPACES_BUCKET=… npm run brands:logos -w @bitocard/api -- <folder> [--write] [--registry <file>]');
  process.exit(1);
}

const types = { '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };
const limits = { logo: 1024 * 1024, card: 5 * 1024 * 1024 };
const registry = JSON.parse(readFileSync(registryPath, 'utf8'));
const bySlug = new Map(registry.brands.flatMap(brand => [brand.slug, ...brand.slugs].map(slug => [slug, brand])));
const endpoint = (SPACES_ENDPOINT ?? `https://${SPACES_REGION}.digitaloceanspaces.com`).replace(/\/+$/, '');
const credentials = { accessKey: SPACES_KEY, secret: SPACES_SECRET, region: SPACES_REGION };

let uploaded = 0;
let problems = 0;
for (const file of readdirSync(folder).sort()) {
  const ext = extname(file).toLowerCase();
  const type = types[ext];
  if (!type) continue;
  const base = file.slice(0, -ext.length).toLowerCase();
  const kind = base.endsWith('-card') ? 'card' : 'logo';
  const slug = kind === 'card' ? base.slice(0, -'-card'.length) : base;
  const brand = bySlug.get(slug);
  const fail = message => {
    problems += 1;
    console.error(`✗ ${file}: ${message}`);
  };
  if (!brand) {
    fail(`no brand in the registry covers "${slug}"; add it first`);
    continue;
  }
  if (kind === 'card' && type === 'image/svg+xml') {
    fail('card art must be PNG, WebP or JPEG');
    continue;
  }
  const body = readFileSync(join(folder, file));
  if (body.length > limits[kind]) {
    fail(`too large (at most ${limits[kind] / 1024 / 1024} MB)`);
    continue;
  }
  if (!inspectImage(body, type)) {
    fail(type === 'image/svg+xml' ? 'not a plain SVG drawing (no scripts, event handlers or outside references)' : `not a valid ${ext.slice(1).toUpperCase()} image`);
    continue;
  }
  const path = `brands/${brand.slug}/${kind}${ext === '.jpeg' ? '.jpg' : ext}`;
  const key = `${SPACES_ROOT}/platform/${path}`;
  const url = new URL(`${endpoint}/${encodeKey(SPACES_BUCKET)}/${encodeKey(key)}`);
  // Fixed names can be replaced, so they are cached for a day rather than for good.
  const headers = signRequest({
    method: 'PUT',
    url,
    // SVG is served as a download (an <img> still shows it): opened on its own, a browser never runs it as a page.
    headers: { 'content-type': type, 'x-amz-acl': 'public-read', 'cache-control': 'public, max-age=86400', ...(type === 'image/svg+xml' ? { 'content-disposition': 'attachment' } : {}) },
    credentials,
    payloadHash: createHash('sha256').update(body).digest('hex'),
  });
  const res = await fetch(url, { method: 'PUT', headers, body });
  if (!res.ok) {
    fail(`storage refused it (${res.status}): ${(await res.text()).slice(0, 200)}`);
    continue;
  }
  brand[kind] = path;
  uploaded += 1;
  console.log(`✓ ${file} → ${path}`);
}

if (write && uploaded) {
  // One brand per line, as the file is kept, so changes are easy to review.
  const line = brand => `{ ${Object.entries(brand).map(([key, value]) => `${JSON.stringify(key)}: ${JSON.stringify(value).replace(/","/g, '", "')}`).join(', ')} }`;
  writeFileSync(registryPath, `{\n  "about": ${JSON.stringify(registry.about)},\n  "brands": [\n${registry.brands.map(brand => `    ${line(brand)}`).join(',\n')}\n  ]\n}\n`);
  console.log(`Updated ${registryPath}`);
}
console.log(`${uploaded} uploaded, ${problems} refused.`);
if (problems) process.exitCode = 1;
