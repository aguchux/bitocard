import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Length } from 'class-validator';
import { Public } from '../auth/caller.js';
import { CurrentCustomer, type CustomerCaller, CustomerGuard } from '../customers/customer-session.js';
import type { P2pPaymentMethodKind } from '../generated/prisma/client.js';
import { PaymentMethodsService } from './payment-methods.service.js';

class PaymentMethodDto {
  @IsIn(['bank', 'mobile_money', 'named']) kind: P2pPaymentMethodKind;
  @IsString() @Length(3, 3) currency: string;
  @IsOptional() @IsString() @Length(1, 120) bank_name?: string;
  @IsOptional() @IsString() @Length(1, 40) bank_code?: string;
  @IsOptional() @IsString() @Length(1, 40) account_number?: string;
  @IsOptional() @IsString() @Length(1, 60) network?: string;
  @IsOptional() @IsString() @Length(1, 30) phone?: string;
  @IsOptional() @IsString() @Length(1, 40) provider?: string;
  @IsOptional() @IsString() @Length(1, 160) handle?: string;
}

/**
 * A trader's payment methods (docs/CRYPTO_SPINOFF_PLAN.md, step 3 item 1), reached only through Afrippa's signed server
 * (the gate covers `/v1/afrippa/p2p`) with the trader's session, two-step done.
 */
@ApiExcludeController()
@Public()
@UseGuards(CustomerGuard)
@Controller('afrippa/p2p/payment-methods')
export class PaymentMethodsController {
  constructor(private readonly methods: PaymentMethodsService) {}

  @Get()
  list(@CurrentCustomer() caller: CustomerCaller) {
    return this.methods.list(caller.customer);
  }

  @Post()
  add(@CurrentCustomer() caller: CustomerCaller, @Body() body: PaymentMethodDto) {
    return this.methods.add(caller.customer, body);
  }

  @Delete(':id')
  remove(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string) {
    return this.methods.remove(caller.customer, id);
  }
}
