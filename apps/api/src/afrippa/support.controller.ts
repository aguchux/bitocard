import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, Req, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { ApiExcludeController } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBase64, IsEmail, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { AdminRoles, type Caller, CurrentCaller, Public, RealmOnly } from '../auth/caller.js';
import { ApiError } from '../common/errors/api-error.js';
import { adminId } from '../countries/countries.controller.js';
import { afrippaStoreId } from './ids.js';
import { CurrentCustomer, type CustomerCaller, CustomerGuard } from '../customers/customer-session.js';
import { PrismaService } from '../database/prisma.service.js';
import { SkipIdempotency } from '../common/idempotency/idempotency.interceptor.js';
import { maxDocumentBytes } from '../kyc/files.js';
import { type ChatAuthor, type ChatStatus, chatStatuses, ChatsService, type ChatUpload, maxChatMessage, visitorHeader } from '../support/chats.service.js';
import { sendFile } from '../support/chats.controller.js';
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

class VisitorStartDto {
  @IsString() @Length(1, 80)
  name: string;

  @IsEmail() @MaxLength(254)
  email: string;

  @IsString() @Length(1, maxChatMessage)
  body: string;
}

class ChatBodyDto {
  @IsString() @Length(1, maxChatMessage)
  body: string;
}

/** A file from Afrippa's site: base64 inside the signed JSON, so its server signs the file with the request. */
class TraderChatFileDto {
  @IsString() @Length(1, 200)
  file_name: string;

  @IsIn(['image/jpeg', 'image/png', 'application/pdf'])
  content_type: string;

  /** The file, base64 (4 MB at most once decoded). */
  @IsBase64() @MaxLength(5_600_000)
  data: string;

  @IsOptional() @IsString() @MaxLength(maxChatMessage)
  body?: string;
}

class ChatAfterDto {
  @IsOptional() @IsUUID()
  after?: string;
}

class ChatListDto {
  @IsOptional() @IsIn(chatStatuses)
  status?: ChatStatus;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit?: number;

  @IsOptional() @IsUUID()
  starting_after?: string;
}

class ChatCaptionDto {
  @IsOptional() @IsString() @MaxLength(maxChatMessage)
  body?: string;
}

class ChatToTicketDto {
  @IsString() @Length(3, 200)
  subject: string;

  @IsIn(ticketCategories)
  category: TicketCategory;
}

const chatUpload = FileInterceptor('file', { limits: { fileSize: maxDocumentBytes + 1, files: 1, fields: 2 } });

/**
 * A trader's live chat with Afrippa's team on afrippa.com: their one open chat, polled for new messages, photos and
 * PDFs sealed in Afrippa's own private bucket. Under `/v1/afrippa/account`: only Afrippa's signed server, past
 * two-step. Writes skip idempotency, as a repeated chat message is harmless (as for store chats).
 */
@ApiExcludeController()
@Public()
@UseGuards(CustomerGuard)
@Controller('afrippa/account/support/chat')
export class TraderChatController {
  constructor(private readonly chats: ChatsService) {}

  @Get()
  current(@CurrentCustomer() caller: CustomerCaller) {
    return this.chats.currentForCustomer(caller.customer);
  }

  @Post('messages')
  @SkipIdempotency()
  send(@CurrentCustomer() caller: CustomerCaller, @Body() body: ChatBodyDto) {
    return this.chats.sendAsCustomer(caller.customer, body.body);
  }

  @Post('attachments')
  @SkipIdempotency()
  attach(@CurrentCustomer() caller: CustomerCaller, @Body() body: TraderChatFileDto) {
    const buffer = Buffer.from(body.data, 'base64');
    const file: ChatUpload = { buffer, mimetype: body.content_type, size: buffer.length, originalname: body.file_name };
    return this.chats.attachAs({ kind: 'customer', customer: caller.customer }, file, body.body);
  }

  @Get(':id/messages')
  messages(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string, @Query() query: ChatAfterDto) {
    return this.chats.messagesForCustomer(caller.customer, id, query.after);
  }

  @Get(':id/files/:file')
  async file(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string, @Param('file', ParseUUIDPipe) file: string, @Res() res: Response) {
    sendFile(res, await this.chats.fileFor({ kind: 'customer', customer: caller.customer }, id, file));
  }

  @Post(':id/close')
  @HttpCode(HttpStatus.OK)
  @SkipIdempotency()
  close(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string) {
    return this.chats.closeAsCustomer(caller.customer, id);
  }
}

/**
 * A signed-out visitor's chat with Afrippa (afrippa.com, through its signed server): their name, email and first
 * message, then the token returned once, which Afrippa's server keeps in its own cookie and sends as
 * `BitoCard-Chat-Visitor`. Afrippa's team (or its assistant) answers in its own queue; a reply is emailed from Afrippa.
 * Starting is held to the sign-in rate limit per address. Files come as base64 in the signed JSON, as for traders.
 */
@ApiExcludeController()
@Public()
@Controller('afrippa/account/support/visitor-chat')
export class AfrippaVisitorChatController {
  constructor(
    private readonly chats: ChatsService,
    private readonly prisma: PrismaService,
  ) {}

