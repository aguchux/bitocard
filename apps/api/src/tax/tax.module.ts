import { Global, Module } from '@nestjs/common';
import { AdminTaxController } from './tax.controller.js';
import { TaxService } from './tax.service.js';

@Global()
@Module({ controllers: [AdminTaxController], providers: [TaxService], exports: [TaxService] })
export class TaxModule {}
