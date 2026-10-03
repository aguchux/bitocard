import { Module } from '@nestjs/common';
import { PayoutsController } from './payouts.controller.js';
import { PayoutsService } from './payouts.service.js';

@Module({
  controllers: [PayoutsController],
  providers: [PayoutsService],
  exports: [PayoutsService],
})
export class PayoutsModule {}