  private store() {
    return this.prisma.store.findUniqueOrThrow({ where: { id: afrippaStoreId }, include: { reseller: { select: { house: true } } } });
  }

  private async as(req: Request) {
    const requester = await this.chats.visitorAt(req.get(visitorHeader), await this.store());
    if (!requester) throw new ApiError(HttpStatus.UNAUTHORIZED, 'authentication_error', 'visitor_unknown', 'Tell us your name and email to chat.');
    return requester;
  }

  @Get()
  async current(@Req() req: Request) {
    const store = await this.store();
    const requester = await this.chats.visitorAt(req.get(visitorHeader), store);
    const [chat, assistant] = await Promise.all([requester ? this.chats.currentFor(requester) : null, this.chats.assistantProfile(store)]);
    return { object: 'support_chat_current' as const, chat, assistant, visitor: requester?.kind === 'visitor' ? { name: requester.visitor.name, email: requester.visitor.email } : null };
  }

  @Post()
  @SkipIdempotency()
  async start(@Req() req: Request, @Body() body: VisitorStartDto) {
    return this.chats.startAsVisitorAt(await this.store(), { token: req.get(visitorHeader), ...body });
  }

  @Post('messages')
  @SkipIdempotency()
  async send(@Req() req: Request, @Body() body: ChatBodyDto) {
    return this.chats.sendAs(await this.as(req), body.body);
  }

  @Post('attachments')
  @SkipIdempotency()
  async attach(@Req() req: Request, @Body() body: TraderChatFileDto) {
    const buffer = Buffer.from(body.data, 'base64');
    const file: ChatUpload = { buffer, mimetype: body.content_type, size: buffer.length, originalname: body.file_name };
    return this.chats.attachAs(await this.as(req), file, body.body);
  }

  @Get(':id/messages')
  async messages(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string, @Query() query: ChatAfterDto) {
    return this.chats.messagesFor(await this.as(req), id, query.after);
  }

  @Get(':id/files/:file')
  async file(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string, @Param('file', ParseUUIDPipe) file: string, @Res() res: Response) {
    sendFile(res, await this.chats.fileFor(await this.as(req), id, file));
  }

  @Post(':id/human')
  @HttpCode(HttpStatus.OK)
  @SkipIdempotency()
  async human(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) {
    return this.chats.askForPersonAs(await this.as(req), id);
  }

  @Post(':id/close')
  @HttpCode(HttpStatus.OK)
  @SkipIdempotency()
  async close(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) {
    return this.chats.closeAs(await this.as(req), id);
  }
}

/** Afrippa's admins answer its traders' chats (support and operations): their own queue only, never BitoCard's. */
@ApiExcludeController()
@RealmOnly('afrippa_admin')
@AdminRoles('support', 'operations')
@Controller('afrippa/admin/support/chats')
export class AfrippaChatsAdminController {
  constructor(
    private readonly chats: ChatsService,
    private readonly prisma: PrismaService,
  ) {}

  /** Traders see "Afrippa"; Afrippa's admins see who wrote. */
  private async author(caller: Caller): Promise<ChatAuthor> {
    const id = adminId(caller);
    const user = id ? await this.prisma.user.findUnique({ where: { id }, select: { name: true } }) : null;
    return { kind: 'afrippa', id, name: user?.name ?? null };
  }

  @Get()
  list(@Query() filter: ChatListDto) {
    return this.chats.listForAdmin(filter, 'afrippa');
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.chats.getForAdmin(id, 'afrippa');
  }

  @Get(':id/messages')
  messages(@Param('id', ParseUUIDPipe) id: string, @Query() query: ChatAfterDto) {
    return this.chats.messagesForAdmin(id, query.after, 'afrippa');
  }

  @Get(':id/files/:file')
  async file(@Param('id', ParseUUIDPipe) id: string, @Param('file', ParseUUIDPipe) file: string, @Res() res: Response) {
    sendFile(res, await this.chats.fileForAdmin(id, file, 'afrippa'));
  }

  @Post(':id/messages')
  @SkipIdempotency()
  async reply(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: ChatBodyDto) {
    return this.chats.replyAsAdmin(id, await this.author(caller), body.body, 'afrippa');
  }

  @Post(':id/attachments')
  @SkipIdempotency()
  @UseInterceptors(chatUpload)
  async attach(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: ChatCaptionDto, @UploadedFile() file?: ChatUpload) {
    return this.chats.attachAsAdmin(id, await this.author(caller), file, body.body, 'afrippa');
  }

  @Post(':id/take')
  @HttpCode(HttpStatus.OK)
  @SkipIdempotency()
  async take(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string) {
    return this.chats.takeAsAdmin(id, await this.author(caller), 'afrippa');
  }

  @Post(':id/close')
  @HttpCode(HttpStatus.OK)
  @SkipIdempotency()
  close(@Param('id', ParseUUIDPipe) id: string) {
    return this.chats.closeAsAdmin(id, 'afrippa');
  }

  @Post(':id/ticket')
  @HttpCode(HttpStatus.OK)
  ticket(@Param('id', ParseUUIDPipe) id: string, @Body() body: ChatToTicketDto) {
    return this.chats.ticketAsAdmin(id, body, 'afrippa');
  }
}
