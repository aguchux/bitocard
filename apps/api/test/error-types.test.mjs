// Every error's `type` matches its HTTP status, as the docs promise (guides/errors): 401 authentication_error,
// 403 permission_error, 404 not_found_error, 409 conflict_error (or idempotency_error), 429 rate_limit_error,
// 400/402/422 invalid_request_error (or idempotency_error), 5xx api_error. Checked over the API source.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const src = new URL('../src/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const allowed = {
  BAD_REQUEST: ['invalid_request_error', 'idempotency_error'],
  PAYMENT_REQUIRED: ['invalid_request_error'],
  UNPROCESSABLE_ENTITY: ['invalid_request_error', 'idempotency_error'],
  UNAUTHORIZED: ['authentication_error'],
  FORBIDDEN: ['permission_error'],
  NOT_FOUND: ['not_found_error'],
  CONFLICT: ['conflict_error', 'idempotency_error'],
  TOO_MANY_REQUESTS: ['rate_limit_error'],
  INTERNAL_SERVER_ERROR: ['api_error'],
  BAD_GATEWAY: ['api_error'],
  SERVICE_UNAVAILABLE: ['api_error'],
  GATEWAY_TIMEOUT: ['api_error'],
};

const files = dir => readdirSync(dir, { withFileTypes: true }).flatMap(entry => (entry.isDirectory() ? (entry.name === 'generated' ? [] : files(join(dir, entry.name))) : entry.name.endsWith('.ts') ? [join(dir, entry.name)] : []));

test("every error's type matches its HTTP status", () => {
  const wrong = [];
  let checked = 0;
  for (const file of files(src)) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/ApiError\(\s*HttpStatus\.(\w+),\s*'(\w+)',\s*'(\w+)'/g)) {
      const [, status, type, code] = match;
      checked += 1;
      if (allowed[status] && !allowed[status].includes(type)) wrong.push(`${file.slice(src.length)}: ${status} ${type} (${code})`);
    }
  }
  assert.ok(checked > 100, `found ${checked} errors to check`);
  assert.deepEqual(wrong, []);
});
