import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Length, Matches, Max, MaxLength, Min } from 'class-validator';
import { AdminRoles, type Caller, CurrentCaller, Public, RealmOnly, StepUp } from '../auth/caller.js';
import { adminId } from '../countries/countries.controller.js';
import { CurrentCustomer, type CustomerCaller, CustomerGuard } from '../customers/customer-session.js';
import { ProductOnly } from '../products/product.js';
import { applicationStatuses, ConnectApplicationsService, photoKinds, type PhotoKind } from './applications.service.js';
import { ConnectAdminService } from './connect-admin.service.js';

const upper = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.toUpperCase() : value);

class ApplicationDto {
  @IsOptional() @IsString() @MaxLength(200)
  business_name?: string | null;

  @IsOptional() @IsString() @MaxLength(60)
  registration_number?: string | null;

  @IsOptional() @IsUUID()
  area_id?: string | null;

  @IsOptional() @IsString() @MaxLength(400)
  address?: string | null;

  @IsOptional() @IsString() @MaxLength(200)
  landmark?: string | null;

  @IsOptional() @IsNumber()
  latitude?: number | null;

  @IsOptional() @IsNumber()
  longitude?: number | null;

  @IsOptional() @IsString() @MaxLength(300)
  hours?: string | null;

  @IsOptional() @IsString() @MaxLength(30)
  phone?: string | null;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100000)
  capacity?: number | null;

  @IsOptional() @IsString() @MaxLength(120)
  person_name?: string | null;

  @IsOptional() @IsString() @MaxLength(100)
  person_role?: string | null;
}

class PhotoUploadDto {
  @IsString() @Length(1, 200)
  filename: string;

  @IsString() @MaxLength(100)
  content_type: string;

  @Type(() => Number) @IsInt() @Min(1)
  size: number;
}

class PhotoDto {
  @IsUUID()
  media_id: string;

  @IsIn(photoKinds)
  kind: PhotoKind;
}

class AgreementDto {
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/)
  version: string;
}

class SubmitDto {
  /** The deposit the applicant saw, in minor units: a different one is refused (`deposit_changed`). */
  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  expected_deposit?: number;
}

class NoteDto {
  @IsString() @Length(1, 1000)
  note: string;
}

class ReasonDto {
  @IsString() @Length(1, 1000)
  reason: string;
}

class VisitDto {
  @IsUUID()
  visitor_id: string;

  /** ISO 8601, in the future. */
  @IsString() @MaxLength(40)
  at: string;

  @IsOptional() @IsString() @MaxLength(500)
  note?: string | null;
}

class VisitResultDto {
  @IsBoolean()
  passed: boolean;

  @IsString() @Length(1, 2000)
  report: string;
}

class AdminListDto {
  @IsOptional() @IsIn(applicationStatuses)
  status?: string;

  @IsOptional() @Transform(upper) @Matches(/^[A-Z]{2}$/)
  country?: string;

  @IsOptional() @IsString() @MaxLength(80)
  q?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100000)
  offset?: number;
}

class CountryDto {
  @IsOptional() @Transform(upper) @Matches(/^[A-Z]{2}$/)
  country?: string;
}

class CentresDto extends CountryDto {
  @IsOptional() @IsIn(['active', 'paused', 'closed'])
  status?: string;
}

class VisitorDto {
  @IsOptional() @Transform(upper) @Matches(/^[A-Z]{2}$/)
  country?: string;

  @IsOptional() @IsString() @Length(1, 120)
  name?: string;

  @IsOptional() @IsString() @MaxLength(30)
  phone?: string | null;

  @IsOptional() @IsString() @MaxLength(200)
  email?: string | null;

  @IsOptional() @IsIn(['staff', 'agent'])
  kind?: 'staff' | 'agent';

  /** An agent who finished Udozo's training. */
  @IsOptional() @IsBoolean()
  trained?: boolean;

  @IsOptional() @IsBoolean()
  active?: boolean;
}

class StateDto {
  @IsBoolean()
  enabled: boolean;
}

class SettingsDto {
  /** Minor units; null clears it (applications cannot be submitted until it is set). */
  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  deposit?: number | null;

