import { Module } from '@nestjs/common';
import { CustomerPayoutsService } from './customer-payouts.service.js';
import { PayoutsController } from './payouts.controller.js';
import { PayoutsService } from './payouts.service.js';

@Module({
  controllers: [PayoutsController],
  providers: [PayoutsService, CustomerPayoutsService],
  exports: [PayoutsService, CustomerPayoutsService],
})
export class PayoutsModule {}