import { Global, Module } from '@nestjs/common';
import { SupplierAdapters } from './supplier-adapters.js';
import { AdminSuppliersController } from './suppliers.controller.js';
import { SuppliersService } from './suppliers.service.js';

@Global()
@Module({
  controllers: [AdminSuppliersController],
  providers: [SupplierAdapters, SuppliersService],
  exports: [SupplierAdapters, SuppliersService],
})
export class SuppliersModule {}
