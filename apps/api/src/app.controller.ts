import { Controller, Get, Header, Inject } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Public } from './auth/caller.js';
import { APP_CONFIG, type AppConfig } from './config/config.js';

@ApiExcludeController()
@Public()
@Controller()
export class AppController {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  @Get()
  info() {
    // Udozo's documentation is still to be published (docs/UDOZO_SPINOFF_PLAN.md): its instance names none yet.
    const docs = this.config.APP_PRODUCT === 'bitocard' ? 'https://docs.bitocard.com' : null;
    return { service: `${this.config.APP_PRODUCT}-api`, version: 'v1', docs, openapi: '/v1/openapi.json', health: '/health' };
  }

  @Get('robots.txt')
  @Header('Content-Type', 'text/plain; charset=utf-8')
  robots() {
    return 'User-Agent: *\nDisallow: /\n';
  }
}
