import { Module } from '@nestjs/common';
import { AdminFxController, FxController } from './fx.controller';
import { FxService } from './fx.service';

@Module({
  controllers: [FxController, AdminFxController],
  providers: [FxService],
  exports: [FxService],
})
export class FxModule {}
