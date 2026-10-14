import { Controller, Get, HttpCode, HttpStatus, Post, Query, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { IsIn, IsOptional, IsUUID } from 'class-validator';
import { AdminRoles, Public, RealmOnly } from '../auth/caller.js';
import { CurrentCustomer, type CustomerCaller, CustomerGuard } from '../customers/customer-session.js';
import type { LedgerMode } from '../generated/prisma/client.js';
import { SpinsService } from './spins.service.js';

class AdminSpinsQueryDto {
  @IsOptional() @IsIn(['live', 'test'])
  mode?: LedgerMode;

  @IsOptional() @IsUUID()
  customer_id?: string;
}

/** Spin and win for store customers (sessions only; hosted stores, so left out of the public OpenAPI document). */
@ApiExcludeController()
@Public()
@UseGuards(CustomerGuard)
@Controller('store/spins')
export class CustomerSpinsController {
  constructor(private readonly spins: SpinsService) {}

  @Get()
  status(@CurrentCustomer() caller: CustomerCaller) {
    return this.spins.status(caller.customer);
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  spin(@CurrentCustomer() caller: CustomerCaller) {
    return this.spins.spin(caller.customer);
  }
}

/** Admin: every Spin and win, with totals per coin (BitoCard's promotion spend). */
@ApiExcludeController()
@RealmOnly('admin')
@AdminRoles('operations', 'finance', 'support')
@Controller('admin/crypto/spins')
export class AdminSpinsController {
  constructor(private readonly spins: SpinsService) {}

  @Get()
  list(@Query() query: AdminSpinsQueryDto) {
    return this.spins.adminList(query);
  }
}
