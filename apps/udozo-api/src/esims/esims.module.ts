import { Module } from '@nestjs/common';
import { CatalogueModule } from '../catalogue/catalogue.module.js';
import { FxModule } from '../fx/fx.module.js';
import { OrdersModule } from '../orders/orders.module.js';
import { EsimAccessController, EsimsController } from './esims.controller.js';
import { EsimsService } from './esims.service.js';

/** eSIMs after their order: status and data use, top-ups, cancelling for a refund, and supplier notifications. */
@Module({
  imports: [CatalogueModule, FxModule, OrdersModule],
  controllers: [EsimsController, EsimAccessController],
  providers: [EsimsService],
  exports: [EsimsService],
})
export class EsimsModule {}
