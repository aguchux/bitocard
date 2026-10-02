import 'reflect-metadata';
import cookieParser from 'cookie-parser';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import { AppModule, type AppOptions } from './app.module';
import { originAllowed } from './auth/auth.guard';
import { APP_CONFIG, type AppConfig } from './config/config';
import { validationPipe } from './common/errors/validation';
import { securityHeaders } from './common/security-headers';
import { addWebhooks } from './webhooks/openapi';

/** Routes outside /v1: service info, health and robots.txt. Everything else is versioned. */
const unversioned = ['/', 'health', 'robots.txt'];

/**
 * Builds the configured Nest application without listening, so tests and the OpenAPI export can reuse it.
 * Named `bootstrap` rather than `app`/`index`/`server`: Vercel treats those names in dist/ as the entrypoint.
 */
export async function createApp(options: AppOptions = {}) {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.register(options), { bufferLogs: true, rawBody: true });
  app.useLogger(app.get(Logger));
  app.disable('x-powered-by');
  app.set('trust proxy', true);
  app.use(securityHeaders);
  app.use(cookieParser());
  const config = app.get<AppConfig>(APP_CONFIG);
  // Browsers on BitoCard apps may call the API with cookies; anything else uses API keys and needs no CORS.
  app.enableCors({
    origin: (origin, done) => done(null, !origin || originAllowed(origin, config.ALLOWED_ORIGINS)),
    credentials: true,
    allowedHeaders: ['content-type', 'idempotency-key', 'bitocard-reseller', 'bitocard-mode', 'x-request-id'],
    exposedHeaders: ['request-id', 'idempotent-replayed', 'ratelimit-limit', 'ratelimit-remaining', 'ratelimit-reset', 'retry-after'],
    maxAge: 600,
  });
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
  return addWebhooks(SwaggerModule.createDocument(app, config));
}
