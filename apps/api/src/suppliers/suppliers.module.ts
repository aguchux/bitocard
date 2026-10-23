import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { StorefrontModule } from '../storefront/storefront.module.js';
import { SupplierFundingService } from './supplier-funding.service.js';
import { SupplierAdapters } from './supplier-adapters.js';
import { AdminSuppliersController } from './suppliers.controller.js';
import { SuppliersService } from './suppliers.service.js';

@Global()
@Module({
  imports: [AuthModule, StorefrontModule],
  controllers: [AdminSuppliersController],
  providers: [SupplierAdapters, SuppliersService, SupplierFundingService],
  exports: [SupplierAdapters, SuppliersService],
})
export class SuppliersModule {}
