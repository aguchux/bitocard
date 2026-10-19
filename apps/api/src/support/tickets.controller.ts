import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeController, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, Length, ValidateIf } from 'class-validator';
import { AdminRoles, type Caller, CurrentCaller, Public, RealmOnly, resellerOf, Roles, Scopes } from '../auth/caller.js';
import { adminId } from '../countries/countries.controller.js';
import { CurrentCustomer, type CustomerCaller, CustomerGuard } from '../customers/customer-session.js';
import { PrismaService } from '../database/prisma.service.js';
import type { LedgerMode } from '../generated/prisma/client.js';
import { Mode } from '../ledger/mode.js';
import { modeHeader, PageDto } from '../ledger/wallet.controller.js';
import {
  type TicketAuthor,
  type TicketCategory,
  ticketCategories,
  type TicketPriority,
  ticketPriorities,
  type TicketQueue,
  ticketQueues,
  presentTicket,
  TicketsService,
  type TicketStatus,
  ticketStatuses,
  type TicketVisibility,
  ticketVisibilities,
} from './tickets.service.js';

class TicketFilterDto extends PageDto {
  @ApiPropertyOptional({ enum: ticketStatuses, description: '`open` (waiting for whoever answers), `pending` (waiting for the requester) or `resolved`.' })
  @IsOptional() @IsIn(ticketStatuses)
  status?: TicketStatus;

  @ApiPropertyOptional({ enum: ticketQueues, description: 'Who answers: `reseller` (you) or `bitocard`.' })
  @IsOptional() @IsIn(ticketQueues)
  queue?: TicketQueue;

  @ApiPropertyOptional({ enum: ['customer', 'reseller'], description: '`customer` (your customers’ tickets) or `reseller` (yours to BitoCard).' })
  @IsOptional() @IsIn(['customer', 'reseller'])
  requester?: 'customer' | 'reseller';
}

class OpenTicketDto {
  @ApiProperty({ enum: ['reseller', 'customer'], description: '`reseller`: your own question to BitoCard (BitoCard answers). `customer`: a ticket for one of your customers to track and answer (you can pass it to BitoCard).' })
  @IsIn(['reseller', 'customer'])
  requester: 'reseller' | 'customer';

  @ApiProperty({ description: 'A short summary.', minLength: 3, maxLength: 200 })
  @IsString() @Length(3, 200)
  subject: string;

  @ApiProperty({ enum: ticketCategories, description: 'What it is about.' })
  @IsIn(ticketCategories)
  category: TicketCategory;

  @ApiProperty({ description: 'The question: the first message.', minLength: 3, maxLength: 5000 })
  @IsString() @Length(3, 5000)
  message: string;

  @ApiPropertyOptional({ description: 'The order it is about.' })
  @IsOptional() @IsUUID()
  order_id?: string;

  @ApiPropertyOptional({ description: 'Your own reference for the customer (customers’ tickets).', maxLength: 200 })
  @IsOptional() @IsString() @Length(1, 200)
  customer_reference?: string;
}

class TicketMessageDto {
  @ApiProperty({ description: 'The message.', minLength: 1, maxLength: 5000 })
  @IsString() @Length(1, 5000)
  body: string;

  @ApiPropertyOptional({ enum: ticketVisibilities, default: 'all', description: '`all`: the requester sees it too. `staff`: on a customer’s ticket, you and BitoCard only.' })
  @IsOptional() @IsIn(ticketVisibilities)
  visibility?: TicketVisibility;
}

class EscalateTicketDto {
  @ApiProperty({ description: 'For BitoCard: what you found and what the customer needs. The customer does not see it.', minLength: 10, maxLength: 5000 })
  @IsString() @Length(10, 5000)
  note: string;
}

class ResolveTicketDto {
  @ApiPropertyOptional({ description: 'A last message to the requester.', maxLength: 5000 })
  @IsOptional() @IsString() @Length(1, 5000)
  note?: string;
}

class UpdateTicketDto {
  @ApiPropertyOptional({ enum: ticketPriorities })
  @IsOptional() @IsIn(ticketPriorities)
  priority?: TicketPriority;

  @ApiPropertyOptional({ description: 'The team member to assign it to, or null for nobody.', nullable: true })
  @IsOptional() @ValidateIf((_object, value) => value !== null) @IsUUID()
  assignee_id?: string | null;
}

class CustomerOpenTicketDto {
  @IsString() @Length(3, 200)
  subject: string;

  @IsIn(ticketCategories)
  category: TicketCategory;

