import { type CallHandler, type ExecutionContext, Global, Injectable, Module, type NestInterceptor } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { from, switchMap } from 'rxjs';
import { MediaStorage } from '../media/storage.js';
import { SettingsModule } from '../settings/settings.module.js';
import { AdminStoreWatermarkController, AdminWatermarkController, ClassifiedWatermarkController } from './watermarks.controller.js';
import { WatermarkService } from './watermarks.service.js';

/** Brings this instance's watermark state up to date (at most every 15 seconds) before a request. */
@Injectable()
export class WatermarkRefreshInterceptor implements NestInterceptor {
  constructor(private readonly watermarks: WatermarkService) {}

  intercept(_context: ExecutionContext, next: CallHandler) {
    return from(this.watermarks.refresh()).pipe(switchMap(() => next.handle()));
  }
}

/** Watermarked listing photos (docs/UDOZO_WATERMARK_PLAN.md). Global, so every presenter of listing photos reaches it. */
@Global()
@Module({
  imports: [SettingsModule],
  controllers: [ClassifiedWatermarkController, AdminWatermarkController, AdminStoreWatermarkController],
  providers: [WatermarkService, MediaStorage, { provide: APP_INTERCEPTOR, useClass: WatermarkRefreshInterceptor }],
  exports: [WatermarkService],
})
export class WatermarksModule {}
