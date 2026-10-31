import { Module } from '@nestjs/common';
import { CatalogueModule } from '../catalogue/catalogue.module.js';
import { OrdersModule } from '../orders/orders.module.js';
import { NumberAccessController, NumbersController, NumberWebhooksController } from './numbers.controller.js';
import { NumbersService } from './numbers.service.js';

/** Virtual numbers after their order: renewals, reminders, pausing and deletion, and their SMS. */
@Module({
  imports: [CatalogueModule, OrdersModule],
  controllers: [NumbersController, NumberWebhooksController, NumberAccessController],
  providers: [NumbersService],
  exports: [NumbersService],
})
export class NumbersModule {}
