import { HttpStatus, Injectable } from '@nestjs/common';
import { ApiError } from '../../common/errors/api-error.js';
import type { CustomerWithStore } from '../../customers/customers.service.js';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { SettingsService } from '../../settings/settings.service.js';
import type { AiTool } from '../../support/ai/providers.js';
import type { ShopRole } from '../../support/bots.service.js';
import { cleanMessage } from '../conversations.service.js';
import { minComparable } from '../moderation.service.js';
import { conditions, featureValueOut, linkPattern, priceText } from '../rules.js';
import { safePayFee } from '../safe-pay.service.js';
import { ListingSearchService, type SearchSort, searchSorts } from '../search.service.js';
import { quoted } from './sanitise.js';
import { redFlags, safeTradeGuide } from './shop-knowledge.js';

/** Who and where a conversation is: tools never take a country or a person from the model. */
export type ToolScope = {
  country: string;
  currency: string;
  surface: ShopRole;
  roles: readonly string[];
  customer: CustomerWithStore | null;
  /** The listing the conversation was opened from (a buyer's question about it, or a seller's own). */
  listingId: string | null;
  /** The chat it was opened from (reply suggestions): only for a participant. */
  conversationId: string | null;
};

/** What the person sees beside the answer, drawn from tool results only. */
export type AssistantCard =
  | { type: 'listings'; items: unknown[] }
  | { type: 'compare'; items: unknown[] }
  | { type: 'price_range'; category: string; currency: string; low: number; median: number; high: number; count: number }
  | { type: 'safe_pay'; currency: string; price: number; fee: number; total: number; listing_id: string | null }
  | { type: 'checklist'; category: string | null; items: string[] }
  | { type: 'orders'; items: unknown[] }
  | { type: 'my_listings'; items: unknown[] }
  | { type: 'message_draft'; listing_id: string; title: string; url: string; text: string }
  | { type: 'person'; reason: string };

export type ToolOutcome = { result: string; cards?: AssistantCard[]; urls?: string[] };

const tool = (name: string, description: string, properties: Record<string, unknown> = {}, required: string[] = []): AiTool => ({ name, description, parameters: { type: 'object', properties, required, additionalProperties: false } });
const text = { type: 'string' };
const number = { type: 'number' };
const uuid = { type: 'string', description: 'A listing id from an earlier tool result.' };

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const slugPattern = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const str = (value: unknown, max = 100) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : typeof value === 'string' && /^\d+(\.\d+)?$/.test(value.trim()) ? Number(value) : null);
const slugOf = (value: unknown) => {
  const slug = str(value, 80).toLowerCase();
  return slugPattern.test(slug) ? slug : undefined;
};
const json = (value: unknown) => JSON.stringify(value);

/** A Safe pay order's next step, as the person reads it (never the release code). */
const nextStep: Record<string, { buyer: string; seller: string }> = {
  requested: { buyer: 'Waiting for the seller to accept.', seller: 'Accept or decline the request.' },
  accepted: { buyer: 'Pay from your wallet before the deadline.', seller: 'Waiting for the buyer to pay.' },
  paid: { buyer: 'Meet the seller (give your release code only after inspecting) or wait for the delivery.', seller: 'Hand it over: enter the buyer’s release code at the meet-up, or mark the delivery sent.' },
  sent: { buyer: 'Confirm when it arrives, or open a dispute.', seller: 'Waiting for the buyer to confirm the delivery.' },
  disputed: { buyer: 'BitoCard is deciding the dispute.', seller: 'BitoCard is deciding the dispute.' },
  released: { buyer: 'Done.', seller: 'Paid: withdrawable after the payout hold.' },
  refunded: { buyer: 'Refunded to your wallet.', seller: 'Closed: the buyer was refunded.' },
  cancelled: { buyer: 'Cancelled.', seller: 'Cancelled.' },
  declined: { buyer: 'The seller declined.', seller: 'You declined.' },
  expired: { buyer: 'Expired.', seller: 'Expired.' },
};

