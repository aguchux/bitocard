// The phone's own alerts are never used to tell people things: Udozo's dialog and toasts (`@/components/feedback`) are.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

test('the phone’s own alerts are never used: Udozo’s dialog and toasts say everything', () => {
  const root = fileURLToPath(new URL('../src/', import.meta.url));
  const sources = (dir: string): string[] =>
    readdirSync(dir).flatMap(name => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? sources(path) : /\.(tsx?|jsx?)$/.test(name) ? [path] : [];
    });
  const found = sources(root).filter(path => /\bAlert\.(alert|prompt)\s*\(|\bToastAndroid\b|\bwindow\.alert\s*\(/.test(readFileSync(path, 'utf8')));
  assert.deepEqual(found, [], `Use useDialog or useToast from @/components/feedback instead, in: ${found.join(', ')}`);
});
