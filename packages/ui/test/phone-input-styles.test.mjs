import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const root = new URL('../../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

/** Every source file of an app (no build output or dependencies). */
function files(dir) {
  return readdirSync(dir).flatMap(name => {
    if (['node_modules', '.next', 'test'].includes(name)) return [];
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : /\.tsx?$/.test(name) ? [path] : [];
  });
}

test('apps using PhoneInput have Tailwind read it and serve its flag images', () => {
  const apps = readdirSync(join(root, 'apps')).filter(app => {
    try {
      return files(join(root, 'apps', app)).some(file => readFileSync(file, 'utf8').includes('@bitocard/ui/phone-input'));
    } catch {
      return false;
    }
  });
  assert.ok(apps.length > 0);
  for (const app of apps) {
    const css = readFileSync(join(root, 'apps', app, 'app', 'globals.css'), 'utf8');
    assert.match(css, /@source "\.\.\/\.\.\/\.\.\/packages\/ui\/src\/phone-input\.tsx";/, `${app}'s globals.css`);
    assert.ok(statSync(join(root, 'apps', app, 'app', 'flags', '[code]', 'route.ts')).isFile(), `${app} serves /flags/<code>.svg for the country prefix`);
  }
});
