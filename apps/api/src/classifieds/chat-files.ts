import type { Response } from 'express';

/** Sends a chat photo: never cached, never run as a page. */
export function sendPhoto(res: Response, file: { contentType: string; bytes: Buffer; name: string }) {
  res.set({
    'content-type': file.contentType,
    'content-length': String(file.bytes.length),
    'cache-control': 'no-store, private',
    'content-disposition': `inline; filename="${file.name}"`,
    'x-content-type-options': 'nosniff',
    'content-security-policy': "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
  });
  res.end(file.bytes);
}
