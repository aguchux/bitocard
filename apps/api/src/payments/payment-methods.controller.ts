import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsIn, IsString } from 'class-validator';
import { AdminRoles, type Caller, CurrentCaller, RealmOnly } from '../auth/caller.js';
import { adminId } from '../countries/countries.controller.js';
import { paymentMethodPurposes, PaymentMethodsService } from './payment-methods.service.js';

class SetPaymentMethodsDto {
  @IsIn(paymentMethodPurposes)
  purpose: (typeof paymentMethodPurposes)[number];

  /** The gateways switched on, in the order payers see them; every other gateway is switched off. */
  @IsArray() @ArrayMaxSize(10) @IsString({ each: true })
  enabled: string[];
}

/** Admin: the payment methods each market offers, for wallet top-ups and customer checkout. Changes are audited. */
@ApiExcludeController()
@RealmOnly('admin')
@AdminRoles('operations', 'finance')
@Controller('admin/countries/:code/payment-methods')
export class AdminPaymentMethodsController {
  constructor(private readonly methods: PaymentMethodsService) {}

  @Get()
  list(@Param('code') code: string) {
    return this.methods.adminList(code);
  }

  @Put()
  set(@CurrentCaller() caller: Caller, @Param('code') code: string, @Body() body: SetPaymentMethodsDto) {
    return this.methods.set(adminId(caller), code, body.purpose, body.enabled);
  }
}