/**
 * The shop assistant's tools, run by BitoCard. Each is scoped on the server: to the conversation's country (never one
 * the model names), to the signed-in customer for their own things, and to active public listings for everyone else.
 * No tool acts: they read, and the person presses the buttons. Seller and buyer text reaches the model fenced as data.
 */
@Injectable()
export class ShopAssistantTools {
  constructor(
    private readonly prisma: PrismaService,
    private readonly search: ListingSearchService,
    private readonly settings: SettingsService,
  ) {}

  /** The tools offered for a conversation: by the assistant's roles, the surface, and whether the person is signed in. */
  definitions(scope: ToolScope): AiTool[] {
    const can = (role: ShopRole) => scope.roles.includes(role);
    const list: AiTool[] = [];
    const buyer = can('browse') && (scope.surface === 'browse' || scope.surface === 'help');
    if (buyer || scope.surface === 'sell') {
      list.push(
        tool(
          'search_listings',
          'Search active listings in this country. Prices are whole currency units. Returns at most 10, nearest the buyer first.',
          {
            words: { ...text, description: 'What they want, in a few words (brand, model, item).' },
            category: { ...text, description: 'A category slug from the categories tool.' },
            area: { ...text, description: 'An area slug, for listings near it.' },
            state: { ...text, description: 'A state slug.' },
            price_min: number,
            price_max: number,
            condition: { type: 'array', items: { type: 'string', enum: [...conditions] } },
            features: { type: 'array', items: { type: 'object', properties: { key: text, value: text, min: number, max: number }, required: ['key'] }, description: 'Registry keys (search_features) with a value, or a min and max for numbers.' },
            id_checked_only: { type: 'boolean', description: 'Only sellers whose ID BitoCard checked.' },
            safe_pay_ready_only: { type: 'boolean', description: 'Only sellers set up to take Safe pay.' },
            sort: { type: 'string', enum: [...searchSorts] },
          },
        ),
        tool('get_listing', 'One active listing: its features, description, condition, area, seller badges and checks.', { listing_id: uuid }, ['listing_id']),
        tool('compare_listings', 'Up to 4 active listings side by side.', { listing_ids: { type: 'array', items: uuid, maxItems: 4 } }, ['listing_ids']),
        tool('price_range', 'The middle half of active and recently sold prices for comparable listings in this country over 90 days (needs enough of them).', { category: text, condition: { type: 'string', enum: [...conditions] }, features: { type: 'array', items: { type: 'object', properties: { key: text, value: text }, required: ['key', 'value'] } } }, ['category']),
      );
    }
    if (buyer || can('help')) {
      list.push(
        tool('safe_pay_quote', 'The buyer’s Safe pay fee and total for a listing or a price (whole currency units), from Safe pay’s own fee rules.', { listing_id: uuid, price: number }),
        tool('safety_checklist', 'The Safe Trade Guide’s checks, and a category’s own checks.', { category: text }),
      );
    }
    list.push(tool('categories', 'The categories open in this country, with their slugs.'), tool('search_features', 'Feature keys in the registry matching words (for filters and listings).', { words: text }, ['words']));
    if (buyer) list.push(tool('draft_message', 'Draft a first message to a listing’s seller, shown for the buyer to edit and send themselves.', { listing_id: uuid, text: { ...text, description: 'At most 500 characters. No phone numbers, links or payment details.' } }, ['listing_id', 'text']));
    if (scope.customer && can('help')) {
      list.push(
        tool('my_listings', 'The signed-in person’s own listings: title, status, views, leads.'),
        tool('my_orders', 'The signed-in person’s Safe pay orders, buying and selling: status and what is next (never codes).'),
        tool('my_conversations', 'The signed-in person’s chats: the listing and who is waiting for a reply (never the messages).'),
      );
    }
    if (scope.customer && scope.surface === 'sell') {
      if (scope.listingId) list.push(tool('my_listing', 'The listing the seller is working on (their own, drafts too): what is filled in and what is missing.'));
      if (scope.conversationId) list.push(tool('chat_messages', 'The latest messages of the chat the seller opened you from, for a reply suggestion.'));
    }
    list.push(tool('offer_person', 'Offer the person a chat with BitoCard’s support, for anything you cannot do or decide.', { reason: text }, ['reason']));
    return list;
  }

