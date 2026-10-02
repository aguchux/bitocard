import { Body, Controller, Get, HttpCode, HttpStatus, Logger, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeController, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsString, IsUrl, IsUUID, Length, Matches } from 'class-validator';
import type { Request } from 'express';
import { AdminRoles, type Caller, CurrentCaller, personOf, Public, RealmOnly, resellerOf, Roles, Scopes, SessionOnly } from '../auth/caller';
import { ApiError } from '../common/errors/api-error';
import { SkipIdempotency } from '../common/idempotency/idempotency.interceptor';
import { adminId } from '../countries/countries.controller';
import type { LedgerMode, VerificationStatus } from '../generated/prisma/client';
import { Mode } from '../ledger/mode';
import { modeHeader, PageDto } from '../ledger/wallet.controller';
import { IdentityService } from './identity.service';

const referencePattern = /^[A-Za-z0-9._:@-]{1,100}$/;

class ConsentDto {
  @ApiProperty({ description: 'The owner agrees to the identity check, including the face (biometric) check.' })
  @IsBoolean()
  consent: boolean;
}

class StartCustomerVerificationDto {
  @ApiProperty({ example: 'NG', description: 'The customer’s country (ISO 3166-1 alpha-2). Nigeria uses the BVN; elsewhere an ID document and face check.' })
  @Matches(/^[A-Za-z]{2}$/)
  country: string;

  @ApiProperty({ example: 'Chinedu' })
  @IsString() @Length(1, 100)
  first_name: string;

  @ApiProperty({ example: 'Okafor' })
  @IsString() @Length(1, 100)
  last_name: string;

  @ApiPropertyOptional({ description: 'Nigeria only: the 11-digit BVN. Passed to the bank’s consent service and never stored by BitoCard.', example: '22222222222' })
  @IsOptional() @Matches(/^\d{11}$/)
  bvn?: string;

  @ApiProperty({ description: 'Where the customer returns after the check (HTTPS).', example: 'https://example.com/account/verified' })
  @IsUrl({ require_protocol: true, protocols: ['https'] })
  redirect_url: string;

  @ApiProperty({ description: 'The customer agreed to the check (and, outside Nigeria, to the face check).' })
  @IsBoolean()
  consent: boolean;
}

class SimulateVerificationDto {
  @ApiProperty({ enum: ['approved', 'declined'] })
  @IsIn(['approved', 'declined'])
  outcome: 'approved' | 'declined';
}

class AdminVerificationFilterDto extends PageDto {
  @IsOptional() @IsIn(['in_progress', 'approved', 'declined', 'in_review', 'expired']) status?: VerificationStatus;
  @IsOptional() @IsIn(['reseller', 'customer']) subject?: 'reseller' | 'customer';
  @IsOptional() @IsUUID() reseller_id?: string;
}

class DecideVerificationDto {
  @IsIn(['approved', 'declined']) decision: 'approved' | 'declined';
  @IsString() @Length(5, 500) reason: string;
  /** The name as confirmed in the provider's console, when approving. */
  @IsOptional() @IsString() @Length(3, 200) verified_name?: string;
}

const customerReference = (reference: string) => {
  if (!referencePattern.test(reference)) {
    throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'parameter_invalid', 'Customer references use letters, numbers and . _ : @ - (up to 100).', 'reference');
  }
  return reference;
};

/** The business owner's identity check, required before the account goes live. */
@ApiTags('Account')
@ApiBearerAuth()
@SessionOnly()
@Controller('account/verification')
export class ResellerVerificationController {
  constructor(private readonly identity: IdentityService) {}

  @ApiOperation({ summary: 'Get the identity check status' })
  @Get()
  get(@CurrentCaller() caller: Caller) {
    return this.identity.resellerVerification(resellerOf(caller));
  }

  @ApiOperation({
    summary: 'Start the identity check',
    description: 'Business owner only. Returns a Didit page where the owner photographs an ID document and takes a selfie. An unfinished check is returned again for a day.',
  })
  @Roles()
  @Post()
  start(@CurrentCaller() caller: Caller, @Body() body: ConsentDto) {
    return this.identity.startResellerVerification(resellerOf(caller), personOf(caller), body.consent);
  }
}

@ApiTags('Customers')
@ApiBearerAuth()
@modeHeader
@Scopes('customers:verify')
@Controller('customers/:reference/verification')
export class CustomerVerificationController {
  constructor(private readonly identity: IdentityService) {}

  @ApiOperation({
    summary: 'Start a customer identity check',
    description:
      'Optional for your own systems: you are responsible for knowing your customers. In Nigeria the customer approves sharing their BVN record on the bank’s consent page, and it must match their name; elsewhere they photograph an ID document and take a selfie. Send the customer to `url`; the outcome arrives as a `customer_verification.*` webhook. An approved or unfinished check for the same customer is returned instead of a new one. In test mode no page is shown: finish the check with the simulate endpoint.',
  })
  @Roles('admin', 'developer')
  @Post()
  start(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Param('reference') reference: string, @Body() body: StartCustomerVerificationDto) {
    return this.identity.startCustomerVerification(resellerOf(caller), mode, customerReference(reference), body);
  }

  @ApiOperation({ summary: 'Get a customer’s latest identity check' })
  @Get()
  get(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Param('reference') reference: string) {
    return this.identity.customerVerification(resellerOf(caller), mode, customerReference(reference));
  }

  @ApiOperation({ summary: 'Simulate the outcome of a customer identity check (test mode)' })
  @Roles('admin', 'developer')
  @Post('simulate')
  @HttpCode(HttpStatus.OK)
  simulate(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Param('reference') reference: string, @Body() body: SimulateVerificationDto) {
    return this.identity.simulateCustomer(resellerOf(caller), mode, customerReference(reference), body.outcome);
  }
}

/** Identity checks for review: in-review cases are decided after checking them in the provider's console. */
@ApiExcludeController()
@RealmOnly('admin')
@Controller('admin/verifications')
export class AdminVerificationsController {
  constructor(private readonly identity: IdentityService) {}

  @AdminRoles('operations', 'support')
  @Get()
  list(@Query() filter: AdminVerificationFilterDto) {
    return this.identity.adminList(filter);
  }

  @AdminRoles('operations', 'support')
  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.identity.adminGet(id);
  }

  @AdminRoles('operations')
  @Post(':id/decide')
  @HttpCode(HttpStatus.OK)
  decide(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: DecideVerificationDto) {
    return this.identity.decide(adminId(caller), id, body);
  }
}

type DiditEvent = { webhook_type?: string; session_id?: string; status?: string };

/** Didit notifications: authenticated by signature, then the session is re-read from Didit. */
@ApiExcludeController()
@Public()
@SkipIdempotency()
@Controller('webhooks')
export class IdentityWebhooksController {
  private readonly logger = new Logger('IdentityWebhooks');

  constructor(private readonly identity: IdentityService) {}

  @Post('didit')
  @HttpCode(HttpStatus.OK)
  async didit(@Req() req: Request & { rawBody?: Buffer }, @Body() body: DiditEvent) {
    if (!this.identity.didit?.webhookTrusted(req.rawBody, req.get('x-signature'), req.get('x-timestamp'))) {
      throw new ApiError(HttpStatus.UNAUTHORIZED, 'authentication_error', 'signature_invalid', 'Webhook signature is missing or wrong.');
    }
    if (body.webhook_type !== 'status.updated' || !body.session_id) {
      this.logger.log({ type: body.webhook_type }, 'Ignored Didit event');
      return { received: true };
    }
    return { received: true, ...(await this.identity.refreshByReference('didit', body.session_id)) };
  }
}
