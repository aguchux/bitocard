// TEMPORARY (droplet move, deploy/droplet/README.md): Vercel never shows Sensitive variables, so the production build
// hands ENCRYPTION_KEY to the droplet sealed to a key only the droplet holds (RSA-OAEP-SHA256). Only the sealed value is
// printed; it is useless without the droplet's private key. Never fails the build. Removed once the droplet has the key.
import { constants, createHash, createPublicKey, publicEncrypt } from 'node:crypto';

const dropletKey = `-----BEGIN PUBLIC KEY-----
MIIBojANBgkqhkiG9w0BAQEFAAOCAY8AMIIBigKCAYEAppREDgplO4iv8IKknxYG
NdnMjP2/E9y6n6v9nULvjNT4oeBPfZefSHZRIx1BcQl+B0ZwjKu3ZV89DArcLvKV
0UrJ2N2GgPpOcJa4cLLm8+o8p5vr/l+XHBk+YJ7qlEjC+M69FwpTBB3j9Y+M1rdo
hxk0SjVp0X2pXtjjSi2agvBbzqU0k8HQojZe1euwq57HhOmvdQTP3MZ++6f1S9ZZ
FgJVk1PMup4qSp1XSrnfyDJ/XuSsvycZqzQyStis/xV4Kvjnv/xR0771lTUpsg1G
T9pTmJsT/hNqs137Yx5Yuo+7/kXl+DV3qye+6LMLgRDVH7PiDdXYCth0GOWKmTah
rZhNk4RXY7Ovk6eA7TYg/4XgreNtOfRTM1tjdWpQ04vgnifGX9LSREYxUtHgl1l0
J5tb5guvNRIG3lwhnnphz7uMkAokJdCtLT0WACZQf0UIDCmUJL8dlS2r1ShHM5xS
JMKPwkJ7v0LGz5WquOlIGe/QeCr0tyemyoCiSbrNSw55AgMBAAE=
-----END PUBLIC KEY-----`;

try {
  const key = process.env.ENCRYPTION_KEY;
  if (process.env.VERCEL_ENV !== 'production') console.log('[key-handoff] skipped: not a production build');
  else if (!key) console.log('[key-handoff] skipped: ENCRYPTION_KEY is not set for the build');
  else {
    const pub = createPublicKey(dropletKey);
    const id = createHash('sha256').update(pub.export({ type: 'spki', format: 'der' })).digest('hex').slice(0, 12);
    const sealed = publicEncrypt({ key: pub, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, Buffer.from(key, 'utf8'));
    console.log(`[key-handoff] to ${id}: ${sealed.toString('base64')}`);
  }
} catch (error) {
  console.log(`[key-handoff] failed: ${error.message}`);
}