  async run(scope: ToolScope, name: string, args: Record<string, unknown>): Promise<ToolOutcome> {
    try {
      switch (name) {
        case 'search_listings':
          return await this.searchListings(scope, args);
        case 'get_listing':
          return await this.getListing(scope, args);
        case 'compare_listings':
          return await this.compare(scope, args);
        case 'price_range':
          return await this.priceRange(scope, args);
        case 'safe_pay_quote':
          return await this.safePayQuote(scope, args);
        case 'safety_checklist':
          return await this.checklist(scope, args);
        case 'categories':
          return await this.categories(scope);
        case 'search_features':
          return await this.features(args);
        case 'draft_message':
          return await this.draftMessage(scope, args);
        case 'my_listings':
          return await this.myListings(scope);
        case 'my_orders':
          return await this.myOrders(scope);
        case 'my_conversations':
          return await this.myConversations(scope);
        case 'my_listing':
          return await this.myListing(scope);
        case 'chat_messages':
          return await this.chatMessages(scope);
        case 'offer_person': {
          const reason = str(args.reason, 200) || 'Talk to a person';
          return { result: 'The person sees a Talk to a person button.', cards: [{ type: 'person', reason }] };
        }
        default:
          return { result: 'That tool is not available here.' };
      }
    } catch (error) {
      // A refused input (an unknown category, a bad filter) goes back to the model to correct; anything else stops.
      if (error instanceof ApiError && error.getStatus() < 500) return { result: `Not possible: ${error.message}` };
      throw error;
    }
  }

  private active(scope: ToolScope) {
    return { country: scope.country, status: 'active' } as const;
  }

  private async searchListings(scope: ToolScope, args: Record<string, unknown>): Promise<ToolOutcome> {
    const features = Array.isArray(args.features) ? (args.features as Array<Record<string, unknown>>).slice(0, 6) : [];
    const f = features
      .map(item => {
        const key = str(item.key, 40).toLowerCase();
        if (!key) return null;
        const min = num(item.min);
        const max = num(item.max);
        if (min !== null || max !== null) return `${key}:${min ?? ''}..${max ?? ''}`;
        const value = str(item.value, 60);
        return value ? `${key}:${value}` : null;
      })
      .filter((item): item is string => Boolean(item));
    const units = (value: unknown) => {
      const amount = num(value);
      return amount === null ? undefined : Math.round(amount * 100);
    };
    const sort = searchSorts.includes(args.sort as SearchSort) ? (args.sort as SearchSort) : undefined;
    const condition = Array.isArray(args.condition) ? (args.condition as unknown[]).map(String).filter(item => (conditions as readonly string[]).includes(item)) : undefined;
    const narrowed = Boolean(args.id_checked_only || args.safe_pay_ready_only);
    const found = await this.search.search({
      country: scope.country,
      q: str(args.words) || undefined,
      category: slugOf(args.category),
      area: slugOf(args.area),
      state: slugOf(args.state),
      price_min: units(args.price_min),
      price_max: units(args.price_max),
      condition: condition?.length ? condition : undefined,
      f: f.length ? f : undefined,
      sort,
      limit: narrowed ? 50 : 10,
    });
    let cards = found.data;
    if (narrowed && cards.length) {
      const owners = await this.prisma.classifiedListing.findMany({ where: { id: { in: cards.map(card => card.id) } }, select: { id: true, customerId: true } });
      const ownerOf = new Map(owners.map(row => [row.id, row.customerId]));
      const ready = args.safe_pay_ready_only ? await this.safePayReady(scope.country, [...new Set(owners.map(row => row.customerId))]) : null;
      cards = cards.filter(card => (!args.id_checked_only || card.seller.badges.includes('id_checked')) && (!ready || ready.has(ownerOf.get(card.id)!)));
    }
    cards = cards.slice(0, 10);
    const result = cards.map(card => ({
      listing_id: card.id,
      title: card.title,
      price: card.price.amount === null ? 'on request' : priceText(card.price.amount, card.price.currency),
      negotiable: card.price.kind === 'negotiable',
      condition: card.condition,
      area: `${card.area.name}, ${card.area.state.name}`,
      highlights: card.highlights,
      seller_badges: card.seller.badges,
      where: card.tier,
      url: card.url,
    }));
    return { result: json({ total: found.total, shown: result.length, listings: result }), cards: cards.length ? [{ type: 'listings', items: cards }] : [], urls: cards.map(card => card.url) };
  }

