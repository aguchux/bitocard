import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { securityHeaders } from './common/security-headers';

/**
 * Builds the configured Nest application without listening, so tests can reuse it.
 * Named `bootstrap` rather than `app`/`index`/`server`: Vercel treats those names in dist/ as the entrypoint.
 */
export async function createApp() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: ['error', 'warn', 'log'] });
  app.disable('x-powered-by');
  app.use(securityHeaders);
  app.enableShutdownHooks();
  return app;
}
