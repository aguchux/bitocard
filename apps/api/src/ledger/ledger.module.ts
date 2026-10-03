import { Global, Module } from '@nestjs/common';
import { LedgerService } from './ledger.service.js';
import { AdminWalletController, WalletController } from './wallet.controller.js';
import { WalletService } from './wallet.service.js';

/** The ledger and wallets, used by payments, payouts, plan billing and (later) orders. */
@Global()
@Module({
  controllers: [WalletController, AdminWalletController],
  providers: [LedgerService, WalletService],
  exports: [LedgerService, WalletService],
})
export class LedgerModule {}
