import {
  Body,
  type CanActivate,
  Controller,
  createParamDecorator,
  type ExecutionContext,
  Get,
  HttpCode,
  HttpStatus,
  Injectable,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiExcludeController } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import type { Request, Response } from 'express';
import { PrismaService } from '../database/prisma.service.js';
import { AdminRoles, type Caller, CurrentCaller, personOf, Public, RealmOnly, SessionOnly, requireStepUp } from '../auth/caller.js';
import { ApiError } from '../common/errors/api-error.js';
import { SkipIdempotency } from '../common/idempotency/idempotency.interceptor.js';
import { adminId } from '../countries/countries.controller.js';
import { maxDocumentBytes } from './files.js';
import { KycService, type Reviewer } from './kyc.service.js';

export const kycSessionHeader = 'bitocard-kyc-session';
type KycRequest = Request & { kyc?: { caseId: string; sessionId: string }; kycSessionId?: string };

const signInAgain = () => new ApiError(HttpStatus.UNAUTHORIZED, 'authentication_error', 'kyc_session_expired', 'Your session has ended. Open your verification link again.');

/** BitoCard Verify's applicant routes: the app's server sends the session from its cookie as `BitoCard-Kyc-Session`. */
@Injectable()
export class KycSessionGuard implements CanActivate {
  constructor(private readonly kyc: KycService) {}

  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<KycRequest>();
    const token = req.get(kycSessionHeader);
    const session = token ? await this.kyc.resolve(token) : null;
    if (!session) throw signInAgain();
    req.kyc = session;
    // Idempotency keys are scoped to this session.
    req.kycSessionId = session.sessionId;
    return true;
  }
}

const CurrentCase = createParamDecorator((_data: unknown, context: ExecutionContext): string => {
  const req = context.switchToHttp().getRequest<KycRequest>();
  if (!req.kyc) throw signInAgain();
  return req.kyc.caseId;
});

class ExchangeDto {
  @IsString() @Length(10, 200)
  token: string;
}

class ConsentDto {
  @IsBoolean()
  consent: boolean;
}

class BusinessDto {
  @IsIn(['unregistered', 'registered'])
  business_type: 'unregistered' | 'registered';

  @IsOptional() @IsString() @Length(2, 200)
  registered_name?: string;

  @IsOptional() @IsString() @Length(2, 60)
  registration_number?: string;

  @IsOptional() @IsString() @Length(5, 300)
  business_address?: string;
}

class IdentityDto {
  @IsString() @Length(2, 40)
  id_type: string;

  @IsString() @Length(4, 30)
  id_number: string;

  @IsString() @Length(3, 120)
  full_name: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date_of_birth must be YYYY-MM-DD' })
  date_of_birth: string;
}

class DocumentDto {
  @Matches(/^(id_front|id_back|selfie|business_registration|business_address|business_directors|liveness_\d_\d)$/, { message: 'kind is not a document of a check' })
  kind: string;
}

class ApproveDto {
  @IsString() @Length(3, 200)
  verified_name: string;

  @IsOptional() @IsString() @Length(1, 500)
  note?: string;
}

class DeclineDto {
  @IsString() @Length(2, 40)
  reason: string;

  @IsOptional() @IsString() @Length(1, 500)
  note?: string;
}

class ResubmitDto {
  @IsArray() @ArrayMaxSize(12) @IsString({ each: true })
  items: string[];

  @IsString() @Length(3, 500)
  note: string;
}

class ReviewListDto {
  @IsOptional() @IsIn(['submitted', 'resubmit', 'approved', 'declined', 'all'])
  status?: string;

  @IsOptional() @IsIn(['reseller', 'customer'])
  subject?: string;

  @IsOptional() @IsIn(['kyc', 'kyb'])
  kind?: string;

  @IsOptional() @IsIn(['admin', 'reseller'])
  reviewer?: string;

  @IsOptional() @Matches(/^[A-Za-z]{2}$/)
  country?: string;

  @IsOptional() @IsUUID()
  reseller_id?: string;

  @IsOptional() @IsString() @Length(1, 100)
  customer_id?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit?: number;

  @IsOptional() @IsUUID()
  starting_after?: string;
}

const upload = FileInterceptor('file', { limits: { fileSize: maxDocumentBytes + 1, files: 1, fields: 4 } });

function sendDocument(res: Response, document: { contentType: string; bytes: Buffer; name: string }) {
  res.set({
    'content-type': document.contentType,
    'content-length': String(document.bytes.length),
    'cache-control': 'no-store, private',
    'content-disposition': `inline; filename="${document.name}"`,
    'x-content-type-options': 'nosniff',
    // A PDF opened from here can never run anything.
    'content-security-policy': "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
  });
  res.end(document.bytes);
}

/** Exchanging a link for an app session (the link's token works once). */
@ApiExcludeController()
@Public()
@SkipIdempotency()
@Controller('kyc/session')
export class KycSessionController {
  constructor(private readonly kyc: KycService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  exchange(@Body() body: ExchangeDto) {
    return this.kyc.exchange(body.token);
  }
}

/** The applicant's case on BitoCard Verify. */
@ApiExcludeController()
@Public()
@UseGuards(KycSessionGuard)
@Controller('kyc/case')
export class KycCaseController {
  constructor(private readonly kyc: KycService) {}

