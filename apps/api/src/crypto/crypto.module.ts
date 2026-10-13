import { Module } from '@nestjs/common';
import { CheckoutModule } from '../checkout/checkout.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { PayoutsModule } from '../payouts/payouts.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { CryptoDepositsService } from './chains/deposits.service.js';
import {
  AdminChainsController,
  AdminCryptoController,
  AdminCustomerPayoutsController,
  AdminP2pController,
  AdminWithdrawalsController,
  ChainWebhooksController,
  CustomerCashController,
  CustomerCryptoController,
  CustomerP2pController,
  CustomerWithdrawalsController,
} from './crypto.controller.js';
import { CryptoWalletsService } from './crypto-wallets.service.js';
import { P2pService } from './p2p.service.js';
import { CryptoWithdrawalsService } from './withdrawals.service.js';

/**
 * Store customers' crypto wallets, on-chain deposits and withdrawals, the P2P market (instant trades paid from BitoCard
 * wallets) and bank payouts of P2P money.
 */
@Module({
  imports: [CheckoutModule, IdentityModule, PayoutsModule, SettingsModule],
  controllers: [
    CustomerCryptoController,
    CustomerWithdrawalsController,
    CustomerCashController,
    CustomerP2pController,
    AdminCryptoController,
    AdminP2pController,
    AdminChainsController,
    AdminWithdrawalsController,
    AdminCustomerPayoutsController,
    ChainWebhooksController,
  ],
  providers: [CryptoWalletsService, P2pService, CryptoDepositsService, CryptoWithdrawalsService],
  exports: [CryptoWalletsService, P2pService, CryptoDepositsService, CryptoWithdrawalsService],
})
export class CryptoModule {}
