import { Body, Controller, HttpCode, HttpStatus, Logger, Post, Req } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '../auth/caller';
import { ApiError } from '../common/errors/api-error';
import { SkipIdempotency } from '../common/idempotency/idempotency.interceptor';
import { IdentityService } from '../identity/identity.service';
import { PayoutsService } from '../payouts/payouts.service';
import { PaymentProviders } from './payment-providers';
import { PaymentsService } from './payments.service';

const untrusted = () => new ApiError(HttpStatus.UNAUTHORIZED, 'authentication_error', 'signature_invalid', 'Webhook signature is missing or wrong.');

type FlutterwaveEvent = { event?: string; 'event.type'?: string; data?: { id?: number | string; reference?: string } };

type MonnifyEvent = { eventType?: string; eventData?: { transactionReference?: string; product?: { type?: string } } };

/**
 * Notifications from payment providers. Each is authenticated, then the result is re-read from the provider before
 * any money moves. Handling is idempotent; an error returns 500 so the provider retries later.
 */
@ApiExcludeController()
@Public()
@SkipIdempotency()
@Controller('webhooks')
export class ProviderWebhooksController {
  private readonly logger = new Logger('ProviderWebhooks');

  constructor(
    private readonly providers: PaymentProviders,
    private readonly payments: PaymentsService,
    private readonly payouts: PayoutsService,
    private readonly identity: IdentityService,
  ) {}

  @Post('flutterwave')
  @HttpCode(HttpStatus.OK)
  async flutterwave(@Req() req: Request, @Body() body: FlutterwaveEvent) {
    if (!this.providers.flutterwave?.webhookTrusted(req.get('verif-hash'))) throw untrusted();
    const event = body.event ?? '';
    // BVN consent finished: re-read the record (the BVN data in the notification is ignored, never stored).
    if (event === 'bvn.completed' && body.data?.reference) return { received: true, ...(await this.identity.refreshByReference('flutterwave', body.data.reference)) };
    const id = body.data?.id;
    if (id === undefined) return { received: true };
    if (event === 'charge.completed') return { received: true, ...(await this.payments.flutterwaveCharge(String(id))) };
    if (event === 'transfer.completed') return { received: true, ...(await this.payouts.refreshByTransferId('flutterwave', String(id))) };
    this.logger.log({ event }, 'Ignored Flutterwave event');
    return { received: true };
  }

  @Post('monnify')
  @HttpCode(HttpStatus.OK)
  async monnify(@Req() req: Request & { rawBody?: Buffer }, @Body() body: MonnifyEvent) {
    if (!this.providers.monnify?.webhookTrusted(req.rawBody, req.get('monnify-signature'))) throw untrusted();
    const reference = body.eventData?.transactionReference;
    if (body.eventType === 'SUCCESSFUL_TRANSACTION' && body.eventData?.product?.type === 'RESERVED_ACCOUNT' && reference) {
      return { received: true, ...(await this.payments.monnifyDeposit(reference)) };
    }
    return { received: true };
  }
}
