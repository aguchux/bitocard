import { Global, Module } from '@nestjs/common';
import { AdminMediaController, AfrippaAdminMediaController, ResellerMediaController } from './media.controller.js';
import { MediaService } from './media.service.js';
import { AdminAvatarController, AvatarController } from './avatars.controller.js';
import { AvatarsService } from './avatars.service.js';
import { MediaStorage } from './storage.js';

/** Uploaded logos, icons and images in object storage (DigitalOcean Spaces). Global so the cron job can reach it. */
@Global()
@Module({
  controllers: [AdminMediaController, AfrippaAdminMediaController, ResellerMediaController, AvatarController, AdminAvatarController],
  providers: [MediaService, MediaStorage, AvatarsService],
  exports: [MediaService, AvatarsService],
})
export class MediaModule {}
