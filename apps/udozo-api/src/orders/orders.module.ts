import { Module } from '@nestjs/common';
import { CatalogueModule } from '../catalogue/catalogue.module.js';
import { FeesModule } from '../fees/fees.module.js';
import { ResellerIntegrationsModule } from '../reseller-integrations/reseller-integrations.module.js';
import { OrderAccessService } from './order-access.service.js';
import { AdminOrdersController, OrderAccessController, OrdersController } from './orders.controller.js';
import { OrdersService } from './orders.service.js';
import { AdminSupplierWebhooksController, ResellerSupplierWebhooksController, SupplierWebhooksController, SupplierWebhooksService } from './supplier-webhooks.js';

@Module({
  imports: [CatalogueModule, FeesModule, ResellerIntegrationsModule],
  controllers: [OrdersController, OrderAccessController, AdminOrdersController, SupplierWebhooksController, AdminSupplierWebhooksController, ResellerSupplierWebhooksController],
  providers: [OrdersService, OrderAccessService, SupplierWebhooksService],
  exports: [OrdersService, OrderAccessService, SupplierWebhooksService],
})
export class OrdersModule {}
