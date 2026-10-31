import { createHash, createHmac } from 'node:crypto';

/**
 * AWS Signature Version 4 for S3-compatible storage (DigitalOcean Spaces), with no SDK: presigned links for browser
 * uploads, and signed headers for the API's own requests. Checked against AWS's published examples (media tests).
 */
export type Credentials = { accessKey: string; secret: string; region: string };

const sha256 = (data: string) => createHash('sha256').update(data).digest('hex');
const hmac = (key: Buffer | string, data: string) => createHmac('sha256', key).update(data).digest();

/** The SHA-256 of an empty body, for requests without one. */
export const emptyPayloadHash = sha256('');

/** RFC 3986 encoding, as SigV4 requires (encodeURIComponent leaves !'()* alone). */
export const encodeRfc3986 = (value: string) => encodeURIComponent(value).replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);

/** An object key as a URL path: each segment encoded, the slashes kept. */
export const encodeKey = (key: string) => key.split('/').map(encodeRfc3986).join('/');

/** 20130524T000000Z */
export const amzDate = (date: Date) => date.toISOString().replace(/[:-]|\.\d{3}/g, '');

function canonicalQuery(params: Array<[string, string]>) {
  return params
    .map(([key, value]) => [encodeRfc3986(key), encodeRfc3986(value)] as const)
    .sort(([a, av], [b, bv]) => (a === b ? (av < bv ? -1 : 1) : a < b ? -1 : 1))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
}

function sign(credentials: Credentials, date: string, canonicalRequest: string) {
  const day = date.slice(0, 8);
  const scope = `${day}/${credentials.region}/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', date, scope, sha256(canonicalRequest)].join('\n');
  const key = hmac(hmac(hmac(hmac(`AWS4${credentials.secret}`, day), credentials.region), 's3'), 'aws4_request');
  return { scope, signature: hmac(key, stringToSign).toString('hex') };
}

function headerBlock(url: URL, headers: Record<string, string>) {
  const all: Record<string, string> = { host: url.host };
  for (const [name, value] of Object.entries(headers)) all[name.toLowerCase()] = String(value).trim().replace(/\s+/g, ' ');
  const names = Object.keys(all).sort();
  return { names: names.join(';'), canonical: names.map(name => `${name}:${all[name]}\n`).join('') };
}

/**
 * A presigned link (query authentication). Every header in `headers` is signed, so the caller must send exactly those
 * values: signing `content-length` and `content-type` fixes the upload's size and type.
 */
export function presign(input: { method: string; url: URL; headers?: Record<string, string>; credentials: Credentials; expiresIn: number; now?: Date }) {
  const date = amzDate(input.now ?? new Date());
  const { names, canonical } = headerBlock(input.url, input.headers ?? {});
  const day = date.slice(0, 8);
  const params: Array<[string, string]> = [
    ...[...input.url.searchParams.entries()],
    ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
    ['X-Amz-Credential', `${input.credentials.accessKey}/${day}/${input.credentials.region}/s3/aws4_request`],
    ['X-Amz-Date', date],
    ['X-Amz-Expires', String(input.expiresIn)],
    ['X-Amz-SignedHeaders', names],
  ];
  const query = canonicalQuery(params);
  const request = [input.method, input.url.pathname, query, canonical, names, 'UNSIGNED-PAYLOAD'].join('\n');
  const { signature } = sign(input.credentials, date, request);
  return `${input.url.origin}${input.url.pathname}?${query}&X-Amz-Signature=${signature}`;
}

/** Headers for a request the API makes itself (Authorization header authentication). */
export function signRequest(input: { method: string; url: URL; headers?: Record<string, string>; credentials: Credentials; payloadHash?: string; now?: Date }) {
  const date = amzDate(input.now ?? new Date());
  const payloadHash = input.payloadHash ?? emptyPayloadHash;
  const headers = { ...input.headers, 'x-amz-content-sha256': payloadHash, 'x-amz-date': date };
  const { names, canonical } = headerBlock(input.url, headers);
  const request = [input.method, input.url.pathname, canonicalQuery([...input.url.searchParams.entries()]), canonical, names, payloadHash].join('\n');
  const { scope, signature } = sign(input.credentials, date, request);
  return { ...headers, authorization: `AWS4-HMAC-SHA256 Credential=${input.credentials.accessKey}/${scope}, SignedHeaders=${names}, Signature=${signature}` };
}
