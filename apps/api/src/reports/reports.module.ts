import { Module } from '@nestjs/common';
import { FxModule } from '../fx/fx.module.js';
import { AdminReportsController } from './reports.controller.js';
import { ReportsService } from './reports.service.js';
import { ResellerReportsController } from './reseller-reports.controller.js';
import { ResellerReportsService } from './reseller-reports.service.js';
import { ResaleReportsService } from './resale-reports.service.js';

/** Platform-wide P&L, growth and statement reporting for admins, and a reseller's own equivalent, from the ledger. */
@Module({
  imports: [FxModule],
  controllers: [AdminReportsController, ResellerReportsController],
  providers: [ReportsService, ResellerReportsService, ResaleReportsService],
})
export class ReportsModule {}
