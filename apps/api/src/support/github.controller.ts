import { Body, Controller, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '../auth/caller.js';
import { ApiError } from '../common/errors/api-error.js';
import { SkipIdempotency } from '../common/idempotency/idempotency.interceptor.js';
import { IntegrationsService } from '../integrations/integrations.service.js';
import { EngineeringService } from './engineering.service.js';
import { githubSignatureValid } from './github.js';

/** GitHub's notifications for the engineering repository (`X-Hub-Signature-256`): closed and reopened issues. */
@ApiExcludeController()
@Public()
@SkipIdempotency()
@Controller('webhooks/github')
export class GithubWebhookController {
  constructor(
    private readonly engineering: EngineeringService,
    private readonly integrations: IntegrationsService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async receive(@Req() req: Request & { rawBody?: Buffer }, @Body() body: Parameters<EngineeringService['notice']>[1]) {
    if (!githubSignatureValid(this.integrations.config.GITHUB_WEBHOOK_SECRET as string | undefined, req.rawBody, req.get('x-hub-signature-256'))) {
      throw new ApiError(HttpStatus.UNAUTHORIZED, 'authentication_error', 'signature_invalid', 'Webhook signature is missing or wrong.');
    }
    return { received: true, outcome: await this.engineering.notice(req.get('x-github-event'), body) };
  }
}
