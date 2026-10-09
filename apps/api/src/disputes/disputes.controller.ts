import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeController, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, Min } from 'class-validator';
import { AdminRoles, type Caller, CurrentCaller, Public, RealmOnly, resellerOf, Roles, Scopes } from '../auth/caller.js';
import { adminId } from '../countries/countries.controller.js';
import { CurrentCustomer, type CustomerCaller, CustomerGuard } from '../customers/customer-session.js';
import { PrismaService } from '../database/prisma.service.js';
import type { LedgerMode } from '../generated/prisma/client.js';
import { Mode } from '../ledger/mode.js';
import { modeHeader, PageDto } from '../ledger/wallet.controller.js';
import {
  type DisputeAction,
  disputeActions,
  type DisputeKind,
  disputeKinds,
  DisputesService,
  type DisputeStatus,
  disputeStatuses,
  type DisputeTopic,
  disputeTopics,
  type MessageVisibility,
  messageVisibilities,
} from './disputes.service.js';

class DisputeFilterDto extends PageDto {
  @ApiPropertyOptional({ enum: disputeStatuses, description: '`open` (with you), `escalated` (with BitoCard), `contested` (BitoCard is contesting a chargeback) or `resolved`.' })
  @IsOptional() @IsIn(disputeStatuses)
  status?: DisputeStatus;

  @ApiPropertyOptional({ enum: disputeKinds, description: '`customer`, `reseller` (yours with BitoCard) or `chargeback`.' })
  @IsOptional() @IsIn(disputeKinds)
  kind?: DisputeKind;
}

class OpenDisputeDto {
  @ApiProperty({ enum: ['customer', 'reseller'], description: '`customer`: a customer’s dispute for you to investigate. `reseller`: your own dispute with BitoCard (it goes to BitoCard at once).' })
  @IsIn(['customer', 'reseller'])
  kind: 'customer' | 'reseller';

  @ApiProperty({ enum: disputeTopics, description: 'What it is about: `order`, `payment`, `funding` (a wallet top-up), `trade` or `other`.' })
  @IsIn(disputeTopics)
  topic: DisputeTopic;

  @ApiProperty({ description: 'A short summary.', minLength: 3, maxLength: 200 })
  @IsString() @Length(3, 200)
  subject: string;

  @ApiProperty({ description: 'What happened: the first message on the dispute.', minLength: 3, maxLength: 5000 })
  @IsString() @Length(3, 5000)
  message: string;

  @ApiPropertyOptional({ description: 'The order it is about.' })
  @IsOptional() @IsUUID()
  order_id?: string;

  @ApiPropertyOptional({ description: 'The wallet top-up it is about.' })
  @IsOptional() @IsUUID()
  top_up_id?: string;

  @ApiPropertyOptional({ description: 'Your own reference for the customer (customer disputes).', maxLength: 200 })
  @IsOptional() @IsString() @Length(1, 200)
  customer_reference?: string;
}

class MessageDto {
  @ApiProperty({ description: 'The message.', minLength: 1, maxLength: 5000 })
  @IsString() @Length(1, 5000)
  body: string;

  @ApiPropertyOptional({ enum: messageVisibilities, default: 'all', description: '`all`: everyone on the dispute, the customer too. `staff`: you and BitoCard only.' })
  @IsOptional() @IsIn(messageVisibilities)
  visibility?: MessageVisibility;
}

class EscalateDto {
  @ApiProperty({
    enum: disputeActions,
    description: 'What you recommend BitoCard does: `refund_customer`, `credit_reseller`, `reject`, `contest_chargeback` or `accept_chargeback`.',
  })
  @IsIn(disputeActions)
  recommendation: DisputeAction;

  @ApiPropertyOptional({ description: 'For `credit_reseller`: how much, in minor units of the dispute currency.', minimum: 1 })
  @IsOptional() @IsInt() @Min(1) @Max(Number.MAX_SAFE_INTEGER)
  amount?: number;

  @ApiProperty({ description: 'Your report: what you found and why you recommend it.', minLength: 10, maxLength: 10000 })
  @IsString() @Length(10, 10000)
  report: string;
}

class ResolveDto {
  @ApiProperty({ description: 'How you resolved it: sent to the customer as the last message.', minLength: 3, maxLength: 5000 })
  @IsString() @Length(3, 5000)
  note: string;
}

class CustomerOpenDto {
  @IsUUID()
  checkout_id: string;

  @IsString() @Length(3, 200)
  subject: string;

  @IsString() @Length(3, 5000)
  message: string;
}

class CustomerMessageDto {
  @IsString() @Length(1, 5000)
  body: string;
}

class AdminFilterDto extends DisputeFilterDto {
  @IsOptional() @IsUUID()
  reseller_id?: string;
}

class ExecuteDto {
  @IsIn(disputeActions)
  action: DisputeAction;

  @IsOptional() @IsInt() @Min(1) @Max(Number.MAX_SAFE_INTEGER)
  amount?: number;

  @IsString() @Length(3, 5000)
  note: string;
}

class ReturnDto {
  @IsString() @Length(3, 5000)
  note: string;
}

/** Who wrote it: a person's name from their session; an API key writes as the store. */
async function authorOf(prisma: PrismaService, caller: Caller, kind: 'reseller' | 'bitocard') {
  if (caller.kind !== 'session') return { kind, id: null, name: null };
  const user = await prisma.user.findUnique({ where: { id: caller.userId }, select: { name: true } });
  return { kind, id: caller.userId, name: user?.name ?? null };
}

