import { Global, Module } from '@nestjs/common';
import { AdminTaxController } from './tax.controller';
import { TaxService } from './tax.service';

@Global()
@Module({ controllers: [AdminTaxController], providers: [TaxService], exports: [TaxService] })
export class TaxModule {}
