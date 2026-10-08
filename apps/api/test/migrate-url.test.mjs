// The address migrations use: Neon's direct host instead of its pooler, so Prisma's advisory lock holds.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { migrationUrl } from '../scripts/migrate-url.mjs';

test('a Neon pooled address becomes its direct address; DIRECT_URL wins; anything else is kept', () => {
  const pooled = 'postgresql://owner:secret@ep-quiet-sky-a1b2c3-pooler.c-6.us-east-2.aws.neon.tech/app?sslmode=require&pgbouncer=true';
  assert.equal(migrationUrl({ DATABASE_URL: pooled }), 'postgresql://owner:secret@ep-quiet-sky-a1b2c3.c-6.us-east-2.aws.neon.tech/app?sslmode=require');
  assert.equal(migrationUrl({ DATABASE_URL: pooled, DIRECT_URL: 'postgresql://direct/app' }), 'postgresql://direct/app');
  const direct = 'postgresql://owner:secret@ep-quiet-sky-a1b2c3.c-6.us-east-2.aws.neon.tech/app?sslmode=require';
  assert.equal(migrationUrl({ DATABASE_URL: direct }), direct);
  assert.equal(migrationUrl({ DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/bitocard_test' }), 'postgresql://postgres:postgres@localhost:5432/bitocard_test');
  assert.equal(migrationUrl({}), undefined);
});
