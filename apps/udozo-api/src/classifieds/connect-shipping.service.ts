import { HttpStatus, Injectable } from '@nestjs/common';
import { ApiError } from '../common/errors/api-error.js';
import { PrismaService } from '../database/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { SettingsService } from '../settings/settings.service.js';
import { maxPriceMinor } from './rules.js';

/** What a listing request may say about shipping through Udozo Connect. */
export type ConnectInput = {
  /** Ship through Udozo Connect: to a Connect Centre in the ticked states. */
  connect?: boolean;
  /** The states it ships to, each with the seller's shipping charge to a centre there (minor units, 0 free); replaces them all. */
  connect_states?: { state_id: string; shipping: number }[];
  /** The centres it ships to, or null for every active centre in the ticked states (new ones too). */
  connect_centres?: string[] | null;
};

/** What `check` changes: the listing's own columns, and its states and centres when they were sent. */
export type ConnectChanges = {
  fields: { connect?: boolean; connectAllCentres?: boolean };
  states: { stateId: string; shippingMinor: bigint }[] | null;
  centres: string[] | null;
};

/** The parts of a listing `check` and `requireComplete` read. */
export type ConnectCurrent = { id: string; connect: boolean; connectAllCentres: boolean; priceKind: string } | null;

/** How a listing is loaded with what it ships to. */
export const connectInclude = {
  connectStates: { include: { state: { select: { id: true, slug: true, name: true } } } },
  connectCentres: { include: { centre: { select: { id: true, number: true, name: true, stateId: true, status: true } } } },
} satisfies Prisma.ClassifiedListingInclude;
type ConnectRow = Prisma.ClassifiedListingGetPayload<{ include: typeof connectInclude }>;

/** The most states one listing can ship to (every state of the biggest market fits). */
export const maxConnectStates = 60;
export const maxConnectCentres = 200;

const invalid = (code: string, message: string, param?: string) => new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', code, message, param);
const centreNumber = (number: number) => `CC-${String(number).padStart(6, '0')}`;

/**
 * Listings shipped through Udozo Connect (docs/UDOZO_CONNECT_PLAN.md, phase 4). A seller ticks **Ship through Udozo
 * Connect**, the states it ships to with their own shipping charge (all of it theirs), and the centres there: every
 * active one (the default, so a new centre joins by itself) or those they choose. Only where `connect_shipping` is on
 * in the market; a state switched off for Connect (`connect_states`) takes no new ones. Buyers see it on the listing
 * page; buying through a centre comes with phase 5.
 */
