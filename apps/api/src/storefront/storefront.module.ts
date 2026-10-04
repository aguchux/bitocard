import { Module } from '@nestjs/common';
import { AdminStorefrontController, StorefrontController } from './storefront.controller.js';
import { StorefrontAdminService } from './storefront-admin.service.js';
import { StorefrontService } from './storefront.service.js';

/** BitoCard's own storefront (bitocard.com): the public catalogue and home page, and the admin Storefront Manager. */
@Module({
  controllers: [StorefrontController, AdminStorefrontController],
  providers: [StorefrontService, StorefrontAdminService],
  exports: [StorefrontService],
})
export class StorefrontModule {}
