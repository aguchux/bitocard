import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { ListingsService } from '../../classifieds/listings.service.js';
import { ListingMediaService } from '../../classifieds/media.service.js';
import { ShopTermsService } from '../../classifieds/terms.service.js';
import { conditionName, priceText } from '../../classifieds/rules.js';
import { PostingJourneysService } from '../../postings/journeys.service.js';
import { WhatsappOutbox } from '../outbox.service.js';
import { words } from '../messages.js';
import { type BotContext, type FlowState, matchAreas, matchSubcategories, placeName, problemText, readPrice, subcategories, topCategories, typed } from './context.js';

type Step = 'draft_choice' | 'title' | 'category' | 'subcategory' | 'condition' | 'price' | 'area' | 'photos' | 'description' | 'brand' | 'summary' | 'terms';
type SellState = FlowState & { step: Step; listingId?: string; page?: number; editing?: boolean };

const device = 'WhatsApp';
const pageSize = 9;

/**
 * Selling on WhatsApp, one step at a time with lists and buttons (no AI): an ordinary draft is made at the first step
 * and saved after each, through the same listing rules as udozo.com (so it shows in My listings too), then submitted
 * the same way (terms, what submitting needs, photos, moderation, limits). Its posting journey says `whatsapp`.
 */
@Injectable()
export class SellFlow {
  constructor(
    private readonly prisma: PrismaService,
    private readonly listings: ListingsService,
    private readonly media: ListingMediaService,
    private readonly terms: ShopTermsService,
    private readonly journeys: PostingJourneysService,
    private readonly outbox: WhatsappOutbox,
  ) {}

  private async go(ctx: BotContext, state: SellState) {
    await ctx.setFlow('sell', state);
  }

  async start(ctx: BotContext) {
    if (!ctx.customer) return ctx.needAccount();
    try {
      await this.listings.sellerCountry(ctx.customer);
    } catch (error) {
      return ctx.say({ type: 'text', body: problemText(error) });
    }
    this.journeys.client({ id: ctx.customer.id, country: ctx.customer.country }, { type: 'sell_opened', source: 'whatsapp' }, device);
    const draft = await this.prisma.classifiedListing.findFirst({ where: { customerId: ctx.customer.id, status: 'draft', title: { not: null } }, orderBy: { updatedAt: 'desc' }, select: { id: true, title: true } });
    if (draft) {
      await this.go(ctx, { step: 'draft_choice', listingId: draft.id });
      return ctx.say({ type: 'buttons', body: words.continueDraft(draft.title!), buttons: words.draftButtons });
    }
    await this.go(ctx, { step: 'title' });
    await ctx.say({ type: 'text', body: words.sellIntro });
    return ctx.say({ type: 'text', body: words.askTitle });
  }

  /** A step's answer (typed, a photo or a choice). */
  async step(ctx: BotContext) {
    if (!ctx.customer) return ctx.needAccount();
    const state = ctx.state as SellState;
    const choice = ctx.input.choice ?? '';
    try {
      if (choice === 'sell:new') return this.toStep(ctx, { step: 'title' });
      if (choice === 'sell:continue' && state.listingId) return this.resume(ctx, state.listingId);
      if (choice === 'sell:change') return ctx.say({ type: 'list', body: 'What would you like to change?', button: words.changeButton, rows: words.changeRows });
      if (choice.startsWith('sell:edit:')) return this.edit(ctx, state, choice.slice('sell:edit:'.length));
      if (choice === 'sell:draft') {
        await ctx.setFlow(null);
        return ctx.say({ type: 'text', body: words.draftKept(`${ctx.site}/account/listings/${state.listingId}`) });
      }
      if (choice === 'sell:post') return this.post(ctx, state);
      if (choice === 'sell:terms:accept') {
        const terms = await this.terms.status(ctx.customer.id);
        await this.terms.accept(ctx.customer.id, terms.version);
        return this.post(ctx, state);
      }
      switch (state.step) {
        case 'draft_choice':
          return ctx.say({ type: 'buttons', body: 'Carry on with your draft, or start a new ad?', buttons: words.draftButtons });
        case 'title':
          return this.title(ctx, state);
        case 'category':
        case 'subcategory':
          return this.category(ctx, state);
        case 'condition':
          return this.condition(ctx, state);
        case 'price':
          return this.price(ctx, state);
        case 'area':
          return this.area(ctx, state);
        case 'photos':
          return this.photos(ctx, state);
        case 'description':
          return this.description(ctx, state);
        case 'brand':
          return this.brand(ctx, state);
        default:
          return this.summary(ctx, state);
      }
    } catch (error) {
      return ctx.say({ type: 'text', body: problemText(error) });
    }
  }

