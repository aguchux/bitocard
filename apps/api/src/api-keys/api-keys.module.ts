import { Module } from '@nestjs/common';
import { AccountController } from './account.controller';
import { ApiKeysController } from './api-keys.controller';
import { ApiKeysService } from './api-keys.service';

@Module({
  controllers: [ApiKeysController, AccountController],
  providers: [ApiKeysService],
})
export class ApiKeysModule {}
