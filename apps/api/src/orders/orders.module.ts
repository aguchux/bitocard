import { Module } from '@nestjs/common';
import { CatalogueModule } from '../catalogue/catalogue.module.js';
import { AdminOrdersController, OrdersController } from './orders.controller.js';
import { OrdersService } from './orders.service.js';
import { AdminSupplierWebhooksController, SupplierWebhooksController, SupplierWebhooksService } from './supplier-webhooks.js';

@Module({
  imports: [CatalogueModule],
  controllers: [OrdersController, AdminOrdersController, SupplierWebhooksController, AdminSupplierWebhooksController],
  providers: [OrdersService, SupplierWebhooksService],
  exports: [OrdersService, SupplierWebhooksService],
})
export class OrdersModule {}