@ApiTags('Disputes')
@ApiBearerAuth()
@modeHeader
@Roles('admin', 'support', 'finance')
@Controller('disputes')
export class DisputesController {
  constructor(
    private readonly disputes: DisputesService,
    private readonly prisma: PrismaService,
  ) {}

  @ApiOperation({ summary: 'List disputes', description: 'Your customers’ disputes, your own disputes with BitoCard and chargebacks, newest first.' })
  @Scopes('disputes:read')
  @Get()
  list(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Query() filter: DisputeFilterDto) {
    return this.disputes.listForReseller(resellerOf(caller), mode, filter);
  }

  @ApiOperation({
    summary: 'Open a dispute',
    description:
      'Log a customer’s dispute to investigate (for example one raised with you on your own systems), or open your own dispute with BitoCard (`kind: reseller`), which goes to BitoCard at once. Disputes about funding, payments and trades are investigated by you first and escalated to BitoCard with your report and recommendation.',
  })
  @Scopes('disputes:write')
  @Post()
  async open(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Body() body: OpenDisputeDto) {
    return this.disputes.openForReseller(resellerOf(caller), mode, await authorOf(this.prisma, caller, 'reseller'), body);
  }

  @ApiOperation({ summary: 'Get a dispute', description: 'With every message, staff notes included.' })
  @Scopes('disputes:read')
  @Get(':id')
  get(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Param('id', ParseUUIDPipe) id: string) {
    return this.disputes.getForReseller(resellerOf(caller), mode, id);
  }

  @ApiOperation({ summary: 'Add a message', description: 'Answer the customer (`visibility: all`) or add a note only you and BitoCard see (`staff`).' })
  @Scopes('disputes:write')
  @Post(':id/messages')
  async reply(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Param('id', ParseUUIDPipe) id: string, @Body() body: MessageDto) {
    return this.disputes.replyAsReseller(resellerOf(caller), mode, id, await authorOf(this.prisma, caller, 'reseller'), body);
  }

  @ApiOperation({
    summary: 'Escalate a dispute to BitoCard',
    description: 'Hand a dispute you have investigated to BitoCard with your report and what you recommend it does. BitoCard decides and executes; it may send it back to you for more.',
  })
  @Scopes('disputes:write')
  @Post(':id/escalate')
  @HttpCode(HttpStatus.OK)
  async escalate(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Param('id', ParseUUIDPipe) id: string, @Body() body: EscalateDto) {
    return this.disputes.escalate(resellerOf(caller), mode, id, await authorOf(this.prisma, caller, 'reseller'), body);
  }

  @ApiOperation({
    summary: 'Resolve a customer dispute',
    description: 'Close a customer’s dispute you settled yourself, with a note to the customer. Nothing moves money: anything BitoCard must execute (a refund, a credit) is escalated instead. Chargebacks and your own disputes are BitoCard’s to decide.',
  })
  @Scopes('disputes:write')
  @Post(':id/resolve')
  @HttpCode(HttpStatus.OK)
  async resolve(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Param('id', ParseUUIDPipe) id: string, @Body() body: ResolveDto) {
    return this.disputes.resolveAsReseller(resellerOf(caller), mode, id, await authorOf(this.prisma, caller, 'reseller'), body);
  }
}

/** Store customers' disputes about their own orders (hosted stores; the store's server sends the customer's session). */
@ApiExcludeController()
@Public()
@UseGuards(CustomerGuard)
@Controller('store/account/disputes')
export class CustomerDisputesController {
  constructor(private readonly disputes: DisputesService) {}

  @Get()
  list(@CurrentCustomer() caller: CustomerCaller, @Query() page: PageDto) {
    return this.disputes.listForCustomer(caller.customer, page);
  }

  @Post()
  open(@CurrentCustomer() caller: CustomerCaller, @Body() body: CustomerOpenDto) {
    return this.disputes.openForCustomer(caller.customer, body);
  }

  @Get(':id')
  get(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string) {
    return this.disputes.getForCustomer(caller.customer, id);
  }

  @Post(':id/messages')
  reply(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string, @Body() body: CustomerMessageDto) {
    return this.disputes.replyAsCustomer(caller.customer, id, body.body);
  }
}

/** Admin: escalated disputes and BitoCard's decisions. Money actions need finance; every decision is audited. */
@ApiExcludeController()
@RealmOnly('admin')
@AdminRoles('support', 'operations', 'finance')
@Controller('admin/disputes')
export class AdminDisputesController {
  constructor(
    private readonly disputes: DisputesService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  list(@Query() filter: AdminFilterDto) {
    return this.disputes.listForAdmin(filter);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.disputes.getForAdmin(id);
  }

  @Post(':id/messages')
  async reply(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: MessageDto) {
    return this.disputes.replyAsAdmin(id, await authorOf(this.prisma, caller, 'bitocard'), body);
  }

  @Post(':id/return')
  @HttpCode(HttpStatus.OK)
  async returnToReseller(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: ReturnDto) {
    return this.disputes.returnToReseller(adminId(caller), id, await authorOf(this.prisma, caller, 'bitocard'), body.note);
  }

  @Post(':id/execute')
  @HttpCode(HttpStatus.OK)
  async execute(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: ExecuteDto) {
    const author = await authorOf(this.prisma, caller, 'bitocard');
    const roles = caller.kind === 'session' ? caller.adminRoles : [];
    return this.disputes.execute({ id: adminId(caller), name: author.name, finance: roles.includes('finance') || roles.includes('super_admin') }, id, body);
  }
}
