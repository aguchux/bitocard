import { createHmac, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { HttpError, type Signer } from './service.js';

const maxAgeSeconds = 300;
const maxBody = 64 * 1024;

/** The request's `v1` when its `BitoCard-Signer-Signature` is valid for the signed text within five minutes, else null. */
export function requestValid(secret: string, header: string | undefined, text: string, now = Math.floor(Date.now() / 1000)) {
  const at = /(?:^|,)t=(\d+)(?:,|$)/.exec(header ?? '')?.[1];
  if (!header || !at || Math.abs(now - Number(at)) > maxAgeSeconds) return null;
  const expected = createHmac('sha256', secret).update(`${at}.${text}`).digest();
  for (const [, v1] of header.matchAll(/(?:^|,)v1=([0-9a-f]{64})(?=,|$)/g)) {
    if (timingSafeEqual(Buffer.from(v1, 'hex'), expected)) return v1;
  }
  return null;
}

/** The reply's signature: over `reply.<t>.<the request's v1>.<status>.<body>`, so it answers exactly that request. */
export function replySignature(secret: string, requestV1: string, status: number, body: string, at = Math.floor(Date.now() / 1000)) {
  return `t=${at},v1=${createHmac('sha256', secret).update(`reply.${at}.${requestV1}.${status}.${body}`).digest('hex')}`;
}

async function readBody(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > maxBody) throw new HttpError(413, 'request too large');
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

type Log = (event: string, fields?: Record<string, unknown>) => void;

/**
 * The signer's HTTP interface (`docs/crypto-signer.md`). Every request must carry a valid signature; every reply,
 * errors included, is signed over the request's own signature so the API can trust it. Run it behind HTTPS (the
 * platform's TLS or a load balancer): it listens on plain HTTP inside its own network.
 */
export function signerServer(signer: Signer, secret: string, log: Log = () => undefined): Server {
  return createServer((req, res) => void handle(req, res));

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const path = new URL(req.url ?? '/', 'http://signer').pathname;
    let requestV1: string | null = null;
    const send = (status: number, payload: unknown) => {
      const body = JSON.stringify(payload);
      res.statusCode = status;
      res.setHeader('content-type', 'application/json');
      res.setHeader('cache-control', 'no-store');
      // An unsigned request gets an unsigned refusal: there is nothing to bind a signature to.
      if (requestV1) res.setHeader('BitoCard-Signer-Signature', replySignature(secret, requestV1, status, body));
      res.end(body);
    };
    try {
      if (req.method !== 'GET' && req.method !== 'POST') throw new HttpError(405, 'method not allowed');
      const body = req.method === 'POST' ? await readBody(req) : '';
      // A POST signs its body; a GET the path it was sent to (a base path in front included, as the API signs it).
      requestV1 = requestValid(secret, req.headers['bitocard-signer-signature'] as string | undefined, req.method === 'POST' ? body : path);
      if (!requestV1) {
        send(401, { error: { message: 'missing or wrong signature' } });
        return;
      }
      const json = () => {
        try {
          return JSON.parse(body) as unknown;
        } catch {
          throw new HttpError(400, 'body must be JSON');
        }
      };
      const route = path.replace(/^.*?(?=\/v1\/)/, '');
      if (req.method === 'GET' && route === '/v1/health') return send(200, await signer.health());
      if (req.method === 'POST' && route === '/v1/transfers') return send(200, await signer.receive(json()));
      const transfer = /^\/v1\/transfers\/([^/]+)$/.exec(route);
      if (req.method === 'GET' && transfer) {
        const found = await signer.get(decodeURIComponent(transfer[1]));
        return found ? send(200, found) : send(404, { error: { message: 'no transfer with this reference' } });
      }
      const balances = /^\/v1\/balances\/([^/]+)$/.exec(route);
      if (req.method === 'GET' && balances) return send(200, await signer.balances(balances[1]));
      if (req.method === 'POST' && route === '/v1/deposit-addresses') return send(200, await signer.track(json()));
      if (req.method === 'POST' && route === '/v1/addresses') throw new HttpError(422, 'Solana addresses are not supported yet');
      throw new HttpError(404, 'not found');
    } catch (error) {
      if (error instanceof HttpError) return send(error.status, { error: { message: error.message } });
      log('request.error', { path, error: error instanceof Error ? error.message : String(error) });
      // Unclear to the API: it asks again later with the same reference.
      send(500, { error: { message: 'signer error' } });
    }
  }
}
