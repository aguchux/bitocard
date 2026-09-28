import { Controller, Get, Header } from '@nestjs/common';

@Controller()
export class AppController {
  @Get()
  info() {
    return { service: 'bitocard-api', status: 'scaffold', health: '/health' };
  }

  @Get('robots.txt')
  @Header('Content-Type', 'text/plain; charset=utf-8')
  robots() {
    return 'User-Agent: *\nDisallow: /\n';
  }
}
