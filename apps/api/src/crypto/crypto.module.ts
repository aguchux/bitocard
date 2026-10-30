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
  AdminP2pController,
  AdminReconciliationsController,
  AdminWithdrawalsController,
  ChainWebhooksController,
  CustomerCryptoController,
  CustomerP2pController,
  CustomerWithdrawalsController,
  PublicCryptoController,
} from './crypto.controller.js';
import { CryptoWalletsService } from './crypto-wallets.service.js';
import { CryptoMarketLimitsService } from './market-limits.service.js';
import { P2pFeesService } from './p2p-fees.service.js';
import { P2pStandingService } from './p2p-standing.service.js';
import { P2pTrustService } from './p2p-trust.service.js';
import { P2pWordsService } from './p2p-words.service.js';
import { P2pService } from './p2p.service.js';
import { CryptoWithdrawalsService } from './withdrawals.service.js';

/**
 * Afrippa's crypto: traders' coin wallets, on-chain deposits and withdrawals, and the P2P market (escrow ads; orders are
 * in the Afrippa module). The instant exchange and resellers' own coins were retired (docs/CRYPTO_SPINOFF_PLAN.md, step 3).
 */
@Module({
  imports: [AuthModule, CheckoutModule, FxModule, IdentityModule, PayoutsModule, SettingsModule],
  controllers: [
    CustomerCryptoController,
    CustomerWithdrawalsController,
    CustomerP2pController,
    PublicCryptoController,
    AdminCryptoController,
    AdminP2pController,
    AdminChainsController,
    AdminWithdrawalsController,
    AdminReconciliationsController,
    ChainWebhooksController,
  ],
  providers: [CryptoWalletsService, CryptoMarketLimitsService, P2pFeesService, P2pStandingService, P2pTrustService, P2pWordsService, P2pService, CryptoDepositsService, CryptoWithdrawalsService, CryptoReconciliationService],
  exports: [CryptoWalletsService, CryptoMarketLimitsService, P2pFeesService, P2pStandingService, P2pTrustService, P2pWordsService, P2pService, CryptoDepositsService, CryptoWithdrawalsService, CryptoReconciliationService],
})
export class CryptoModule {}
