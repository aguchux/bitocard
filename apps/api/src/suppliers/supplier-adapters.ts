import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { StubAdapter, type SupplierAdapter } from './adapter';
import { ReloadlyAdapter } from './reloadly.adapter';
import { VtpassAdapter } from './vtpass.adapter';

/**
 * Every supplier in the registry has an adapter. Suppliers whose API access is not yet confirmed get a stub until
 * their adapter is built; which suppliers are used is admin configuration, not code.
 */
@Injectable()
export class SupplierAdapters {
  private readonly adapters = new Map<string, SupplierAdapter>();

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    const sandbox = config.RELOADLY_SANDBOX;
    this.add(
      new ReloadlyAdapter(
        { clientId: config.RELOADLY_CLIENT_ID, clientSecret: config.RELOADLY_CLIENT_SECRET },
        {
          auth: config.RELOADLY_AUTH_URL,
          giftcards: config.RELOADLY_GIFTCARDS_URL ?? (sandbox ? 'https://giftcards-sandbox.reloadly.com' : 'https://giftcards.reloadly.com'),
          topups: config.RELOADLY_TOPUPS_URL ?? (sandbox ? 'https://topups-sandbox.reloadly.com' : 'https://topups.reloadly.com'),
        },
      ),
    );
    this.add(new VtpassAdapter({ apiKey: config.VTPASS_API_KEY, publicKey: config.VTPASS_PUBLIC_KEY, secretKey: config.VTPASS_SECRET_KEY }, config.VTPASS_API_URL, config.VTPASS_CONTACT_PHONE));
  }

  private add(adapter: SupplierAdapter) {
    this.adapters.set(adapter.code, adapter);
  }

  get(code: string): SupplierAdapter {
    return this.adapters.get(code) ?? new StubAdapter(code);
  }
}
