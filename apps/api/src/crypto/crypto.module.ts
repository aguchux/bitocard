import { Module } from '@nestjs/common';
import { CheckoutModule } from '../checkout/checkout.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { CryptoDepositsService } from './chains/deposits.service.js';
import { AdminChainsController, AdminCryptoController, AdminP2pController, ChainWebhooksController, CustomerCryptoController, CustomerP2pController } from './crypto.controller.js';
import { CryptoWalletsService } from './crypto-wallets.service.js';
import { P2pService } from './p2p.service.js';

/** Store customers' crypto wallets and the P2P market (instant trades paid from BitoCard wallets). */
@Module({
  imports: [CheckoutModule, IdentityModule, SettingsModule],
  controllers: [CustomerCryptoController, CustomerP2pController, AdminCryptoController, AdminP2pController, AdminChainsController, ChainWebhooksController],
  providers: [CryptoWalletsService, P2pService, CryptoDepositsService],
  exports: [CryptoWalletsService, P2pService, CryptoDepositsService],
})
export class CryptoModule {}
