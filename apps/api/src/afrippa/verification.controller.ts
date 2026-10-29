import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Equals, IsBoolean, IsIn } from 'class-validator';
import { Public } from '../auth/caller.js';
import { StoreSellers } from '../checkout/store-sellers.js';
import { ApiError } from '../common/errors/api-error.js';
import { type CustomerCaller, CustomerGuard, CurrentCustomer } from '../customers/customer-session.js';
import { IdentityService } from '../identity/identity.service.js';
import { IntegrationsService } from '../integrations/integrations.service.js';
import { afrippaOperatorId, afrippaStoreId } from './ids.js';

class StartDto {
  /** The trader agrees to the check, including the face check (biometric data). */
  @IsBoolean() @Equals(true, { message: 'consent must be true' })
  consent: boolean;
}

class SimulateDto {
  @IsIn(['approved', 'declined'])
  outcome: 'approved' | 'declined';
}

/** A trader's name as the check expects it: their first word, then the rest. */
const names = (name: string) => {
  const [first, ...rest] = name.trim().split(/\s+/);
  return { first_name: first || 'Trader', last_name: rest.join(' ') };
};

/**
 * A trader's identity check (docs/CRYPTO_SPINOFF_PLAN.md, step 4 part 4), through Afrippa's signed server: always
 * Verify in Afrippa's name (verify.afrippa.com), whatever the trader's country, under Afrippa's operator account, so
 * the case is Afrippa's (its documents in Afrippa's own bucket, reviewed only in Afrippa's admin). Live trading,
 * payment methods and withdrawals read its outcome. The sandbox simulates it.
 */
@ApiExcludeController()
@Public()
@UseGuards(CustomerGuard)
@Controller('afrippa/account/verification')
export class TraderVerificationController {
  constructor(
    private readonly identity: IdentityService,
    private readonly stores: StoreSellers,
    private readonly integrations: IntegrationsService,
  ) {}

  /** Whether the trader is verified, and their latest check (an open one's link is never handed out twice). */
  @Get()
  async status(@CurrentCustomer() caller: CustomerCaller) {
    const mode = this.stores.mode(caller.customer.store);
    const verified = await this.identity.isCustomerVerified(afrippaOperatorId, mode, caller.customer.id);
    const latest = await this.identity.customerVerification(afrippaOperatorId, mode, caller.customer.id).catch(() => null);
    return { object: 'trader_verification' as const, mode, verified, latest };
  }

  /** Starts the check, or continues an open one with a fresh single-use link. */
  @Post()
  @HttpCode(HttpStatus.OK)
  async start(@CurrentCustomer() caller: CustomerCaller, @Body() body: StartDto) {
    const customer = caller.customer;
    if (!customer.country) throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'country_required', 'Your account has no country yet.');
    const returnUrl = new URL('/verification', this.integrations.config.AFRIPPA_URL).toString();
    return this.identity.startCustomerVerification(
      afrippaOperatorId,
      this.stores.mode(customer.store),
      customer.id,
      { country: customer.country, ...names(customer.name), redirect_url: returnUrl, consent: body.consent },
      { storeId: afrippaStoreId },
    );
  }

  /** The sandbox only: approve or decline the trader's check. */
  @Post('simulate')
  @HttpCode(HttpStatus.OK)
  simulate(@CurrentCustomer() caller: CustomerCaller, @Body() body: SimulateDto) {
    return this.identity.simulateCustomer(afrippaOperatorId, this.stores.mode(caller.customer.store), caller.customer.id, body.outcome);
  }
}
