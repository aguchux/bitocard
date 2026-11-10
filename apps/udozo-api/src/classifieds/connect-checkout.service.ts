import { HttpStatus, Injectable } from '@nestjs/common';
import { ApiError } from '../common/errors/api-error.js';
import { PrismaService } from '../database/prisma.service.js';
import { ListingShippingService } from './connect-shipping.service.js';

/** The market's Connect fee and how it is shared, as orders use them (null fee: Connect orders are refused). */
export type ConnectTerms = { fee: { kind: 'percent'; bps: number } | { kind: 'fixed'; minor: bigint } | null; centreShareBps: number; buyerFreeHours: number };

const invalid = (code: string, message: string, param?: string) => new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', code, message, param);
const centreNumber = (number: number) => `CC-${String(number).padStart(6, '0')}`;

/** The Connect fee on an order with this shipping charge: a percentage of it (rounded to the nearest unit), or fixed. */
export function connectFeeOf(terms: ConnectTerms, shippingMinor: bigint) {
  if (!terms.fee) return null;
  return terms.fee.kind === 'fixed' ? terms.fee.minor : (shippingMinor * BigInt(terms.fee.bps) + 5000n) / 10000n;
}

/** The centre's part of a Connect fee (rounded down; Udozo has the rest). */
export const centreShareOf = (feeMinor: bigint, shareBps: number) => (feeMinor * BigInt(shareBps)) / 10000n;

/**
 * Buying through Udozo Connect (docs/UDOZO_CONNECT_PLAN.md, phase 5): the centres a listing reaches, with each state's
 * shipping charge and Connect fee, and the check of the buyer's choice. Only where `connect_shipping` is on and finance
 * set the market's Connect fee; only to an active centre in a state open for Connect that the listing ships to.
 */
@Injectable()
export class ConnectCheckoutService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly shipping: ListingShippingService,
  ) {}

  async terms(country: string): Promise<ConnectTerms> {
    const row = await this.prisma.connectSettings.findUnique({ where: { country } });
    const fee =
      row?.feeKind === 'percent' && row.feeBps !== null ? { kind: 'percent' as const, bps: row.feeBps } : row?.feeKind === 'fixed' && row.feeMinor !== null ? { kind: 'fixed' as const, minor: row.feeMinor } : null;
    return { fee, centreShareBps: row?.centreShareBps ?? 7000, buyerFreeHours: row?.buyerFreeHours ?? 72 };
  }

  /** The centres a buyer can collect this listing at, by state, with what each state costs; null when there are none. */
  async options(listing: { id: string; country: string; connect: boolean; connectAllCentres: boolean }) {
    const reach = await this.shipping.presentPublic(listing);
    if (!reach) return null;
    const terms = await this.terms(listing.country);
    if (!terms.fee) return null;
    const centres = await this.prisma.connectCentre.findMany({
      where: { country: listing.country, status: 'active', stateId: { in: reach.states.map(state => state.id) }, ...(listing.connectAllCentres ? {} : { listings: { some: { listingId: listing.id } } }) },
      include: { area: { select: { id: true, name: true, latitude: true, longitude: true } } },
      orderBy: [{ name: 'asc' }],
    });
    return {
      fee: terms.fee.kind === 'percent' ? { kind: 'percent' as const, bps: terms.fee.bps } : { kind: 'fixed' as const, amount: Number(terms.fee.minor) },
      states: reach.states.map(state => ({
        id: state.id,
        name: state.name,
        slug: state.slug,
        shipping: state.shipping,
        connect_fee: Number(connectFeeOf(terms, BigInt(state.shipping))),
        centres: centres
          .filter(centre => centre.stateId === state.id)
          .map(centre => ({
            id: centre.id,
            number: centreNumber(centre.number),
            name: centre.name,
            area: { id: centre.area.id, name: centre.area.name, latitude: Number(centre.area.latitude), longitude: Number(centre.area.longitude) },
            address: centre.address,
            landmark: centre.landmark,
            hours: centre.hours,
            phone: centre.phone,
          })),
      })),
    };
  }

  /** The buyer's chosen centre for this listing, checked: its state's shipping charge, the Connect fee and the state. */
  async check(listing: { id: string; country: string; connect: boolean; connectAllCentres: boolean }, centreId: string | undefined) {
    if (!centreId) throw invalid('centre_required', 'Choose the Connect Centre you will collect it from.', 'connect_centre_id');
    const options = await this.options(listing);
    if (!options) throw invalid('parameter_invalid', 'This item cannot be collected at a Connect Centre.', 'fulfilment');
    const state = options.states.find(item => item.centres.some(centre => centre.id === centreId));
    if (!state) throw invalid('centre_unavailable', 'Choose an open Connect Centre this seller ships to.', 'connect_centre_id');
    return { centreId, stateId: state.id, shippingMinor: BigInt(state.shipping), feeMinor: BigInt(state.connect_fee) };
  }
}
