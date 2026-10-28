import { HttpStatus, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { ApiError } from '../common/errors/api-error.js';
import { PrismaService } from '../database/prisma.service.js';

/**
 * Settings chain: BitoCard allows options per country; each reseller chooses among what their country allows.
 * Add new settings here, then seed or set their country options.
 */
export const optionDefinitions = {
  gift_card_payout: { values: ['wallet', 'bank'], description: 'Where customers receive money from gift cards they sell.' },
} as const;

/** Admin switches for gated features, and the scopes each can be set at. Off unless switched on, or `default: true`. */
export const switchDefinitions = {
  startup_allowance: { scopes: ['global', 'country', 'reseller'], description: 'The one-time $500 startup allowance.' },
  welcome_bonus: { scopes: ['reseller'], description: 'The $1 customer welcome bonus; only ever per reseller.' },
  reserved_accounts: {
    scopes: ['global', 'country', 'reseller'],
    description: 'Live reserved bank accounts (top-ups by bank transfer), on top of the country offering them. In Nigeria the owner also needs a verified BVN.',
  },
  custom_domains: {
    scopes: ['global', 'country', 'reseller'],
    description: 'Resellers buy or connect their own domains for their stores, manage DNS and email setup in SHQ (Settings > Integrations > Domains must be set up).',
  },
  own_integrations: {
    scopes: ['global', 'country', 'reseller'],
    description: "Resellers connect their own supplier accounts (on plans with own integrations, for integrations offered in their country).",
  },
  own_payment_gateways: {
    scopes: ['global', 'country', 'reseller'],
    description:
      "Resellers connect their own payment gateway (on plans with own payment gateways, for gateways offered in their country) and can choose it to collect their hosted stores' customer payments. Off, BitoCard's gateways collect and the money reaches their wallet.",
  },
  customer_app_bottom_bar_desktop: {
    scopes: ['global', 'country', 'reseller'],
    description: "Customers' account app uses the bottom tab bar on desktop too, instead of the side rail. A reseller's own choice for their store (SHQ Store) wins over this.",
  },
  customer_wallets: {
    scopes: ['global', 'country', 'reseller'],
    default: true,
    description:
      "Store customers have a wallet: they top it up (card, mobile money, Flutterwave or their own bank account number) and buy only from it, never withdrawing. Off, they pay at checkout instead (any balance left can still be spent). On unless switched off.",
  },
  crypto_wallets: {
    scopes: ['global', 'country', 'reseller'],
    description: "Store customers hold crypto (USDT, USDC, BTC, ETH, BNB) in BitoCard wallets. Off until crypto is cleared to operate in the market.",
  },
  p2p_trading: {
    scopes: ['global', 'country', 'reseller'],
    description: "Store customers buy and sell crypto with each other on the P2P market, paid from their BitoCard wallets. Needs crypto wallets on too.",
  },
  spin_rewards: {
    scopes: ['global', 'country', 'reseller'],
    description: "Spin and win: each store customer (one per person across every store) wins $1 over 50 to 100 spins, a few a day, paid by BitoCard into their spin rewards and moved into their store wallet in US dollars or their own currency. Off until the promotion's terms are cleared.",
  },
  crypto_app: {
    scopes: ['global', 'country'],
    description: "BitoCard Crypto (crypto.bitocard.com) shows this country's market. Its residents and its ID documents are allowed in BitoCard Crypto only where it, or global trading, is on.",
  },
  crypto_global: {
    scopes: ['global', 'country', 'reseller'],
    description:
      "BitoCard Crypto's global market: one P2P market in US dollars across countries. Global opens the market itself; each country must be switched on by itself for its residents to trade there (even where its own market is off): the global level alone opens no country. A reseller decides for their stores' customers (following the country unless set).",
  },
  crypto_cross_border: {
    scopes: ['country'],
    description: "Residents of other allowed countries may trade in this country's local-currency P2P market (a Nigerian selling USDT for cedis in Ghana's), within its cross-border limits.",
  },
  crypto_trade_abroad: {
    scopes: ['reseller'],
    default: true,
    description: "Customers of this reseller's stores may trade in other countries' local P2P markets, where those take cross-border trades. On unless switched off.",
  },
  crypto_install_prompt: {
    scopes: ['global', 'country'],
    description: 'BitoCard Crypto offers to install itself as an app, at most three times per visitor.',
  },
  store_template_all_in_one: {
    scopes: ['global', 'country', 'reseller'],
    default: true,
    description: 'Resellers can choose the All-in-one store template for a store. Stores already using it keep it. On unless switched off.',
  },
  store_template_topups: {
    scopes: ['global', 'country', 'reseller'],
    default: true,
    description: 'Resellers can choose the Top-up and bills store template. Stores already using it keep it. On unless switched off.',
  },
  store_template_gift_cards: {
    scopes: ['global', 'country', 'reseller'],
    default: true,
    description: 'Resellers can choose the Gift card shop store template. Stores already using it keep it. On unless switched off.',
  },
  store_template_crypto_desk: {
    scopes: ['global', 'country', 'reseller'],
    default: true,
    description: "Resellers can choose the Crypto desk store template (retired with crypto: never offered). Stores already using it keep it. On unless switched off.",
  },
  store_template_single_product: {
    scopes: ['global', 'country', 'reseller'],
    default: true,
    description: 'Resellers can choose the Single product store template. Stores already using it keep it. On unless switched off.',
  },
  store_template_vpn_shop: {
    scopes: ['global', 'country', 'reseller'],
    default: true,
    description: 'Resellers can choose the VPN shop store template (it sells only once VPN is on sale in their market). Stores already using it keep it. On unless switched off.',
  },
  store_template_resale_shop: {
    scopes: ['global', 'country', 'reseller'],
    default: true,
    description: "Resellers can choose the Resale shop store template (also needs the reseller's reseller_resale switch on and a verified account). Stores already using it keep it. On unless switched off.",
  },
  store_template_rdp_shop: {
    scopes: ['global', 'country', 'reseller'],
    default: true,
    description: 'Resellers can choose the RDP shop store template (it sells only once RDP is on sale in their market). Stores already using it keep it. On unless switched off.',
  },
  reseller_two_step: {
    scopes: ['global', 'country', 'reseller'],
    description:
      "Every member of the reseller's team must use two-step sign-in in SHQ (an authenticator app, an emailed code or a text message, from the methods their market allows), setting it up at their next sign-in. Off: two-step is each person's choice.",
  },
  shq_install_prompt: {
    scopes: ['global', 'country', 'reseller'],
    description:
      "SHQ asks the reseller's team to install it as an app (home screen, full screen; iPhones need it for push notifications): at most three times, on separate visits at least an hour apart, never once installed. Off: no prompt, and the browser's own install bar is held back too.",
  },
  storefront_install_prompt: {
    scopes: ['global', 'country'],
    description:
      "bitocard.com asks shoppers to install it as an app (home screen, full screen), on root bitocard.com (the global setting) and on this market's country store: at most three times, on separate visits at least an hour apart, never once installed. Never on resellers' stores. Off: no prompt, and the browser's own install bar is held back too.",
  },
  manual_reseller_approval: {
    scopes: ['global', 'country'],
    description: 'Resellers who pass the identity check wait for an admin to activate them, instead of going live at once.',
  },
  country_stores: {
    scopes: ['global', 'country'],
    description:
      'bitocard.com serves this market through its own country store (`<country>.bitocard.com`, for example ng.bitocard.com), with that market’s house account as seller of record for every purchase there, instead of the buyer’s own country. Root bitocard.com redirects into it once set up. Off: root bitocard.com serves the market as today.',
  },
  classifieds: {
    scopes: ['global', 'country'],
    description: 'BitoCard Shop (classifieds) in this market: browsing at shop.bitocard.com/<country>, posting and chatting, and the Shop tab on its country store. Off until the marketplace terms are cleared there.',
  },
  classifieds_safe_pay: {
    scopes: ['global', 'country'],
    description: "Safe pay in BitoCard Shop: buyers pay from their wallet, BitoCard holds the money until they confirm, then pays the seller. Needs classifieds on and the market's Safe pay fees set. Off until holding buyers' money is cleared there.",
  },
  classifieds_assistant: {
    scopes: ['global', 'country'],
    description: "Shop assistants (Anjio) in BitoCard Shop: finding listings, helping sellers post and answering questions. Needs classifieds on and an active shop assistant for the market.",
  },
  classifieds_resale: {
    scopes: ['global', 'country'],
    description:
      "B2B reselling: BitoCard Shop sellers can open their listings to resellers' stores (docs/BITOCARD_B2B_RESELLING_PLAN.md), with the discount and markup limit they choose inside BitoCard's limits (Shop > Settings > Resale). Needs classifieds on and the reseller fee set there. Off until holding money for two parties is cleared.",
  },
  reseller_resale: {
    scopes: ['global', 'country', 'reseller'],
    description:
      "B2B reselling for resellers: a verified reseller with a Resale shop store browses BitoCard Shop suppliers' resale listings in their country, adds them to the store at their own price within the supplier's limits, and works with suppliers in a chat with deals (docs/BITOCARD_B2B_RESELLING_PLAN.md). Needs classifieds_resale open in the country. Every plan.",
  },
  classifieds_install_prompt: {
    scopes: ['global', 'country'],
    description:
      "BitoCard Shop asks visitors in this market to install shop.bitocard.com as an app (home screen, full screen): at most three times, on separate visits at least an hour apart, never once installed. Off: no prompt, and the browser's own install bar is held back too.",
  },
} as const;

export type OptionKey = keyof typeof optionDefinitions;
export type SwitchKey = keyof typeof switchDefinitions;
type SwitchScope = { countryCode?: string | null; resellerId?: string | null };

export const isOptionKey = (key: string): key is OptionKey => key in optionDefinitions;
export const isSwitchKey = (key: string): key is SwitchKey => key in switchDefinitions;
/** A switch's value where no admin has set it: off, unless its definition says `default: true`. */
/**
 * Crypto's switches, kept for Afrippa (crypto has left BitoCard; `docs/CRYPTO_SPINOFF_PLAN.md`): never listed to
 * BitoCard's admins or resellers. Their routes are closed (`AfrippaGateGuard`), so they change nothing in BitoCard.
 */
export const afrippaSwitches: ReadonlySet<SwitchKey> = new Set<SwitchKey>([
  'crypto_wallets',
  'p2p_trading',
  'crypto_app',
  'crypto_global',
  'crypto_cross_border',
  'crypto_trade_abroad',
  'crypto_install_prompt',
  'store_template_crypto_desk',
]);

/** The switches BitoCard's admins and resellers see. */
export const bitocardSwitchKeys = (Object.keys(switchDefinitions) as SwitchKey[]).filter(key => !afrippaSwitches.has(key));

export const switchDefault = (key: SwitchKey): boolean => ('default' in switchDefinitions[key] ? Boolean(switchDefinitions[key].default) : false);

const unknownSetting = (param: string) => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such setting.', param);

@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** The reseller's effective options, with what their country allows and where each value comes from. */
  async effectiveOptions(resellerId: string) {
    const reseller = await this.prisma.reseller.findUniqueOrThrow({ where: { id: resellerId }, include: { options: true } });
    const countryOptions = reseller.country ? await this.prisma.countryOption.findMany({ where: { countryCode: reseller.country } }) : [];
    return Object.fromEntries(
      (Object.keys(optionDefinitions) as OptionKey[]).map(key => {
        const country = countryOptions.find(option => option.key === key);
        const choice = reseller.options.find(option => option.key === key)?.value;
        const allowed = country?.allowed ?? [];
        const value = choice && allowed.includes(choice) ? choice : (country?.defaultValue ?? null);
        return [key, { value, allowed, source: choice && allowed.includes(choice) ? 'reseller' : 'country_default' }];
      }),
    );
  }

  async setResellerOption(resellerId: string, key: string, value: string) {
    if (!isOptionKey(key)) throw unknownSetting('key');
    const effective = await this.effectiveOptions(resellerId);
    if (!effective[key].allowed.includes(value)) {
      throw new ApiError(
        HttpStatus.BAD_REQUEST,
        'invalid_request_error',
        'option_not_allowed',
        effective[key].allowed.length ? `Choose one of: ${effective[key].allowed.join(', ')}.` : 'This setting is not available in your country yet.',
        'value',
      );
    }
    await this.prisma.resellerOption.upsert({ where: { resellerId_key: { resellerId, key } }, create: { resellerId, key, value }, update: { value } });
    return this.effectiveOptions(resellerId);
  }

  /** Admin: what a country allows. Reseller choices outside the new list fall back to the country default. */
  async setCountryOption(actorId: string | null, countryCode: string, key: string, allowed: string[], defaultValue: string) {
    if (!isOptionKey(key)) throw unknownSetting('key');
    const values: readonly string[] = optionDefinitions[key].values;
    const invalid = allowed.filter(value => !values.includes(value));
    if (invalid.length || allowed.length === 0) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'parameter_invalid', `allowed must be some of: ${values.join(', ')}.`, 'allowed');
    }
    if (!allowed.includes(defaultValue)) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'parameter_invalid', 'default must be one of the allowed values.', 'default');
    }
    const code = countryCode.toUpperCase();
    if (!(await this.prisma.country.findUnique({ where: { code } }))) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such country.');
    const before = await this.prisma.countryOption.findUnique({ where: { countryCode_key: { countryCode: code, key } } });
    const after = await this.prisma.countryOption.upsert({
      where: { countryCode_key: { countryCode: code, key } },
      create: { countryCode: code, key, allowed, defaultValue },
      update: { allowed, defaultValue },
    });
    await this.audit.record({ actorId, action: 'country.option_updated', targetType: 'country', targetId: code, before, after });
    return { object: 'country_option' as const, country: code, key, allowed: after.allowed, default: after.defaultValue };
  }

  /** Whether a switch is on for a reseller: their own switch, else their country's, else the global one, else its default. */
  async isOn(key: SwitchKey, resellerId: string) {
    const reseller = await this.prisma.reseller.findUniqueOrThrow({ where: { id: resellerId } });
    const rows = await this.prisma.featureSwitch.findMany({ where: { key } });
    const pick = (match: (row: (typeof rows)[number]) => boolean) => rows.find(match)?.enabled;
    return (
      pick(row => row.resellerId === resellerId) ??
      pick(row => row.countryCode !== null && row.countryCode === reseller.country) ??
      pick(row => row.countryCode === null && row.resellerId === null) ??
      switchDefault(key)
    );
  }

  /**
   * A switch's value set at exactly one scope (a country, or a reseller), else null: nothing falls through. For rules
   * that must be set for each country on purpose, such as which countries may use crypto.
   */
  async isSetFor(key: SwitchKey, scope: { countryCode?: string; resellerId?: string }) {
    const row = await this.prisma.featureSwitch.findFirst({ where: { key, countryCode: scope.countryCode ?? null, resellerId: scope.resellerId ?? null } });
    return row?.enabled ?? null;
  }

  /** A switch's global value alone (its global row, else its default): for switches whose global level means the feature itself. */
  async isOnGlobally(key: SwitchKey) {
    const row = await this.prisma.featureSwitch.findFirst({ where: { key, countryCode: null, resellerId: null } });
    return row?.enabled ?? switchDefault(key);
  }

  /** Whether a switch is on for a market as a whole: its country, else the global one, else its default. No reseller in mind. */
  async isOnForCountry(key: SwitchKey, countryCode: string) {
    const rows = await this.prisma.featureSwitch.findMany({ where: { key } });
    const pick = (match: (row: (typeof rows)[number]) => boolean) => rows.find(match)?.enabled;
    return pick(row => row.countryCode === countryCode) ?? pick(row => row.countryCode === null && row.resellerId === null) ?? switchDefault(key);
  }

  async switchesFor(resellerId: string) {
    const keys = bitocardSwitchKeys;
    return Object.fromEntries(await Promise.all(keys.map(async key => [key, await this.isOn(key, resellerId)] as const)));
  }

  /** Admin: set (true/false) or clear (null) a switch at one scope. */
  async setSwitch(actorId: string | null, key: string, scope: SwitchScope, enabled: boolean | null) {
    if (!isSwitchKey(key)) throw unknownSetting('key');
    const countryCode = scope.countryCode?.toUpperCase() ?? null;
    const resellerId = scope.resellerId ?? null;
    if (countryCode && resellerId) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'parameter_invalid', 'Choose a country or a reseller, not both.', 'reseller_id');
    }
    const level = resellerId ? 'reseller' : countryCode ? 'country' : 'global';
    const scopes: readonly string[] = switchDefinitions[key].scopes;
    if (!scopes.includes(level)) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'scope_not_allowed', `${key} can only be set per ${scopes.join(' or ')}.`);
    }
    if (countryCode && !(await this.prisma.country.findUnique({ where: { code: countryCode } }))) {
      throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such country.', 'country_code');
    }
    if (resellerId && !(await this.prisma.reseller.findUnique({ where: { id: resellerId } }))) {
      throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such reseller.', 'reseller_id');
    }

    const before = await this.prisma.featureSwitch.findFirst({ where: { key, countryCode, resellerId } });
    let after = null;
    if (enabled === null) {
      if (before) await this.prisma.featureSwitch.delete({ where: { id: before.id } });
    } else if (before) {
      after = await this.prisma.featureSwitch.update({ where: { id: before.id }, data: { enabled } });
    } else {
      after = await this.prisma.featureSwitch.create({ data: { key, countryCode, resellerId, enabled } });
    }
    await this.audit.record({ actorId, action: enabled === null ? 'switch.cleared' : 'switch.set', targetType: 'switch', targetId: `${key}:${level}:${countryCode ?? resellerId ?? 'all'}`, before, after });
    return { object: 'switch' as const, key, scope: level, country_code: countryCode, reseller_id: resellerId, enabled };
  }

  async listSwitches() {
    const rows = await this.prisma.featureSwitch.findMany({ orderBy: [{ key: 'asc' }, { updatedAt: 'desc' }] });
    return {
      object: 'list' as const,
      /** Each switch's scopes, description and `default` (its value where nothing is set). */
      definitions: Object.fromEntries(bitocardSwitchKeys.map(key => [key, { ...switchDefinitions[key], default: switchDefault(key) }])),
      data: rows.filter(row => !afrippaSwitches.has(row.key as SwitchKey)).map(row => ({
        object: 'switch' as const,
        key: row.key,
        scope: row.resellerId ? 'reseller' : row.countryCode ? 'country' : 'global',
        country_code: row.countryCode,
        reseller_id: row.resellerId,
        enabled: row.enabled,
      })),
    };
  }
}
