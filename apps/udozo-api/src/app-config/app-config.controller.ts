import { Controller, Get, Header, Module, Query } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { IsIn, IsOptional, Matches } from 'class-validator';
import { Public } from '../auth/caller.js';
import { IntegrationsService } from '../integrations/integrations.service.js';
import { ProductOnly } from '../products/product.js';
import { SettingsModule } from '../settings/settings.module.js';
import { type SwitchKey, SettingsService } from '../settings/settings.service.js';
import { appVersionPattern, updateState } from './versions.js';

class AppConfigQueryDto {
  @IsIn(['ios', 'android']) platform!: 'ios' | 'android';
  @Matches(appVersionPattern, { message: 'A version is three numbers, for example 1.2.0' }) version!: string;
  /** The shopper's market, for its `features`. */
  @IsOptional() @Matches(/^[A-Z]{2}$/, { message: 'country is two capital letters' }) country?: string;
}

/**
 * What the app shows or hides in a market, beside what `GET /v1/classifieds/markets` already says per market (UdozoPay,
 * buy orders, Connect, auctions): each its switch for that country (else the global one, else its default). The API
 * still decides every action: these only spare the app offering what would be refused.
 */
export const appFeatures = {
  assistant: 'classifieds_assistant',
  wanted: 'classifieds_wanted',
  reviews: 'classifieds_reviews',
  private_ratings: 'classifieds_interaction_ratings',
  seller_scores: 'seller_scores',
  personalisation: 'personalisation',
  whatsapp: 'whatsapp_channel',
  pos_payments: 'pos_wallet_payments',
} as const satisfies Record<string, SwitchKey>;

/**
 * What Udozo's mobile app asks when it opens (docs/UDOZO_MOBILE_APP_PLAN.md, phase 0): whether this version must update
 * (`required`: the app shows only Update the app), may update (`available`) or is fine, with the store page to open, and
 * the site's address for its legal pages. Admins set the versions in Settings > Integrations > Mobile app. Markets come
 * from GET /v1/classifieds/markets, as for udozo.com; with `country`, the market's other features too (`appFeatures`).
 */
@ApiExcludeController()
@Public()
@Controller('app')
@ProductOnly('udozo')
export class AppConfigController {
  constructor(
    private readonly integrations: IntegrationsService,
    private readonly settings: SettingsService,
  ) {}

  @Get('config')
  @Header('Cache-Control', 'public, max-age=60')
  async config(@Query() query: AppConfigQueryDto) {
    const settings = this.integrations.config;
    const ios = query.platform === 'ios';
    const min = (ios ? settings.APP_IOS_MIN_VERSION : settings.APP_ANDROID_MIN_VERSION) ?? null;
    const latest = (ios ? settings.APP_IOS_LATEST_VERSION : settings.APP_ANDROID_LATEST_VERSION) ?? null;
    const site = settings.STOREFRONT_URL.replace(/\/+$/, '');
    return {
      object: 'app_config' as const,
      platform: query.platform,
      version: query.version,
      update: updateState(query.version, min, latest),
      min_version: min,
      latest_version: latest,
      store_url: (ios ? settings.APP_IOS_STORE_URL : settings.APP_ANDROID_STORE_URL) ?? null,
      site_url: site,
      legal: { terms: `${site}/legal/terms`, privacy: `${site}/legal/privacy` },
      country: query.country ?? null,
      features: query.country
        ? Object.fromEntries(await Promise.all(Object.entries(appFeatures).map(async ([name, key]) => [name, await this.settings.isOnForCountry(key, query.country!)] as const)))
        : null,
    };
  }
}

@Module({ imports: [SettingsModule], controllers: [AppConfigController] })
export class AppConfigModule {}
