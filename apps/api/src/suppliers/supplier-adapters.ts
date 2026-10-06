import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { PrismaService } from '../database/prisma.service.js';
import { inSandbox, urlsFor } from '../integrations/endpoints.js';
import { IntegrationsService } from '../integrations/integrations.service.js';
import { StubAdapter, type SupplierAdapter } from './adapter.js';
import { DidwwAdapter } from './didww.adapter.js';
import { ReloadlyAdapter } from './reloadly.adapter.js';
import { StockAdapter } from './stock.adapter.js';
import { VtpassAdapter } from './vtpass.adapter.js';
import { PawapayAdapter } from './pawapay.adapter.js';
import { ZenditAdapter } from './zendit.adapter.js';

/** Reloadly on given credentials, at the gift card and top-up addresses given (live, or an override in tests). */
function reloadly(config: { RELOADLY_AUTH_URL: string; RELOADLY_GIFTCARDS_URL?: string; RELOADLY_TOPUPS_URL?: string }, credentials: { clientId?: string; clientSecret?: string }) {
  return new ReloadlyAdapter(credentials, { auth: config.RELOADLY_AUTH_URL, giftcards: config.RELOADLY_GIFTCARDS_URL!, topups: config.RELOADLY_TOPUPS_URL! });
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
    // A supplier switched to its sandbox (Settings > Integrations) gets no credentials here: it is never used for live
    // orders or syncs, and serves only BitoCard's simulated sandbox. Its credentials are tested from the integration.
    this.configured = integrations.derive(settings => {
      const config = urlsFor(settings, 'live');
      const live = (code: string) => !inSandbox(settings, code);
      const adapters: SupplierAdapter[] = [
        reloadly(config, live('reloadly') ? { clientId: config.RELOADLY_CLIENT_ID, clientSecret: config.RELOADLY_CLIENT_SECRET } : {}),
        new VtpassAdapter(live('vtpass') ? { apiKey: config.VTPASS_API_KEY, publicKey: config.VTPASS_PUBLIC_KEY, secretKey: config.VTPASS_SECRET_KEY } : {}, config.VTPASS_API_URL, config.VTPASS_CONTACT_PHONE),
        new DidwwAdapter({ apiKey: live('didww') ? config.DIDWW_API_KEY : undefined, baseUrl: config.DIDWW_API_URL, countries: config.DIDWW_COUNTRIES, callbackBase: config.DIDWW_CALLBACK_URL }),
        new ZenditAdapter({ apiKey: live('zendit') ? config.ZENDIT_API_KEY : undefined, baseUrl: config.ZENDIT_API_URL }),
        new PawapayAdapter({ apiToken: live('pawapay') ? config.PAWAPAY_API_TOKEN : undefined, baseUrl: config.PAWAPAY_API_URL, feePercent: config.PAWAPAY_PAYOUT_FEE_PERCENT }),
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
    // Always the providers' live addresses, whatever BitoCard's own Sandbox switches say.
    const config = urlsFor(this.integrations.config, 'live');
    if (code === 'reloadly') return reloadly(config, { clientId: credentials.client_id, clientSecret: credentials.client_secret });
    if (code === 'vtpass') return new VtpassAdapter({ apiKey: credentials.api_key, publicKey: credentials.public_key, secretKey: credentials.secret_key }, config.VTPASS_API_URL, config.VTPASS_CONTACT_PHONE);
    if (code === 'didww') return new DidwwAdapter({ apiKey: credentials.api_key, baseUrl: config.DIDWW_API_URL, countries: config.DIDWW_COUNTRIES, callbackBase: config.DIDWW_CALLBACK_URL, connectionId });
    if (code === 'zendit') return new ZenditAdapter({ apiKey: credentials.api_key, baseUrl: config.ZENDIT_API_URL });
    if (code === 'pawapay') return new PawapayAdapter({ apiToken: credentials.api_token, baseUrl: config.PAWAPAY_API_URL, feePercent: credentials.payout_fee_percent });
    return null;
  }

  /** Whether BitoCard's own account with this supplier is switched to its sandbox (so not used live). */
  sandbox(code: string) {
    return inSandbox(this.integrations.config, code);
  }

  get(code: string): SupplierAdapter {
    return this.configured().get(code) ?? new StubAdapter(code);
  }
}