  /** The Connect fee: a share of the shipping charge (`fee_bps`) or fixed (`fee`, minor units); null: no Connect orders. */
  @IsOptional() @IsIn(['percent', 'fixed'])
  fee_kind?: 'percent' | 'fixed' | null;

  @IsOptional() @IsInt() @Min(0) @Max(10000)
  fee_bps?: number;

  @IsOptional() @IsInt() @Min(0)
  fee?: number;

  /** The centre's part of Connect fees, demurrage and penalties (Udozo has the rest). */
  @IsOptional() @IsInt() @Min(0) @Max(10000)
  centre_share_bps?: number;

  /** The buyer's free time to collect once an item is ready. */
  @IsOptional() @IsInt() @Min(1) @Max(720)
  buyer_free_hours?: number;

  /** Returns to sellers: due days after ready, hours to answer, the seller's days to collect. */
  @IsOptional() @IsInt() @Min(1) @Max(90)
  return_due_days?: number;

  @IsOptional() @IsInt() @Min(1) @Max(720)
  return_answer_hours?: number;

  @IsOptional() @IsInt() @Min(1) @Max(90)
  seller_collect_days?: number;

  /** Storage: a day's demurrage and Loss of care penalty as shares of the shipping charge, and the penalty's daily cap. */
  @IsOptional() @IsInt() @Min(0) @Max(10000)
  demurrage_bps?: number;

  @IsOptional() @IsInt() @Min(0) @Max(10000)
  loc_penalty_bps?: number;

  @IsOptional() @IsInt() @Min(0)
  loc_penalty_cap?: number;

  /** Abandoned, then auctioned, this many days into Loss of care; claims within claim_days of the sale. */
  @IsOptional() @IsInt() @Min(1) @Max(365)
  abandoned_after_days?: number;

  @IsOptional() @IsInt() @Min(1) @Max(730)
  auction_after_days?: number;

  @IsOptional() @IsInt() @Min(1) @Max(365)
  claim_days?: number;

  /** Auctions: the bid step (a share and a least amount), the extension for a late bid, and the hours to pay. */
  @IsOptional() @IsInt() @Min(1) @Max(5000)
  auction_step_bps?: number;

  @IsOptional() @IsInt() @Min(0)
  auction_step_min?: number;

  @IsOptional() @IsInt() @Min(0) @Max(60)
  auction_extend_minutes?: number;

  @IsOptional() @IsInt() @Min(1) @Max(336)
  auction_pay_hours?: number;
}

/**
 * Applying to run a Connect Centre (docs/UDOZO_CONNECT_PLAN.md, phase 2), for signed-in Udozo customers. connect.udozo.com
 * calls these from its server with the customer's session.
 */
@ApiExcludeController()
@Public()
@UseGuards(CustomerGuard)
@Controller('connect')
@ProductOnly('udozo')
export class ConnectApplicationsController {
  constructor(private readonly applications: ConnectApplicationsService) {}

  @Get('apply')
  settings(@CurrentCustomer() caller: CustomerCaller) {
    return this.applications.applySettings(caller.customer);
  }

  @Post('agreement/accept')
  @HttpCode(HttpStatus.OK)
  accept(@CurrentCustomer() caller: CustomerCaller, @Body() body: AgreementDto) {
    return this.applications.acceptAgreement(caller.customer, body.version);
  }

  @Get('applications')
  list(@CurrentCustomer() caller: CustomerCaller) {
    return this.applications.list(caller.customer);
  }

  @Post('applications')
  create(@CurrentCustomer() caller: CustomerCaller, @Body() body: ApplicationDto) {
    return this.applications.create(caller.customer, body);
  }

  @Get('applications/:id')
  get(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string) {
    return this.applications.get(caller.customer, id);
  }

  @Patch('applications/:id')
  update(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string, @Body() body: ApplicationDto) {
    return this.applications.update(caller.customer, id, body);
  }

  @Post('applications/:id/photos/uploads')
  startPhoto(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string, @Body() body: PhotoUploadDto) {
    return this.applications.startPhoto(caller.customer, id, body);
  }

  @Post('applications/:id/photos')
  @HttpCode(HttpStatus.OK)
  addPhoto(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string, @Body() body: PhotoDto) {
    return this.applications.addPhoto(caller.customer, id, body.media_id, body.kind);
  }

