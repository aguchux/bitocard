import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { WantedService } from '../../classifieds/wanted/wanted.service.js';
import { priceText } from '../../classifieds/rules.js';
import { words } from '../messages.js';
import { type BotContext, type FlowState, matchAreas, matchSubcategories, placeName, problemText, readPrice, subcategories, topCategories, typed } from './context.js';

type Step = 'words' | 'category' | 'area' | 'budget' | 'condition' | 'summary';
type WantedState = FlowState & { step: Step; words?: string; categoryId?: string; categoryName?: string; areaId?: string | null; budgetMax?: number | null; conditions?: string[] };

/**
 * Wanted requests on WhatsApp: the buyer says what they need, confirms the category, place, budget and condition,
 * and posts it through the same rules as udozo.com; matching listings come back at once. Sellers told of a request
 * answer it here by choosing one of their listings.
 */
@Injectable()
export class WantedFlow {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wanted: WantedService,
  ) {}

  private go(ctx: BotContext, state: WantedState) {
    return ctx.setFlow('wanted', state);
  }

  async start(ctx: BotContext) {
    if (!ctx.customer) return ctx.needAccount();
    if (!(await this.wanted.open(ctx.country))) return ctx.say({ type: 'text', body: 'Requests are not open in your country yet. Send what you are looking for to search instead.' });
    await this.go(ctx, { step: 'words' });
    await ctx.say({ type: 'text', body: words.wantIntro });
    return ctx.say({ type: 'text', body: words.askWanted });
  }

  async step(ctx: BotContext) {
    if (!ctx.customer) return ctx.needAccount();
    const state = ctx.state as WantedState;
    const choice = ctx.input.choice ?? '';
    try {
      if (choice === 'want:post') return this.post(ctx, state);
      switch (state.step) {
        case 'words': {
          const text = typed(ctx);
          if (ctx.input.kind !== 'text' || text.length < 3) return ctx.say({ type: 'text', body: words.askWanted });
          const guess = (await matchSubcategories(this.prisma, ctx.country, text))[0];
          const next: WantedState = { ...state, step: 'category', words: text.slice(0, 80), ...(guess ? { categoryId: guess.id, categoryName: guess.name } : {}) };
          await this.go(ctx, next);
          if (guess) return ctx.say({ type: 'buttons', body: words.categoryGuess(guess.name), buttons: words.guessButtons });
          return this.askCategory(ctx);
        }
        case 'category':
          return this.category(ctx, state);
        case 'area':
          return this.area(ctx, state);
        case 'budget': {
          let budget: number | null = null;
          if (choice !== 'want:budget:skip') {
            budget = ctx.input.kind === 'text' ? readPrice(typed(ctx)) : null;
            if (budget === null) return ctx.say({ type: 'buttons', body: words.askBudget, buttons: words.skipButton('want:budget:skip') });
          }
          await this.go(ctx, { ...state, step: 'condition', budgetMax: budget });
          return ctx.say({ type: 'buttons', body: words.askWantedCondition, buttons: words.wantedConditionButtons });
        }
        case 'condition': {
          const pick = choice.replace(/^want:cond:/, '');
          const conditions = pick === 'new' ? ['new'] : pick === 'used' ? ['used', 'untested'] : [];
          return this.summary(ctx, { ...state, step: 'summary', conditions });
        }
        default:
          return this.summary(ctx, state);
      }
    } catch (error) {
      return ctx.say({ type: 'text', body: problemText(error) });
    }
  }

  private async askCategory(ctx: BotContext) {
    const tops = await topCategories(this.prisma, ctx.country);
    return ctx.say({ type: 'list', body: words.askCategory, button: words.categoryButton, rows: tops.slice(0, 10).map(top => ({ id: `want:top:${top.id}`, title: top.name })) });
  }

  private async category(ctx: BotContext, state: WantedState) {
    const choice = ctx.input.choice ?? '';
    if (choice === 'want:cat:yes' && state.categoryId) return this.askArea(ctx, state);
    if (choice === 'want:cat:other') return this.askCategory(ctx);
    if (choice.startsWith('want:top:')) {
      const subs = await subcategories(this.prisma, choice.slice('want:top:'.length), ctx.country);
      return ctx.say({ type: 'list', body: 'Which part?', button: words.categoryButton, rows: subs.slice(0, 10).map(sub => ({ id: `want:sub:${sub.id}`, title: sub.name })) });
    }
    if (choice.startsWith('want:sub:')) {
      const category = await this.prisma.classifiedCategory.findUnique({ where: { id: choice.slice('want:sub:'.length) }, select: { id: true, name: true } });
      if (category) return this.askArea(ctx, { ...state, categoryId: category.id, categoryName: category.name });
    }
    if (ctx.input.kind === 'text') {
      const found = await matchSubcategories(this.prisma, ctx.country, typed(ctx));
      if (found.length) return ctx.say({ type: 'list', body: words.askCategory, button: words.categoryButton, rows: found.map(sub => ({ id: `want:sub:${sub.id}`, title: sub.name })) });
    }
    return this.askCategory(ctx);
  }

  private async askArea(ctx: BotContext, state: WantedState) {
    await this.go(ctx, { ...state, step: 'area' });
    const home = ctx.customer?.areaId ? await this.prisma.classifiedArea.findUnique({ where: { id: ctx.customer.areaId }, include: { parent: true } }) : null;
    const buttons = [...(home ? [{ id: `want:area:${home.id}`, title: `Near ${home.name}` }] : []), { id: 'want:area:any', title: 'Anywhere' }];
    return ctx.say({ type: 'buttons', body: home ? words.askArea(placeName(home)) : 'Where? Type the town or area, or choose Anywhere.', buttons });
  }

  private async area(ctx: BotContext, state: WantedState) {
    const choice = ctx.input.choice ?? '';
    let areaId: string | null | undefined;
    if (choice === 'want:area:any') areaId = null;
    else if (choice.startsWith('want:area:')) areaId = choice.slice('want:area:'.length);
    else if (ctx.input.kind === 'text') {
      const found = await matchAreas(this.prisma, ctx.country, typed(ctx));
      if (found.length === 1) areaId = found[0]!.id;
      else if (found.length) return ctx.say({ type: 'list', body: 'Which one?', button: words.areaButton, rows: found.map(area => ({ id: `want:area:${area.id}`, title: area.name, description: area.parent?.name })) });
      else return ctx.say({ type: 'text', body: words.noArea });
    }
    if (areaId === undefined) return this.askArea(ctx, state);
    await this.go(ctx, { ...state, step: 'budget', areaId });
    return ctx.say({ type: 'buttons', body: words.askBudget, buttons: words.skipButton('want:budget:skip') });
  }

  private async summary(ctx: BotContext, state: WantedState) {
    await this.go(ctx, { ...state, step: 'summary' });
    const area = state.areaId ? await this.prisma.classifiedArea.findUnique({ where: { id: state.areaId }, include: { parent: true } }) : null;
    const currency = (await this.prisma.country.findUnique({ where: { code: ctx.country }, select: { currency: true } }))?.currency ?? 'NGN';
    const lines = [
      `*${state.words}*`,
      `Category: ${state.categoryName ?? 'not chosen'}`,
      `Where: ${placeName(area) ?? 'anywhere'}`,
      `Budget: ${state.budgetMax ? `up to ${priceText(state.budgetMax, currency)}` : 'not given'}`,
      `Condition: ${state.conditions?.includes('new') ? 'New' : state.conditions?.length ? 'Used' : 'Either'}`,
    ];
    return ctx.say({ type: 'buttons', body: lines.join('\n'), buttons: words.wantedSummaryButtons });
  }

  private async post(ctx: BotContext, state: WantedState) {
    if (!state.words || !state.categoryId) return this.start(ctx);
    const created = await this.wanted.create(ctx.customer!, { words: state.words, category_id: state.categoryId, area_id: state.areaId ?? null, budget_max: state.budgetMax ?? null, conditions: state.conditions ?? [] }, 'whatsapp');
    await ctx.setFlow(null);
    await ctx.say({ type: 'text', body: words.wantedPosted(created.number, created.sellers_told) });
    if (created.matches.length) {
      await ctx.say({
        type: 'list',
        body: words.wantedMatches,
        button: words.resultsButton,
        rows: created.matches.slice(0, 5).map(card => ({ id: `l:${card.ref}`, title: card.title, description: [card.price.amount !== null ? priceText(card.price.amount, card.price.currency) : 'Ask for price', card.area.name].join(' · ') })),
      });
    }
  }

  // ---- Sellers ----

  /** A request they were told about: what it is, then their listings to answer with. */
  async show(ctx: BotContext, requestId: string) {
    if (!ctx.customer) return ctx.needAccount();
    try {
      const request = await this.wanted.get(ctx.customer, requestId);
      if (!('your_listings' in request)) return ctx.say({ type: 'text', body: `Your request ${request.number}: ${request.responses.length} answer${request.responses.length === 1 ? '' : 's'} so far. See them on udozo.com: ${ctx.site}/account/wanted/${request.id}` });
      if (request.status !== 'open') return ctx.say({ type: 'text', body: 'This request is closed.' });
      if (request.answered) return ctx.say({ type: 'text', body: 'You already answered this request.' });
      const head = words.wantedForYou(request.words, request.place ?? '', request.budget.text);
      if (!request.your_listings.length) return ctx.say({ type: 'text', body: `${head}\n\n${words.wantedNoListings}` });
      return ctx.say({
        type: 'list',
        body: `${head}${request.details ? `\n\n"${request.details}"` : ''}`,
        button: 'Your listings',
        rows: request.your_listings.map(listing => ({ id: `wresp:${requestId}:${listing.id}`, title: listing.title ?? 'Listing', description: listing.price.amount !== null ? priceText(listing.price.amount, listing.price.currency) : 'Ask for price' })),
      });
    } catch (error) {
      return ctx.say({ type: 'text', body: problemText(error) });
    }
  }

  async respond(ctx: BotContext, requestId: string, listingId: string) {
    if (!ctx.customer) return ctx.needAccount();
    try {
      await this.wanted.respond(ctx.customer, requestId, { listing_id: listingId });
      return ctx.say({ type: 'text', body: words.wantedAnswered });
    } catch (error) {
      return ctx.say({ type: 'text', body: problemText(error) });
    }
  }
}

