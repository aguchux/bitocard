import { Module } from '@nestjs/common';
import { FxModule } from '../fx/fx.module.js';
import { AdminReportsController } from './reports.controller.js';
import { ReportsService } from './reports.service.js';

/** Platform-wide P&L, growth and statement reporting for admins. */
@Module({
  imports: [FxModule],
  controllers: [AdminReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
