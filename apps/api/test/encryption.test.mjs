// Encryption of secrets stored in the database (AES-256-GCM).
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { describe, test } from 'node:test';
import { Encryption } from '../dist/common/encryption.js';

describe('encryption', () => {
  const key = randomBytes(32).toString('base64');

  test('round-trips, with a fresh nonce each time', () => {
    const box = new Encryption(key);
    const a = box.encrypt('JBSWY3DPEHPK3PXP');
    const b = box.encrypt('JBSWY3DPEHPK3PXP');
    assert.notEqual(a, b);
    assert.match(a, /^v1:/);
    assert.equal(box.decrypt(a), 'JBSWY3DPEHPK3PXP');
  });

  test('tampered values and the wrong key are rejected', () => {
    const sealed = new Encryption(key).encrypt('secret');
    const parts = sealed.split(':');
    parts[3] = Buffer.from('tampered').toString('base64url');
    assert.throws(() => new Encryption(key).decrypt(parts.join(':')));
    assert.throws(() => new Encryption(randomBytes(32).toString('base64')).decrypt(sealed));
  });

  test('keys must be 32 bytes', () => {
    assert.throws(() => new Encryption(randomBytes(16).toString('base64')), /32 bytes/);
  });
});
