import { Body, Controller, HttpCode, HttpStatus, Logger, Post, Query, Req } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '../auth/caller.js';
import { ApiError } from '../common/errors/api-error.js';
import { SkipIdempotency } from '../common/idempotency/idempotency.interceptor.js';
import { IdentityService } from '../identity/identity.service.js';
import { PayoutsService } from '../payouts/payouts.service.js';
import { ChargebacksService } from './chargebacks.service.js';
import { PaymentProviders } from './payment-providers.js';
import { PaymentsService } from './payments.service.js';

const untrusted = () => new ApiError(HttpStatus.UNAUTHORIZED, 'authentication_error', 'signature_invalid', 'Webhook signature is missing or wrong.');

type FlutterwaveEvent = { event?: string; 'event.type'?: string; data?: { id?: number | string; reference?: string } };

type MonnifyEvent = { eventType?: string; eventData?: { transactionReference?: string; paymentReference?: string; product?: { type?: string } } };

type StripeEvent = { type?: string; data?: { object?: { id?: string; object?: string } } };

type PawapayDeposit = { depositId?: string };

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
    private readonly chargebacks: ChargebacksService,
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
    // A payment page (top-up or checkout): re-read by our reference.
    if (body.eventData?.paymentReference) return { received: true, ...(await this.payments.paymentNotice('monnify', { reference: body.eventData.paymentReference })) };
    return { received: true };
  }

  /** Stripe Checkout: the session named is re-read from Stripe before any money moves. */
  @Post('stripe')
  @HttpCode(HttpStatus.OK)
  async stripe(@Req() req: Request & { rawBody?: Buffer }, @Body() body: StripeEvent) {
    if (!this.providers.stripe?.webhookTrusted(req.rawBody, req.get('stripe-signature'))) throw untrusted();
    const session = body.data?.object;
    if (body.type?.startsWith('checkout.session.') && session?.object === 'checkout.session' && session.id) {
      return { received: true, ...(await this.payments.paymentNotice('stripe', { providerTransactionId: session.id })) };
    }
    // A chargeback opened, updated or decided: re-read from Stripe.
    if (body.type?.startsWith('charge.dispute.') && session?.object === 'dispute' && session.id) {
      return { received: true, ...(await this.chargebacks.stripeNotice(session.id)) };
    }
    return { received: true };
  }

  /** pawaPay deposit callbacks (mobile money payments): the deposit named is re-read from pawaPay. */
  @Post('pawapay-deposits')
  @HttpCode(HttpStatus.OK)
  async pawapayDeposits(@Query('token') token: string | undefined, @Body() body: PawapayDeposit) {
    if (!this.providers.pawapay?.callbackTrusted(token)) throw untrusted();
    if (!body.depositId) return { received: true };
    return { received: true, ...(await this.payments.paymentNotice('pawapay', { providerTransactionId: body.depositId })) };
  }
}
