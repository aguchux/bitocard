import { createHash, randomBytes } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { houseStoreId } from '../checkout/house-ids.js';
import { shopOrigin } from '../classifieds/listings.service.js';
import { ApiError } from '../common/errors/api-error.js';
import type { CustomerWithStore } from '../customers/customers.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma, type PosWalletRequest } from '../generated/prisma/client.js';
import { formatMoney } from '../notifications/templates.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { InboxService } from '../notifications/inbox.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { normalisePhone } from '../auth/auth.service.js';
import { PosCustomersService } from './customers.service.js';
import { PosSalesService, type SaleInput } from './sales.service.js';

export type WalletRequestInput = SaleInput & { wallet_amount: number; phone?: string | null };

/** How long the buyer has to confirm: the plan's five minutes. */
export const walletRequestMs = 5 * 60_000;
export const walletTokenPattern = /^pw_[A-Za-z0-9_-]{32}$/;

const invalid = (code: string, message: string, param?: string) => new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', code, message, param);
const conflict = (code: string, message: string, param?: string) => new ApiError(HttpStatus.CONFLICT, 'conflict_error', code, message, param);
const missing = () => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'This payment request is not here any more. Ask the shop for a new one.');
const hashOf = (token: string) => createHash('sha256').update(token).digest('hex');
const requestNumber = (n: number) => `PW-${String(n).padStart(6, '0')}`;
/** What the stored basket holds: the sale as the till sent it, less the till, its wallet part and the buyer's number. */
type Basket = Omit<SaleInput, 'till_id'>;
/** Refusals of the basket itself: once the buyer is paying, the shop's stock or prices moved. */
const basketCodes = new Set(['stock_short', 'price_changed', 'product_unavailable', 'plan_limit', 'payments_mismatch']);

/**
 * Paying at the till from the buyer's Udozo wallet (docs/UDOZO_POS_PLAN.md, milestone 3), the one way money moves through
 * Udozo at a shop. The till asks for the wallet part of its basket, shown as a QR code for whoever signs in to pay, or
 * sent to one buyer by their Udozo mobile number; the request waits five minutes. The buyer confirms on udozo.com, and in
 * that one transaction the basket is checked again and made into the sale (its stock taken) and the money moves from the
 * buyer's `customer_wallet` to the owner's `customer_withdrawable` (`pos_wallet:<request>`), held there for the market's
 * payout hold like UdozoPay sales. Nothing is ever taken without the buyer pressing Pay, and a basket that changed at
 * the shop meanwhile takes nothing. Off unless `pos_wallet_payments` is on for the shop's country.
 */
