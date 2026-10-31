import { HttpStatus, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { ApiError } from '../common/errors/api-error.js';
import { CryptoWalletsService } from '../crypto/crypto-wallets.service.js';
import { everyMarket } from '../crypto/p2p-fees.service.js';
import { globalMarket } from '../crypto/p2p.service.js';
import { PrismaService } from '../database/prisma.service.js';
import type { LedgerMode } from '../generated/prisma/client.js';
import { SettingsService, switchDefault, type SwitchKey } from '../settings/settings.service.js';
import { afrippaStoreId } from './ids.js';

/** The switches that open Afrippa's markets, set for all of Afrippa or one country (never per reseller). */
export const afrippaMarketSwitches = ['crypto_wallets', 'p2p_trading', 'crypto_app', 'crypto_global', 'crypto_cross_border', 'crypto_install_prompt'] as const;
export type AfrippaMarketSwitch = (typeof afrippaMarketSwitches)[number];

/** What each switch does, in Afrippa's words, and where it can be set. */
export const afrippaSwitchDefinitions: Record<AfrippaMarketSwitch, { label: string; description: string; scopes: Array<'global' | 'country'> }> = {
  crypto_wallets: { label: 'Wallets', description: 'Traders in the market hold coins in Afrippa wallets: deposits, withdrawals and test coins.', scopes: ['global', 'country'] },
  p2p_trading: { label: 'P2P trading', description: "The market's own P2P book in its currency: posting ads and opening orders. Needs wallets on too.", scopes: ['global', 'country'] },
  crypto_app: { label: 'Shown on afrippa.com', description: "afrippa.com lists the country's market, and its residents and ID documents are allowed on Afrippa.", scopes: ['global', 'country'] },
  crypto_global: {
    label: 'Global market',
    description: "The global market in US dollars. Switched on for all of Afrippa it opens the market itself; each country must be switched on by itself for its residents to trade there.",
    scopes: ['global', 'country'],
  },
  crypto_cross_border: { label: 'Open to other countries', description: "Residents of other allowed countries may trade in this country's own book, within its cross-border limits.", scopes: ['country'] },
  crypto_install_prompt: { label: 'Install prompt', description: 'afrippa.com offers to install itself as an app, at most three times per visitor.', scopes: ['global', 'country'] },
};

const isMarketSwitch = (key: string): key is AfrippaMarketSwitch => (afrippaMarketSwitches as readonly string[]).includes(key);

/**
 * Afrippa's markets for its admins (docs/CRYPTO_SPINOFF_PLAN.md, step 6): which markets are open, set by the switches
 * above for all of Afrippa or one country; what each still needs before trading live (fee rates and market limits);
 * and whether Afrippa's store runs in the sandbox or live. BitoCard's admins never see or set these.
 */
@Injectable()
export class AfrippaMarketsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly wallets: CryptoWalletsService,
    private readonly audit: AuditService,
  ) {}

  async overview() {
    const [store, countries, rows, rates, limits] = await Promise.all([
      this.prisma.store.findUniqueOrThrow({ where: { id: afrippaStoreId }, select: { checkoutMode: true } }),
      this.prisma.country.findMany({ orderBy: { code: 'asc' }, select: { code: true, name: true, currency: true } }),
      this.prisma.featureSwitch.findMany({ where: { key: { in: [...afrippaMarketSwitches] }, resellerId: null } }),
      this.prisma.p2pFeeRate.findMany({ select: { market: true } }),
      this.prisma.cryptoMarketLimit.findMany({ where: { mode: 'live' }, select: { market: true } }),
    ]);
    const set = (key: AfrippaMarketSwitch, country: string | null) => rows.find(row => row.key === key && row.countryCode === country)?.enabled ?? null;
    const globalOn = (key: AfrippaMarketSwitch) => set(key, null) ?? switchDefault(key as SwitchKey);
    const rated = new Set(rates.map(rate => rate.market));
    const limited = new Set(limits.map(limit => limit.market));
    const switchesAt = (country: string | null) =>
      Object.fromEntries(
        afrippaMarketSwitches
          .filter(key => afrippaSwitchDefinitions[key].scopes.includes(country ? 'country' : 'global'))
          .map(key => {
            const value = set(key, country);
            return [key, { set: value, on: value ?? (country && key !== 'crypto_cross_border' ? globalOn(key) : switchDefault(key as SwitchKey)) }];
          }),
      );
    const ready = (market: string) => ({ fee_rates: rated.has(market) || rated.has(everyMarket), limits: limited.has(market) });
    return {
      object: 'afrippa_markets' as const,
      store_mode: store.checkoutMode as LedgerMode,
      definitions: afrippaSwitchDefinitions,
      global: { market: globalMarket, switches: switchesAt(null), ready: ready(globalMarket) },
      countries: await Promise.all(
        countries.map(async country => ({
          code: country.code,
          name: country.name,
          currency: country.currency,
          switches: switchesAt(country.code),
          // Its residents may trade at all (an allow-list: set for the country by itself, never by the global level).
          allowed: await this.wallets.allowedCountry(country.code),
          ready: ready(country.code),
        })),
      ),
    };
  }

  /** Sets (true or false) or clears (null) a switch for all of Afrippa or one country. Audited in Afrippa's trail. */
  async setSwitch(adminId: string | null, key: string, countryCode: string | null, enabled: boolean | null) {
    if (!isMarketSwitch(key)) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such switch.', 'key');
    if (!afrippaSwitchDefinitions[key].scopes.includes(countryCode ? 'country' : 'global')) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'scope_not_allowed', `${afrippaSwitchDefinitions[key].label} is set per country only.`, 'country_code');
    }
    await this.settings.setSwitch(adminId, key, { countryCode: countryCode ?? undefined }, enabled);
    return this.overview();
  }

  /**
   * Moves Afrippa's store between the sandbox (test coins, simulated payments, no real money) and live. Live, every
   * market still needs its fee rates and limits before trading in it. Audited in Afrippa's trail.
   */
  async setStoreMode(adminId: string | null, mode: LedgerMode, reason: string) {
    const before = await this.prisma.store.findUniqueOrThrow({ where: { id: afrippaStoreId }, select: { checkoutMode: true } });
    if (before.checkoutMode !== mode) {
      await this.prisma.store.update({ where: { id: afrippaStoreId }, data: { checkoutMode: mode } });
      await this.audit.record({ actorId: adminId, action: 'afrippa.store_mode_changed', targetType: 'store', targetId: afrippaStoreId, before: { mode: before.checkoutMode }, after: { mode, reason: reason.trim() }, platform: 'afrippa' });
    }
    return this.overview();
  }
}
