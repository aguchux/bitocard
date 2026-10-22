import { AuthModule } from '../auth/auth.module.js';
import { Module } from '@nestjs/common';
import { CheckoutModule } from '../checkout/checkout.module.js';
import { FxModule } from '../fx/fx.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { PayoutsModule } from '../payouts/payouts.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { CryptoDepositsService } from './chains/deposits.service.js';
import { CryptoReconciliationService } from './custody/reconciliation.service.js';
import {
  AdminChainsController,
  AdminCryptoController,
  AdminCustomerPayoutsController,
  AdminP2pController,
  AdminReconciliationsController,
  AdminWithdrawalsController,
  ChainWebhooksController,
  CustomerCashController,
  CustomerCryptoController,
  CustomerP2pController,
  CustomerWithdrawalsController,
} from './crypto.controller.js';
import { CryptoWalletsService } from './crypto-wallets.service.js';
import { AdminExchangeController, CustomerExchangeController, ResellerExchangeController } from './exchange/exchange.controller.js';
import { ExchangeService } from './exchange/exchange.service.js';
import { ResellerDeskService } from './exchange/reseller-desk.service.js';
import { ReservesService } from './exchange/reserves.service.js';
import { P2pService } from './p2p.service.js';
import { CryptoPricesService } from './prices.js';
import { AdminSpinsController, CustomerSpinsController, PublicSpinsController } from './spins.controller.js';
import { SpinsService } from './spins.service.js';
import { CryptoWithdrawalsService } from './withdrawals.service.js';
import { ResellerCoinsController, ResellerCoinsService } from './reseller-coins.js';

/**
 * Store customers' crypto wallets, on-chain deposits and withdrawals, the P2P market (instant trades paid from BitoCard
 * wallets) and bank payouts of P2P money.
 */
@Module({
  imports: [AuthModule, CheckoutModule, FxModule, IdentityModule, PayoutsModule, SettingsModule],
  controllers: [
    CustomerCryptoController,
    CustomerWithdrawalsController,
    CustomerCashController,
    CustomerP2pController,
    CustomerSpinsController,
    PublicSpinsController,
    CustomerExchangeController,
    ResellerExchangeController,
    ResellerCoinsController,
    AdminCryptoController,
    AdminExchangeController,
    AdminSpinsController,
    AdminP2pController,
    AdminChainsController,
    AdminWithdrawalsController,
    AdminCustomerPayoutsController,
    AdminReconciliationsController,
    ChainWebhooksController,
  ],
  providers: [CryptoWalletsService, P2pService, CryptoDepositsService, CryptoWithdrawalsService, CryptoReconciliationService, CryptoPricesService, SpinsService, ExchangeService, ResellerDeskService, ReservesService, ResellerCoinsService],
  exports: [CryptoWalletsService, P2pService, CryptoDepositsService, CryptoWithdrawalsService, CryptoReconciliationService],
})
export class CryptoModule {}