@Injectable()
export class PosWalletService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sales: PosSalesService,
    private readonly customers: PosCustomersService,
    private readonly ledger: LedgerService,
    private readonly settings: SettingsService,
    private readonly inbox: InboxService,
  ) {}

  private async open(country: string) {
    if (!(await this.settings.isOnForCountry('pos_wallet_payments', country))) throw conflict('pos_wallet_unavailable', 'Udozo wallet payments are not open in your country yet. Take another payment method.');
  }

  /** Asks for the wallet part of a basket: checked as a sale would be, nothing taken. Returns the link's token once. */
  async request(owner: CustomerWithStore, input: WalletRequestInput) {
    const account = await this.sales.account(owner);
    await this.open(account.country);
    const till = await this.sales.till(account.id, input.till_id);
    this.sales.checkShape(input);
    if (!Number.isSafeInteger(input.wallet_amount) || input.wallet_amount < 1) throw invalid('parameter_invalid', 'Say how much is paid from the Udozo wallet.', 'wallet_amount');
    const wallet = BigInt(input.wallet_amount);
    if (await this.prisma.posSale.findUnique({ where: { accountId_clientSaleId: { accountId: account.id, clientSaleId: input.client_sale_id } }, select: { id: true } })) {
      throw conflict('sale_exists', 'This basket is already a sale. Start a new sale.', 'client_sale_id');
    }

    // Asked of one buyer: their confirmed Udozo mobile number, in the shop's country.
    let buyer: { id: string; name: string; phone: string | null; phoneVerifiedAt: Date | null } | null = null;
    if (input.phone?.trim()) {
      const phone = normalisePhone(input.phone.trim(), account.country);
      const found = await this.prisma.customer.findFirst({ where: { storeId: houseStoreId, phone, phoneVerifiedAt: { not: null }, status: 'active' }, select: { id: true, name: true, phone: true, phoneVerifiedAt: true, country: true } });
      if (!found || found.country !== account.country) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'buyer_unknown', 'No Udozo account in your country has this mobile number confirmed. Show the QR code instead.', 'phone');
      if (found.id === owner.id) throw conflict('same_person', 'This is your own Udozo account: you cannot pay your own shop.', 'phone');
      buyer = found;
    }
    const buyerId = buyer?.id ?? null;

    const built = await this.prisma.$transaction(tx => this.sales.build(tx, { account, till, ownerId: owner.id, input, wallet }));
    const basket: Basket = {
      client_sale_id: input.client_sale_id,
      lines: input.lines.map(line => ({ listing_id: line.listing_id, quantity: line.quantity, ...(line.discount ? { discount: line.discount } : {}) })),
      ...(input.discount ? { discount: input.discount } : {}),
      payments: input.payments,
      expected_total: input.expected_total,
      ...(input.note ? { note: input.note } : {}),
      ...(input.client_created_at ? { client_created_at: input.client_created_at } : {}),
    };
    let customerId = input.customer_id ?? null;
    const token = `pw_${randomBytes(24).toString('base64url')}`;
    const now = new Date();
    const row = await this.prisma.$transaction(async tx => {
      // Asking again for the same basket replaces the request waiting for it.
      await tx.posWalletRequest.updateMany({ where: { accountId: account.id, clientSaleId: input.client_sale_id, status: 'waiting' }, data: { status: 'cancelled' } });
      // Asked of a Udozo customer by their number: they join the shop's customers now, linked to their account.
      if (buyer) customerId = (await this.customers.linkUdozo(tx, account.id, buyer, customerId)).id;
      return tx.posWalletRequest.create({
        data: {
          accountId: account.id,
          shopId: till.shopId,
          tillId: till.id,
          tokenHash: hashOf(token),
          clientSaleId: input.client_sale_id,
          mode: account.mode,
          currency: account.currency,
          amountMinor: wallet,
          totalMinor: built.totals.total,
          basket: basket as unknown as Prisma.InputJsonValue,
          soldByCustomerId: owner.id,
          soldByName: owner.name,
          buyerCustomerId: buyerId,
          customerId,
          expiresAt: new Date(now.getTime() + walletRequestMs),
        },
      });
    });
    const payUrl = `${shopOrigin}/pay/${token}`;
    if (buyerId) {
      void this.inbox
        .customer({ customerId: buyerId, storeId: houseStoreId }, 'customer.pos.payment', {
          subject: `pos_wallet:${row.id}`,
          title: `${till.shop.name} asks you to pay ${formatMoney(wallet, account.currency)}`,
          body: 'Open it to see what you are buying, then press Pay to pay from your Udozo wallet. It waits for 5 minutes.',
          link: `/pay/${token}`,
        })
        .catch(() => undefined);
    }
    return { ...(await this.present(row)), token, pay_url: payUrl };
  }

  async status(owner: CustomerWithStore, id: string) {
    const account = await this.sales.account(owner);
    const row = await this.prisma.posWalletRequest.findFirst({ where: { id, accountId: account.id } });
    if (!row) throw missing();
    return this.present(await this.expire(row));
  }

  async cancel(owner: CustomerWithStore, id: string) {
    const account = await this.sales.account(owner);
    await this.prisma.posWalletRequest.updateMany({ where: { id, accountId: account.id, status: 'waiting' }, data: { status: 'cancelled' } });
    return this.status(owner, id);
  }

  // ---- The buyer, on udozo.com ----

  private async byToken(buyer: CustomerWithStore, token: string) {
    if (!walletTokenPattern.test(token)) throw missing();
    const row = await this.prisma.posWalletRequest.findUnique({ where: { tokenHash: hashOf(token) }, include: { shop: { select: { name: true } }, account: { select: { customerId: true, country: true } } } });
    // Asked of someone else: not theirs to see.
    if (!row || (row.buyerCustomerId && row.buyerCustomerId !== buyer.id)) throw missing();
    return { ...row, ...(await this.expire(row)) };
  }

  /** What the buyer is asked to pay: the shop, the wallet part, the whole sale and its items. */
  async view(buyer: CustomerWithStore, token: string) {
    const row = await this.byToken(buyer, token);
    const basket = row.basket as unknown as Basket;
    const listings = await this.prisma.classifiedListing.findMany({ where: { id: { in: basket.lines.map(line => line.listing_id) } }, select: { id: true, title: true, priceMinor: true } });
    const byId = new Map(listings.map(item => [item.id, item]));
    return {
      object: 'pos_wallet_payment' as const,
      number: requestNumber(row.number),
      status: row.status,
      shop: { name: row.shop.name },
      currency: row.currency,
      amount: Number(row.amountMinor),
      total: Number(row.totalMinor),
      items: basket.lines.map(line => ({ title: byId.get(line.listing_id)?.title ?? 'An item', quantity: line.quantity })),
      own_shop: row.account.customerId === buyer.id,
      expires_at: row.expiresAt.toISOString(),
      paid_at: row.paidAt?.toISOString() ?? null,
    };
  }

  /** The buyer pays: the sale is made and the money moves in one transaction, or nothing happens. */
  async pay(buyer: CustomerWithStore, token: string, expectedAmount: number) {
    const row = await this.byToken(buyer, token);
    if (row.status !== 'waiting') throw conflict('request_closed', row.status === 'paid' ? 'This was paid already.' : 'This payment request has closed. Ask the shop for a new one.');
    if (buyer.storeId !== houseStoreId) throw new ApiError(HttpStatus.FORBIDDEN, 'permission_error', 'pos_unavailable', 'Pay with your udozo.com account.');
    if (row.account.customerId === buyer.id) throw conflict('same_person', 'This is your own shop: you cannot pay yourself.');
    if (!buyer.phoneVerifiedAt) throw conflict('phone_required', 'Confirm your mobile number on your Udozo profile before paying a shop.', 'phone');
    if (buyer.country !== row.account.country) throw conflict('currency_mismatch', 'This shop is in another country: your wallet cannot pay it.');
    await this.open(row.account.country);
    if (BigInt(expectedAmount) !== row.amountMinor) throw conflict('price_changed', 'The amount changed. Look again before paying.', 'expected_amount');

    const account = await this.prisma.posAccount.findUniqueOrThrow({ where: { id: row.accountId }, include: { plan: true } });
    if (!row.tillId) throw conflict('request_closed', 'The shop removed this till. Ask the shop for a new payment request.');
    const till = await this.sales.till(account.id, row.tillId);
    const basket = row.basket as unknown as Basket;
    const input: SaleInput = { ...basket, till_id: row.tillId };
    const number = requestNumber(row.number);
    const entry = await this.ledger.prepare({
      mode: row.mode,
      type: 'pos_wallet_payment',
      reference: `pos_wallet:${row.id}`,
      description: `${row.shop.name} (Udozo POS ${number})`,
      lines: [
        { account: { kind: 'customer_wallet', currency: row.currency, customerId: buyer.id }, debit: row.amountMinor },
        { account: { kind: 'customer_withdrawable', currency: row.currency, customerId: row.account.customerId }, credit: row.amountMinor },
      ],
    });
    const now = new Date();
    try {
      await this.prisma.$transaction(async tx => {
        const claimed = await tx.posWalletRequest.updateMany({ where: { id: row.id, status: 'waiting', expiresAt: { gt: now } }, data: { status: 'paid', buyerCustomerId: buyer.id, paidAt: now } });
        if (!claimed.count) throw conflict('request_closed', 'This payment request has closed. Ask the shop for a new one.');
        // The payer joins the shop's customers (or is found there), linked to their Udozo account, and the sale is theirs.
        const customer = await this.customers.linkUdozo(tx, account.id, { id: buyer.id, name: buyer.name, phone: buyer.phone, phoneVerifiedAt: buyer.phoneVerifiedAt }, row.customerId);
        input.customer_id = customer.id;
        const built = await this.sales.build(tx, { account, till, ownerId: row.account.customerId, input, wallet: row.amountMinor });
        const saleId = await this.sales.record(tx, { account, till, soldBy: { id: row.soldByCustomerId, name: row.soldByName }, input, built, now, walletRequest: { id: row.id, number } });
        await tx.posWalletRequest.update({ where: { id: row.id }, data: { saleId } });
        await this.ledger.write(tx, entry);
      });
    } catch (error) {
      if (error instanceof ApiError && error.code === 'insufficient_funds') {
        throw new ApiError(HttpStatus.PAYMENT_REQUIRED, 'invalid_request_error', 'wallet_balance_low', `Your wallet has too little for ${formatMoney(row.amountMinor, row.currency)}. Add funds, then pay.`);
      }
      // The shop's basket changed meanwhile (stock sold online, a price changed, the same basket sold another way):
      // nothing was taken, and the till is told to start again.
      if ((error instanceof ApiError && basketCodes.has(error.code)) || (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) {
        await this.prisma.posWalletRequest.updateMany({ where: { id: row.id, status: 'waiting' }, data: { status: 'cancelled' } });
        throw conflict('basket_changed', 'Something in this sale changed at the shop, so nothing was taken. Ask the cashier to start again.');
      }
      throw error;
    }
    return this.view(buyer, token);
  }

  async decline(buyer: CustomerWithStore, token: string) {
    const row = await this.byToken(buyer, token);
    await this.prisma.posWalletRequest.updateMany({ where: { id: row.id, status: 'waiting' }, data: { status: 'declined', buyerCustomerId: buyer.id } });
    return this.view(buyer, token);
  }

  /** A waiting request past its five minutes is expired (written the first time it is read). */
  private async expire<T extends PosWalletRequest>(row: T): Promise<T> {
    if (row.status !== 'waiting' || row.expiresAt > new Date()) return row;
    await this.prisma.posWalletRequest.updateMany({ where: { id: row.id, status: 'waiting' }, data: { status: 'expired' } });
    return { ...row, status: 'expired' };
  }

  private async present(row: PosWalletRequest) {
    return {
      object: 'pos_wallet_request' as const,
      id: row.id,
      number: requestNumber(row.number),
      status: row.status,
      currency: row.currency,
      amount: Number(row.amountMinor),
      total: Number(row.totalMinor),
      client_sale_id: row.clientSaleId,
      /** Asked of one buyer by their mobile number (never shown), else a QR code anyone may pay. */
      for_buyer: row.buyerCustomerId !== null,
      expires_at: row.expiresAt.toISOString(),
      paid_at: row.paidAt?.toISOString() ?? null,
      /** The sale it made, once paid. */
      sale: row.saleId ? await this.sales.presentById(row.saleId) : null,
    };
  }
}
