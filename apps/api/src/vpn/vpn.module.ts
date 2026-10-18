import { Global, Module } from '@nestjs/common';
import { VpnCredentialsService } from './vpn-credentials.service.js';

@Global()
@Module({
  providers: [VpnCredentialsService],
  exports: [VpnCredentialsService],
})
export class VpnModule {}