  @IsString() @Length(3, 5000)
  message: string;

  @IsOptional() @IsUUID()
  checkout_id?: string;
}

class CustomerMessageDto {
  @IsString() @Length(1, 5000)
  body: string;
}

class CustomerFilterDto extends PageDto {
  @IsOptional() @IsIn(ticketStatuses)
  status?: TicketStatus;
}

class AdminTicketFilterDto extends TicketFilterDto {
  @IsOptional() @IsUUID()
  reseller_id?: string;
}

class SendDraftDto {
  @IsOptional() @IsString() @Length(1, 5000)
  body?: string;
}

class ReturnTicketDto {
  @IsString() @Length(3, 5000)
  note: string;
}

/** Who wrote it: a person's name from their session; an API key writes as the store. */
async function authorOf(prisma: PrismaService, caller: Caller, kind: 'reseller' | 'bitocard'): Promise<TicketAuthor> {
  if (caller.kind !== 'session') return { kind, id: null, name: null };
  const user = await prisma.user.findUnique({ where: { id: caller.userId }, select: { name: true } });
  return { kind, id: caller.userId, name: user?.name ?? null };
}

@ApiTags('Support')
@ApiBearerAuth()
@modeHeader
@Roles('admin', 'support')
@Controller('support/tickets')
export class TicketsController {
  constructor(
    private readonly tickets: TicketsService,
    private readonly prisma: PrismaService,
  ) {}

  @ApiOperation({ summary: 'List support tickets', description: 'Your customers’ tickets and your own tickets to BitoCard, most recently active first.' })
  @Scopes('support:read')
  @Get()
  list(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Query() filter: TicketFilterDto) {
    return this.tickets.listForReseller(resellerOf(caller), mode, filter);
  }

  @ApiOperation({
    summary: 'Open a support ticket',
    description: 'Ask BitoCard a question (`requester: reseller`), or log a ticket for one of your customers on your own systems to answer and track (`requester: customer`, with your `customer_reference`). Customers on your hosted store open their own tickets there.',
  })
  @Scopes('support:write')
  @Post()
  async open(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Body() body: OpenTicketDto) {
    return this.tickets.openForReseller(resellerOf(caller), mode, await authorOf(this.prisma, caller, 'reseller'), body, caller.kind === 'session' ? 'form' : 'api');
  }

  @ApiOperation({ summary: 'Get a support ticket', description: 'With its messages: on your customers’ tickets, staff notes included.' })
  @Scopes('support:read')
  @Get(':id')
  get(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Param('id', ParseUUIDPipe) id: string) {
    return this.tickets.getForReseller(resellerOf(caller), mode, id);
  }

  @ApiOperation({
    summary: 'Add a message to a support ticket',
    description: 'Answer the customer (`visibility: all`: waiting for them next), add a note for your team and BitoCard (`staff`), or reply on your own ticket to BitoCard.',
  })
  @Scopes('support:write')
  @Post(':id/messages')
  async reply(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Param('id', ParseUUIDPipe) id: string, @Body() body: TicketMessageDto) {
    return this.tickets.replyAsReseller(resellerOf(caller), mode, id, await authorOf(this.prisma, caller, 'reseller'), body);
  }

  @ApiOperation({ summary: 'Pass a support ticket to BitoCard', description: 'Hand a customer’s ticket you cannot answer to BitoCard, with a note on what you found. BitoCard answers the customer and may send it back to you.' })
  @Scopes('support:write')
  @Post(':id/escalate')
  @HttpCode(HttpStatus.OK)
  async escalate(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Param('id', ParseUUIDPipe) id: string, @Body() body: EscalateTicketDto) {
    return this.tickets.escalate(resellerOf(caller), mode, id, await authorOf(this.prisma, caller, 'reseller'), body);
  }

  @ApiOperation({ summary: 'Resolve a support ticket', description: 'Close a customer’s ticket you answered, or your own ticket once BitoCard has answered it, optionally with a last message. A requester’s reply reopens it.' })
  @Scopes('support:write')
  @Post(':id/resolve')
  @HttpCode(HttpStatus.OK)
  async resolve(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Param('id', ParseUUIDPipe) id: string, @Body() body: ResolveTicketDto) {
    return this.tickets.resolveAsReseller(resellerOf(caller), mode, id, await authorOf(this.prisma, caller, 'reseller'), body);
  }

