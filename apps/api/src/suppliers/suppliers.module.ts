import { Global, Module } from '@nestjs/common';
import { SupplierAdapters } from './supplier-adapters';
import { AdminSuppliersController } from './suppliers.controller';
import { SuppliersService } from './suppliers.service';

@Global()
@Module({
  controllers: [AdminSuppliersController],
  providers: [SupplierAdapters, SuppliersService],
  exports: [SupplierAdapters, SuppliersService],
})
export class SuppliersModule {}
