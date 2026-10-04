import { Global, Module } from '@nestjs/common';
import { AdminMediaController, ResellerMediaController } from './media.controller.js';
import { MediaService } from './media.service.js';
import { MediaStorage } from './storage.js';

/** Uploaded logos, icons and images in object storage (DigitalOcean Spaces). Global so the cron job can reach it. */
@Global()
@Module({
  controllers: [AdminMediaController, ResellerMediaController],
  providers: [MediaService, MediaStorage],
  exports: [MediaService],
})
export class MediaModule {}
