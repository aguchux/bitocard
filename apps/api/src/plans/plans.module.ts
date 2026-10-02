import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { AdminPlansController, PlansController } from './plans.controller';
import { PlansService } from './plans.service';

@Module({
  imports: [SettingsModule],
  controllers: [PlansController, AdminPlansController],
  providers: [PlansService],
  exports: [PlansService],
})
export class PlansModule {}
