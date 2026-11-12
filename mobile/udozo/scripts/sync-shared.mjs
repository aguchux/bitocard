// Copies the Udozo types and helpers udozo.com uses (packages/api-client/src: classifieds.ts, home.ts and the
// storefront.ts home.ts reads its types from) into src/shared, as they are, so EAS builds, which upload only this
// folder, have them. Run after those files change: node scripts/sync-shared.mjs. test/shared.test.ts fails while a copy
// differs from its original.
import { copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const sharedFiles = ['classifieds.ts', 'home.ts', 'storefront.ts'];
const from = join(here, '../../../packages/api-client/src');
const to = join(here, '../src/shared');

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const file of sharedFiles) copyFileSync(join(from, file), join(to, file));
  console.log(`Copied ${sharedFiles.join(', ')} to src/shared`);
}
