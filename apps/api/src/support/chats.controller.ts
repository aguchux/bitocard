import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, Req, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiExcludeController } from '@nestjs/swagger';
import { IsEmail, IsIn, IsOptional, IsString, IsUUID, Length, MaxLength } from 'class-validator';
import type { Request, Response } from 'express';
import { AdminRoles, type Caller, CurrentCaller, Public, RealmOnly, resellerOf, Roles, SessionOnly } from '../auth/caller.js';
import { StoreSellers } from '../checkout/store-sellers.js';
import { ApiError } from '../common/errors/api-error.js';
import { SkipIdempotency } from '../common/idempotency/idempotency.interceptor.js';
import { CurrentCustomer, type CustomerCaller, CustomerGuard } from '../customers/customer-session.js';
import { StoreKey } from '../customers/store-key.js';
import { PrismaService } from '../database/prisma.service.js';
import type { LedgerMode } from '../generated/prisma/client.js';
import { maxDocumentBytes } from '../kyc/files.js';
import { Mode } from '../ledger/mode.js';
import { PageDto } from '../ledger/wallet.controller.js';
import { type ChatAuthor, type ChatStatus, chatStatuses, ChatsService, type ChatUpload, maxChatMessage, type StoreRequester, visitorHeader } from './chats.service.js';
import { type TicketCategory, ticketCategories } from './tickets.service.js';
import { PlanAccessService } from '../plans/plan-access.js';

class ChatMessageDto {
  @IsString() @Length(1, maxChatMessage)
  body: string;
}

/** A file's caption (multipart field), optional. */
class ChatFileDto {
  @IsOptional() @IsString() @MaxLength(maxChatMessage)
  body?: string;
}

class VisitorStartDto {
  @IsString() @Length(1, 80)
  name: string;

  @IsEmail() @MaxLength(254)
  email: string;

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

const upload = FileInterceptor('file', { limits: { fileSize: maxDocumentBytes + 1, files: 1, fields: 2 } });

async function authorOf(prisma: PrismaService, caller: Caller, kind: 'reseller' | 'bitocard'): Promise<ChatAuthor> {
  if (caller.kind !== 'session') return { kind, id: null, name: null };
  const user = await prisma.user.findUnique({ where: { id: caller.userId }, select: { name: true } });
  return { kind, id: caller.userId, name: user?.name ?? null };
}

/** A chat file, never cached, and a PDF opened from here can never run anything. */
function sendFile(res: Response, file: { contentType: string; bytes: Buffer; name: string }) {
  const ascii = file.name.replace(/[^\w.\- ]/g, '_');
  res.set({
    'content-type': file.contentType,
    'content-length': String(file.bytes.length),
    'cache-control': 'no-store, private',
    'content-disposition': `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(file.name)}`,
    'x-content-type-options': 'nosniff',
    'content-security-policy': "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
  });
  res.end(file.bytes);
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

  private static as(caller: CustomerCaller): StoreRequester {
    return { kind: 'customer', customer: caller.customer };
  }

  @Get()
  async current(@CurrentCustomer() caller: CustomerCaller) {
    const [chat, assistant] = await Promise.all([this.chats.currentForCustomer(caller.customer), this.chats.assistantProfile(caller.customer.store)]);
    return { object: 'support_chat_current' as const, chat, assistant };
  }

  /** The customer asks for a person: the assistant stops answering. */
  @Post(':id/human')
  @HttpCode(HttpStatus.OK)
  @SkipIdempotency()
  human(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string) {
    return this.chats.askForPerson(caller.customer, id);
  }

  @Post('messages')
  @SkipIdempotency()
  send(@CurrentCustomer() caller: CustomerCaller, @Body() body: ChatMessageDto) {
    return this.chats.sendAsCustomer(caller.customer, body.body);
  }

  /** A photo or PDF (multipart `file`, optional `body` caption). */
  @Post('attachments')
  @SkipIdempotency()
  @UseInterceptors(upload)
  attach(@CurrentCustomer() caller: CustomerCaller, @Body() body: ChatFileDto, @UploadedFile() file?: ChatUpload) {
    return this.chats.attachAs(CustomerChatController.as(caller), file, body.body);
  }

  @Get(':id/messages')
  messages(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string, @Query() query: AfterDto) {
    return this.chats.messagesForCustomer(caller.customer, id, query.after);
  }

  @Get(':id/files/:file')
  async file(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string, @Param('file', ParseUUIDPipe) file: string, @Res() res: Response) {
    sendFile(res, await this.chats.fileFor(CustomerChatController.as(caller), id, file));
  }

  @Post(':id/close')
  @HttpCode(HttpStatus.OK)
  @SkipIdempotency()
  close(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string) {
    return this.chats.closeAsCustomer(caller.customer, id);
  }
}

/**
 * A signed-out visitor's chat with a store: they give their name and email with their first message, and the store's
 * server keeps the token it gets back in its own cookie, sending it as `BitoCard-Chat-Visitor`. The store answers as it
 * answers its customers. Starting is held to the sign-in rate limit per address.
 */
@ApiExcludeController()
@Public()
@Controller('store/support/visitor-chat')
export class VisitorChatController {
  constructor(
    private readonly chats: ChatsService,
    private readonly sellers: StoreSellers,
  ) {}