  @Delete('applications/:id/photos/:photo')
  removePhoto(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string, @Param('photo', ParseUUIDPipe) photo: string) {
    return this.applications.removePhoto(caller.customer, id, photo);
  }

  @Post('applications/:id/submit')
  @HttpCode(HttpStatus.OK)
  submit(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string, @Body() body: SubmitDto) {
    return this.applications.submit(caller.customer, id, body.expected_deposit);
  }

  @Post('applications/:id/withdraw')
  @HttpCode(HttpStatus.OK)
  withdraw(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string) {
    return this.applications.withdraw(caller.customer, id);
  }

  @Post('applications/:id/visit/confirm')
  @HttpCode(HttpStatus.OK)
  confirmVisit(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string) {
    return this.applications.confirmVisit(caller.customer, id);
  }

  @Post('applications/:id/visit/reschedule')
  @HttpCode(HttpStatus.OK)
  rescheduleVisit(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string, @Body() body: NoteDto) {
    return this.applications.rescheduleVisit(caller.customer, id, body.note);
  }
}

/** Udozo's team: applications, visitors, the states Connect is open in, each market's deposit, and centres. */
@ApiExcludeController()
@RealmOnly('admin')
@AdminRoles('support', 'operations', 'finance')
@Controller('admin/connect')
@ProductOnly('udozo')
export class AdminConnectController {
  constructor(
    private readonly applications: ConnectApplicationsService,
    private readonly admin: ConnectAdminService,
  ) {}

  @Get('applications')
  list(@Query() query: AdminListDto) {
    return this.applications.adminList(query);
  }

  @Get('applications/:id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.applications.adminGet(id);
  }

  @Post('applications/:id/request-changes')
  @HttpCode(HttpStatus.OK)
  @AdminRoles('operations')
  requestChanges(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: NoteDto) {
    return this.applications.requestChanges(adminId(caller), id, body.note);
  }

  @Post('applications/:id/visit')
  @HttpCode(HttpStatus.OK)
  @AdminRoles('operations')
  scheduleVisit(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: VisitDto) {
    return this.applications.scheduleVisit(adminId(caller), id, body);
  }

  @Post('applications/:id/visit/result')
  @HttpCode(HttpStatus.OK)
  @AdminRoles('operations')
  recordVisit(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: VisitResultDto) {
    return this.applications.recordVisit(adminId(caller), id, body);
  }

  @Post('applications/:id/approve')
  @HttpCode(HttpStatus.OK)
  @AdminRoles('operations')
  approve(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string) {
    return this.applications.approve(adminId(caller), id);
  }

  @Post('applications/:id/reject')
  @HttpCode(HttpStatus.OK)
  @AdminRoles('operations')
  reject(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: ReasonDto) {
    return this.applications.reject(adminId(caller), id, body.reason);
  }

  @Get('visitors')
  visitors(@Query() query: CountryDto) {
    return this.admin.visitors(query.country);
  }

  @Post('visitors')
  @AdminRoles('operations')
  createVisitor(@CurrentCaller() caller: Caller, @Body() body: VisitorDto) {
    return this.admin.createVisitor(adminId(caller), body);
  }

  @Patch('visitors/:id')
  @AdminRoles('operations')
  updateVisitor(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: VisitorDto) {
    return this.admin.updateVisitor(adminId(caller), id, body);
  }

  @Get('states/:country')
  states(@Param('country') country: string) {
    return this.admin.states(country);
  }

  @Put('states/:state')
  @AdminRoles('operations')
  setState(@CurrentCaller() caller: Caller, @Param('state', ParseUUIDPipe) state: string, @Body() body: StateDto) {
    return this.admin.setState(adminId(caller), state, body.enabled);
  }

  @Get('settings/:country')
  settings(@Param('country') country: string) {
    return this.admin.settings(country);
  }

  @Put('settings/:country')
  @AdminRoles('finance')
  @StepUp()
  setSettings(@CurrentCaller() caller: Caller, @Param('country') country: string, @Body() body: SettingsDto) {
    return this.admin.setSettings(adminId(caller), country, body);
  }

  @Get('centres')
  centres(@Query() query: CentresDto) {
    return this.admin.centres(query);
  }
}
