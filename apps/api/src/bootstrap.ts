import 'reflect-metadata';
import cookieParser from 'cookie-parser';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { json, type NextFunction, type Request, type Response } from 'express';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import { AppModule, type AppOptions } from './app.module.js';
import { originAllowed } from './auth/auth.guard.js';
import { APP_CONFIG, type AppConfig } from './config/config.js';
import { validationPipe } from './common/errors/validation.js';
import { securityHeaders } from './common/security-headers.js';
import { addResponses } from './openapi/responses/index.js';
import { addWebhooks } from './webhooks/openapi.js';

/** Routes outside /v1: service info, health and robots.txt. Everything else is versioned. */
const unversioned = ['/', 'health', 'robots.txt'];

/**
 * Files sent from Afrippa's site (an order's room, a trader's chat with Afrippa): a JSON body (so Afrippa's server signs
 * the file with the request) up to 6 MB, read before Nest's 100 KB parser, its raw bytes kept for the signature check.
 */
export const isOrderRoomUpload = (url: string | undefined) =>
  /^\/v1\/afrippa\/(?:p2p\/orders\/[^/?#]+\/attachments|account\/support\/chat\/attachments)(?:[?#]|$)/.test(url ?? '');
const orderRoomJson = json({
  limit: '6mb',
  verify: (req, _res, bytes) => {
    (req as Request & { rawBody?: Buffer }).rawBody = Buffer.from(bytes);
  },
});

/** BitoCard Shop's listing video uploads, sent by the seller's browser with a signed link (no cookies). */
export const isVideoUpload = (url: string | undefined) => /^\/v1\/classifieds\/video-uploads\/[^/?#]+(?:[?#]|$)/.test(url ?? '');

/**
 * Builds the configured Nest application without listening, so tests and the OpenAPI export can reuse it.
 * Named `bootstrap` rather than `app`/`index`/`server`: Vercel treats those names in dist/ as the entrypoint.
 */
export async function createApp(options: AppOptions = {}) {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.register(options), { bufferLogs: true, rawBody: true });
  app.useLogger(app.get(Logger));
  app.disable('x-powered-by');
  // Trust exactly the configured number of proxies (Vercel's edge), never every hop: see TRUST_PROXY.
  app.set('trust proxy', app.get<AppConfig>(APP_CONFIG).TRUST_PROXY);
  app.use(securityHeaders);
  app.use(cookieParser());
  app.use((req: Request, res: Response, next: NextFunction) => (isOrderRoomUpload(req.originalUrl) ? orderRoomJson(req, res, next) : next()));
  const config = app.get<AppConfig>(APP_CONFIG);
  // Browsers on BitoCard apps, and Afrippa's admin app, may call the API with cookies; anything else uses API keys and
  // needs no CORS.
  const afrippaAdmin = new URL(config.AFRIPPA_ADMIN_APP_URL).origin;
  const cors = {
    origin: (origin: string | undefined, done: (error: Error | null, allow?: boolean) => void) => done(null, !origin || origin === afrippaAdmin || originAllowed(origin, config.ALLOWED_ORIGINS)),
    credentials: true,
    // `authorization`: the docs send a short-lived "Try it" token (never a stored API key) from the browser.
    allowedHeaders: ['authorization', 'content-type', 'idempotency-key', 'bitocard-reseller', 'bitocard-mode', 'x-request-id'],
    exposedHeaders: ['request-id', 'idempotent-replayed', 'ratelimit-limit', 'ratelimit-remaining', 'ratelimit-reset', 'retry-after'],
    maxAge: 600,
  };
  // A listing video sent with its upload link (BitoCard Shop): the link is the credential, so any page may send it, never
  // with cookies (`ClassifiedVideoUploadsController`).
  const videoUpload = { origin: true, credentials: false, methods: ['POST'], allowedHeaders: ['content-type'], exposedHeaders: ['request-id'], maxAge: 600 };
  app.enableCors((req: Request, done: (error: Error | null, options: object) => void) => done(null, isVideoUpload(req.url) ? videoUpload : cors));
  app.setGlobalPrefix('v1', { exclude: unversioned });
  app.useGlobalPipes(validationPipe);
  app.enableShutdownHooks();

  const document = buildOpenApi(app);
  app.use('/v1/openapi.json', (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'GET' || req.path !== '/') return next();
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.json(document);
  });
  return app;
}

/** The public API description. The docs app renders it; `npm run openapi` writes it to openapi.json. */
export function buildOpenApi(app: NestExpressApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('BitoCard API')
    .setVersion('v1')
    .setDescription('One API for catalogue, quotes, orders, wallets and webhooks. Sandbox and live share this address; your API key decides the mode.')
    .addServer('https://api.bitocard.com')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'API key', description: 'API key: bc_test_… (sandbox) or bc_live_… (live).' })
    .build();
  return addResponses(addWebhooks(SwaggerModule.createDocument(app, config)));
}
