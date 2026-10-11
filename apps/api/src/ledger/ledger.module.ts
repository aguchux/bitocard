import { Global, Module } from '@nestjs/common';
import { FxModule } from '../fx/fx.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { AllowanceService } from './allowance.service.js';
import { LedgerService } from './ledger.service.js';
import { AdminWalletController, WalletController } from './wallet.controller.js';
import { WalletService } from './wallet.service.js';

/** The ledger and wallets, used by payments, payouts, plan billing and (later) orders. */
@Global()
@Module({
  imports: [SettingsModule, FxModule],
  controllers: [WalletController, AdminWalletController],
  providers: [LedgerService, WalletService, AllowanceService],
  exports: [LedgerService, WalletService, AllowanceService],
})
export class LedgerModule {}
