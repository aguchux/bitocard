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
  fixed_price_earning: {
    values: ['markup', 'discount'],
    description: "How resellers earn on face-value products: a markup on top, or selling at face value and keeping BitoCard's discount.",
  },
} as const;

/** Admin switches for gated features, and the scopes each can be set at. Off unless switched on. */
export const switchDefinitions = {
  startup_allowance: { scopes: ['global', 'country', 'reseller'], description: 'The one-time $500 startup allowance.' },
  welcome_bonus: { scopes: ['reseller'], description: 'The $1 customer welcome bonus; only ever per reseller.' },
  reserved_accounts: {
    scopes: ['global', 'country', 'reseller'],
    description: 'Live reserved bank accounts (top-ups by bank transfer), on top of the country offering them. In Nigeria the owner also needs a verified BVN.',
  },
  manual_reseller_approval: {
    scopes: ['global', 'country'],
    description: 'Resellers who pass the identity check wait for an admin to activate them, instead of going live at once.',
  },
} as const;

export type OptionKey = keyof typeof optionDefinitions;
export type SwitchKey = keyof typeof switchDefinitions;
type SwitchScope = { countryCode?: string | null; resellerId?: string | null };

export const isOptionKey = (key: string): key is OptionKey => key in optionDefinitions;
export const isSwitchKey = (key: string): key is SwitchKey => key in switchDefinitions;

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

  /** Whether a switch is on for a reseller: their own switch, else their country's, else the global one. Off by default. */
  async isOn(key: SwitchKey, resellerId: string) {
    const reseller = await this.prisma.reseller.findUniqueOrThrow({ where: { id: resellerId } });
    const rows = await this.prisma.featureSwitch.findMany({ where: { key } });
    const pick = (match: (row: (typeof rows)[number]) => boolean) => rows.find(match)?.enabled;
    return (
      pick(row => row.resellerId === resellerId) ??
      pick(row => row.countryCode !== null && row.countryCode === reseller.country) ??
      pick(row => row.countryCode === null && row.resellerId === null) ??
      false
    );
  }

  async switchesFor(resellerId: string) {
    const keys = Object.keys(switchDefinitions) as SwitchKey[];
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
      definitions: switchDefinitions,
      data: rows.map(row => ({
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
