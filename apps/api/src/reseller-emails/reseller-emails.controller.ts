import { Body, Controller, Get, HttpCode, HttpStatus, Module, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { IsOptional, IsString, Length, Matches } from 'class-validator';
import { AdminRoles, type Caller, CurrentCaller, RealmOnly } from '../auth/caller.js';
import { adminId } from '../countries/countries.controller.js';
import { ProductOnly } from '../products/product.js';
import { ResellerEmailsService } from './reseller-emails.service.js';

class SendResellerEmailDto {
  /** A quick email's key, or `custom`. */
  @IsString() @Matches(/^[a-z_]{2,40}$/) template: string;
  /** A custom email's subject. */
  @IsOptional() @IsString() @Length(3, 150) subject?: string;
  /** A custom email's message, or a personal note added to a quick email. Blank lines start new paragraphs. */
  @IsOptional() @IsString() @Length(0, 5000) message?: string;
}

/** Emails to a reseller's owner from their page in the admin app: quick emails and custom ones. */
@ApiExcludeController()
@ProductOnly('bitocard')
@RealmOnly('admin')
@Controller('admin/resellers/:id/emails')
export class ResellerEmailsController {
  constructor(private readonly emails: ResellerEmailsService) {}

  @AdminRoles('operations', 'support')
  @Get()
  list(@Param('id', ParseUUIDPipe) id: string) {
    return this.emails.overview(id);
  }

  @AdminRoles('operations', 'support')
  @Post()
  @HttpCode(HttpStatus.OK)
  send(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: SendResellerEmailDto) {
    return this.emails.send(adminId(caller), id, body);
  }
}

@Module({ controllers: [ResellerEmailsController], providers: [ResellerEmailsService] })
export class ResellerEmailsModule {}