  private async as(req: Request, key: string | null) {
    const requester = await this.chats.visitor(req.get(visitorHeader), key);
    if (!requester) throw new ApiError(HttpStatus.UNAUTHORIZED, 'authentication_error', 'visitor_unknown', 'Tell us your name and email to chat.');
    return requester;
  }

  @Get()
  async current(@Req() req: Request, @StoreKey() key: string | null) {
    const requester = await this.chats.visitor(req.get(visitorHeader), key);
    const store = requester?.kind === 'visitor' ? requester.store : await this.sellers.resolve(key);
    const [chat, assistant] = await Promise.all([requester ? this.chats.currentFor(requester) : null, this.chats.assistantProfile(store)]);
    return { object: 'support_chat_current' as const, chat, assistant, visitor: requester?.kind === 'visitor' ? { name: requester.visitor.name, email: requester.visitor.email } : null };
  }

  /** Name, email and the first message. Returns the token once, for a browser that had none. */
  @Post()
  @SkipIdempotency()
  start(@Req() req: Request, @StoreKey() key: string | null, @Body() body: VisitorStartDto) {
    return this.chats.startAsVisitor(key, { token: req.get(visitorHeader), ...body });
  }

  @Post('messages')
  @SkipIdempotency()
  async send(@Req() req: Request, @StoreKey() key: string | null, @Body() body: ChatMessageDto) {
    return this.chats.sendAs(await this.as(req, key), body.body);
  }

  @Post('attachments')
  @SkipIdempotency()
  @UseInterceptors(upload)
  async attach(@Req() req: Request, @StoreKey() key: string | null, @Body() body: ChatFileDto, @UploadedFile() file?: ChatUpload) {
    return this.chats.attachAs(await this.as(req, key), file, body.body);
  }

  @Get(':id/messages')
  async messages(@Req() req: Request, @StoreKey() key: string | null, @Param('id', ParseUUIDPipe) id: string, @Query() query: AfterDto) {
    return this.chats.messagesFor(await this.as(req, key), id, query.after);
  }

  @Get(':id/files/:file')
  async file(@Req() req: Request, @StoreKey() key: string | null, @Param('id', ParseUUIDPipe) id: string, @Param('file', ParseUUIDPipe) file: string, @Res() res: Response) {
    sendFile(res, await this.chats.fileFor(await this.as(req, key), id, file));
  }

  @Post(':id/human')
  @HttpCode(HttpStatus.OK)
  @SkipIdempotency()
  async human(@Req() req: Request, @StoreKey() key: string | null, @Param('id', ParseUUIDPipe) id: string) {
    return this.chats.askForPersonAs(await this.as(req, key), id);
  }

  @Post(':id/close')
  @HttpCode(HttpStatus.OK)
  @SkipIdempotency()
  async close(@Req() req: Request, @StoreKey() key: string | null, @Param('id', ParseUUIDPipe) id: string) {
    return this.chats.closeAs(await this.as(req, key), id);
  }
}

/** The store's chat inbox in SHQ: its customers' and visitors' chats. */
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

