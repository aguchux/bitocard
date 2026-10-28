import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { ApiError } from '../common/errors/api-error.js';
import { feeFor, fromUnits } from '../crypto/amounts.js';
import { CryptoWalletsService, cryptoFeesRef, isTrader } from '../crypto/crypto-wallets.service.js';
import { CryptoMarketLimitsService } from '../crypto/market-limits.service.js';
import { P2pFeesService } from '../crypto/p2p-fees.service.js';
import { P2pStandingService } from '../crypto/p2p-standing.service.js';
import { P2pTrustService } from '../crypto/p2p-trust.service.js';
import { P2pService } from '../crypto/p2p.service.js';
import type { CustomerWithStore } from '../customers/customers.service.js';
import { PrismaService } from '../database/prisma.service.js';
import type { CryptoAsset, LedgerMode, P2pAd, P2pOrder, P2pOrderStatus, P2pPaymentMethod } from '../generated/prisma/client.js';
import { IdentityService } from '../identity/identity.service.js';
import { LedgerService, type PreparedEntry, type Tx } from '../ledger/ledger.service.js';
import { minor } from '../ledger/mode.js';
import { InboxService } from '../notifications/inbox.service.js';
import type { CustomerNotificationType } from '../notifications/inbox.js';
import { afrippaOperatorId } from './ids.js';
import { OrderRoomService } from './order-room.service.js';
import { isReversible, PaymentMethodsService } from './payment-methods.service.js';

/** Orders still running: the coins in escrow. */
export const openOrderStatuses: P2pOrderStatus[] = ['pending_payment', 'paid', 'appealed'];
/** Orders a buyer may have waiting for their payment at once, and open in an hour. */
export const maxUnpaidOrders = 5;
export const maxOrdersPerHour = 10;
/** A trader with fewer completed orders than this has the market's new-trader limits. */
export const newTraderOrders = 5;
export const orderNumber = (n: number) => `ORD-${String(n).padStart(6, '0')}`;

const conflict = (code: string, message: string, param?: string) => new ApiError(HttpStatus.CONFLICT, 'conflict_error', code, message, param);
const invalid = (code: string, message: string, param?: string) => new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', code, message, param);
const notFound = () => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such order.', 'id');
const adUnavailable = () => conflict('ad_unavailable', 'This ad is no longer available. Choose another.', 'ad_id');

/** How payment methods are matched on a buy ad: any bank to any bank; a mobile money network or a named service to the same one. */
const rail = (method: Pick<P2pPaymentMethod, 'kind' | 'label'>) => (method.kind === 'bank' ? 'bank' : `${method.kind}:${method.label.trim().toLowerCase()}`);

type Viewer = 'buyer' | 'seller' | 'admin';

/**
 * Afrippa's P2P orders (docs/CRYPTO_SPINOFF_PLAN.md, step 3 item 3): the escrow engine. Taking an escrow ad opens an
 * order and moves the seller's coins (the amount plus the seller's fee) into escrow (`crypto_escrow`, a customer
 * account of the seller), in one transaction with the ad's row locked. The buyer pays the seller directly (Afrippa
 * never touches the money) into the seller's payment method shown in the order, within the ad's window, and marks it
 * paid. Then:
 * - the seller **releases**: the coins less the buyer's fee to the buyer, both fees to Afrippa (`crypto_fees`);
 *   released coins are never taken back;
 * - the buyer **cancels**, or the window ends unpaid (**expired**, the `p2p-orders` job): the coins go back to the
 *   ad's lock (a sell ad still open) or the seller's wallet, and the ad takes the amount again;
 * - either side **appeals** once it is marked paid, and Afrippa's operations **decide**: release to the buyer or
 *   return to the seller, saying whose fault it was.
 * Every step claims the order's status in the same transaction that moves the coins, so it happens once whatever
 * runs at the same time (a release racing a cancel, an expiry or a decision: one wins, the others are refused).
 */