  /** Sellers who could accept Safe pay now: identity checked and a payout account in the country (live). */
  private async safePayReady(country: string, customerIds: string[]) {
    if (!customerIds.length) return new Set<string>();
    const [checked, accounts] = await Promise.all([
      this.prisma.identityVerification.findMany({ where: { subject: 'customer', mode: 'live', status: 'approved', customerReference: { in: customerIds } }, select: { customerReference: true } }),
      this.prisma.customerBankAccount.findMany({ where: { customerId: { in: customerIds }, mode: 'live', country, removedAt: null }, select: { customerId: true } }),
    ]);
    const banked = new Set(accounts.map(row => row.customerId));
    return new Set(checked.map(row => row.customerReference).filter((id): id is string => Boolean(id) && banked.has(id!)));
  }

  /** An active listing in this country, by id. */
  private async listingRef(scope: ToolScope, id: unknown) {
    const listingId = str(id, 40);
    if (!uuidPattern.test(listingId)) return null;
    const row = await this.prisma.classifiedListing.findFirst({ where: { id: listingId, ...this.active(scope) }, select: { ref: true } });
    return row ? Number(row.ref) : null;
  }

  private async page(scope: ToolScope, id: unknown) {
    const ref = await this.listingRef(scope, id);
    return ref === null ? null : this.search.listing(scope.country, ref).catch(() => null);
  }

  private describe(page: NonNullable<Awaited<ReturnType<ShopAssistantTools['page']>>>) {
    return {
      listing_id: page.id,
      title: page.title,
      price: page.price.amount === null ? 'on request' : priceText(page.price.amount, page.price.currency),
      negotiable: page.price.kind === 'negotiable',
      condition: page.condition,
      category: page.category.name,
      area: `${page.area.name}, ${page.area.state.name}`,
      features: Object.fromEntries(page.features.map(feature => [feature.name, feature.value === null ? null : `${feature.value}${feature.unit && typeof feature.value === 'number' ? ` ${feature.unit}` : ''}`])),
      delivery: page.delivery,
      reserved: page.reserved,
      seller: { badges: page.seller.badges, active_listings: page.seller.active_listings, member_since: page.seller.member_since.slice(0, 7) },
      photos: page.photos.length,
      has_video: Boolean(page.video),
      safety_checks: page.category.safety_checklist,
      url: page.url,
    };
  }

  private async getListing(scope: ToolScope, args: Record<string, unknown>): Promise<ToolOutcome> {
    const page = await this.page(scope, args.listing_id);
    if (!page) return { result: 'No such active listing in this country.' };
    const card = (await this.search.cards([page.id])).get(page.id);
    return { result: [json(this.describe(page)), quoted('Description', page.description)].filter(Boolean).join('\n\n'), cards: card ? [{ type: 'listings', items: [card] }] : [], urls: [page.url] };
  }

