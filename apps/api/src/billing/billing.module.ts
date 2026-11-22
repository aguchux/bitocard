import { Module } from '@nestjs/common';
import { AdminInvoicesController, InvoicesController } from './invoices.controller.js';

/** Monthly invoices, what is owed and the credit limit (InvoicesService itself is the ledger module's). */
@Module({
  controllers: [InvoicesController, AdminInvoicesController],
})
export class BillingModule {}
