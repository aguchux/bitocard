import { Global, Module } from '@nestjs/common';
import { AdminDevicesController, DevicesController } from './devices.controller.js';
import { EmailService } from './email.service.js';
import { AdminNotificationsController, NotificationsController } from './inbox.controller.js';
import { InboxService } from './inbox.service.js';
import { PushService } from './push.service.js';
import { SmsService } from './sms.service.js';

@Global()
@Module({
  controllers: [NotificationsController, AdminNotificationsController, DevicesController, AdminDevicesController],
  providers: [EmailService, SmsService, InboxService, PushService],
  exports: [EmailService, SmsService, InboxService, PushService],
})
export class NotificationsModule {}