@Injectable()
export class ListingShippingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  /** Whether Connect shipping is open in the market. */
  open(country: string) {
    return this.settings.isOnForCountry('connect_shipping', country);
  }

  /** The Connect part of a listing request, each piece checked against the market, its states and its centres. */
  async check(country: string, input: ConnectInput, current: ConnectCurrent, priceKind: string): Promise<ConnectChanges> {
    const changes: ConnectChanges = { fields: {}, states: null, centres: null };
    const sent = input.connect !== undefined || input.connect_states !== undefined || input.connect_centres !== undefined;
    if (!sent) {
      // A listing that ships through Connect is paid with UdozoPay, so it needs a price.
      if (current?.connect && priceKind === 'on_request') throw invalid('connect_price_required', 'Items shipped through Udozo Connect are paid with UdozoPay, so they need a price.', 'price_kind');
      return changes;
    }
    // Turning it off, or a listing already shipping, needs no open switch; turning it on, or changing where, does.
    const turningOff = input.connect === false && input.connect_states === undefined && input.connect_centres === undefined;
    if (!turningOff && !(await this.open(country))) throw invalid('connect_unavailable', 'Shipping through Udozo Connect is not open in your country yet.', 'connect');
    if (input.connect !== undefined) changes.fields.connect = input.connect;
    const on = changes.fields.connect ?? current?.connect ?? false;
    if (on && priceKind === 'on_request') throw invalid('connect_price_required', 'Items shipped through Udozo Connect are paid with UdozoPay, so they need a price.', 'price_kind');

    let stateIds: string[] | null = null;
    if (input.connect_states !== undefined) {
      if (input.connect_states.length > maxConnectStates) throw invalid('parameter_invalid', `Choose at most ${maxConnectStates} states.`, 'connect_states');
      const ids = input.connect_states.map(item => item.state_id);
      if (new Set(ids).size !== ids.length) throw invalid('parameter_invalid', 'Each state can be given once.', 'connect_states');
      const [states, closed] = await Promise.all([
        this.prisma.classifiedArea.findMany({ where: { id: { in: ids }, kind: 'state', country, enabled: true }, select: { id: true } }),
        this.prisma.connectState.findMany({ where: { stateId: { in: ids }, enabled: false }, select: { stateId: true } }),
      ]);
      const known = new Set(states.map(row => row.id));
      const shut = new Set(closed.map(row => row.stateId));
      changes.states = input.connect_states.map((item, index) => {
        if (!known.has(item.state_id)) throw invalid('parameter_invalid', 'Choose a state of your country.', `connect_states[${index}].state_id`);
        if (shut.has(item.state_id)) throw invalid('state_unavailable', 'Udozo Connect is not taking new items in this state.', `connect_states[${index}].state_id`);
        if (!Number.isSafeInteger(item.shipping) || item.shipping < 0 || BigInt(item.shipping) > maxPriceMinor) throw invalid('parameter_invalid', 'A shipping charge is 0 (free) or more, in minor units.', `connect_states[${index}].shipping`);
        return { stateId: item.state_id, shippingMinor: BigInt(item.shipping) };
      });
      stateIds = changes.states.map(row => row.stateId);
    }

    if (input.connect_centres !== undefined) {
      if (input.connect_centres === null) {
        changes.fields.connectAllCentres = true;
        changes.centres = [];
      } else {
        if (input.connect_centres.length > maxConnectCentres) throw invalid('parameter_invalid', `Choose at most ${maxConnectCentres} centres.`, 'connect_centres');
        const ids = [...new Set(input.connect_centres)];
        const within = stateIds ?? (current ? (await this.prisma.classifiedListingConnectState.findMany({ where: { listingId: current.id }, select: { stateId: true } })).map(row => row.stateId) : []);
        const centres = await this.prisma.connectCentre.findMany({ where: { id: { in: ids } }, select: { id: true, country: true, status: true, stateId: true } });
        ids.forEach((id, index) => {
          const centre = centres.find(row => row.id === id);
          if (!centre || centre.country !== country || centre.status !== 'active') throw invalid('centre_unavailable', 'Choose an open Connect Centre.', `connect_centres[${index}]`);
          if (!within.includes(centre.stateId)) throw invalid('centre_unavailable', 'Choose a centre in a state you ship to.', `connect_centres[${index}]`);
        });
        changes.fields.connectAllCentres = false;
        changes.centres = ids;
      }
    } else if (stateIds && current && !current.connectAllCentres) {
      // States changed and centres were chosen: those in states no longer ticked go.
      const chosen = await this.prisma.classifiedListingConnectCentre.findMany({ where: { listingId: current.id }, include: { centre: { select: { stateId: true } } } });
      changes.centres = chosen.filter(row => stateIds.includes(row.centre.stateId)).map(row => row.centreId);
    }
    return changes;
  }

  /** Writes the states and centres `check` gave, in the listing's own transaction. */
  async write(tx: Prisma.TransactionClient, listingId: string, changes: ConnectChanges) {
    if (changes.states) {
      await tx.classifiedListingConnectState.deleteMany({ where: { listingId } });
      if (changes.states.length) await tx.classifiedListingConnectState.createMany({ data: changes.states.map(row => ({ listingId, ...row })) });
    }
    if (changes.centres) {
      await tx.classifiedListingConnectCentre.deleteMany({ where: { listingId } });
      if (changes.centres.length) await tx.classifiedListingConnectCentre.createMany({ data: changes.centres.map(centreId => ({ listingId, centreId })) });
    }
  }

  /** A listing past draft that ships through Connect says where to, and through which centres. */
  async requireComplete(client: Prisma.TransactionClient, listingId: string, listing: { connect: boolean; connectAllCentres: boolean }) {
    if (!listing.connect) return;
    const [states, centres] = await Promise.all([
      client.classifiedListingConnectState.count({ where: { listingId } }),
      listing.connectAllCentres ? 1 : client.classifiedListingConnectCentre.count({ where: { listingId } }),
    ]);
    if (!states) throw invalid('listing_incomplete', 'Add the states it ships to through Udozo Connect.', 'connect_states');
    if (!centres) throw invalid('listing_incomplete', 'Choose at least one Connect Centre it ships to.', 'connect_centres');
  }

  /** The seller's view: on or off, the states with their charges, and every centre or those chosen. */
  presentOwn(row: ConnectRow & { connect: boolean; connectAllCentres: boolean }) {
    return {
      enabled: row.connect,
      states: row.connectStates
        .map(item => ({ state: { id: item.state.id, slug: item.state.slug, name: item.state.name }, shipping: Number(item.shippingMinor) }))
        .sort((a, b) => a.state.name.localeCompare(b.state.name)),
      all_centres: row.connectAllCentres,
      centres: row.connectCentres.map(item => ({ id: item.centre.id, number: centreNumber(item.centre.number), name: item.centre.name, state_id: item.centre.stateId, active: item.centre.status === 'active' })),
    };
  }

  /**
   * What buyers see: the states it ships to now, each with its charge and how many open centres take it there, or null
   * (not shipping through Connect, Connect shipping closed in the market, or no open centre in any of its states).
   */
  async presentPublic(listing: { id: string; country: string; connect: boolean; connectAllCentres: boolean }) {
    if (!listing.connect || !(await this.open(listing.country))) return null;
    const states = await this.prisma.classifiedListingConnectState.findMany({ where: { listingId: listing.id }, include: { state: { select: { id: true, slug: true, name: true } } } });
    if (!states.length) return null;
    const ids = states.map(row => row.stateId);
    const [closed, centres] = await Promise.all([
      this.prisma.connectState.findMany({ where: { stateId: { in: ids }, enabled: false }, select: { stateId: true } }),
      this.prisma.connectCentre.groupBy({
        by: ['stateId'],
        where: { country: listing.country, status: 'active', stateId: { in: ids }, ...(listing.connectAllCentres ? {} : { listings: { some: { listingId: listing.id } } }) },
        _count: { _all: true },
      }),
    ]);
    const shut = new Set(closed.map(row => row.stateId));
    const shown = states
      .filter(row => !shut.has(row.stateId))
      .map(row => ({ id: row.state.id, slug: row.state.slug, name: row.state.name, shipping: Number(row.shippingMinor), centres: centres.find(item => item.stateId === row.stateId)?._count._all ?? 0 }))
      .filter(row => row.centres > 0)
      .sort((a, b) => a.name.localeCompare(b.name));
    return shown.length ? { states: shown } : null;
  }
}
