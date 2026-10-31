import 'reflect-metadata';
import cookieParser from 'cookie-parser';
import { ModulesContainer, NestFactory } from '@nestjs/core';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
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
import { addWebhooks, withoutOtherEvents } from './webhooks/openapi.js';
import { PRODUCT_ONLY, productOf } from './products/product.js';

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
  const appConfig = app.get<AppConfig>(APP_CONFIG);
  const product = productOf(appConfig);
  const udozo = appConfig.APP_PRODUCT === 'udozo';
  const config = new DocumentBuilder()
    .setTitle(`${product.name} API`)
    .setVersion('v1')
    .setDescription(
      udozo
        ? 'One API for resale listings, orders, wallets and webhooks. Sandbox and live share this address; your API key decides the mode.'
        : 'One API for catalogue, quotes, orders, wallets and webhooks. Sandbox and live share this address; your API key decides the mode.',
    )
    .addServer(udozo ? 'https://api.udozo.com' : 'https://api.bitocard.com')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'API key', description: `API key: ${product.apiKeyPrefix}test_… (sandbox) or ${product.apiKeyPrefix}live_… (live).` })
    .build();
  return withoutOtherEvents(addResponses(addWebhooks(withoutOtherProducts(app, SwaggerModule.createDocument(app, config)))), appConfig.APP_PRODUCT);
}

/** Leaves out the routes of the other product (`@ProductOnly`), and the tags no route uses any more. */
function withoutOtherProducts(app: NestExpressApplication, document: OpenAPIObject): OpenAPIObject {
  const product = app.get<AppConfig>(APP_CONFIG).APP_PRODUCT;
  // Indexed by Nest's RequestMethod.
  const methods = ['get', 'post', 'put', 'delete', 'patch', 'all', 'options', 'head'];
  for (const module of app.get(ModulesContainer).values()) {
    for (const wrapper of module.controllers.values()) {
      const type = wrapper.metatype as (new (...args: never[]) => object) | null;
      if (!type?.prototype) continue;
      const bases = [Reflect.getMetadata(PATH_METADATA, type) ?? ''].flat() as string[];
      for (const name of Object.getOwnPropertyNames(type.prototype)) {
        const handler = name === 'constructor' ? undefined : (type.prototype as Record<string, unknown>)[name];
        if (typeof handler !== 'function' || Reflect.getMetadata(PATH_METADATA, handler) === undefined) continue;
        const owner = (Reflect.getMetadata(PRODUCT_ONLY, handler) ?? Reflect.getMetadata(PRODUCT_ONLY, type)) as string | undefined;
        if (!owner || owner === product) continue;
        const method = methods[Reflect.getMetadata(METHOD_METADATA, handler) as number];
        for (const base of bases) {
          for (const sub of [Reflect.getMetadata(PATH_METADATA, handler)].flat() as string[]) {
            const joined = [base, sub].map(part => String(part).replace(/^\/+|\/+$/g, '')).filter(Boolean).join('/');
            const path = `/v1/${joined}`.replace(/:([A-Za-z_]+)/g, '{$1}');
            const item = document.paths[path] as Record<string, unknown> | undefined;
            if (!item || !method) continue;
            delete item[method];
            if (!methods.some(each => each in item)) delete document.paths[path];
          }
        }
      }
    }
  }
  const used = new Set(Object.values(document.paths).flatMap(item => methods.flatMap(method => ((item as Record<string, { tags?: string[] }>)[method]?.tags ?? []))));
  if (document.tags) document.tags = document.tags.filter(tag => used.has(tag.name));
  return document;
}
