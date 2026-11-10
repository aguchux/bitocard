import { Body, Controller, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';
import { Public } from '../auth/caller.js';
import { CurrentCustomer, type CustomerCaller, CustomerGuard } from '../customers/customer-session.js';
import { ProductOnly } from '../products/product.js';
import { ListingAuctionsService } from './listing-auctions.service.js';

class BidDto {
  @IsInt() @Min(1)
  amount: number;
}

/** Bidding on a listing sold by auction, from its page on udozo.com. */
@ApiExcludeController()
@Public()
@UseGuards(CustomerGuard)
@Controller('classifieds/listings/:id')
@ProductOnly('udozo')
export class ListingAuctionsController {
  constructor(private readonly auctions: ListingAuctionsService) {}

  @Post('bids')
  bid(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string, @Body() body: BidDto) {
    return this.auctions.bid(caller.customer, id, body.amount);
  }
}
