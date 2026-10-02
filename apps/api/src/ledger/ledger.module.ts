import { Global, Module } from '@nestjs/common';
import { LedgerService } from './ledger.service';
import { AdminWalletController, WalletController } from './wallet.controller';
import { WalletService } from './wallet.service';

/** The ledger and wallets, used by payments, payouts, plan billing and (later) orders. */
@Global()
@Module({
  controllers: [WalletController, AdminWalletController],
  providers: [LedgerService, WalletService],
  exports: [LedgerService, WalletService],
})
export class LedgerModule {}
