import { Module } from '@nestjs/common';
import { CheckoutModule } from '../checkout/checkout.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { CryptoDepositsService } from './chains/deposits.service.js';
import {
  AdminChainsController,
  AdminCryptoController,
  AdminP2pController,
  AdminWithdrawalsController,
  ChainWebhooksController,
  CustomerCryptoController,
  CustomerP2pController,
  CustomerWithdrawalsController,
} from './crypto.controller.js';
import { CryptoWalletsService } from './crypto-wallets.service.js';
import { P2pService } from './p2p.service.js';
import { CryptoWithdrawalsService } from './withdrawals.service.js';

/** Store customers' crypto wallets, on-chain deposits and withdrawals, and the P2P market (instant trades paid from BitoCard wallets). */
@Module({
  imports: [CheckoutModule, IdentityModule, SettingsModule],
  controllers: [
    CustomerCryptoController,
    CustomerWithdrawalsController,
    CustomerP2pController,
    AdminCryptoController,
    AdminP2pController,
    AdminChainsController,
    AdminWithdrawalsController,
    ChainWebhooksController,
  ],
  providers: [CryptoWalletsService, P2pService, CryptoDepositsService, CryptoWithdrawalsService],
  exports: [CryptoWalletsService, P2pService, CryptoDepositsService, CryptoWithdrawalsService],
})
export class CryptoModule {}
