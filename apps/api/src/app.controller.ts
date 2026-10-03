import { Controller, Get, Header } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Public } from './auth/caller.js';

@ApiExcludeController()
@Public()
@Controller()
export class AppController {
  @Get()
  info() {
    return { service: 'bitocard-api', version: 'v1', docs: 'https://docs.bitocard.com', openapi: '/v1/openapi.json', health: '/health' };
  }

  @Get('robots.txt')
  @Header('Content-Type', 'text/plain; charset=utf-8')
  robots() {
    return 'User-Agent: *\nDisallow: /\n';
  }
}
