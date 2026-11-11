import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Res, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsEmail, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import type { Response } from 'express';
import { Public } from '../auth/caller.js';
import { CurrentCustomer, type CustomerCaller, CustomerGuard } from '../customers/customer-session.js';
import { ProductOnly } from '../products/product.js';
import { levelOf } from './permissions.js';
import { CurrentStaff, PosAllows, PosGuard } from './pos.guard.js';
import { PosReceiptsService } from './receipts.service.js';
import type { PosStaffContext } from './staff.service.js';

const kinds = ['receipt', 'invoice'] as const;
const flag = ({ value }: { value: unknown }) => value === true || value === 'true' || value === '1';

class PdfDto {
  @IsOptional() @IsIn(kinds)
  kind?: 'receipt' | 'invoice';

  /** The paper's width in millimetres: the till's when not given. */
  @IsOptional() @Type(() => Number) @IsIn([58, 80])
  width?: 58 | 80;

  /** A gift receipt: no prices or payments. */
  @IsOptional() @Transform(flag) @IsBoolean()
  gift?: boolean;
}

class CodeDto {
  @IsOptional() @IsIn(kinds)
  kind?: 'receipt' | 'invoice';
}

class WhatsappSendDto {
  @IsString() @MaxLength(20)
  phone: string;

  @IsOptional() @IsIn(kinds)
  kind?: 'receipt' | 'invoice';

  /** Keep the number on the sale's customer when they have none. */
  @IsOptional() @IsBoolean()
  save_to_customer?: boolean;
}

class EmailSendDto {
  @IsEmail() @MaxLength(254)
  email: string;

  @IsOptional() @IsIn(['receipt', 'invoice', 'both'])
  attach?: 'receipt' | 'invoice' | 'both';

  @IsOptional() @IsBoolean()
  save_to_customer?: boolean;
}

/** A receipt's PDF, shown in the browser (never cached: it carries the customer's purchase). */
function sendPdf(res: Response, file: { bytes: Buffer; name: string; contentType: string }) {
  res.set({
    'content-type': file.contentType,
    'content-length': String(file.bytes.length),
    'cache-control': 'no-store, private',
    'content-disposition': `inline; filename="${file.name.replace(/[^\w.\- ]/g, '_')}"`,
    'x-content-type-options': 'nosniff',
  });
  res.end(file.bytes);
}

/** A shop owner's receipts: print, download, show the QR code, send on WhatsApp or by email. */
@ApiExcludeController()
@Public()
@UseGuards(CustomerGuard)
@Controller('pos/owner')
@ProductOnly('udozo')
export class PosOwnerReceiptsController {
  constructor(private readonly receipts: PosReceiptsService) {}

  @Get('sales/:id/receipts')
  overview(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string) {
    return this.receipts.overview(caller.customer, id);
  }

  @Get('sales/:id/receipt.pdf')
  async pdf(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string, @Query() query: PdfDto, @Res() res: Response) {
    sendPdf(res, await this.receipts.pdf(caller.customer, id, query));
  }

  @Post('sales/:id/receipt-codes')
  code(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string, @Body() body: CodeDto) {
    return this.receipts.screenCode(caller.customer, id, body.kind ?? 'receipt');
  }

  @Get('sales/:id/receipt-codes/:code')
  codeStatus(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string, @Param('code', ParseUUIDPipe) code: string) {
    return this.receipts.code(caller.customer, id, code);
  }

  @Post('sales/:id/receipt/whatsapp')
  whatsapp(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string, @Body() body: WhatsappSendDto) {
    return this.receipts.sendWhatsapp(caller.customer, id, body);
  }

  @Post('sales/:id/receipt/email')
  email(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string, @Body() body: EmailSendDto) {
    return this.receipts.sendEmail(caller.customer, id, body);
  }
}

/** The sales a member of staff may see (as their sales routes): every sale with `all_sales`; else their own at their tills. */
const scopeOf = (context: PosStaffContext) => (levelOf(context.role, 'all_sales') === 'yes' ? {} : { soldByStaff: context.staff.id, ...(context.tills === 'all' ? {} : { tills: context.tills }) });
/** Saving a number or email on the sale's customer needs the customers permission. */
const canSave = (context: PosStaffContext) => levelOf(context.role, 'customers') === 'yes';

/** Staff's receipts: for the sales they may see, the same as the owner's. */
@ApiExcludeController()
@Public()
@UseGuards(PosGuard)
@Controller('pos/staff')
@ProductOnly('udozo')
export class PosStaffReceiptsController {
  constructor(private readonly receipts: PosReceiptsService) {}

  @Get('sales/:id/receipts')
  @PosAllows(['own_sales', 'all_sales'])
  overview(@CurrentStaff() context: PosStaffContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.receipts.overview(context.owner, id, scopeOf(context));
  }

  @Get('sales/:id/receipt.pdf')
  @PosAllows(['own_sales', 'all_sales'])
  async pdf(@CurrentStaff() context: PosStaffContext, @Param('id', ParseUUIDPipe) id: string, @Query() query: PdfDto, @Res() res: Response) {
    sendPdf(res, await this.receipts.pdf(context.owner, id, query, scopeOf(context)));
  }

  @Post('sales/:id/receipt-codes')
  @PosAllows(['own_sales', 'all_sales'])
  code(@CurrentStaff() context: PosStaffContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: CodeDto) {
    return this.receipts.screenCode(context.owner, id, body.kind ?? 'receipt', scopeOf(context));
  }

  @Get('sales/:id/receipt-codes/:code')
  @PosAllows(['own_sales', 'all_sales'])
  codeStatus(@CurrentStaff() context: PosStaffContext, @Param('id', ParseUUIDPipe) id: string, @Param('code', ParseUUIDPipe) code: string) {
    return this.receipts.code(context.owner, id, code, scopeOf(context));
  }

  @Post('sales/:id/receipt/whatsapp')
  @PosAllows(['own_sales', 'all_sales'])
  whatsapp(@CurrentStaff() context: PosStaffContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: WhatsappSendDto) {
    return this.receipts.sendWhatsapp(context.owner, id, body, { by: context.by, scope: scopeOf(context), canSave: canSave(context) });
  }

  @Post('sales/:id/receipt/email')
  @PosAllows(['own_sales', 'all_sales'])
  email(@CurrentStaff() context: PosStaffContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: EmailSendDto) {
    return this.receipts.sendEmail(context.owner, id, body, { by: context.by, scope: scopeOf(context), canSave: canSave(context) });
  }
}
