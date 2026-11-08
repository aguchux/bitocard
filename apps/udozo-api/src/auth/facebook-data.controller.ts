import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipIdempotency } from '../common/idempotency/idempotency.interceptor.js';
import { ProductOnly } from '../products/product.js';
import { Public } from './caller.js';
import { FacebookDataService } from './facebook-data.service.js';

/**
 * Meta's Facebook Login callbacks, set in the Meta app (App settings > Advanced): Deauthorize callback URL
 * `https://api.udozo.com/v1/webhooks/facebook/deauthorize` and Data Deletion Request URL
 * `https://api.udozo.com/v1/webhooks/facebook/data-deletion`. Meta posts a form with `signed_request`.
 */
@ApiExcludeController()
@ProductOnly('udozo')
@Public()
@SkipIdempotency()
@Controller('webhooks/facebook')
export class FacebookDataWebhookController {
  constructor(private readonly data: FacebookDataService) {}

  @Post('deauthorize')
  @HttpCode(HttpStatus.OK)
  deauthorize(@Body('signed_request') signed: unknown) {
    return this.data.deauthorize(signed);
  }

  @Post('data-deletion')
  @HttpCode(HttpStatus.OK)
  deletion(@Body('signed_request') signed: unknown) {
    return this.data.deletion(signed);
  }
}

/** Where a Facebook data deletion request stands, read by udozo.com's status page. */
@ApiExcludeController()
@ProductOnly('udozo')
@Public()
@Controller('facebook/data-deletion')
export class FacebookDataStatusController {
  constructor(private readonly data: FacebookDataService) {}

  @Get(':code')
  status(@Param('code') code: string) {
    return this.data.status(code);
  }
}