  private async compare(scope: ToolScope, args: Record<string, unknown>): Promise<ToolOutcome> {
    const ids = Array.isArray(args.listing_ids) ? (args.listing_ids as unknown[]).slice(0, 4) : [];
    const pages = (await Promise.all(ids.map(id => this.page(scope, id)))).filter((page): page is NonNullable<typeof page> => Boolean(page));
    if (!pages.length) return { result: 'None of those are active listings in this country.' };
    const cards = await this.search.cards(pages.map(page => page.id));
    return { result: json(pages.map(page => this.describe(page))), cards: [{ type: 'compare', items: pages.map(page => cards.get(page.id)).filter(Boolean) }], urls: pages.map(page => page.url) };
  }

  /** The category and its subcategories, open in this country. */
  private async categoryIds(scope: ToolScope, slug: string | undefined) {
    if (!slug) return null;
    const category = await this.prisma.classifiedCategory.findFirst({ where: { slug, enabled: true, countries: { some: { country: scope.country, enabled: true } } }, include: { children: { where: { enabled: true }, select: { id: true } }, parent: true } });
    return category ? { category, ids: [category.id, ...category.children.map(child => child.id)] } : null;
  }

  /** The middle half of comparable active and recently sold prices; only with enough of them to say anything. */
  async priceRange(scope: ToolScope, args: Record<string, unknown>): Promise<ToolOutcome> {
    const found = await this.categoryIds(scope, slugOf(args.category));
    if (!found) return { result: 'No such category in this country: use the categories tool.' };
    const condition = (conditions as readonly string[]).includes(String(args.condition)) ? String(args.condition) : null;
    const wanted = Array.isArray(args.features) ? (args.features as Array<Record<string, unknown>>).slice(0, 4) : [];
    const registry = wanted.length ? await this.prisma.classifiedFeature.findMany({ where: { key: { in: wanted.map(item => str(item.key, 40).toLowerCase()) }, enabled: true } }) : [];
    const filters = wanted
      .map(item => {
        const feature = registry.find(row => row.key === str(item.key, 40).toLowerCase());
        const value = str(item.value, 60);
        if (!feature || !value) return null;
        if (feature.dataType === 'number') {
          const n = num(value);
          return n === null ? null : Prisma.sql`EXISTS (SELECT 1 FROM "classified_listing_features" lf WHERE lf."listing_id" = l."id" AND lf."feature_id" = ${feature.id}::uuid AND lf."value_number" = ${n})`;
        }
        return Prisma.sql`EXISTS (SELECT 1 FROM "classified_listing_features" lf WHERE lf."listing_id" = l."id" AND lf."feature_id" = ${feature.id}::uuid AND lower(lf."value_text") = ${value.toLowerCase()})`;
      })
      .filter((item): item is Prisma.Sql => Boolean(item));
    const since = new Date(Date.now() - 90 * 86_400_000);
    const where = [
      Prisma.sql`l."country" = ${scope.country}`,
      Prisma.sql`l."price_minor" IS NOT NULL`,
      Prisma.sql`l."category_id" IN (${Prisma.join(found.ids.map(id => Prisma.sql`${id}::uuid`))})`,
      Prisma.sql`(l."status" = 'active' OR (l."status" = 'sold' AND l."sold_at" >= ${since}))`,
      Prisma.sql`coalesce(l."published_at", l."created_at") >= ${since}`,
      ...(condition ? [Prisma.sql`l."condition" = ${condition}`] : []),
      ...filters,
    ];
    const [row] = await this.prisma.$queryRaw<{ low: number | null; median: number | null; high: number | null; count: bigint }[]>`
      SELECT percentile_cont(0.25) WITHIN GROUP (ORDER BY l."price_minor")::float8 AS low,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY l."price_minor")::float8 AS median,
             percentile_cont(0.75) WITHIN GROUP (ORDER BY l."price_minor")::float8 AS high,
             count(*) AS count
      FROM "classified_listings" l WHERE ${Prisma.join(where, ' AND ')}`;
    const count = Number(row?.count ?? 0);
    if (!row || count < minComparable || row.low === null || row.median === null || row.high === null) {
      return { result: json({ enough: false, comparable: count, note: 'Not enough comparable listings to say: do not guess a price.' }) };
    }
    const round = (value: number) => Math.round(value / 100) * 100;
    const card: AssistantCard = { type: 'price_range', category: found.category.name, currency: scope.currency, low: round(row.low), median: round(row.median), high: round(row.high), count };
    return {
      result: json({ enough: true, category: found.category.name, comparable: count, usual_low: priceText(card.low, scope.currency), median: priceText(card.median, scope.currency), usual_high: priceText(card.high, scope.currency), note: 'A range from other listings, not a valuation.' }),
      cards: [card],
    };
  }

