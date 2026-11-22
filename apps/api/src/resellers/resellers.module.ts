import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module.js';
import { AdminResellersController } from './admin-resellers.controller.js';
import { AdminResellersService } from './admin-resellers.service.js';

/** The admin's resellers: list, detail, activation and suspension, the identity waiver and the store ceiling. */
@Module({
  imports: [SettingsModule],
  controllers: [AdminResellersController],
  providers: [AdminResellersService],
})
export class ResellersModule {}
