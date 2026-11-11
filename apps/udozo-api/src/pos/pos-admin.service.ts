import { HttpStatus, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { ApiError } from '../common/errors/api-error.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { isPosPlanCode, type PosLimits, posLimitKeys, presentPlan } from './plans.js';
import { PosService, withShops } from './pos.service.js';

const invalid = (code: string, message: string, param?: string) => new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', code, message, param);

export const posAppPlatforms = ['android', 'ios', 'windows'] as const;
export type PosAppPlatform = (typeof posAppPlatforms)[number];

/** Each store's own address for an app: Windows only the Microsoft Store (pos.udozo.com never serves an installer). */
const storeAddress: Record<PosAppPlatform, RegExp> = {
  android: /^https:\/\/play\.google\.com\/store\/apps\/details\?id=[A-Za-z0-9._]+$/,
  ios: /^https:\/\/apps\.apple\.com\/[a-z]{2}\/app\/[a-z0-9-]+\/id\d+$/,
  windows: /^https:\/\/apps\.microsoft\.com\/detail\/[A-Za-z0-9]{12}$/,
};

export const appLinkValid = (platform: PosAppPlatform, url: string) => storeAddress[platform].test(url);

export type PlanChange = { name?: string; description?: string; prices?: Record<string, number | null>; yearly_prices?: Record<string, number | null>; limits?: Partial<PosLimits>; trial_days?: number; shown?: boolean; offline_hours?: number; offline_sales?: number };

/**
 * Udozo's team on Udozo POS (admin.udozo.com > POS): every owner's account, the three plans (finance sets their prices per
 * market currency, limits and trial; every change audited), and where pos.udozo.com's app buttons go.
 */
@Injectable()
export class PosAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pos: PosService,
    private readonly audit: AuditService,
  ) {}

  async accounts(query: { q?: string; country?: string; plan?: string; limit?: number; offset?: number }) {
    const q = query.q?.trim();
    const where: Prisma.PosAccountWhereInput = {
      ...(query.country ? { country: query.country } : {}),
      ...(query.plan ? { planCode: query.plan } : {}),
      ...(q
        ? {
            OR: [
              { customer: { email: { contains: q.toLowerCase() } } },
              { customer: { name: { contains: q, mode: 'insensitive' } } },
              { shops: { some: { name: { contains: q, mode: 'insensitive' } } } },
              { shops: { some: { shopCode: q.toUpperCase() } } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.posAccount.findMany({ where, include: { ...withShops, customer: { select: { id: true, name: true, email: true } } }, orderBy: { createdAt: 'desc' }, take: query.limit ?? 50, skip: query.offset ?? 0 }),
      this.prisma.posAccount.count({ where }),
    ]);
    return { object: 'list' as const, total, data: rows.map(row => ({ ...this.pos.present(row), owner: row.customer })) };
  }

  async account(id: string) {
    const row = await this.prisma.posAccount.findUnique({ where: { id }, include: { ...withShops, customer: { select: { id: true, name: true, email: true } } } });
    if (!row) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'There is no such Udozo POS account.');
    const charges = await this.prisma.posCharge.findMany({ where: { accountId: id }, orderBy: { createdAt: 'desc' }, take: 50 });
    const names = new Map((await this.pos.plans()).map(plan => [plan.code, plan.name]));
    return { ...this.pos.present(row), owner: row.customer, charges: charges.map(charge => this.pos.presentCharge(charge, names.get(charge.planCode) ?? charge.planCode)) };
  }

  async plans() {
    const plans = await this.pos.plans();
    const counts = await this.prisma.posAccount.groupBy({ by: ['planCode'], _count: { _all: true } });
    const currencies = [...new Set((await this.prisma.country.findMany({ select: { currency: true } })).map(item => item.currency))].sort();
    return {
      object: 'list' as const,
      currencies,
      data: plans.map(plan => ({
        ...presentPlan(plan, null),
        shown: plan.shown,
        prices: plan.prices as Record<string, number>,
        yearly_prices: plan.yearlyPrices as Record<string, number>,
        accounts: counts.find(item => item.planCode === plan.code)?._count._all ?? 0,
      })),
    };
  }

  async updatePlan(adminId: string | null, code: string, change: PlanChange) {
    if (!isPosPlanCode(code)) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'There is no such plan.');
    const before = await this.prisma.posPlan.findUniqueOrThrow({ where: { code } });
    const data: Prisma.PosPlanUpdateInput = {};
    if (change.name !== undefined) {
      const name = change.name.trim();
      if (!name || name.length > 40) throw invalid('parameter_invalid', 'A plan name is 1 to 40 characters.', 'name');
      data.name = name;
    }
    if (change.description !== undefined) data.description = change.description.trim().slice(0, 300);
    // Monthly prices and yearly ones (a yearly price needs the monthly one in that currency, as plans are offered monthly first).
    for (const field of ['prices', 'yearly_prices'] as const) {
      const asked = change[field];
      if (asked === undefined) continue;
      if (code === 'free') throw invalid('parameter_invalid', 'Free has no price.', field);
      const markets = new Set((await this.prisma.country.findMany({ select: { currency: true } })).map(item => item.currency));
      const prices = { ...((field === 'prices' ? before.prices : before.yearlyPrices) as Record<string, number>) };
      for (const [currency, amount] of Object.entries(asked)) {
        if (!markets.has(currency)) throw invalid('parameter_invalid', `${currency} is not a market's currency.`, `${field}.${currency}`);
        if (amount === null) delete prices[currency];
        else if (!Number.isSafeInteger(amount) || amount <= 0) throw invalid('parameter_invalid', 'A price is a whole number of minor units above zero.', `${field}.${currency}`);
        else prices[currency] = amount;
      }
      if (field === 'prices') data.prices = prices;
      else data.yearlyPrices = prices;
    }
    const monthly = (data.prices ?? before.prices) as Record<string, number>;
    const yearly = (data.yearlyPrices ?? before.yearlyPrices) as Record<string, number>;
    const orphan = Object.keys(yearly).find(currency => monthly[currency] === undefined);
    if (orphan) throw invalid('parameter_invalid', `Set ${orphan}'s monthly price before its yearly one.`, `yearly_prices.${orphan}`);
    if (change.limits !== undefined) {
      const limits = { ...(before.limits as Record<string, number | null>) };
      for (const [key, value] of Object.entries(change.limits)) {
        if (!(posLimitKeys as readonly string[]).includes(key)) throw invalid('parameter_invalid', `There is no limit called ${key}.`, `limits.${key}`);
        if (value !== null && (!Number.isInteger(value) || value < 1 || value > 100000)) throw invalid('parameter_invalid', 'A limit is from 1 to 100,000, or none.', `limits.${key}`);
        if (code === 'free' && value === null) throw invalid('parameter_invalid', 'Free always has a limit.', `limits.${key}`);
        limits[key] = value;
      }
      data.limits = limits;
    }
    if (change.trial_days !== undefined) {
      if (code === 'free' && change.trial_days !== 0) throw invalid('parameter_invalid', 'Free has no trial.', 'trial_days');
      data.trialDays = change.trial_days;
    }
    if (change.offline_hours !== undefined) {
      if (!Number.isInteger(change.offline_hours) || change.offline_hours < 1 || change.offline_hours > 168) throw invalid('parameter_invalid', 'A till sells offline for 1 to 168 hours.', 'offline_hours');
      data.offlineHours = change.offline_hours;
    }
    if (change.offline_sales !== undefined) {
      if (!Number.isInteger(change.offline_sales) || change.offline_sales < 1 || change.offline_sales > 5000) throw invalid('parameter_invalid', 'A till makes 1 to 5,000 sales offline.', 'offline_sales');
      data.offlineSales = change.offline_sales;
    }
    if (change.shown !== undefined) {
      if (code === 'free' && !change.shown) throw invalid('parameter_invalid', 'Free is always offered.', 'shown');
      data.shown = change.shown;
    }
    const after = await this.prisma.posPlan.update({ where: { code }, data });
    await this.audit.record({ actorId: adminId, action: 'pos.plan_changed', targetType: 'pos_plan', targetId: code, before, after });
    return (await this.plans()).data.find(plan => plan.code === code)!;
  }

  async appLinks() {
    const rows = await this.prisma.posAppLink.findMany();
    return { object: 'pos_apps' as const, ...Object.fromEntries(posAppPlatforms.map(platform => [platform, rows.find(row => row.platform === platform)?.url ?? null])) } as { object: 'pos_apps' } & Record<PosAppPlatform, string | null>;
  }

  async setAppLink(adminId: string | null, platform: PosAppPlatform, url: string | null) {
    const before = await this.prisma.posAppLink.findUnique({ where: { platform } });
    if (url === null) await this.prisma.posAppLink.deleteMany({ where: { platform } });
    else {
      if (!appLinkValid(platform, url)) {
        const example = { android: 'https://play.google.com/store/apps/details?id=com.udozo.pos', ios: 'https://apps.apple.com/ng/app/udozo-pos/id1234567890', windows: 'https://apps.microsoft.com/detail/9NXXXXXXXXXX' }[platform];
        throw invalid('parameter_invalid', `Give the app's address in its store, such as ${example}.`, 'url');
      }
      await this.prisma.posAppLink.upsert({ where: { platform }, create: { platform, url }, update: { url } });
    }
    await this.audit.record({ actorId: adminId, action: 'pos.app_link_changed', targetType: 'pos_app_link', targetId: platform, before, after: { platform, url } });
    return this.appLinks();
  }
}