  @Get()
  get(@CurrentCase() caseId: string) {
    return this.kyc.applicantCase(caseId);
  }

  @Put('consent')
  consent(@CurrentCase() caseId: string, @Body() body: ConsentDto) {
    return this.kyc.consent(caseId, body.consent);
  }

  @Put('business')
  business(@CurrentCase() caseId: string, @Body() body: BusinessDto) {
    return this.kyc.business(caseId, body);
  }

  @Put('identity')
  identity(@CurrentCase() caseId: string, @Body() body: IdentityDto) {
    return this.kyc.identityDetails(caseId, body);
  }

  @Post('documents')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(upload)
  document(@CurrentCase() caseId: string, @Body() body: DocumentDto, @UploadedFile() file?: { buffer: Buffer; mimetype: string; size: number }) {
    return this.kyc.upload(caseId, body.kind, file);
  }

  @Post('liveness')
  @HttpCode(HttpStatus.OK)
  liveness(@CurrentCase() caseId: string) {
    return this.kyc.liveness(caseId);
  }

  @Post('submit')
  @HttpCode(HttpStatus.OK)
  submit(@CurrentCase() caseId: string) {
    return this.kyc.submit(caseId);
  }
}

/** A registered, KYB-verified reseller reviewing its own customers' checks (on verify.bitocard.com, SHQ sessions). */
@ApiExcludeController()
@SessionOnly()
@Controller('kyc/reviews')
export class KycReviewsController {
  constructor(private readonly kyc: KycService) {}

  private reviewer(caller: Caller): Reviewer & { realm: 'reseller' } {
    const userId = personOf(caller);
    if (!caller.resellerId) throw new ApiError(HttpStatus.FORBIDDEN, 'permission_error', 'not_permitted', 'Choose a reseller account first.');
    return { realm: 'reseller', userId, resellerId: caller.resellerId };
  }

  @Get('eligibility')
  eligibility(@CurrentCaller() caller: Caller) {
    const reviewer = this.reviewer(caller);
    return this.kyc.eligibility(reviewer.resellerId, caller.kind === 'session' ? caller.role : null);
  }

  @Get()
  list(@CurrentCaller() caller: Caller, @Query() query: ReviewListDto) {
    return this.kyc.list(this.reviewer(caller), { status: query.status, customer_id: query.customer_id, limit: query.limit, starting_after: query.starting_after });
  }

  @Get(':id')
  get(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string) {
    return this.kyc.detail(id, this.reviewer(caller));
  }

  /** Loaded by `<img>` and PDF links, which cannot name the account: the person's membership of the case's reseller decides. */
  @Get(':id/documents/:document')
  async document(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Param('document', ParseUUIDPipe) document: string, @Res() res: Response) {
    const reviewer: Reviewer = { realm: 'reseller', userId: personOf(caller), resellerId: caller.resellerId ?? '*' };
    sendDocument(res, await this.kyc.document(id, document, reviewer));
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  approve(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: ApproveDto) {
    return this.kyc.approve(id, this.reviewer(caller), body);
  }

  @Post(':id/decline')
  @HttpCode(HttpStatus.OK)
  decline(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: DeclineDto) {
    return this.kyc.decline(id, this.reviewer(caller), body);
  }

  @Post(':id/resubmit')
  @HttpCode(HttpStatus.OK)
  resubmit(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: ResubmitDto) {
    return this.kyc.resubmit(id, this.reviewer(caller), body);
  }
}

/** BitoCard admins: every BitoCard Verify case, with its documents. */
@ApiExcludeController()
@RealmOnly('admin')
@Controller('admin/kyc/cases')
export class AdminKycController {
  constructor(
    private readonly kyc: KycService,
    private readonly prisma: PrismaService,
  ) {}

  private reviewer(caller: Caller): Reviewer {
    return { realm: 'admin', userId: adminId(caller) || null };
  }

  @AdminRoles('operations', 'support')
  @Get()
  list(@CurrentCaller() caller: Caller, @Query() query: ReviewListDto) {
    return this.kyc.list(this.reviewer(caller), query);
  }

  @AdminRoles('operations', 'support')
  @Get(':id')
  get(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string) {
    return this.kyc.detail(id, this.reviewer(caller));
  }

  @AdminRoles('operations', 'support')
  @Get(':id/documents/:document')
  async document(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Param('document', ParseUUIDPipe) document: string, @Res() res: Response) {
    sendDocument(res, await this.kyc.document(id, document, this.reviewer(caller)));
  }

  @AdminRoles('operations')
  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  approve(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: ApproveDto) {
    return this.kyc.approve(id, this.reviewer(caller), body);
  }

  @AdminRoles('operations')
  @Post(':id/decline')
  @HttpCode(HttpStatus.OK)
  async decline(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: DeclineDto) {
    // Overturning an approved check needs the step-up window.
    const current = await this.prisma.kycCase.findUnique({ where: { id }, select: { status: true } });
    if (current?.status === 'approved') requireStepUp(caller);
    return this.kyc.decline(id, this.reviewer(caller), body);
  }

  @AdminRoles('operations')
  @Post(':id/resubmit')
  @HttpCode(HttpStatus.OK)
  resubmit(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: ResubmitDto) {
    return this.kyc.resubmit(id, this.reviewer(caller), body);
  }
}