  private async safePayQuote(scope: ToolScope, args: Record<string, unknown>): Promise<ToolOutcome> {
    if (!(await this.settings.isOnForCountry('classifieds_safe_pay', scope.country))) return { result: 'Safe pay is not open in this country yet: point to the Safe Trade Guide.' };
    const settings = await this.prisma.classifiedSafePaySettings.findUnique({ where: { country: scope.country } });
    if (!settings || settings.buyerFeeBps === null || settings.buyerFeeCapMinor === null) return { result: 'Safe pay is not set up in this country yet.' };
    let price: bigint | null = null;
    let listingId: string | null = null;
    if (args.listing_id) {
      const listing = await this.prisma.classifiedListing.findFirst({ where: { id: uuidPattern.test(str(args.listing_id, 40)) ? str(args.listing_id, 40) : '00000000-0000-0000-0000-000000000000', ...this.active(scope) }, select: { id: true, priceMinor: true } });
      if (!listing) return { result: 'No such active listing in this country.' };
      if (listing.priceMinor === null) return { result: 'This listing’s price is on request: agree a price in the chat first.' };
      price = listing.priceMinor;
      listingId = listing.id;
    } else {
      const amount = num(args.price);
      if (amount === null || amount <= 0) return { result: 'Give a listing or a price.' };
      price = BigInt(Math.round(amount * 100));
    }
    const fee = safePayFee(price, settings.buyerFeeBps, settings.buyerFeeCapMinor);
    const card: AssistantCard = { type: 'safe_pay', currency: scope.currency, price: Number(price), fee: Number(fee), total: Number(price + fee), listing_id: listingId };
    return { result: json({ price: priceText(price, scope.currency), buyer_fee: priceText(fee, scope.currency), total: priceText(price + fee, scope.currency), note: 'Paid from the BitoCard wallet; held by BitoCard until the buyer has the item.' }), cards: [card] };
  }

  private async checklist(scope: ToolScope, args: Record<string, unknown>): Promise<ToolOutcome> {
    const found = await this.categoryIds(scope, slugOf(args.category));
    const own = found ? (found.category.safetyChecklist.length ? found.category.safetyChecklist : (found.category.parent?.safetyChecklist ?? [])) : [];
    const general = safeTradeGuide.flatMap(group => group.items);
    return {
      result: json({ category: found?.category.name ?? null, category_checks: own, general: safeTradeGuide, red_flags: redFlags }),
      cards: [{ type: 'checklist', category: found?.category.name ?? null, items: own.length ? own : general }],
    };
  }

  private async categories(scope: ToolScope): Promise<ToolOutcome> {
    const rows = await this.prisma.classifiedCategory.findMany({
      where: { enabled: true, parentId: null, countries: { some: { country: scope.country, enabled: true } } },
      orderBy: { position: 'asc' },
      include: { children: { where: { enabled: true, countries: { some: { country: scope.country, enabled: true } } }, orderBy: { position: 'asc' }, select: { slug: true, name: true } } },
    });
    return { result: json(rows.map(row => ({ slug: row.slug, name: row.name, subcategories: row.children }))) };
  }

