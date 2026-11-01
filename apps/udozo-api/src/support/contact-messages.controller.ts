import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsEmail, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, Min, ValidateIf } from 'class-validator';
import type { Request } from 'express';
import { AdminRoles, type Caller, CurrentCaller, Public, RealmOnly } from '../auth/caller.js';
import { adminId } from '../countries/countries.controller.js';
import { customerFor } from '../customers/customer-session.js';
import { CustomersService } from '../customers/customers.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { ProductOnly } from '../products/product.js';
import { type ContactKind, contactKinds, ContactMessagesService, type ContactStatus, contactStatuses } from './contact-messages.service.js';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const upper = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toUpperCase() : value);

class ContactDto {
  @IsIn(contactKinds)
  kind: ContactKind;

  @Transform(trim) @IsString() @Length(2, 120)
  name: string;

  @Transform(trim) @IsEmail() @Length(3, 254)
  email: string;

  /** Optional: digits, spaces, brackets, hyphens and a leading +. */
  @IsOptional() @Transform(trim) @ValidateIf((_, value) => value !== '') @Matches(/^\+?[\d\s()-]{6,24}$/, { message: 'Enter a phone number, or leave it empty.' })
  phone?: string;

  @Transform(trim) @IsString() @Length(10, 3000)
  body: string;

  @IsOptional() @Transform(upper) @Matches(/^[A-Z]{2}$/)
  country?: string;
}

/** udozo.com's Contact us form, for anyone; a signed-in sender's account is linked to the message. */
@ApiExcludeController()
@Controller('contact-messages')
@ProductOnly('udozo')
export class ContactMessagesController {
  constructor(
    private readonly contact: ContactMessagesService,
    private readonly customers: CustomersService,
  ) {}

  @Public()
  @Post()
  async submit(@Body() body: ContactDto, @Req() req: Request) {
    const session = await customerFor(this.customers, req).catch(() => null);
    return this.contact.submit(body, session?.customer.id ?? null);
  }
}

class ListDto {
  @IsOptional() @IsIn([...contactStatuses, 'active'])
  status?: ContactStatus | 'active';

  @IsOptional() @IsIn(contactKinds)
  kind?: ContactKind;

  /** me, none (unassigned) or an admin's id. */
  @IsOptional() @IsString() @Length(2, 36)
  assignee?: string;

  @IsOptional() @Transform(trim) @IsString() @Length(1, 100)
  q?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  offset?: number;
}

class EntryDto {
  @Transform(trim) @IsString() @Length(1, 5000)
  body: string;
}

class UpdateDto {
  @IsOptional() @IsIn(contactStatuses)
  status?: ContactStatus;

  @IsOptional() @ValidateIf((_, value) => value !== null) @IsUUID()
  assignee_id?: string | null;
}

/** Udozo's support team works Contact us messages: every one, its status and assignee, replies by email and notes. */
@ApiExcludeController()
@RealmOnly('admin')
@AdminRoles('support', 'operations')
@Controller('admin/support/contact-messages')
@ProductOnly('udozo')
export class AdminContactMessagesController {
  constructor(
    private readonly contact: ContactMessagesService,
    private readonly prisma: PrismaService,
  ) {}

  private async author(caller: Caller) {
    const id = adminId(caller);
    const user = id ? await this.prisma.user.findUnique({ where: { id }, select: { name: true } }) : null;
    return { id, name: user?.name ?? 'The Udozo team' };
  }

  @Get()
  list(@Query() query: ListDto, @CurrentCaller() caller: Caller) {
    return this.contact.list({ ...query, assignee: query.assignee === 'me' ? (adminId(caller) ?? undefined) : query.assignee });
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.contact.get(id);
  }

  @Patch(':id')
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateDto, @CurrentCaller() caller: Caller) {
    return this.contact.update(id, await this.author(caller), body);
  }

  @Post(':id/replies')
  async reply(@Param('id', ParseUUIDPipe) id: string, @Body() body: EntryDto, @CurrentCaller() caller: Caller) {
    return this.contact.reply(id, await this.author(caller), body.body);
  }

  @Post(':id/notes')
  async note(@Param('id', ParseUUIDPipe) id: string, @Body() body: EntryDto, @CurrentCaller() caller: Caller) {
    return this.contact.note(id, await this.author(caller), body.body);
  }
}