  private save(ctx: BotContext, state: SellState, input: Parameters<ListingsService['update']>[2]) {
    const saved = this.listings.update(ctx.customer!, state.listingId!, input);
    void saved.then(answer => this.journeys.api({ step: 'save', customerId: ctx.customer!.id, country: ctx.customer!.country, listingId: state.listingId!, answer: answer as never, device }), () => undefined);
    return saved;
  }

  /** The next step: back to the summary while changing one thing, else the one after. */
  private async next(ctx: BotContext, state: SellState, step: Step) {
    return this.toStep(ctx, state.editing ? { ...state, step: 'summary', editing: false } : { ...state, step });
  }

  /** Asks the question a step needs. */
  private async toStep(ctx: BotContext, state: SellState): Promise<void> {
    await this.go(ctx, state);
    switch (state.step) {
      case 'title':
        return ctx.say({ type: 'text', body: words.askTitle });
      case 'category':
        return this.askCategory(ctx, state, state.page ?? 0);
      case 'condition':
        return ctx.say({ type: 'list', body: words.askCondition, button: 'Condition', rows: words.conditionRows });
      case 'price':
        return ctx.say({ type: 'buttons', body: words.askPrice, buttons: words.priceButtons });
      case 'area': {
        const home = ctx.customer?.areaId ? await this.prisma.classifiedArea.findUnique({ where: { id: ctx.customer.areaId }, include: { parent: true } }) : null;
        if (home) return ctx.say({ type: 'buttons', body: words.askArea(placeName(home)), buttons: [{ id: `sell:area:${home.id}`, title: `Use ${home.name}` }] });
        return ctx.say({ type: 'text', body: words.askArea(null) });
      }
      case 'photos': {
        const settings = await this.listings.marketSettings(ctx.country);
        const count = await this.photoCount(state.listingId!);
        return ctx.say(count >= settings.minPhotos ? { type: 'buttons', body: `${words.askPhotos(settings.minPhotos, settings.maxPhotos)} You have ${count}.`, buttons: words.photosDone } : { type: 'text', body: words.askPhotos(settings.minPhotos, settings.maxPhotos) });
      }
      case 'description':
        return ctx.say({ type: 'buttons', body: words.askDescription, buttons: words.skipButton('sell:desc:skip') });
      case 'brand': {
        const brands = await this.brandsFor(state.listingId!);
        return ctx.say(brands.length ? { type: 'list', body: words.askBrand, button: 'Brands', rows: brands.map(name => ({ id: `sell:brand:${name.slice(0, 60)}`, title: name })) } : { type: 'text', body: words.askBrand });
      }
      default:
        return this.summary(ctx, state);
    }
  }

  private async resume(ctx: BotContext, listingId: string) {
    const listing = await this.prisma.classifiedListing.findUnique({ where: { id: listingId }, select: { title: true, categoryId: true, condition: true, priceKind: true, priceMinor: true, areaId: true } });
    if (!listing) return this.toStep(ctx, { step: 'title' });
    const state: SellState = { step: 'title', listingId };
    const settings = await this.listings.marketSettings(ctx.country);
    const step: Step = !listing.title
      ? 'title'
      : !listing.categoryId
        ? 'category'
        : !listing.condition
          ? 'condition'
          : listing.priceKind !== 'on_request' && listing.priceMinor === null
            ? 'price'
            : !listing.areaId
              ? 'area'
              : (await this.photoCount(listingId)) < settings.minPhotos
                ? 'photos'
                : 'summary';
    return this.toStep(ctx, { ...state, step });
  }

