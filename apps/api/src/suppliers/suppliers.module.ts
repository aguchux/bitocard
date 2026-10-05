import { Global, Module } from '@nestjs/common';
import { StorefrontModule } from '../storefront/storefront.module.js';
import { SupplierAdapters } from './supplier-adapters.js';
import { AdminSuppliersController } from './suppliers.controller.js';
import { SuppliersService } from './suppliers.service.js';

@Global()
@Module({
  imports: [StorefrontModule],
  controllers: [AdminSuppliersController],
  providers: [SupplierAdapters, SuppliersService],
  exports: [SupplierAdapters, SuppliersService],
})
export class SuppliersModule {}
