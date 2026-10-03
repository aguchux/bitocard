import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module.js';
import { AdminPlansController, PlansController } from './plans.controller.js';
import { PlansService } from './plans.service.js';

@Module({
  imports: [SettingsModule],
  controllers: [PlansController, AdminPlansController],
  providers: [PlansService],
  exports: [PlansService],
})
export class PlansModule {}
