import { Controller, Get, Header, Module, Query } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { IsIn, Matches } from 'class-validator';
import { Public } from '../auth/caller.js';
import { IntegrationsService } from '../integrations/integrations.service.js';
import { ProductOnly } from '../products/product.js';
import { appVersionPattern, updateState } from './versions.js';

class AppConfigQueryDto {
  @IsIn(['ios', 'android']) platform!: 'ios' | 'android';
  @Matches(appVersionPattern, { message: 'A version is three numbers, for example 1.2.0' }) version!: string;
}

/**
 * What Udozo's mobile app asks when it opens (docs/UDOZO_MOBILE_APP_PLAN.md, phase 0): whether this version must update
 * (`required`: the app shows only Update the app), may update (`available`) or is fine, with the store page to open, and
 * the site's address for its legal pages. Admins set the versions in Settings > Integrations > Mobile app. Markets and
 * their switches come from GET /v1/classifieds/markets, as for udozo.com.
 */
@ApiExcludeController()
@Public()
@Controller('app')
@ProductOnly('udozo')
export class AppConfigController {
  constructor(private readonly integrations: IntegrationsService) {}

  @Get('config')
  @Header('Cache-Control', 'public, max-age=60')
  config(@Query() query: AppConfigQueryDto) {
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
    };
  }
}

@Module({ controllers: [AppConfigController] })
export class AppConfigModule {}