@Injectable()
export class P2pOrdersService {
  private readonly logger = new Logger('P2pOrders');

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly wallets: CryptoWalletsService,
    private readonly p2p: P2pService,
    private readonly feeRates: P2pFeesService,
    private readonly methods: PaymentMethodsService,
    private readonly identity: IdentityService,
    private readonly inbox: InboxService,
    private readonly audit: AuditService,
    private readonly room: OrderRoomService,
    private readonly standing: P2pStandingService,
    private readonly trust: P2pTrustService,
    private readonly limits: CryptoMarketLimitsService,
  ) {}

  private requireTrader(customer: CustomerWithStore) {
    if (!isTrader(customer)) throw notFound();
  }

  // -- Opening -------------------------------------------------------------------------------------------------

  /**
   * Opens an order on an escrow ad (or, with `preview`, shows what it would be): `price` must be the price the taker
   * saw; `payment_method_id` is where the buyer pays: one of a sell ad's own, or for a buy ad one of the taker's
   * (the seller's) matching the ways the ad's owner pays.
   */
  async open(customer: CustomerWithStore, input: { ad_id: string; price: number; amount?: string; fiat?: number; payment_method_id: string; preview?: boolean }) {
    this.requireTrader(customer);
    if ((input.fiat === undefined) === (input.amount === undefined)) throw invalid('parameter_missing', 'Send either fiat or amount.', 'fiat');
    const owned = await this.wallets.context(customer);
    const found = await this.prisma.p2pAd.findFirst({ where: { id: input.ad_id, mode: owned.mode } });
    // An ad another order emptied is no longer on offer (rather than an amount clipped to nothing).
    if (!found || found.status !== 'active' || found.remainingAmount <= 0n) throw adUnavailable();
    // The ad's market decides: the taker must be allowed to trade there.
    const { context } = await this.p2p.access(customer, { market: found.country, currency: found.currency });
    if (found.customerId === customer.id) throw conflict('own_ad', 'This is your own ad.', 'ad_id');
    // Traders who blocked each other never trade.
    if ((await this.trust.blockedWith(customer.id)).includes(found.customerId)) throw adUnavailable();
    if (!(await this.p2p.ownerCanTrade(found.customerId, { market: found.country, currency: found.currency }))) throw adUnavailable();
    const asset = await this.wallets.asset(found.asset);
    if (BigInt(input.price) !== found.priceMinor) throw conflict('price_changed', 'The price of this ad changed. Check the new price and try again.', 'price');
    const terms = this.p2p.terms(found, asset, { fiat: input.fiat, amount: input.amount });
    const { buyerBps, sellerBps } = await this.feeRates.rates(asset, found.country, context.mode);
    const buyerFee = feeFor(terms.amount, buyerBps);
    const sellerFee = feeFor(terms.amount, sellerBps);
    if (buyerFee >= terms.amount) throw invalid('amount_too_small', 'This amount is too small to trade.', 'amount');
    const sellerId = found.side === 'sell' ? found.customerId : customer.id;
    const buyerId = found.side === 'sell' ? customer.id : found.customerId;
    // A trader paused or cooling off opens nothing; one buying, nothing either after too many cancellations.
    await this.standing.require(customer.id, context.mode, { buying: buyerId === customer.id });
    const method = await this.payInto(found, customer, input.payment_method_id);
    const unpaid = await this.prisma.p2pOrder.count({ where: { buyerId, mode: context.mode, status: 'pending_payment' } });
    if (unpaid >= maxUnpaidOrders) throw conflict('too_many_orders', `A buyer can have ${maxUnpaidOrders} orders waiting for payment at once. Pay or cancel one first.`);
    if (buyerId === customer.id) {
      const lastHour = await this.prisma.p2pOrder.count({ where: { takerId: customer.id, buyerId: customer.id, mode: context.mode, createdAt: { gt: new Date(Date.now() - 3_600_000) } } });
      if (lastHour >= maxOrdersPerHour) throw new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'rate_limit_error', 'order_rate_limited', 'You are opening orders too quickly. Try again in a while.');
    }
    const buyerName = await this.payerName(buyerId, context.mode);
    await this.notSamePerson(buyerId, sellerId, buyerName, context.mode);
    const [takerNew, makerNew, makerHome] = await Promise.all([this.isNew(customer.id, context.mode), this.isNew(found.customerId, context.mode), this.homeOf(found.customerId)]);
    const shown = {
      object: 'p2p_order_preview' as const,
      asset: asset.code,
      currency: found.currency,
      price: minor(found.priceMinor),
      amount: fromUnits(terms.amount, asset.decimals),
      fiat: minor(terms.fiat),
      buyer_fee: fromUnits(buyerFee, asset.decimals),
      seller_fee: fromUnits(sellerFee, asset.decimals),
      received: fromUnits(terms.amount - buyerFee, asset.decimals),
      payment_window: found.paymentWindowMinutes,
    };
    if (input.preview) return shown;

    const account = (kind: 'crypto_wallet' | 'crypto_locked' | 'crypto_escrow') => this.ledger.accountId(context.mode, this.wallets.ref(sellerId, kind, asset.code));
    const [walletId, lockedId, escrowId] = await Promise.all([account('crypto_wallet'), account('crypto_locked'), account('crypto_escrow')]);
    const held = terms.amount + sellerFee;
    const order = await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM p2p_ads WHERE id = ${found.id}::uuid FOR UPDATE`;
      const ad = await tx.p2pAd.findUniqueOrThrow({ where: { id: found.id } });
      if (ad.status !== 'active' || ad.priceMinor !== found.priceMinor) throw adUnavailable();
      if (ad.remainingAmount < terms.amount) throw conflict('amount_unavailable', `This ad has only ${fromUnits(ad.remainingAmount, asset.decimals)} ${asset.code} left.`, 'amount');
      // The market's limits for both parties (a new trader's tighter), with both locked: parallel orders cannot pass them.
      await tx.$queryRaw`SELECT id FROM customers WHERE id IN (${customer.id}::uuid, ${ad.customerId}::uuid) ORDER BY id FOR UPDATE`;
      await this.limits.check(tx, {
        mode: context.mode,
        market: ad.country,
        currency: ad.currency,
        fiat: terms.fiat,
        parties: [
          { customerId: customer.id, home: context.country, taker: true, newTrader: takerNew },
          { customerId: ad.customerId, home: makerHome, taker: false, newTrader: makerNew },
        ],
      });
      // A sell ad pays its seller's fee from the reserve it keeps for it, then the seller's wallet.
      const feeFromLock = ad.side === 'sell' ? (ad.feeLocked < sellerFee ? ad.feeLocked : sellerFee) : 0n;
      const created = await tx.p2pOrder.create({
        data: {
          mode: context.mode,
          adId: ad.id,
          market: ad.country,
          currency: ad.currency,
          asset: asset.code,
          makerId: ad.customerId,
          takerId: customer.id,
          sellerId,
          buyerId,
          priceMinor: ad.priceMinor,
          amount: terms.amount,
          fiatMinor: terms.fiat,
          sellerFee,
          buyerFee,
          sellerFeeBps: sellerBps,
          sellerFeeFromLock: feeFromLock,
          buyerFeeBps: buyerBps,
          paymentMethodId: method.id,
          buyerName,
          paymentWindowMinutes: ad.paymentWindowMinutes ?? 15,
          payBy: new Date(Date.now() + (ad.paymentWindowMinutes ?? 15) * 60_000),
        },
      });
      // The ad's taken part counts as filled while the order runs; a cancelled or returned order gives it back.
      await tx.p2pAd.update({ where: { id: ad.id }, data: { remainingAmount: { decrement: terms.amount }, filledAmount: { increment: terms.amount }, feeLocked: { decrement: feeFromLock } } });
      // A sell ad's coins (and its fee, as far as its reserve goes) come from its lock; a buy ad's seller (the taker) pays from their wallet.
      const fromLock = ad.side === 'sell' ? terms.amount + feeFromLock : 0n;
      const fromWallet = held - fromLock;
      await this.write(tx, context.mode, `p2p_order:${created.id}:escrow`, 'p2p_order_escrow', `${asset.code} held in escrow for order ${orderNumber(created.number)}`, created, [
        ...(fromLock > 0n ? [{ accountId: lockedId, kind: 'crypto_locked' as const, amount: fromLock }] : []),
        ...(fromWallet > 0n ? [{ accountId: walletId, kind: 'crypto_wallet' as const, amount: fromWallet }] : []),
        { accountId: escrowId, kind: 'crypto_escrow', amount: -held },
      ]);
      await this.room.system(
        tx,
        created.id,
        `Order ${orderNumber(created.number)} opened: ${fromUnits(created.amount, asset.decimals)} ${asset.code} for ${minor(created.fiatMinor) / 100} ${created.currency}, held in escrow. ` +
          `The buyer pays within ${created.paymentWindowMinutes} minutes into the seller's account shown in the order, from an account in their own name (${buyerName}).`,
      );
      return created;
    });
    await this.tell(order, found.customerId, 'customer.p2p.order_opened', 'New order on your ad', `${orderNumber(order.number)}: ${fromUnits(order.amount, asset.decimals)} ${asset.code} for ${minor(order.fiatMinor) / 100} ${order.currency}.`);
    return this.present(order, asset, customer.id === buyerId ? 'buyer' : 'seller');
  }

  /** The seller's payment method the buyer pays into, checked against the ad. */
  private async payInto(ad: P2pAd, taker: CustomerWithStore, id: string) {
    if (ad.side === 'sell') {
      const listed = await this.prisma.p2pAdPaymentMethod.findUnique({ where: { adId_paymentMethodId: { adId: ad.id, paymentMethodId: id } }, include: { paymentMethod: true } });
      if (!listed || listed.paymentMethod.removedAt) throw invalid('parameter_invalid', 'Choose one of the ad’s payment methods.', 'payment_method_id');
      return listed.paymentMethod;
    }
    // A buy ad: the taker sells, and is paid into one of their own methods the ad's owner can pay into.
    const own = await this.prisma.p2pPaymentMethod.findFirst({ where: { id, customerId: taker.id, mode: ad.mode, removedAt: null } });
    if (!own) throw invalid('parameter_invalid', 'Choose one of your own saved payment methods.', 'payment_method_id');
    if (own.currency !== ad.currency) throw invalid('payment_method_currency', `Choose a payment method in ${ad.currency}, the ad's currency.`, 'payment_method_id');
    if (own.usableFrom > new Date()) throw conflict('payment_method_not_ready', 'A new payment method can be used 24 hours after it was added.', 'payment_method_id');
    const accepted = await this.prisma.p2pAdPaymentMethod.findMany({ where: { adId: ad.id }, include: { paymentMethod: true } });
    if (!accepted.some(link => rail(link.paymentMethod) === rail(own))) throw invalid('payment_method_mismatch', 'The buyer cannot pay into this kind of account. Choose one the ad lists.', 'payment_method_id');
    return own;
  }

  /** Whether a trader is new: fewer than `newTraderOrders` completed orders. */
  private async isNew(customerId: string, mode: LedgerMode) {
    return (await this.prisma.p2pOrder.count({ where: { mode, status: 'released', OR: [{ buyerId: customerId }, { sellerId: customerId }] } })) < newTraderOrders;
  }

  private async homeOf(customerId: string) {
    return (await this.prisma.customer.findUniqueOrThrow({ where: { id: customerId }, select: { country: true } })).country ?? '';
  }

  /**
   * The same person on both sides is refused: the same verified name (live), or one payment account saved by both
   * (the same details, by their fingerprint). Trading with oneself only moves coins to fake a history.
   */
  private async notSamePerson(buyerId: string, sellerId: string, buyerName: string, mode: LedgerMode) {
    const refused = () => conflict('same_person', 'You cannot trade with this trader.');
    if (mode === 'live') {
      const sellerName = await this.identity.customerVerifiedName(afrippaOperatorId, 'live', sellerId);
      if (sellerName && sellerName.trim().toLowerCase() === buyerName.trim().toLowerCase()) throw refused();
    }
    const fingerprints = await this.prisma.p2pPaymentMethod.findMany({ where: { customerId: { in: [buyerId, sellerId] }, mode }, select: { customerId: true, fingerprint: true } });
    const buyers = new Set(fingerprints.filter(item => item.customerId === buyerId).map(item => item.fingerprint));
    if (fingerprints.some(item => item.customerId === sellerId && buyers.has(item.fingerprint))) throw refused();
  }

  /** The name a payment must come from: the buyer's verified name live, their account name in the sandbox. */
  private async payerName(buyerId: string, mode: LedgerMode) {
    if (mode === 'live') {
      const verified = await this.identity.customerVerifiedName(afrippaOperatorId, 'live', buyerId);
      if (verified) return verified;
    }
    return (await this.prisma.customer.findUniqueOrThrow({ where: { id: buyerId }, select: { name: true } })).name;
  }

  // -- The steps -------------------------------------------------------------------------------------------------

  /**
   * The buyer says they paid, within the window, naming the account they paid from: one of their own saved methods (in
   * their verified name) in the order's currency, of the same kind as the seller's. Third-party payments are refused.
   */
  async markPaid(customer: CustomerWithStore, id: string, paidFrom: string) {
    const order = await this.mine(customer, id, 'buyer');
    const from = await this.prisma.p2pPaymentMethod.findFirst({ where: { id: paidFrom, customerId: customer.id, mode: order.mode, removedAt: null } });
    if (!from) throw invalid('parameter_invalid', 'Choose the account you paid from: one of your own saved payment methods.', 'payment_method_id');
    if (from.currency !== order.currency) throw invalid('payment_method_currency', `Choose an account in ${order.currency}, the order's currency.`, 'payment_method_id');
    if (from.usableFrom > new Date()) throw conflict('payment_method_not_ready', 'A new payment method can be used 24 hours after it was added.', 'payment_method_id');
    const into = await this.prisma.p2pPaymentMethod.findUniqueOrThrow({ where: { id: order.paymentMethodId } });
    if (rail(from) !== rail(into)) throw invalid('payment_method_mismatch', 'This account cannot pay into the seller’s. Choose one of the same kind.', 'payment_method_id');
    const claimed = await this.prisma.p2pOrder.updateMany({ where: { id, status: 'pending_payment', payBy: { gt: new Date() } }, data: { status: 'paid', paidAt: new Date(), paidFromMethodId: from.id } });
    if (claimed.count === 0) {
      const fresh = await this.prisma.p2pOrder.findUniqueOrThrow({ where: { id } });
      if (fresh.status === 'pending_payment') throw conflict('order_expired', 'The time to pay this order is over.');
      throw conflict('order_not_pending', 'This order is no longer waiting for payment.');
    }
    const asset = await this.prisma.cryptoAsset.findUniqueOrThrow({ where: { code: order.asset } });
    await this.room.system(this.prisma, id, `The buyer marked the order paid from ${from.label} ${from.hint} (${from.holderName}). Seller: check ${minor(order.fiatMinor) / 100} ${order.currency} arrived from ${order.buyerName}, then release the coins. Release only for a payment from that name.`);
    await this.tell(order, order.sellerId, 'customer.p2p.order_paid', 'The buyer says they paid', `${orderNumber(order.number)}: check you received ${minor(order.fiatMinor) / 100} ${order.currency} from ${order.buyerName}, then release the coins.`);
    return this.present(await this.prisma.p2pOrder.findUniqueOrThrow({ where: { id } }), asset, 'buyer');
  }

  /**
   * The seller confirms the money arrived from the buyer's own account (`payer_checked`): the coins go to the buyer.
   * They are told to release only for a payment from the buyer's name; a release cannot be taken back.
   */
  async release(customer: CustomerWithStore, id: string, payerChecked: boolean) {
    const order = await this.mine(customer, id, 'seller');
    if (!payerChecked) throw invalid('payer_check_required', `Confirm the money arrived in your account from ${order.buyerName}, the buyer, before releasing.`, 'payer_checked');
    const done = await this.settle(order, 'released', { from: openOrderStatuses });
    if (!done) throw conflict('order_closed', 'This order is already closed.');
    await this.tell(done, done.buyerId, 'customer.p2p.order_released', 'Your coins were released', `${orderNumber(done.number)}: the seller released your coins.`);
    return this.present(done, await this.assetOf(done), 'seller');
  }

  /** The buyer calls it off (before paying, or admitting they did not): the coins go back. */
  async cancel(customer: CustomerWithStore, id: string) {
    const order = await this.mine(customer, id, 'buyer');
    const done = await this.settle(order, 'cancelled', { from: openOrderStatuses, reason: 'buyer' });
    if (!done) throw conflict('order_closed', 'This order is already closed.');
    await this.tell(done, done.sellerId, 'customer.p2p.order_cancelled', 'An order was cancelled', `${orderNumber(done.number)}: the buyer cancelled; your coins are back.`);
    return this.present(done, await this.assetOf(done), 'buyer');
  }

  /** Either side, once it is marked paid: Afrippa's operations decide. */
  async appeal(customer: CustomerWithStore, id: string, reason: string) {
    const order = await this.mine(customer, id);
    const claimed = await this.prisma.p2pOrder.updateMany({ where: { id, status: 'paid' }, data: { status: 'appealed', appealedAt: new Date(), appealedBy: customer.id, appealReason: reason.trim() } });
    if (claimed.count === 0) throw conflict('order_not_appealable', 'An order can be appealed once it is marked paid, while it is open.');
    const other = customer.id === order.buyerId ? order.sellerId : order.buyerId;
    await this.room.system(this.prisma, id, `The ${customer.id === order.buyerId ? 'buyer' : 'seller'} appealed: ${reason.trim()} Afrippa's team will decide. Add your evidence here.`);
    await this.tell(order, other, 'customer.p2p.order_appealed', 'An order was appealed', `${orderNumber(order.number)} was appealed. Afrippa's team will decide; add your evidence to the order.`);
    // Afrippa's operations decide it (admin.afrippa.com's order page).
    await this.inbox.afrippaAdmins('admin.p2p.order_appealed', {
      subject: `order:${order.id}`,
      title: `${orderNumber(order.number)} appealed`,
      body: `The ${customer.id === order.buyerId ? 'buyer' : 'seller'} appealed: ${reason.trim().slice(0, 300)}`,
      link: `/orders/${order.id}`,
      mode: order.mode,
    });
    return this.present(await this.prisma.p2pOrder.findUniqueOrThrow({ where: { id } }), await this.assetOf(order), customer.id === order.buyerId ? 'buyer' : 'seller');
  }

  /** Afrippa's operations decide an appealed order: the coins to the buyer, or back to the seller. Audited. */
  async decide(adminId: string | null, id: string, input: { outcome: 'release' | 'return'; fault: 'buyer' | 'seller' | 'none'; note: string }) {
    const order = await this.prisma.p2pOrder.findUnique({ where: { id } });
    if (!order) throw notFound();
    const decision = { decidedBy: adminId, decisionFault: input.fault, decisionNote: input.note.trim() };
    const done = await this.settle(order, input.outcome === 'release' ? 'released' : 'returned', { from: ['appealed'], decision });
    if (!done) throw conflict('order_not_appealed', 'Only an appealed, open order can be decided.');
    if (input.fault !== 'none') await this.standing.afterStrike(input.fault === 'buyer' ? done.buyerId : done.sellerId, done.mode);
    await this.audit.record({ actorId: adminId, action: `p2p_order.${done.status}`, targetType: 'p2p_order', targetId: id, before: { status: order.status }, after: { status: done.status, fault: input.fault, note: input.note.trim() }, platform: 'afrippa' });
    const asset = await this.assetOf(done);
    for (const party of [done.buyerId, done.sellerId]) {
      await this.tell(done, party, 'customer.p2p.order_decided', 'Your appeal was decided', `${orderNumber(done.number)}: Afrippa's team ${done.status === 'released' ? 'released the coins to the buyer' : 'returned the coins to the seller'}.`);
    }
    return this.present(done, asset, 'admin');
  }

  /** The `p2p-orders` job (every minute): expiries, then the deadline reminders. */
  async job() {
    return { ...(await this.expireDue()), reminded: await this.remind() };
  }

  /**
   * Deadline reminders, each once (claimed on the order): the buyer when 5 minutes of the window are left (or a third
   * of a shorter one), the seller once an order has been marked paid for 15 minutes and not released.
   */
  async remind() {
    const now = Date.now();
    let reminded = 0;
    const unpaid = await this.prisma.p2pOrder.findMany({ where: { status: 'pending_payment', payRemindedAt: null, payBy: { gt: new Date(now), lte: new Date(now + 5 * 60_000) } }, take: 200 });
    for (const order of unpaid) {
      const claimed = await this.prisma.p2pOrder.updateMany({ where: { id: order.id, status: 'pending_payment', payRemindedAt: null }, data: { payRemindedAt: new Date() } });
      if (claimed.count === 0) continue;
      reminded += 1;
      await this.tell(order, order.buyerId, 'customer.p2p.order_reminder', 'Pay or cancel your order', `${orderNumber(order.number)}: pay the seller before ${order.payBy.toUTCString()}, then mark it paid, or cancel it.`);
    }
    const waiting = await this.prisma.p2pOrder.findMany({ where: { status: 'paid', releaseRemindedAt: null, paidAt: { lte: new Date(now - 15 * 60_000) } }, take: 200 });
    for (const order of waiting) {
      const claimed = await this.prisma.p2pOrder.updateMany({ where: { id: order.id, status: 'paid', releaseRemindedAt: null }, data: { releaseRemindedAt: new Date() } });
      if (claimed.count === 0) continue;
      reminded += 1;
      await this.tell(order, order.sellerId, 'customer.p2p.order_reminder', 'A buyer is waiting for your coins', `${orderNumber(order.number)} was marked paid. Check the money arrived from ${order.buyerName}, then release, or appeal if it did not.`);
    }
    return reminded;
  }

  /** Unpaid orders past their window expire, their coins going back (100 a run). */
  async expireDue() {
    const due = await this.prisma.p2pOrder.findMany({ where: { status: 'pending_payment', payBy: { lte: new Date() } }, orderBy: { payBy: 'asc' }, take: 100 });
    let expired = 0;
    for (const order of due) {
      try {
        const done = await this.settle(order, 'cancelled', { from: ['pending_payment'], reason: 'expired', unpaidOnly: true });
        if (!done) continue;
        expired += 1;
        for (const party of [done.buyerId, done.sellerId]) {
          await this.tell(done, party, 'customer.p2p.order_cancelled', 'An order expired', `${orderNumber(done.number)} was not paid in time; the coins went back to the seller.`);
        }
      } catch (error) {
        this.logger.error({ err: error, order: order.id }, 'Could not expire an order');
      }
    }
    return { due: due.length, expired };
  }

  /**
   * Closes an order and moves its coins, in one transaction: claims the order (from `from`, once), then releases the
   * escrow to the buyer (less their fee, both fees to Afrippa) or returns it to the seller (the amount to a still-open
   * sell ad's lock, else their wallet; the fee to their wallet) and gives the ad its amount back. Null if another step
   * closed it first.
   */
  private async settle(
    order: P2pOrder,
    status: 'released' | 'cancelled' | 'returned',
    options: { from: P2pOrderStatus[]; reason?: string; unpaidOnly?: boolean; decision?: { decidedBy: string | null; decisionFault: string; decisionNote: string } },
  ) {
    const asset = await this.assetOf(order);
    const ref = (customerId: string, kind: 'crypto_wallet' | 'crypto_locked' | 'crypto_escrow') => this.ledger.accountId(order.mode, this.wallets.ref(customerId, kind, order.asset));
    const [escrowId, sellerWalletId, sellerLockedId, buyerWalletId, feesId] = await Promise.all([
      ref(order.sellerId, 'crypto_escrow'),
      ref(order.sellerId, 'crypto_wallet'),
      ref(order.sellerId, 'crypto_locked'),
      ref(order.buyerId, 'crypto_wallet'),
      this.ledger.accountId(order.mode, cryptoFeesRef(order.asset)),
    ]);
    const held = order.amount + order.sellerFee;
    return this.prisma.$transaction(async tx => {
      const claimed = await tx.p2pOrder.updateMany({
        where: { id: order.id, status: { in: options.from }, ...(options.unpaidOnly ? { payBy: { lte: new Date() } } : {}) },
        data: { status, closedAt: new Date(), ...(options.reason ? { cancelReason: options.reason } : {}), ...(options.decision ?? {}) },
      });
      if (claimed.count === 0) return null;
      const number = orderNumber(order.number);
      await this.room.system(tx, order.id, closingLine(status, options));
      if (status === 'released') {
        const fees = order.sellerFee + order.buyerFee;
        await this.write(tx, order.mode, `p2p_order:${order.id}:release`, 'p2p_order_release', `${asset.code} released for order ${number}`, order, [
          { accountId: escrowId, kind: 'crypto_escrow', amount: held },
          { accountId: buyerWalletId, kind: 'crypto_wallet', amount: -(order.amount - order.buyerFee) },
          ...(fees > 0n ? [{ accountId: feesId, kind: 'crypto_fees' as const, amount: -fees }] : []),
        ]);
      } else {
        await tx.$queryRaw`SELECT id FROM p2p_ads WHERE id = ${order.adId}::uuid FOR UPDATE`;
        const ad = await tx.p2pAd.findUniqueOrThrow({ where: { id: order.adId } });
        const backToAd = ad.side === 'sell' && ad.customerId === order.sellerId && ['active', 'paused'].includes(ad.status);
        // Back to a still-open sell ad: its coins and the fee its reserve paid; the rest to the seller's wallet.
        await tx.p2pAd.update({
          where: { id: ad.id },
          data: { remainingAmount: { increment: order.amount }, filledAmount: { decrement: order.amount }, ...(backToAd ? { feeLocked: { increment: order.sellerFeeFromLock } } : {}) },
        });
        const toLock = backToAd ? order.amount + order.sellerFeeFromLock : 0n;
        await this.write(tx, order.mode, `p2p_order:${order.id}:return`, 'p2p_order_return', `${asset.code} back from order ${number}`, order, [
          { accountId: escrowId, kind: 'crypto_escrow', amount: held },
          ...(toLock > 0n ? [{ accountId: sellerLockedId, kind: 'crypto_locked' as const, amount: -toLock }] : []),
          ...(held - toLock > 0n ? [{ accountId: sellerWalletId, kind: 'crypto_wallet' as const, amount: -(held - toLock) }] : []),
        ]);
      }
      return tx.p2pOrder.findUniqueOrThrow({ where: { id: order.id } });
    });
  }

  /** Writes a balanced entry inside `tx`, locking its accounts first (in one order, so orders never deadlock). */
  private async write(tx: Tx, mode: LedgerMode, reference: string, type: string, description: string, order: Pick<P2pOrder, 'id'>, postings: PreparedEntry['postings']) {
    await this.ledger.lockBalances(tx, [...new Set(postings.map(posting => posting.accountId))]);
    return this.ledger.write(tx, { mode, type, reference, description, metadata: { order_id: order.id }, postings });
  }

  // -- Reading -------------------------------------------------------------------------------------------------

  /** An order of the customer's (as `as` when given, else either side). Others' orders do not exist for them. */
  private async mine(customer: CustomerWithStore, id: string, as?: 'buyer' | 'seller') {
    this.requireTrader(customer);
    const order = await this.prisma.p2pOrder.findUnique({ where: { id } });
    if (!order || (order.buyerId !== customer.id && order.sellerId !== customer.id)) throw notFound();
    if (as === 'buyer' && order.buyerId !== customer.id) throw new ApiError(HttpStatus.FORBIDDEN, 'permission_error', 'buyer_only', 'Only the buyer can do this.');
    if (as === 'seller' && order.sellerId !== customer.id) throw new ApiError(HttpStatus.FORBIDDEN, 'permission_error', 'seller_only', 'Only the seller can do this.');
    return order;
  }

  async get(customer: CustomerWithStore, id: string) {
    const order = await this.mine(customer, id);
    return this.present(order, await this.assetOf(order), order.buyerId === customer.id ? 'buyer' : 'seller');
  }

  async list(customer: CustomerWithStore, query: { status?: 'open' | 'closed'; limit?: number }) {
    this.requireTrader(customer);
    const context = await this.wallets.context(customer);
    const orders = await this.prisma.p2pOrder.findMany({
      where: {
        mode: context.mode,
        OR: [{ buyerId: customer.id }, { sellerId: customer.id }],
        ...(query.status === 'closed' ? { status: { notIn: openOrderStatuses } } : query.status === 'open' ? { status: { in: openOrderStatuses } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: query.limit ?? 50,
    });
    const assets = new Map((await this.prisma.cryptoAsset.findMany()).map(asset => [asset.code, asset]));
    return { object: 'list' as const, data: await Promise.all(orders.map(order => this.present(order, assets.get(order.asset)!, order.buyerId === customer.id ? 'buyer' : 'seller', { details: false }))) };
  }

  async adminList(query: { mode?: LedgerMode; status?: P2pOrderStatus; customer_id?: string; limit?: number }) {
    const orders = await this.prisma.p2pOrder.findMany({
      where: { ...(query.mode ? { mode: query.mode } : {}), ...(query.status ? { status: query.status } : {}), ...(query.customer_id ? { OR: [{ buyerId: query.customer_id }, { sellerId: query.customer_id }] } : {}) },
      orderBy: { createdAt: 'desc' },
      take: query.limit ?? 100,
    });
    const assets = new Map((await this.prisma.cryptoAsset.findMany()).map(asset => [asset.code, asset]));
    return { object: 'list' as const, data: await Promise.all(orders.map(order => this.present(order, assets.get(order.asset)!, 'admin', { details: false }))) };
  }

  async adminGet(id: string) {
    const order = await this.prisma.p2pOrder.findUnique({ where: { id } });
    if (!order) throw notFound();
    return this.present(order, await this.assetOf(order), 'admin');
  }

  private assetOf(order: Pick<P2pOrder, 'asset'>) {
    return this.prisma.cryptoAsset.findUniqueOrThrow({ where: { code: order.asset } });
  }

  /**
   * An order from one side: what they pay or receive, the window, the counterparty's nickname, and while it is open
   * the seller's payment details (the only place they are ever shown) with the name the payment must come from.
   */
  async present(order: P2pOrder, asset: Pick<CryptoAsset, 'decimals'>, viewer: Viewer, options: { details?: boolean } = {}) {
    const open = openOrderStatuses.includes(order.status);
    const units = (value: bigint) => fromUnits(value, asset.decimals);
    const names = await this.p2p.nicknames([order.buyerId, order.sellerId]);
    const method = await this.prisma.p2pPaymentMethod.findUniqueOrThrow({ where: { id: order.paymentMethodId } });
    const paidFrom = order.paidFromMethodId ? await this.prisma.p2pPaymentMethod.findUnique({ where: { id: order.paidFromMethodId } }) : null;
    const details = open && options.details !== false ? await this.methods.reveal(method.id) : null;
    const warnings = isReversible(method) || (paidFrom && isReversible(paidFrom)) ? ['reversible_payment'] : [];
    // Whether the viewer already rated the other party (a released order, its own page only; null in lists).
    const rater = viewer === 'buyer' ? order.buyerId : viewer === 'seller' ? order.sellerId : null;
    const feedbackGiven = rater && options.details !== false ? (order.status === 'released' ? (await this.prisma.p2pFeedback.count({ where: { orderId: order.id, fromId: rater } })) > 0 : false) : null;
    return {
      object: 'p2p_order' as const,
      id: order.id,
      number: orderNumber(order.number),
      mode: order.mode,
      ad_id: order.adId,
      market: order.market,
      asset: order.asset,
      decimals: asset.decimals,
      currency: order.currency,
      /** From the viewer's side: buy (they receive the coins) or sell. */
      side: viewer === 'admin' ? null : viewer === 'buyer' ? 'buy' : 'sell',
      status: order.status,
      price: minor(order.priceMinor),
      amount: units(order.amount),
      fiat: minor(order.fiatMinor),
      buyer_fee: units(order.buyerFee),
      seller_fee: units(order.sellerFee),
      /** What the buyer receives once released. */
      received: units(order.amount - order.buyerFee),
      /** What the seller has in escrow. */
      escrow: units(order.amount + order.sellerFee),
      payment_window: order.paymentWindowMinutes,
      pay_by: order.payBy.toISOString(),
      buyer: { nickname: names.get(order.buyerId) ?? 'Trader' },
      seller: { nickname: names.get(order.sellerId) ?? 'Trader' },
      /** The seller's account the buyer pays into: the full details only while the order is open. */
      payment_method: { kind: method.kind, label: method.label, currency: method.currency, hint: method.hint, holder_name: method.holderName, details: details ? stripped(details) : null },
      /** The payment must come from an account in this name (the buyer's own): third-party payments are refused. */
      payer_name: order.buyerName,
      /** The buyer's own account they say they paid from (once marked paid). */
      paid_from: paidFrom ? { kind: paidFrom.kind, label: paidFrom.label, hint: paidFrom.hint, holder_name: paidFrom.holderName } : null,
      /** reversible_payment: the payment can be taken back by the payer after release (PayPal): release only once sure. */
      warnings,
      paid_at: order.paidAt?.toISOString() ?? null,
      appealed_at: order.appealedAt?.toISOString() ?? null,
      appealed_by: order.appealedBy ? (order.appealedBy === order.buyerId ? 'buyer' : 'seller') : null,
      appeal_reason: order.appealReason,
      closed_at: order.closedAt?.toISOString() ?? null,
      cancel_reason: order.cancelReason,
      decision: order.decisionFault ? { fault: order.decisionFault, note: viewer === 'admin' ? order.decisionNote : null } : null,
      /** The viewer rated the other party already (null in lists and for admins). */
      feedback_given: feedbackGiven,
      created_at: order.createdAt.toISOString(),
      updated_at: order.updatedAt.toISOString(),
    };
  }

  private async tell(order: Pick<P2pOrder, 'id' | 'mode'>, customerId: string, type: CustomerNotificationType, title: string, body: string) {
    const customer = await this.prisma.customer.findUnique({ where: { id: customerId }, select: { storeId: true } });
    if (!customer) return;
    await this.inbox.customer({ customerId, storeId: customer.storeId }, type, { subject: `${type}:${order.id}:${Date.now()}`, title, body, link: `/orders/${order.id}`, mode: order.mode });
  }
}

/** The room's line when an order closes. */
function closingLine(status: 'released' | 'cancelled' | 'returned', options: { reason?: string; decision?: unknown }) {
  if (status === 'released') return options.decision ? "Afrippa's team decided the appeal: the coins were released to the buyer." : 'The seller released the coins to the buyer.';
  if (status === 'returned') return "Afrippa's team decided the appeal: the coins were returned to the seller.";
  return options.reason === 'expired' ? 'The order was not paid in time and expired. The coins went back to the seller.' : 'The buyer cancelled the order. The coins went back to the seller.';
}

/** The details shown in an order: the account itself (the holder and currency are shown beside it). */
function stripped(details: Awaited<ReturnType<PaymentMethodsService['reveal']>>) {
  return Object.fromEntries(Object.entries(details).filter(([key]) => key !== 'holder_name' && key !== 'currency'));
}
