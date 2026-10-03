import { Module } from '@nestjs/common';
import { AccountController } from './account.controller.js';
import { ApiKeysController } from './api-keys.controller.js';
import { ApiKeysService } from './api-keys.service.js';

@Module({
  controllers: [ApiKeysController, AccountController],
  providers: [ApiKeysService],
})
export class ApiKeysModule {}
