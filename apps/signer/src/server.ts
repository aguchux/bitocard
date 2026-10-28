import { createHmac, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { HttpError, type Signer } from './service.js';

const maxAgeSeconds = 300;
export const maxBody = 64 * 1024;

/** The request's `v1` when its `Afrippa-Signer-Signature` is valid for the signed text within five minutes, else null. */
export function requestValid(secret: string, header: string | undefined | null, text: string, now = Math.floor(Date.now() / 1000)) {
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

export type Log = (event: string, fields?: Record<string, unknown>) => void;
export type SignerRequest = { method: string; path: string; signature: string | null | undefined; body: string };
export type SignerReply = { status: number; headers: Record<string, string>; body: string };

/**
 * One request to the signer (`docs/crypto-signer.md`), whatever runs it (the Node server or a Vercel function). Every
 * request must carry a valid signature; every reply, errors included, is signed over the request's own signature so
 * the API can trust it. `afterReply` receives work to finish once the reply is sent (signing a new transfer).
 */
export async function handleRequest(signer: Signer, secret: string, request: SignerRequest, log: Log = () => undefined, afterReply?: (work: Promise<unknown>) => void): Promise<SignerReply> {
  let requestV1: string | null = null;
  const reply = (status: number, payload: unknown): SignerReply => {
    const body = JSON.stringify(payload);
    // An unsigned request gets an unsigned refusal: there is nothing to bind a signature to.
    const headers: Record<string, string> = { 'content-type': 'application/json', 'cache-control': 'no-store' };
    if (requestV1) headers['Afrippa-Signer-Signature'] = replySignature(secret, requestV1, status, body);
    return { status, headers, body };
  };
  try {
    if (request.method !== 'GET' && request.method !== 'POST') throw new HttpError(405, 'method not allowed');
    // A POST signs its body; a GET the path it was sent to (a base path in front included, as the API signs it).
    requestV1 = requestValid(secret, request.signature, request.method === 'POST' ? request.body : request.path);
    if (!requestV1) return reply(401, { error: { message: 'missing or wrong signature' } });
    const json = () => {
      try {
        return JSON.parse(request.body) as unknown;
      } catch {
        throw new HttpError(400, 'body must be JSON');
      }
    };
    const route = request.path.replace(/^.*?(?=\/v1\/)/, '');
    const { method } = request;
    if (method === 'GET' && route === '/v1/health') return reply(200, await signer.health());
    if (method === 'POST' && route === '/v1/transfers') {
      const view = await signer.receive(json(), afterReply);
      return reply(200, view);
    }
    const transfer = /^\/v1\/transfers\/([^/]+)$/.exec(route);
    if (method === 'GET' && transfer) {
      const found = await signer.get(decodeURIComponent(transfer[1]));
      return found ? reply(200, found) : reply(404, { error: { message: 'no transfer with this reference' } });
    }
    const balances = /^\/v1\/balances\/([^/]+)$/.exec(route);
    if (method === 'GET' && balances) return reply(200, await signer.balances(balances[1]));
    if (method === 'POST' && route === '/v1/deposit-addresses') return reply(200, await signer.track(json()));
    if (method === 'POST' && route === '/v1/addresses') throw new HttpError(422, 'Solana addresses are not supported yet');
    throw new HttpError(404, 'not found');
  } catch (error) {
    if (error instanceof HttpError) return reply(error.status, { error: { message: error.message } });
    log('request.error', { path: request.path, error: error instanceof Error ? error.message : String(error) });
    // Unclear to the API: it asks again later with the same reference.
    return reply(500, { error: { message: 'signer error' } });
  }
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

/**
 * The signer as a Node server (Docker). Run it behind HTTPS (the platform's TLS or a load balancer): it listens on
 * plain HTTP inside its own network.
 */
export function signerServer(signer: Signer, secret: string, log: Log = () => undefined): Server {
  return createServer((req, res) => {
    void (async () => {
      let body = '';
      try {
        body = req.method === 'POST' ? await readBody(req) : '';
      } catch {
        res.statusCode = 413;
        res.end();
        return;
      }
      const path = new URL(req.url ?? '/', 'http://signer').pathname;
      const reply = await handleRequest(signer, secret, { method: req.method ?? 'GET', path, signature: req.headers['afrippa-signer-signature'] as string | undefined, body }, log, work => {
        void work.catch(error => log('transfer.error', { error: String(error) }));
      });
      res.statusCode = reply.status;
      for (const [name, value] of Object.entries(reply.headers)) res.setHeader(name, value);
      res.end(reply.body);
    })();
  });
}
