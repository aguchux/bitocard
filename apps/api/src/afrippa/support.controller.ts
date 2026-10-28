import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, Min, ValidateIf } from 'class-validator';
import { AdminRoles, type Caller, CurrentCaller, Public, RealmOnly } from '../auth/caller.js';
import { adminId } from '../countries/countries.controller.js';
import { CurrentCustomer, type CustomerCaller, CustomerGuard } from '../customers/customer-session.js';
import { PrismaService } from '../database/prisma.service.js';
import {
  type TicketAuthor,
  type TicketCategory,
  ticketCategories,
  type TicketPriority,
  ticketPriorities,
  TicketsService,
  type TicketStatus,
  ticketStatuses,
  type TicketVisibility,
  ticketVisibilities,
} from '../support/tickets.service.js';

class TicketPageDto {
  @IsOptional() @IsIn(ticketStatuses)
  status?: TicketStatus;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit?: number;

  @IsOptional() @IsUUID()
  starting_after?: string;
}

class TraderTicketDto {
  @IsString() @Length(3, 200)
  subject: string;

  @IsIn(ticketCategories)
  category: TicketCategory;

  @IsString() @Length(3, 5000)
  message: string;
}

class TraderMessageDto {
  @IsString() @Length(1, 5000)
  body: string;
}

class AfrippaReplyDto {
  @IsString() @Length(1, 5000)
  body: string;

  /** `all`: the trader sees it; `staff`: Afrippa's admins only. */
  @IsOptional() @IsIn(ticketVisibilities)
  visibility?: TicketVisibility;
}

class AfrippaResolveDto {
  @IsOptional() @IsString() @Length(1, 5000)
  note?: string;
}

class AfrippaUpdateDto {
  @IsOptional() @IsIn(ticketPriorities)
  priority?: TicketPriority;

  @IsOptional() @ValidateIf((_object, value) => value !== null) @IsUUID()
  assignee_id?: string | null;
}

/**
 * A trader's help desk on afrippa.com (docs/CRYPTO_SPINOFF_PLAN.md, Instruments lifted): their tickets go to Afrippa's
 * own queue, answered by Afrippa's team, never a store's or BitoCard's. Under `/v1/afrippa/account`: only Afrippa's
 * signed server reaches it, past two-step.
 */
@ApiExcludeController()
@Public()
@UseGuards(CustomerGuard)
@Controller('afrippa/account/support/tickets')
export class TraderTicketsController {
  constructor(private readonly tickets: TicketsService) {}

  @Get()
  list(@CurrentCustomer() caller: CustomerCaller, @Query() filter: TicketPageDto) {
    return this.tickets.listForCustomer(caller.customer, filter);
  }

  @Post()
  open(@CurrentCustomer() caller: CustomerCaller, @Body() body: TraderTicketDto) {
    return this.tickets.openForCustomer(caller.customer, body);
  }

  @Get(':id')
  get(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string) {
    return this.tickets.getForCustomer(caller.customer, id);
  }

  @Post(':id/messages')
  reply(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string, @Body() body: TraderMessageDto) {
    return this.tickets.replyAsCustomer(caller.customer, id, body.body);
  }

  @Post(':id/close')
  @HttpCode(HttpStatus.OK)
  close(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string) {
    return this.tickets.closeAsCustomer(caller.customer, id);
  }
}

/** Afrippa's admins answer its traders' tickets (support and operations), oldest waiting first. */
@ApiExcludeController()
@RealmOnly('afrippa_admin')
@AdminRoles('support', 'operations')
@Controller('afrippa/admin/support/tickets')
export class AfrippaTicketsAdminController {
  constructor(
    private readonly tickets: TicketsService,
    private readonly prisma: PrismaService,
  ) {}

  /** Afrippa's team writes as "Afrippa" to traders (its people's names are for its own admins only). */
  private async author(caller: Caller): Promise<TicketAuthor> {
    const id = adminId(caller);
    const user = id ? await this.prisma.user.findUnique({ where: { id }, select: { name: true } }) : null;
    return { kind: 'afrippa', id, name: user?.name ?? null };
  }

  @Get()
  list(@Query() filter: TicketPageDto) {
    return this.tickets.listForAdmin(filter, 'afrippa');
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.tickets.getForAdmin(id, 'afrippa');
  }

  @Post(':id/messages')
  async reply(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: AfrippaReplyDto) {
    return this.tickets.replyAsAdmin(id, await this.author(caller), body, 'afrippa');
  }

  @Post(':id/resolve')
  @HttpCode(HttpStatus.OK)
  async resolve(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: AfrippaResolveDto) {
    return this.tickets.resolveAsAdmin(adminId(caller), id, await this.author(caller), body, 'afrippa');
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() body: AfrippaUpdateDto) {
    return this.tickets.updateAsAdmin(id, body, 'afrippa');
  }
}
