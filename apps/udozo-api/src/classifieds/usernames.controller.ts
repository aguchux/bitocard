import { Body, Controller, Get, HttpCode, HttpStatus, Put, Post, Query, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';
import { Public } from '../auth/caller.js';
import { AllowPhonePending, CurrentCustomer, type CustomerCaller, CustomerGuard } from '../customers/customer-session.js';
import { ProductOnly } from '../products/product.js';
import { UsernamesService } from './usernames.service.js';

/** What was typed, in any case: its form is checked by the service, so a bad one is `username_invalid`. */
class UsernameDto {
  @IsString() @Length(1, 60)
  username: string;
}

/**
 * Udozo: the customer's username (docs/UDOZO_USERNAMES_PLAN.md), their seller page's address once they have posted
 * the market's minimum of ads. Part of the account's own steps, so it works before the mobile number is confirmed.
 */
@ApiExcludeController()
@Public()
@UseGuards(CustomerGuard)
@AllowPhonePending()
@Controller('store/account/username')
@ProductOnly('udozo')
export class UsernamesController {
  constructor(private readonly usernames: UsernamesService) {}

  @Get()
  status(@CurrentCustomer() caller: CustomerCaller) {
    return this.usernames.status(caller.customer.id);
  }

  /** Whether a username is free, why not, and up to three free ones like it (30 checks a minute). */
  @Get('availability')
  availability(@CurrentCustomer() caller: CustomerCaller, @Query() query: UsernameDto) {
    return this.usernames.availability(caller.customer.id, query.username);
  }

  @Put()
  set(@CurrentCustomer() caller: CustomerCaller, @Body() body: UsernameDto) {
    return this.usernames.set(caller.customer.id, body.username);
  }

  /** "Not now" on the banner asking them to choose one: after three it stops asking. */
  @Post('prompt/dismiss')
  @HttpCode(HttpStatus.OK)
  dismiss(@CurrentCustomer() caller: CustomerCaller) {
    return this.usernames.dismissPrompt(caller.customer.id);
  }
}
