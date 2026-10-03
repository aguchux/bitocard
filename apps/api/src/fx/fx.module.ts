import { Module } from '@nestjs/common';
import { AdminFxController, FxController } from './fx.controller.js';
import { FxService } from './fx.service.js';

@Module({
  controllers: [FxController, AdminFxController],
  providers: [FxService],
  exports: [FxService],
})
export class FxModule {}
