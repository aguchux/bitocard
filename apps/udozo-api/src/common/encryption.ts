import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * AES-256-GCM for small secrets stored in the database (for example admin authenticator secrets).
 * Output format: `v1:<iv>:<tag>:<ciphertext>`, each part base64url. The key is 32 bytes, base64-encoded (ENCRYPTION_KEY).
 */
export class Encryption {
  private readonly key: Buffer;

  constructor(base64Key: string) {
    this.key = Buffer.from(base64Key, 'base64');
    if (this.key.length !== 32) throw new Error('ENCRYPTION_KEY must be 32 bytes, base64-encoded.');
  }

  encrypt(plain: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return ['v1', iv, cipher.getAuthTag(), data].map(part => (typeof part === 'string' ? part : part.toString('base64url'))).join(':');
  }

  decrypt(sealed: string) {
    const [version, iv, tag, data] = sealed.split(':');
    if (version !== 'v1' || !iv || !tag || data === undefined) throw new Error('Unrecognised encrypted value');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
  }
}
