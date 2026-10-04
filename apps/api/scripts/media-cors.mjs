// Sets the CORS rule a DigitalOcean Spaces bucket needs for browser uploads: PUT (and GET for previews) from the admin
// app and SHQ, with the headers the signed links require. Run after creating the bucket (needs `npm run build` first):
//
//   SPACES_KEY=... SPACES_SECRET=... SPACES_BUCKET=bitocard-media SPACES_REGION=nyc3 \
//     npm run media:cors -w @bitocard/api -- https://admin.bitocard.com https://shq.bitocard.com
//
// With no origins given it allows the production apps and the local development ports (3003 admin, 3004 SHQ).
import { createHash } from 'node:crypto';
import { signRequest } from '../dist/media/sigv4.js';

const { SPACES_KEY, SPACES_SECRET, SPACES_BUCKET, SPACES_REGION = 'nyc3', SPACES_ENDPOINT } = process.env;
if (!SPACES_KEY || !SPACES_SECRET || !SPACES_BUCKET) {
  console.error('Set SPACES_KEY, SPACES_SECRET and SPACES_BUCKET (and SPACES_REGION if not nyc3).');
  process.exit(1);
}
const origins = process.argv.slice(2).length ? process.argv.slice(2) : ['https://admin.bitocard.com', 'https://shq.bitocard.com', 'http://localhost:3003', 'http://localhost:3004'];
const escape = value => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const body = `<?xml version="1.0" encoding="UTF-8"?>
<CORSConfiguration>
  <CORSRule>
${origins.map(origin => `    <AllowedOrigin>${escape(origin)}</AllowedOrigin>`).join('\n')}
    <AllowedMethod>PUT</AllowedMethod>
    <AllowedMethod>GET</AllowedMethod>
    <AllowedMethod>HEAD</AllowedMethod>
    <AllowedHeader>content-type</AllowedHeader>
    <AllowedHeader>x-amz-acl</AllowedHeader>
    <AllowedHeader>cache-control</AllowedHeader>
    <MaxAgeSeconds>3600</MaxAgeSeconds>
  </CORSRule>
</CORSConfiguration>`;

const endpoint = (SPACES_ENDPOINT ?? `https://${SPACES_REGION}.digitaloceanspaces.com`).replace(/\/+$/, '');
const url = new URL(`${endpoint}/${encodeURIComponent(SPACES_BUCKET)}?cors=`);
const headers = signRequest({
  method: 'PUT',
  url,
  headers: { 'content-type': 'application/xml', 'content-md5': createHash('md5').update(body).digest('base64') },
  credentials: { accessKey: SPACES_KEY, secret: SPACES_SECRET, region: SPACES_REGION },
  payloadHash: createHash('sha256').update(body).digest('hex'),
});
const res = await fetch(url, { method: 'PUT', headers, body });
if (!res.ok) {
  console.error(`Spaces refused the CORS rule (${res.status}): ${await res.text()}`);
  process.exit(1);
}
console.log(`CORS set on ${SPACES_BUCKET} for: ${origins.join(', ')}`);
