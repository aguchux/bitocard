import { Module } from '@nestjs/common';
import { AdminStockController } from './stock.controller.js';
import { StockService } from './stock.service.js';

@Module({
  controllers: [AdminStockController],
  providers: [StockService],
})
export class StockModule {}
