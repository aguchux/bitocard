import { Module } from '@nestjs/common';
import { AdminThemeController, ThemeController } from './theme.controller.js';
import { ThemeService } from './theme.service.js';

@Module({
  controllers: [ThemeController, AdminThemeController],
  providers: [ThemeService],
  exports: [ThemeService],
})
export class ThemeModule {}