  @ApiOperation({ summary: 'Send an assistant’s draft', description: 'Send your support assistant’s suggested reply to the customer, as it is or with your changes (`body`).' })
  @Scopes('support:write')
  @Post(':id/drafts/:draft/send')
  @HttpCode(HttpStatus.OK)
  async sendDraft(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Param('id', ParseUUIDPipe) id: string, @Param('draft', ParseUUIDPipe) draft: string, @Body() body: SendDraftDto) {
    return presentTicket(await this.tickets.sendDraft({ resellerId: resellerOf(caller), mode }, id, draft, await authorOf(this.prisma, caller, 'reseller'), body.body), 'reseller');
  }

  @ApiOperation({ summary: 'Discard an assistant’s draft', description: 'Remove your support assistant’s suggested reply without sending it.' })
  @Scopes('support:write')
  @Post(':id/drafts/:draft/discard')
  @HttpCode(HttpStatus.OK)
  async discardDraft(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Param('id', ParseUUIDPipe) id: string, @Param('draft', ParseUUIDPipe) draft: string) {
    return presentTicket(await this.tickets.discardDraft({ resellerId: resellerOf(caller), mode }, id, draft), 'reseller');
  }

  @ApiOperation({ summary: 'Update a support ticket', description: 'Set the priority or the team member a customer’s ticket is assigned to.' })
  @Scopes('support:write')
  @Patch(':id')
  update(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateTicketDto) {
    return this.tickets.updateAsReseller(resellerOf(caller), mode, id, body);
  }
}

/** Store customers' tickets to their store (hosted stores; the store's server sends the customer's session). */
@ApiExcludeController()
@Public()
@UseGuards(CustomerGuard)
@Controller('store/support/tickets')
export class CustomerTicketsController {
  constructor(private readonly tickets: TicketsService) {}

  @Get()
  list(@CurrentCustomer() caller: CustomerCaller, @Query() filter: CustomerFilterDto) {
    return this.tickets.listForCustomer(caller.customer, filter);
  }

  @Post()
  open(@CurrentCustomer() caller: CustomerCaller, @Body() body: CustomerOpenTicketDto) {
    return this.tickets.openForCustomer(caller.customer, body);
  }

  @Get(':id')
  get(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string) {
    return this.tickets.getForCustomer(caller.customer, id);
  }

  @Post(':id/messages')
  reply(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string, @Body() body: CustomerMessageDto) {
    return this.tickets.replyAsCustomer(caller.customer, id, body.body);
  }

  @Post(':id/close')
  @HttpCode(HttpStatus.OK)
  close(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string) {
    return this.tickets.closeAsCustomer(caller.customer, id);
  }
}

/** Admin: BitoCard's support queue (resellers' tickets, passed tickets and bitocard.com's customers). */
@ApiExcludeController()
@RealmOnly('admin')
@AdminRoles('support', 'operations')
@Controller('admin/support/tickets')
export class AdminTicketsController {
  constructor(
    private readonly tickets: TicketsService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  list(@Query() filter: AdminTicketFilterDto) {
    return this.tickets.listForAdmin(filter);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.tickets.getForAdmin(id);
  }

  @Post(':id/messages')
  async reply(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: TicketMessageDto) {
    return this.tickets.replyAsAdmin(id, await authorOf(this.prisma, caller, 'bitocard'), body);
  }

  @Post(':id/return')
  @HttpCode(HttpStatus.OK)
  async returnToReseller(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: ReturnTicketDto) {
    return this.tickets.returnToReseller(adminId(caller), id, await authorOf(this.prisma, caller, 'bitocard'), body.note);
  }

  @Post(':id/resolve')
  @HttpCode(HttpStatus.OK)
  async resolve(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: ResolveTicketDto) {
    return this.tickets.resolveAsAdmin(adminId(caller), id, await authorOf(this.prisma, caller, 'bitocard'), body);
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateTicketDto) {
    return this.tickets.updateAsAdmin(id, body);
  }

  @Post(':id/drafts/:draft/send')
  @HttpCode(HttpStatus.OK)
  async sendDraft(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Param('draft', ParseUUIDPipe) draft: string, @Body() body: SendDraftDto) {
    return presentTicket(await this.tickets.sendDraft({}, id, draft, await authorOf(this.prisma, caller, 'bitocard'), body.body), 'admin');
  }

  @Post(':id/drafts/:draft/discard')
  @HttpCode(HttpStatus.OK)
  async discardDraft(@Param('id', ParseUUIDPipe) id: string, @Param('draft', ParseUUIDPipe) draft: string) {
    return presentTicket(await this.tickets.discardDraft({}, id, draft), 'admin');
  }
}
