import { Global, Module } from '@nestjs/common';
import { CheckoutModule } from '../checkout/checkout.module.js';
import { OrdersModule } from '../orders/orders.module.js';
import { AdminVpnController, VpnAccessController, VpnController, VpnCustomerController } from './vpn.controller.js';
import { VpnCredentialsService } from './vpn-credentials.service.js';
import { VpnService } from './vpn.service.js';

/** VPN credentials prepared before provisioning, and VPN access after its order (status, expiry, password, checks). */
@Global()
@Module({
  providers: [VpnCredentialsService, VpnService],
  exports: [VpnCredentialsService, VpnService],
})
export class VpnModule {}

/** VPN endpoints: resellers' API, the order page and the customer account app, and admins. */
@Module({
  imports: [CheckoutModule, OrdersModule],
  controllers: [VpnController, VpnAccessController, VpnCustomerController, AdminVpnController],
})
export class VpnApiModule {}
