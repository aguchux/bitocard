import { Injectable } from '@nestjs/common';
import { IntegrationsService } from '../integrations/integrations.service.js';
import { StubAdapter, type SupplierAdapter } from './adapter.js';
import { DidwwAdapter } from './didww.adapter.js';
import { ReloadlyAdapter } from './reloadly.adapter.js';
import { VtpassAdapter } from './vtpass.adapter.js';

/**
 * Every supplier in the registry has an adapter. Suppliers whose API access is not yet confirmed get a stub until
 * their adapter is built; which suppliers are used is admin configuration, not code.
 */
@Injectable()
export class SupplierAdapters {
  private readonly configured: () => Map<string, SupplierAdapter>;

  constructor(integrations: IntegrationsService) {
    // Rebuilt when an admin changes supplier credentials, so a new key is used without a restart.
    this.configured = integrations.derive(config => {
      const sandbox = config.RELOADLY_SANDBOX;
      const adapters: SupplierAdapter[] = [
        new ReloadlyAdapter(
          { clientId: config.RELOADLY_CLIENT_ID, clientSecret: config.RELOADLY_CLIENT_SECRET },
          {
            auth: config.RELOADLY_AUTH_URL,
            giftcards: config.RELOADLY_GIFTCARDS_URL ?? (sandbox ? 'https://giftcards-sandbox.reloadly.com' : 'https://giftcards.reloadly.com'),
            topups: config.RELOADLY_TOPUPS_URL ?? (sandbox ? 'https://topups-sandbox.reloadly.com' : 'https://topups.reloadly.com'),
          },
        ),
        new VtpassAdapter({ apiKey: config.VTPASS_API_KEY, publicKey: config.VTPASS_PUBLIC_KEY, secretKey: config.VTPASS_SECRET_KEY }, config.VTPASS_API_URL, config.VTPASS_CONTACT_PHONE),
        new DidwwAdapter({ apiKey: config.DIDWW_API_KEY, baseUrl: config.DIDWW_API_URL, countries: config.DIDWW_COUNTRIES, callbackBase: config.DIDWW_CALLBACK_URL }),
      ];
      return new Map(adapters.map(adapter => [adapter.code, adapter]));
    });
  }

  get(code: string): SupplierAdapter {
    return this.configured().get(code) ?? new StubAdapter(code);
  }
}