  private async features(args: Record<string, unknown>): Promise<ToolOutcome> {
    const words = str(args.words, 60).toLowerCase();
    if (words.length < 2) return { result: '[]' };
    const rows = await this.prisma.classifiedFeature.findMany({ where: { enabled: true, OR: [{ name: { contains: words, mode: 'insensitive' } }, { key: { contains: words.replace(/\s+/g, '_') } }, { synonyms: { has: words } }] }, take: 10, orderBy: { name: 'asc' } });
    return { result: json(rows.map(row => ({ key: row.key, name: row.name, type: row.dataType, unit: row.unit, choices: row.choices.length ? row.choices : undefined, min: row.min ?? undefined, max: row.max ?? undefined, filter: row.filterable }))) };
  }

  private async draftMessage(scope: ToolScope, args: Record<string, unknown>): Promise<ToolOutcome> {
    const page = await this.page(scope, args.listing_id);
    if (!page) return { result: 'No such active listing in this country.' };
    const body = cleanMessage(str(args.text, 500));
    if (!body || linkPattern.test(body) || /\+?\d[\d\s-]{7,}\d/.test(body)) return { result: 'Write it again without links, phone numbers or payment details.' };
    return { result: 'Shown to the buyer to edit and send themselves.', cards: [{ type: 'message_draft', listing_id: page.id, title: page.title, url: page.url, text: body }], urls: [page.url] };
  }

  private requireCustomer(scope: ToolScope) {
    if (!scope.customer) throw new ApiError(HttpStatus.UNAUTHORIZED, 'authentication_error', 'unauthenticated', 'The person must sign in for this.');
    return scope.customer;
  }

  private async myListings(scope: ToolScope): Promise<ToolOutcome> {
    const customer = this.requireCustomer(scope);
    const rows = await this.prisma.classifiedListing.findMany({ where: { customerId: customer.id, country: scope.country, status: { notIn: ['deleted'] } }, orderBy: { updatedAt: 'desc' }, take: 20, select: { id: true, ref: true, title: true, slug: true, status: true, priceMinor: true, currency: true, views: true, leads: true, expiresAt: true } });
    const items = rows.map(row => ({ listing_id: row.id, title: row.title ?? '(untitled draft)', status: row.status, price: row.priceMinor === null ? null : priceText(row.priceMinor, row.currency), views: row.views, leads: row.leads, expires: row.expiresAt?.toISOString().slice(0, 10) ?? null }));
    return { result: json(items), cards: items.length ? [{ type: 'my_listings', items }] : [] };
  }

  private async myOrders(scope: ToolScope): Promise<ToolOutcome> {
    const customer = this.requireCustomer(scope);
    const rows = await this.prisma.classifiedOrder.findMany({
      where: { OR: [{ buyerId: customer.id }, { sellerId: customer.id }], country: scope.country },
      orderBy: { updatedAt: 'desc' },
      take: 10,
      select: { id: true, number: true, status: true, priceMinor: true, currency: true, buyerId: true, fulfilment: true, listing: { select: { title: true } } },
    });
    const items = rows.map(row => {
      const side = row.buyerId === customer.id ? 'buyer' : 'seller';
      return { order_id: row.id, number: `SP-${String(row.number).padStart(6, '0')}`, listing: row.listing.title, side, status: row.status, price: priceText(row.priceMinor, row.currency), fulfilment: row.fulfilment, next: nextStep[row.status]?.[side] ?? null };
    });
    return { result: json(items), cards: items.length ? [{ type: 'orders', items }] : [] };
  }