  @Get(':id/files/:file')
  async file(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Param('id', ParseUUIDPipe) id: string, @Param('file', ParseUUIDPipe) file: string, @Res() res: Response) {
    sendFile(res, await this.chats.fileForReseller(resellerOf(caller), mode, id, file));
  }

  @Post(':id/messages')
  @SkipIdempotency()
  async reply(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Param('id', ParseUUIDPipe) id: string, @Body() body: ChatMessageDto) {
    return this.chats.replyAsReseller(resellerOf(caller), mode, id, await authorOf(this.prisma, caller, 'reseller'), body.body);
  }

  @Post(':id/attachments')
  @SkipIdempotency()
  @UseInterceptors(upload)
  async attach(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Param('id', ParseUUIDPipe) id: string, @Body() body: ChatFileDto, @UploadedFile() file?: ChatUpload) {
    return this.chats.attachAsStore(resellerOf(caller), mode, id, await authorOf(this.prisma, caller, 'reseller'), file, body.body);
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

/**
 * A reseller's team chatting with BitoCard in SHQ: any member can ask, on a plan with priority support (starting or
 * writing in a chat needs it; reading and closing an earlier one does not).
 */
@ApiExcludeController()
@SessionOnly()
@Controller('support/bitocard-chat')
export class BitocardChatController {
  constructor(
    private readonly chats: ChatsService,
    private readonly prisma: PrismaService,
    private readonly planAccess: PlanAccessService,
  ) {}

  @Get()
  async current(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode) {
    await this.planAccess.require(resellerOf(caller), 'priority_support');
    return { object: 'support_chat_current' as const, chat: await this.chats.currentForReseller(resellerOf(caller), mode) };
  }

  @Post('messages')
  @SkipIdempotency()
  async send(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Body() body: ChatMessageDto) {
    await this.planAccess.require(resellerOf(caller), 'priority_support');
    return this.chats.sendAsReseller(resellerOf(caller), mode, await authorOf(this.prisma, caller, 'reseller'), body.body);
  }

  @Post('attachments')
  @SkipIdempotency()
  @UseInterceptors(upload)
  async attach(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Body() body: ChatFileDto, @UploadedFile() file?: ChatUpload) {
    await this.planAccess.require(resellerOf(caller), 'priority_support');
    return this.chats.attachAsReseller(resellerOf(caller), mode, await authorOf(this.prisma, caller, 'reseller'), file, body.body);
  }

  @Get(':id/messages')
  messages(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Param('id', ParseUUIDPipe) id: string, @Query() query: AfterDto) {
    return this.chats.messagesForReseller(resellerOf(caller), mode, id, query.after);
  }

  @Get(':id/files/:file')
  async file(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Param('id', ParseUUIDPipe) id: string, @Param('file', ParseUUIDPipe) file: string, @Res() res: Response) {
    sendFile(res, await this.chats.fileForReseller(resellerOf(caller), mode, id, file));
  }

  @Post(':id/close')
  @HttpCode(HttpStatus.OK)
  @SkipIdempotency()
  async close(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Param('id', ParseUUIDPipe) id: string) {
    return this.chats.closeAsReseller(resellerOf(caller), mode, id, await authorOf(this.prisma, caller, 'reseller'));
  }
}

/** Admin: BitoCard's chats (resellers' teams, and bitocard.com's customers and visitors). */
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

  @Get(':id/files/:file')
  async file(@Param('id', ParseUUIDPipe) id: string, @Param('file', ParseUUIDPipe) file: string, @Res() res: Response) {
    sendFile(res, await this.chats.fileForAdmin(id, file));
  }

  @Post(':id/messages')
  @SkipIdempotency()
  async reply(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: ChatMessageDto) {
    return this.chats.replyAsAdmin(id, await authorOf(this.prisma, caller, 'bitocard'), body.body);
  }

  @Post(':id/attachments')
  @SkipIdempotency()
  @UseInterceptors(upload)
  async attach(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: ChatFileDto, @UploadedFile() file?: ChatUpload) {
    return this.chats.attachAsAdmin(id, await authorOf(this.prisma, caller, 'bitocard'), file, body.body);
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