  private edit(ctx: BotContext, state: SellState, field: string) {
    const step = ({ title: 'title', category: 'category', condition: 'condition', price: 'price', area: 'area', photos: 'photos', description: 'description' } as const)[field as 'title'];
    return step ? this.toStep(ctx, { ...state, step, editing: true, page: 0 }) : this.summary(ctx, state);
  }

  private async title(ctx: BotContext, state: SellState) {
    const title = typed(ctx);
    if (ctx.input.kind !== 'text' || title.length < 3) return ctx.say({ type: 'text', body: words.askTitle });
    if (state.listingId) await this.save(ctx, state, { title });
    else {
      const created = await this.listings.create(ctx.customer!, { title });
      this.journeys.api({ step: 'create', customerId: ctx.customer!.id, country: ctx.customer!.country, listingId: created.id, answer: created as never, device });
      state = { ...state, listingId: created.id };
    }
    return this.next(ctx, { ...state, page: 0 }, 'category');
  }

  private async askCategory(ctx: BotContext, state: SellState, page: number) {
    const tops = await topCategories(this.prisma, ctx.country);
    const shown = tops.slice(page * pageSize, page * pageSize + pageSize);
    const rows = shown.map(top => ({ id: `sell:top:${top.id}`, title: top.name }));
    if (tops.length > (page + 1) * pageSize) rows.push(words.moreCategories);
    await this.go(ctx, { ...state, step: 'category', page });
    return ctx.say({ type: 'list', body: words.askCategory, button: words.categoryButton, rows });
  }

  private async category(ctx: BotContext, state: SellState) {
    const choice = ctx.input.choice ?? '';
    if (choice === 'sell:cat:more') return this.askCategory(ctx, state, (state.page ?? 0) + 1);
    if (choice.startsWith('sell:top:')) {
      const subs = await subcategories(this.prisma, choice.slice('sell:top:'.length), ctx.country);
      if (subs.length === 1) return this.chooseCategory(ctx, state, subs[0]!.id);
      const top = await this.prisma.classifiedCategory.findUnique({ where: { id: choice.slice('sell:top:'.length) }, select: { name: true } });
      await this.go(ctx, { ...state, step: 'subcategory' });
      return ctx.say({ type: 'list', body: words.askSubcategory(top?.name ?? 'it'), button: words.categoryButton, rows: subs.slice(0, 10).map(sub => ({ id: `sell:sub:${sub.id}`, title: sub.name })) });
    }
    if (choice.startsWith('sell:sub:')) return this.chooseCategory(ctx, state, choice.slice('sell:sub:'.length));
    if (ctx.input.kind === 'text') {
      const found = await matchSubcategories(this.prisma, ctx.country, typed(ctx));
      if (found.length) return ctx.say({ type: 'list', body: words.askCategory, button: words.categoryButton, rows: found.map(sub => ({ id: `sell:sub:${sub.id}`, title: sub.name })) });
    }
    return this.askCategory(ctx, state, 0);
  }

  private async chooseCategory(ctx: BotContext, state: SellState, categoryId: string) {
    await this.save(ctx, state, { category_id: categoryId });
    return this.next(ctx, state, 'condition');
  }

  private async condition(ctx: BotContext, state: SellState) {
    const condition = (ctx.input.choice ?? '').replace(/^sell:cond:/, '');
    if (!['new', 'used', 'untested', 'parts'].includes(condition)) return this.toStep(ctx, state);
    await this.save(ctx, state, { condition: condition as 'new' });
    return this.next(ctx, state, 'price');
  }

