import { Module } from '@nestjs/common';
import { AdminFeesController, FeesController } from './fees.controller.js';
import { PlatformFeesService } from './platform-fees.service.js';

/** BitoCard's fees on resellers' own-integration transactions (PLANS.md, Reseller's own integrations). */
@Module({
  controllers: [FeesController, AdminFeesController],
  providers: [PlatformFeesService],
  exports: [PlatformFeesService],
})
export class FeesModule {}
