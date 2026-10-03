import { Global, Module } from '@nestjs/common';
import { PaymentProviders } from './payment-providers.js';

/** The configured payment providers, shared by top-ups, payouts and exchange rates. */
@Global()
@Module({ providers: [PaymentProviders], exports: [PaymentProviders] })
export class ProvidersModule {}