  private async price(ctx: BotContext, state: SellState) {
    if (ctx.input.choice === 'sell:price:ask') await this.save(ctx, state, { price_kind: 'on_request', price: null });
    else {
      const price = ctx.input.kind === 'text' ? readPrice(typed(ctx)) : null;
      if (price === null) return ctx.say({ type: 'buttons', body: words.priceInvalid, buttons: words.priceButtons });
      await this.save(ctx, state, { price_kind: 'negotiable', price });
    }
    return this.next(ctx, state, 'area');
  }

  private async area(ctx: BotContext, state: SellState) {
    const choice = ctx.input.choice ?? '';
    if (choice.startsWith('sell:area:')) {
      await this.save(ctx, state, { area_id: choice.slice('sell:area:'.length) });
      return this.next(ctx, state, 'photos');
    }
    const found = ctx.input.kind === 'text' ? await matchAreas(this.prisma, ctx.country, typed(ctx)) : [];
    if (!found.length) return ctx.say({ type: 'text', body: words.noArea });
    if (found.length === 1) {
      await this.save(ctx, state, { area_id: found[0]!.id });
      return this.next(ctx, state, 'photos');
    }
    return ctx.say({ type: 'list', body: 'Which one?', button: words.areaButton, rows: found.map(area => ({ id: `sell:area:${area.id}`, title: area.name, description: area.parent?.name })) });
  }

  private photoCount(listingId: string) {
    return this.prisma.classifiedMedia.count({ where: { listingId, kind: 'photo', status: 'ready' } });
  }

  private async photos(ctx: BotContext, state: SellState) {
    const settings = await this.listings.marketSettings(ctx.country);
    if (ctx.input.choice === 'sell:photos:done') {
      const count = await this.photoCount(state.listingId!);
      if (count < settings.minPhotos) return ctx.say({ type: 'text', body: words.photosNeeded(settings.minPhotos, count) });
      return this.next(ctx, state, 'description');
    }
    if (ctx.input.kind !== 'image' || !ctx.input.imageId) return ctx.say({ type: 'text', body: words.askPhotos(settings.minPhotos, settings.maxPhotos) });
    const file = await this.outbox.cloud().media(ctx.input.imageId, 4 * 1024 * 1024);
    await this.media.addPhoto(ctx.customer!, state.listingId!, { buffer: file.bytes, mimetype: file.contentType, size: file.bytes.length, originalname: 'whatsapp.jpg' });
    this.journeys.api({ step: 'photo', customerId: ctx.customer!.id, country: ctx.customer!.country, listingId: state.listingId!, answer: null, device });
    const count = await this.photoCount(state.listingId!);
    if (count >= settings.maxPhotos) return this.next(ctx, state, 'description');
    return ctx.say(count >= settings.minPhotos ? { type: 'buttons', body: words.photoAdded(count, settings.minPhotos), buttons: words.photosDone } : { type: 'text', body: words.photoAdded(count, settings.minPhotos) });
  }

  private async description(ctx: BotContext, state: SellState) {
    if (ctx.input.choice !== 'sell:desc:skip') {
      if (ctx.input.kind !== 'text' || !typed(ctx)) return this.toStep(ctx, state);
      await this.save(ctx, state, { description: typed(ctx).slice(0, 4000) });
    }
    if (state.editing) return this.next(ctx, state, 'summary');
    // A brand is asked only where the category asks for one, and only on a draft with no features yet (so a draft
    // begun on udozo.com never loses what was chosen there).
    const [asks, features] = await Promise.all([this.categoryAsksBrand(state.listingId!), this.prisma.classifiedListingFeature.count({ where: { listingId: state.listingId! } })]);
    return this.next(ctx, state, asks && !features ? 'brand' : 'summary');
  }

  private async categoryAsksBrand(listingId: string) {
    const listing = await this.prisma.classifiedListing.findUnique({ where: { id: listingId }, select: { categoryId: true } });
    if (!listing?.categoryId) return false;
    return (await this.prisma.classifiedCategoryFeature.count({ where: { categoryId: listing.categoryId, feature: { key: 'brand' } } })) > 0;
  }

