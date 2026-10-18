import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { AdminRoles, type Caller, CurrentCaller, Public, RealmOnly, resellerOf, Roles, SessionOnly } from '../auth/caller.js';
import { SkipIdempotency } from '../common/idempotency/idempotency.interceptor.js';
import { CurrentCustomer, type CustomerCaller, CustomerGuard } from '../customers/customer-session.js';
import { PrismaService } from '../database/prisma.service.js';
import type { LedgerMode } from '../generated/prisma/client.js';
import { Mode } from '../ledger/mode.js';
import { PageDto } from '../ledger/wallet.controller.js';
import { type ChatAuthor, type ChatStatus, chatStatuses, ChatsService, maxChatMessage } from './chats.service.js';
import { type TicketCategory, ticketCategories } from './tickets.service.js';

class ChatMessageDto {
  @IsString() @Length(1, maxChatMessage)
  body: string;
}

class AfterDto {
  @IsOptional() @IsUUID()
  after?: string;
}

class ChatFilterDto extends PageDto {
  @IsOptional() @IsIn(chatStatuses)
  status?: ChatStatus;
}

class ChatTicketDto {
  @IsString() @Length(3, 200)
  subject: string;

  @IsIn(ticketCategories)
  category: TicketCategory;
}

async function authorOf(prisma: PrismaService, caller: Caller, kind: 'reseller' | 'bitocard'): Promise<ChatAuthor> {
  if (caller.kind !== 'session') return { kind, id: null, name: null };
  const user = await prisma.user.findUnique({ where: { id: caller.userId }, select: { name: true } });
  return { kind, id: caller.userId, name: user?.name ?? null };
}

/**
 * A store customer's live chat with their store (hosted stores; the store's server sends the session). Polled:
 * `GET …/:id/messages?after=<message id>`. Writes skip idempotency: a chat message repeated by a retry is harmless and
 * the store's server sends each once.
 */
@ApiExcludeController()
@Public()
@UseGuards(CustomerGuard)
@Controller('store/support/chat')
export class CustomerChatController {
  constructor(private readonly chats: ChatsService) {}

  @Get()
  async current(@CurrentCustomer() caller: CustomerCaller) {
    return { object: 'support_chat_current' as const, chat: await this.chats.currentForCustomer(caller.customer) };
  }

  @Post('messages')
  @SkipIdempotency()
  send(@CurrentCustomer() caller: CustomerCaller, @Body() body: ChatMessageDto) {
    return this.chats.sendAsCustomer(caller.customer, body.body);
  }

  @Get(':id/messages')
  messages(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string, @Query() query: AfterDto) {
    return this.chats.messagesForCustomer(caller.customer, id, query.after);
  }

  @Post(':id/close')
  @HttpCode(HttpStatus.OK)
  @SkipIdempotency()
  close(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string) {
    return this.chats.closeAsCustomer(caller.customer, id);
  }
}

/** The store's chat inbox in SHQ: its customers' chats. */
@ApiExcludeController()
@SessionOnly()
@Roles('admin', 'support')
@Controller('support/chats')
export class ChatsController {
  constructor(
    private readonly chats: ChatsService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  list(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Query() filter: ChatFilterDto) {
    return this.chats.listForReseller(resellerOf(caller), mode, filter);
  }

  @Get(':id')
  get(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Param('id', ParseUUIDPipe) id: string) {
    return this.chats.getForReseller(resellerOf(caller), mode, id);
  }

  @Get(':id/messages')
  messages(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Param('id', ParseUUIDPipe) id: string, @Query() query: AfterDto) {
    return this.chats.messagesForReseller(resellerOf(caller), mode, id, query.after);
  }

  @Post(':id/messages')
  @SkipIdempotency()
  async reply(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Param('id', ParseUUIDPipe) id: string, @Body() body: ChatMessageDto) {
    return this.chats.replyAsReseller(resellerOf(caller), mode, id, await authorOf(this.prisma, caller, 'reseller'), body.body);
  }

  @Post(':id/take')
  @HttpCode(HttpStatus.OK)
  @SkipIdempotency()
  async take(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Param('id', ParseUUIDPipe) id: string) {
    return this.chats.takeAsReseller(resellerOf(caller), mode, id, await authorOf(this.prisma, caller, 'reseller'));
  }

  @Post(':id/close')
  @HttpCode(HttpStatus.OK)
  @SkipIdempotency()
  async close(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Param('id', ParseUUIDPipe) id: string) {
    return this.chats.closeAsReseller(resellerOf(caller), mode, id, await authorOf(this.prisma, caller, 'reseller'));
  }

  @Post(':id/ticket')
  @HttpCode(HttpStatus.OK)
  ticket(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Param('id', ParseUUIDPipe) id: string, @Body() body: ChatTicketDto) {
    return this.chats.ticketAsReseller(resellerOf(caller), mode, id, body);
  }
}

/** A reseller's team chatting with BitoCard in SHQ: any member can ask. */
@ApiExcludeController()
@SessionOnly()
@Controller('support/bitocard-chat')
export class BitocardChatController {
  constructor(
    private readonly chats: ChatsService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  async current(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode) {
    return { object: 'support_chat_current' as const, chat: await this.chats.currentForReseller(resellerOf(caller), mode) };
  }

  @Post('messages')
  @SkipIdempotency()
  async send(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Body() body: ChatMessageDto) {
    return this.chats.sendAsReseller(resellerOf(caller), mode, await authorOf(this.prisma, caller, 'reseller'), body.body);
  }

  @Get(':id/messages')
  messages(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Param('id', ParseUUIDPipe) id: string, @Query() query: AfterDto) {
    return this.chats.messagesForReseller(resellerOf(caller), mode, id, query.after);
  }

  @Post(':id/close')
  @HttpCode(HttpStatus.OK)
  @SkipIdempotency()
  async close(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Param('id', ParseUUIDPipe) id: string) {
    return this.chats.closeAsReseller(resellerOf(caller), mode, id, await authorOf(this.prisma, caller, 'reseller'));
  }
}

/** Admin: BitoCard's chats (resellers' teams, and bitocard.com's customers). */
@ApiExcludeController()
@RealmOnly('admin')
@AdminRoles('support', 'operations')
@Controller('admin/support/chats')
export class AdminChatsController {
  constructor(
    private readonly chats: ChatsService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  list(@Query() filter: ChatFilterDto) {
    return this.chats.listForAdmin(filter);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.chats.getForAdmin(id);
  }

  @Get(':id/messages')
  messages(@Param('id', ParseUUIDPipe) id: string, @Query() query: AfterDto) {
    return this.chats.messagesForAdmin(id, query.after);
  }

  @Post(':id/messages')
  @SkipIdempotency()
  async reply(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: ChatMessageDto) {
    return this.chats.replyAsAdmin(id, await authorOf(this.prisma, caller, 'bitocard'), body.body);
  }

  @Post(':id/take')
  @HttpCode(HttpStatus.OK)
  @SkipIdempotency()
  async take(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string) {
    return this.chats.takeAsAdmin(id, await authorOf(this.prisma, caller, 'bitocard'));
  }

  @Post(':id/close')
  @HttpCode(HttpStatus.OK)
  @SkipIdempotency()
  close(@Param('id', ParseUUIDPipe) id: string) {
    return this.chats.closeAsAdmin(id);
  }

  @Post(':id/ticket')
  @HttpCode(HttpStatus.OK)
  ticket(@Param('id', ParseUUIDPipe) id: string, @Body() body: ChatTicketDto) {
    return this.chats.ticketAsAdmin(id, body);
  }
}
