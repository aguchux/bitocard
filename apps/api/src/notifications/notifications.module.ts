import { Global, Module } from '@nestjs/common';
import { EmailService } from './email.service.js';
import { SmsService } from './sms.service.js';

@Global()
@Module({
  providers: [EmailService, SmsService],
  exports: [EmailService, SmsService],
})
export class NotificationsModule {}