  private async brandsFor(listingId: string) {
    const listing = await this.prisma.classifiedListing.findUnique({ where: { id: listingId }, select: { categoryId: true } });
    if (!listing?.categoryId) return [];
    const rows = await this.prisma.classifiedBrandCategory.findMany({ where: { categoryId: listing.categoryId, brand: { enabled: true } }, orderBy: { position: 'asc' }, take: 10, select: { brand: { select: { name: true } } } });
    return rows.map(row => row.brand.name);
  }

  private async brand(ctx: BotContext, state: SellState) {
    const choice = ctx.input.choice ?? '';
    const brand = choice.startsWith('sell:brand:') ? choice.slice('sell:brand:'.length) : ctx.input.kind === 'text' ? typed(ctx).slice(0, 60) : '';
    if (!brand) return this.toStep(ctx, state);
    await this.save(ctx, state, { features: [{ key: 'brand', value: brand }] });
    return this.next(ctx, state, 'summary');
  }

  private async summary(ctx: BotContext, state: SellState): Promise<void> {
    await this.go(ctx, { ...state, step: 'summary', editing: false });
    const listing = await this.prisma.classifiedListing.findUnique({
      where: { id: state.listingId! },
      include: { category: { select: { name: true } }, area: { include: { parent: true } }, media: { where: { kind: 'photo', status: 'ready' }, select: { id: true } } },
    });
    if (!listing) return this.toStep(ctx, { step: 'title' });
    const price = listing.priceKind === 'on_request' || listing.priceMinor === null ? 'Ask for price' : priceText(listing.priceMinor, listing.currency);
    const lines = [
      `*${listing.title ?? 'No title yet'}*`,
      `Category: ${listing.category?.name ?? 'not chosen'}`,
      `Condition: ${conditionName(listing.condition) ?? 'not chosen'}`,
      `Price: ${price}`,
      `Place: ${placeName(listing.area) ?? 'not chosen'}`,
      `Photos: ${listing.media.length}`,
      ...(listing.description ? [`Description: ${listing.description.slice(0, 200)}${listing.description.length > 200 ? '…' : ''}`] : []),
    ];
    return ctx.say({ type: 'buttons', body: lines.join('\n'), buttons: words.summaryButtons });
  }

  private async post(ctx: BotContext, state: SellState) {
    if (!state.listingId) return this.toStep(ctx, { step: 'title' });
    if (!(await this.terms.accepted(ctx.customer!.id))) {
      await this.go(ctx, { ...state, step: 'terms' });
      return ctx.say({ type: 'buttons', body: words.terms(`${ctx.site}/legal/terms`), buttons: words.termsButtons });
    }
    let submitted: Awaited<ReturnType<ListingsService['submit']>>;
    try {
      submitted = await this.listings.submit(ctx.customer!, state.listingId);
      this.journeys.api({ step: 'submit', customerId: ctx.customer!.id, country: ctx.customer!.country, listingId: state.listingId, answer: submitted as never, device });
    } catch (error) {
      this.journeys.api({ step: 'submit', customerId: ctx.customer!.id, country: ctx.customer!.country, listingId: state.listingId, answer: null, error, device });
      const param = (error as { param?: string }).param;
      await ctx.say({ type: 'text', body: problemText(error) });
      const fix = ({ title: 'title', category_id: 'category', condition: 'condition', price: 'price', area_id: 'area', photos: 'photos' } as Record<string, Step>)[param ?? ''];
      return fix ? this.toStep(ctx, { ...state, step: fix, editing: true, page: 0 }) : undefined;
    }
    await ctx.setFlow(null);
    const saved = await this.prisma.classifiedListing.findUnique({ where: { id: state.listingId }, select: { ref: true, slug: true } });
    const link = `${ctx.site}/${ctx.country.toLowerCase()}/l/${saved?.ref ?? submitted.ref}-${saved?.slug ?? ''}`;
    return ctx.say({ type: 'text', body: submitted.status === 'active' ? words.posted(link) : words.inReview(link), previewUrl: true });
  }
}
