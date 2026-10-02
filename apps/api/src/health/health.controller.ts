import { Controller, Get, Header, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Public } from '../auth/caller';
import type { Response } from 'express';
import { HealthService } from './health.service';

@ApiExcludeController()
@Public()
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  /** 200 when healthy, 503 when the database is configured but unreachable. */
  @Get()
  @Header('Cache-Control', 'no-store')
  async check(@Res({ passthrough: true }) res: Response) {
    const report = await this.health.status();
    if (report.status !== 'ok') res.status(503);
    return report;
  }
}