  private async myConversations(scope: ToolScope): Promise<ToolOutcome> {
    const customer = this.requireCustomer(scope);
    const rows = await this.prisma.classifiedConversation.findMany({
      where: { OR: [{ buyerId: customer.id }, { sellerId: customer.id }], country: scope.country },
      orderBy: { lastMessageAt: 'desc' },
      take: 15,
      include: { listing: { select: { title: true } }, messages: { orderBy: { seq: 'desc' }, take: 1, select: { senderId: true } } },
    });
    return {
      result: json(
        rows.map(row => {
          const side = row.buyerId === customer.id ? 'buying' : 'selling';
          const last = row.messages[0];
          return { listing: row.listing.title, side, waiting_for: !last ? null : last.senderId === customer.id ? 'them' : 'you', last_message: row.lastMessageAt.toISOString().slice(0, 16).replace('T', ' ') };
        }),
      ),
    };
  }

  /** The seller's own listing (drafts too): what is filled in and what is missing. */
  async ownListing(customerId: string, listingId: string) {
    const row = await this.prisma.classifiedListing.findFirst({
      where: { id: listingId, customerId, status: { not: 'deleted' } },
      include: {
        category: { include: { features: { orderBy: { position: 'asc' }, include: { feature: true } }, parent: true } },
        features: { include: { feature: true } },
        media: { where: { status: 'ready' }, select: { id: true, kind: true } },
        area: true,
      },
    });
    return row;
  }

  private async myListing(scope: ToolScope): Promise<ToolOutcome> {
    const customer = this.requireCustomer(scope);
    const row = scope.listingId ? await this.ownListing(customer.id, scope.listingId) : null;
    if (!row) return { result: 'No listing open.' };
    const filled = new Set(row.features.map(item => item.featureId));
    return {
      result: [
        json({
          title: row.title,
          status: row.status,
          category: row.category?.name ?? null,
          price: row.priceMinor === null ? null : priceText(row.priceMinor, row.currency),
          condition: row.condition,
          area: row.area?.name ?? null,
          photos: row.media.filter(item => item.kind === 'photo').length,
          video: row.media.some(item => item.kind === 'video'),
          features: Object.fromEntries(row.features.map(item => [item.feature.key, featureValueOut(item.feature.dataType, item)])),
          missing_features: (row.category?.features ?? []).filter(link => link.feature.enabled && !filled.has(link.featureId)).map(link => ({ key: link.feature.key, name: link.feature.name })),
        }),
        quoted('Description', row.description),
      ]
        .filter(Boolean)
        .join('\n\n'),
    };
  }

  /** The latest messages of the chat the seller opened the assistant from (only theirs, only that one). */
  async chatTranscript(customerId: string, conversationId: string) {
    const chat = await this.prisma.classifiedConversation.findFirst({ where: { id: conversationId, OR: [{ buyerId: customerId }, { sellerId: customerId }] }, include: { listing: { select: { title: true } }, messages: { orderBy: { seq: 'desc' }, take: 20, where: { kind: { in: ['text', 'offer'] } }, include: { offer: true } } } });
    if (!chat) return null;
    const lines = chat.messages
      .reverse()
      .map(message => `${message.senderId === customerId ? 'Me' : 'Them'}: ${message.kind === 'offer' && message.offer ? `(offer ${priceText(message.offer.priceMinor, message.offer.currency)}, ${message.offer.status}) ` : ''}${message.body}`);
    return { title: chat.listing.title, side: chat.sellerId === customerId ? 'seller' : 'buyer', lines };
  }

  private async chatMessages(scope: ToolScope): Promise<ToolOutcome> {
    const customer = this.requireCustomer(scope);
    const chat = scope.conversationId ? await this.chatTranscript(customer.id, scope.conversationId) : null;
    if (!chat) return { result: 'No chat open.' };
    return { result: [`Listing: ${chat.title ?? ''}; the person is the ${chat.side}.`, quoted('Messages', chat.lines.join('\n'), 3000)].filter(Boolean).join('\n\n') };
  }
}
