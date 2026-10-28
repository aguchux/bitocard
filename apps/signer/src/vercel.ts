import { timingSafeEqual } from 'node:crypto';
import { createSigner, log } from './app.js';
import { handleRequest, maxBody } from './server.js';

/**
 * The signer on Vercel: `api/index.mjs` answers the API (every path is rewritten to it in vercel.json, and the
 * original path is what the signature covers) and `api/worker.mjs` is the worker, run by Vercel Cron every minute in
 * place of the server's loop. Work after a reply (signing a new transfer) is kept alive with `waitUntil`.
 *
 * Deploy it in its own Vercel team, never the API's: anyone who can read one project's environment could otherwise
 * read the Turnkey key too.
 */
let instance: ReturnType<typeof createSigner> | null = null;
const signer = () => {
  instance ??= createSigner().catch(error => {
    instance = null;
    throw error;
  });
  return instance;
};

/** `waitUntil` from the Vercel runtime when it is there (it is on Vercel), so post-reply work is not frozen. */
async function keepAlive(work: Promise<unknown>) {
  try {
    const { waitUntil } = await import('@vercel/functions');
    waitUntil(work);
  } catch {
    void work;
  }
}

export async function fetchHandler(request: Request): Promise<Response> {
  const { signer: service, config } = await signer();
  const length = Number(request.headers.get('content-length') ?? 0);
  if (length > maxBody) return new Response(null, { status: 413 });
  const body = request.method === 'POST' ? await request.text() : '';
  if (body.length > maxBody) return new Response(null, { status: 413 });
  const reply = await handleRequest(
    service,
    config.secret,
    { method: request.method, path: new URL(request.url).pathname, signature: request.headers.get('afrippa-signer-signature'), body },
    log,
    work => void keepAlive(work),
  );
  return new Response(reply.body, { status: reply.status, headers: reply.headers });
}

/** Vercel Cron calls this with `Authorization: Bearer <CRON_SECRET>`; it stops well inside the function's time. */
export async function workerHandler(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET ?? '';
  const given = request.headers.get('authorization') ?? '';
  const expected = `Bearer ${secret}`;
  if (secret.length < 16 || given.length !== expected.length || !timingSafeEqual(Buffer.from(given), Buffer.from(expected))) {
    return new Response(null, { status: 401 });
  }
  const { signer: service } = await signer();
  const result = await service.runOnce(Date.now() + 50_000);
  return Response.json(result);
}
