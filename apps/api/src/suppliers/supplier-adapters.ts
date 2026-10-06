import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { PrismaService } from '../database/prisma.service.js';
import { IntegrationsService } from '../integrations/integrations.service.js';
import { StubAdapter, type SupplierAdapter } from './adapter.js';
import { DidwwAdapter } from './didww.adapter.js';
import { ReloadlyAdapter } from './reloadly.adapter.js';
import { StockAdapter } from './stock.adapter.js';
import { VtpassAdapter } from './vtpass.adapter.js';
import { PawapayAdapter } from './pawapay.adapter.js';
import { ZenditAdapter } from './zendit.adapter.js';

/** Reloadly on given credentials; the API addresses follow the sandbox setting unless overridden (tests). */
function reloadly(config: { RELOADLY_SANDBOX: boolean; RELOADLY_AUTH_URL: string; RELOADLY_GIFTCARDS_URL?: string; RELOADLY_TOPUPS_URL?: string }, credentials: { clientId?: string; clientSecret?: string }) {
  const sandbox = config.RELOADLY_SANDBOX;
  return new ReloadlyAdapter(credentials, {
    auth: config.RELOADLY_AUTH_URL,
    giftcards: config.RELOADLY_GIFTCARDS_URL ?? (sandbox ? 'https://giftcards-sandbox.reloadly.com' : 'https://giftcards.reloadly.com'),
    topups: config.RELOADLY_TOPUPS_URL ?? (sandbox ? 'https://topups-sandbox.reloadly.com' : 'https://topups.reloadly.com'),
  });
}

/**
 * Every supplier in the registry has an adapter. Suppliers whose API access is not yet confirmed get a stub until
 * their adapter is built; which suppliers are used is admin configuration, not code.
 */
@Injectable()
export class SupplierAdapters {
  private readonly configured: () => Map<string, SupplierAdapter>;
  /** BitoCard's own stock: always there, needs no credentials. */
  private readonly stock: StockAdapter;

  constructor(
    private readonly integrations: IntegrationsService,
    prisma: PrismaService,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    this.stock = new StockAdapter(prisma, config.ENCRYPTION_KEY);
    // Rebuilt when an admin changes supplier credentials, so a new key is used without a restart.
    this.configured = integrations.derive(config => {
      const adapters: SupplierAdapter[] = [
        reloadly(config, { clientId: config.RELOADLY_CLIENT_ID, clientSecret: config.RELOADLY_CLIENT_SECRET }),
        new VtpassAdapter({ apiKey: config.VTPASS_API_KEY, publicKey: config.VTPASS_PUBLIC_KEY, secretKey: config.VTPASS_SECRET_KEY }, config.VTPASS_API_URL, config.VTPASS_CONTACT_PHONE),
        new DidwwAdapter({ apiKey: config.DIDWW_API_KEY, baseUrl: config.DIDWW_API_URL, countries: config.DIDWW_COUNTRIES, callbackBase: config.DIDWW_CALLBACK_URL }),
        new ZenditAdapter({ apiKey: config.ZENDIT_API_KEY, baseUrl: config.ZENDIT_API_URL }),
        new PawapayAdapter({ apiToken: config.PAWAPAY_API_TOKEN, baseUrl: config.PAWAPAY_API_URL, feePercent: config.PAWAPAY_PAYOUT_FEE_PERCENT }),
        this.stock,
      ];
      return new Map(adapters.map(adapter => [adapter.code, adapter]));
    });
  }

  /**
   * An adapter on a reseller's own supplier account (their credentials, BitoCard's live addresses), for that
   * reseller's own orders only. Null for a supplier that cannot be connected this way. Live only: the sandbox never
   * calls suppliers. The connection names the account's own notification address (DIDWW callbacks).
   */
  forAccount(code: string, credentials: Record<string, string>, connectionId?: string): SupplierAdapter | null {
    const config = this.integrations.config;
    if (code === 'reloadly') return reloadly({ ...config, RELOADLY_SANDBOX: false }, { clientId: credentials.client_id, clientSecret: credentials.client_secret });
    if (code === 'vtpass') return new VtpassAdapter({ apiKey: credentials.api_key, publicKey: credentials.public_key, secretKey: credentials.secret_key }, config.VTPASS_API_URL, config.VTPASS_CONTACT_PHONE);
    if (code === 'didww') return new DidwwAdapter({ apiKey: credentials.api_key, baseUrl: config.DIDWW_API_URL, countries: config.DIDWW_COUNTRIES, callbackBase: config.DIDWW_CALLBACK_URL, connectionId });
    return null;
  }

  get(code: string): SupplierAdapter {
    return this.configured().get(code) ?? new StubAdapter(code);
  }
}
