import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { AuditService } from '../../audit/audit.service.js';
import { ApiError } from '../../common/errors/api-error.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { Prisma, SupportBot } from '../../generated/prisma/client.js';
import { SettingsService } from '../../settings/settings.service.js';
import { monthStart } from '../../support/ai/ai.service.js';
import { visionProviders, type AiProviderName } from '../../support/ai/providers.js';
import { shopLimitsOf } from '../../support/bots.service.js';
import { languageName, languagePattern } from './languages.js';
import { shopKnowledgeKeys, ShopKnowledgeService, shopKnowledgeTitles, shopSections } from './shop-knowledge.js';

/** Assistant threads are kept this long after their last message, then deleted by the `support` job. */
export const keepThreadsMs = 30 * 86_400_000;

const notFound = () => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such shop assistant.');
const invalid = (code: string, message: string, param?: string) => new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', code, message, param);
const conflict = (code: string, message: string) => new ApiError(HttpStatus.CONFLICT, 'conflict_error', code, message);

export type Assignment = { country: string; language: string | null };
const slotOf = (item: Assignment) => `${item.country}:${item.language ?? ''}`;

/**
 * BitoCard Shop's assistants, as admins manage them: Anjio (the default, every country without its own) and the
 * assistants assigned to countries, optionally per language, with at most one active assistant per country and language
 * (activating one replaces whoever held its slots, in the same transaction). Which assistant answers is worked out here,
 * as is each assistant's knowledge per country: BitoCard's sections generated from the market's live data, refreshed by
 * the daily `support` job, beside the admin's own shared document.
 */
@Injectable()
export class ShopAssistantsService {
  private readonly logger = new Logger('ShopAssistants');

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly knowledge: ShopKnowledgeService,
    private readonly audit: AuditService,
  ) {}

  private async shopBot(id: string) {
    const bot = await this.prisma.supportBot.findUnique({ where: { id } });
    if (!bot || bot.scope !== 'shop') throw notFound();
    return bot;
  }

  /** Markets where BitoCard Shop is switched on. */
  async openCountries() {
    const countries = await this.prisma.country.findMany({ select: { code: true }, orderBy: { code: 'asc' } });
    const open = await Promise.all(countries.map(async country => ((await this.settings.isOnForCountry('classifieds', country.code).catch(() => false)) ? country.code : null)));
    return open.filter((code): code is string => Boolean(code));
  }

  /** The countries an assistant answers in: every open one for the default, else its own. */
  async servedCountries(bot: SupportBot) {
    if (bot.shopDefault) return this.openCountries();
    const rows = await this.prisma.shopBotAssignment.findMany({ where: { botId: bot.id }, select: { country: true } });
    return [...new Set(rows.map(row => row.country))].sort();
  }

  // -- Which assistant answers ----------------------------------------------------------------------------------

  /**
   * The assistant for a country and language: the active one assigned to that country for that language, else the one
   * assigned to it for all its languages, else Anjio (the default), while active. Null when none is.
   */
  async resolve(country: string, language: string) {
    const assigned = await this.prisma.shopBotAssignment.findMany({ where: { country, active: true, OR: [{ language }, { language: null }], bot: { status: 'active', scope: 'shop' } }, include: { bot: true } });
    const exact = assigned.find(row => row.language === language) ?? assigned.find(row => row.language !== null && row.language.split('-')[0] === language.split('-')[0]);
    if (exact) return exact.bot;
    const all = assigned.find(row => row.language === null);
    if (all) return all.bot;
    return this.prisma.supportBot.findFirst({ where: { scope: 'shop', shopDefault: true, status: 'active' } });
  }

  /** The languages people can choose in a country: those its active assistants speak (Anjio's included). */
  async languagesIn(country: string) {
    const [assigned, fallback] = await Promise.all([
      this.prisma.shopBotAssignment.findMany({ where: { country, active: true, bot: { status: 'active' } }, include: { bot: { select: { languages: true } } } }),
      this.prisma.supportBot.findFirst({ where: { scope: 'shop', shopDefault: true, status: 'active' }, select: { languages: true } }),
    ]);
    const codes = new Set<string>();
    for (const row of assigned) for (const code of row.language ? [row.language] : row.bot.languages) codes.add(code);
    for (const code of fallback?.languages ?? []) codes.add(code);
    return [...codes].map(code => ({ code, name: languageName(code) }));
  }

  /** Each open country and language with the assistant answering there (Anjio where none is assigned). */
  async coverage() {
    const countries = await this.openCountries();
    const assignedCountries = await this.prisma.shopBotAssignment.findMany({ distinct: ['country'], select: { country: true } });
    const all = [...new Set([...countries, ...assignedCountries.map(row => row.country)])].sort();
    const names = await this.prisma.country.findMany({ where: { code: { in: all } }, select: { code: true, name: true } });
    const rows = [];
    for (const country of all) {
      for (const language of await this.languagesIn(country)) {
        const bot = await this.resolve(country, language.code);
        rows.push({ country, country_name: names.find(item => item.code === country)?.name ?? country, open: countries.includes(country), language: language.code, language_name: language.name, assistant: bot ? { id: bot.id, name: bot.name, default: bot.shopDefault } : null });
      }
      if (!(await this.languagesIn(country)).length) rows.push({ country, country_name: names.find(item => item.code === country)?.name ?? country, open: countries.includes(country), language: null, language_name: null, assistant: null });
    }
    return { object: 'list' as const, data: rows };
  }

  // -- Assignments and the default -------------------------------------------------------------------------------

  async assign(actorId: string | null, id: string, assignments: Assignment[]) {
    const bot = await this.shopBot(id);
    if (bot.shopDefault) throw conflict('default_assistant', 'The default answers in every country without its own assistant: it is not assigned to countries.');
    const wanted = assignments.map(item => ({ country: item.country.toUpperCase(), language: item.language?.trim() || null }));
    for (const [index, item] of wanted.entries()) {
      if (!/^[A-Z]{2}$/.test(item.country)) throw invalid('parameter_invalid', 'Each country is a 2-letter code.', `assignments[${index}].country`);
      if (item.language && (!languagePattern.test(item.language) || !bot.languages.includes(item.language))) throw invalid('parameter_invalid', `It does not speak "${item.language}": add the language first.`, `assignments[${index}].language`);
    }
    const unique = [...new Map(wanted.map(item => [slotOf(item), item])).values()];
    const known = await this.prisma.country.findMany({ where: { code: { in: unique.map(item => item.country) } }, select: { code: true } });
    const missing = unique.find(item => !known.some(country => country.code === item.country));
    if (missing) throw invalid('parameter_invalid', `${missing.country} is not a Udozo market.`, 'assignments');
    const before = await this.prisma.shopBotAssignment.findMany({ where: { botId: id }, select: { country: true, language: true } });
    await this.prisma.$transaction(async tx => {
      await tx.shopBotAssignment.deleteMany({ where: { botId: id } });
      if (unique.length) await tx.shopBotAssignment.createMany({ data: unique.map(item => ({ botId: id, country: item.country, language: item.language, active: false })) });
      if (bot.status === 'active') await this.takeSlots(tx, bot, actorId);
    });
    await this.audit.record({ actorId, action: 'support_bot.assigned', targetType: 'support_bot', targetId: id, before: { assignments: before }, after: { assignments: unique } });
    // An active assistant left with no country cannot answer: it is paused.
    if (bot.status === 'active' && !unique.length) {
      await this.prisma.supportBot.update({ where: { id }, data: { status: 'paused' } });
    }
    const rows = await this.prisma.shopBotAssignment.findMany({ where: { botId: id }, orderBy: [{ country: 'asc' }, { language: 'asc' }] });
    return rows.map(row => ({ country: row.country, language: row.language, active: row.active }));
  }

  /**
   * The assistant's assignments become active. Whoever held one of those country and language slots is unassigned
   * there (their assignment removed), audited, so the swap happens at once.
   */
  async takeSlots(tx: Prisma.TransactionClient, bot: SupportBot, actorId: string | null) {
    const mine = await tx.shopBotAssignment.findMany({ where: { botId: bot.id } });
    for (const item of mine) {
      const held = await tx.shopBotAssignment.findMany({ where: { country: item.country, language: item.language, active: true, botId: { not: bot.id } } });
      for (const other of held) {
        await tx.shopBotAssignment.delete({ where: { id: other.id } });
        // In the same transaction as the swap (the audit service writes outside it).
        await tx.auditLog.create({ data: { actorId, action: 'support_bot.unassigned', targetType: 'support_bot', targetId: other.botId, before: { country: other.country, language: other.language }, after: { replaced_by: bot.id } } });
      }
    }
    await tx.shopBotAssignment.updateMany({ where: { botId: bot.id }, data: { active: true } });
  }

  async deactivated(botId: string) {
    await this.prisma.shopBotAssignment.updateMany({ where: { botId }, data: { active: false } });
  }

  /** Makes this assistant the default (every country without its own); the previous default is paused, with no countries. */
  async makeDefault(actorId: string | null, id: string) {
    const bot = await this.shopBot(id);
    if (bot.shopDefault) return;
    if (bot.status === 'suspended') throw conflict('assistant_suspended', 'This assistant is suspended.');
    const previous = await this.prisma.supportBot.findFirst({ where: { scope: 'shop', shopDefault: true } });
    await this.prisma.$transaction(async tx => {
      if (previous) await tx.supportBot.update({ where: { id: previous.id }, data: { shopDefault: false, ...(previous.status === 'active' ? { status: 'paused' } : {}) } });
      await tx.shopBotAssignment.deleteMany({ where: { botId: id } });
      await tx.supportBot.update({ where: { id }, data: { shopDefault: true } });
    });
    await this.audit.record({ actorId, action: 'support_bot.made_default', targetType: 'support_bot', targetId: id, before: { default: previous?.id ?? null }, after: { default: id } });
  }

  // -- What it still needs --------------------------------------------------------------------------------------

  async missing(bot: SupportBot) {
    const missing: string[] = [];
    if (!bot.languages.length) missing.push('Choose the languages it speaks.');
    const greetings = (bot.greetings ?? {}) as Record<string, string>;
    const without = bot.languages.filter(code => !greetings[code]?.trim());
    if (without.length) missing.push(`Write its greeting in ${without.map(languageName).join(', ')}.`);
    if (bot.roles.includes('sell') && !visionProviders.includes(bot.provider as AiProviderName)) missing.push('Helping sellers reads their photos: choose a model that reads images.');
    if (!bot.shopDefault && !(await this.prisma.shopBotAssignment.count({ where: { botId: bot.id } }))) missing.push('Assign it to at least one country, or make it the default.');
    const served = await this.servedCountries(bot);
    const have = new Set((await this.countryDocs(bot.id)).map(doc => doc.country));
    const lacking = served.filter(country => !have.has(country));
    if (lacking.length) missing.push(`Generate its knowledge for ${lacking.join(', ')} (Knowledge per country).`);
    return missing;
  }

  /** What admins see of a shop assistant beside its profile. */
  async present(bot: SupportBot) {
    const [assignments, served, usage, ratings, reported, lastEval] = await Promise.all([
      this.prisma.shopBotAssignment.findMany({ where: { botId: bot.id }, orderBy: [{ country: 'asc' }, { language: 'asc' }] }),
      this.servedCountries(bot),
      this.prisma.aiUsage.aggregate({ where: { botId: bot.id, kind: 'shop', createdAt: { gte: monthStart() } }, _sum: { costMicros: true }, _count: { _all: true } }),
      this.prisma.assistantMessage.groupBy({ by: ['rating'], where: { thread: { botId: bot.id }, rating: { not: null } }, _count: { _all: true } }),
      this.prisma.assistantMessage.count({ where: { thread: { botId: bot.id }, reportedAt: { not: null } } }),
      this.prisma.shopBotEval.findFirst({ where: { botId: bot.id }, orderBy: { createdAt: 'desc' } }),
    ]);
    const limits = shopLimitsOf(bot);
    return {
      default: bot.shopDefault,
      languages: bot.languages.map(code => ({ code, name: languageName(code) })),
      greetings: bot.greetings as Record<string, string>,
      limits,
      assignments: assignments.map(row => ({ country: row.country, language: row.language, active: row.active })),
      countries: served,
      month: { calls: usage._count._all, cost_usd: Number(usage._sum.costMicros ?? 0n) / 1_000_000, budget_usd: limits.monthly_budget_usd },
      ratings: { up: ratings.find(row => row.rating === 1)?._count._all ?? 0, down: ratings.find(row => row.rating === -1)?._count._all ?? 0 },
      reported,
      last_eval: lastEval ? { id: lastEval.id, model: lastEval.model, passed: lastEval.passed, cases: lastEval.cases, created_at: lastEval.createdAt.toISOString() } : null,
    };
  }

  // -- Knowledge per country ------------------------------------------------------------------------------------

  /** The latest BitoCard document for each country the assistant has one for. */
  async countryDocs(botId: string) {
    const rows = await this.prisma.supportBotKnowledge.findMany({ where: { botId, country: { not: null } }, orderBy: { version: 'desc' } });
    const latest = new Map<string, (typeof rows)[number]>();
    for (const row of rows) if (!latest.has(row.country!)) latest.set(row.country!, row);
    return [...latest.values()];
  }

  /** The shared document's starting point (the admin's own sections). */
  sharedTemplate(name: string) {
    return this.knowledge.sharedTemplate(name);
  }

  /** The shared document and the country's: what an answer in that country is given. */
  async knowledgeFor(bot: SupportBot, country: string) {
    const [shared, local] = await Promise.all([
      bot.knowledgeId ? this.prisma.supportBotKnowledge.findUnique({ where: { id: bot.knowledgeId }, select: { content: true } }) : null,
      this.prisma.supportBotKnowledge.findFirst({ where: { botId: bot.id, country }, orderBy: { version: 'desc' }, select: { content: true } }),
    ]);
    return [local?.content, shared?.content].filter(Boolean).join('\n\n') || null;
  }

  private async saveCountry(bot: SupportBot, country: string, content: string, dataHash: string, actorId: string | null, source: 'generated' | 'refreshed') {
    return this.prisma.$transaction(async tx => {
      const last = await tx.supportBotKnowledge.findFirst({ where: { botId: bot.id }, orderBy: { version: 'desc' }, select: { version: true } });
      const version = (last?.version ?? 0) + 1;
      await tx.supportBotKnowledge.create({ data: { botId: bot.id, country, version, source, format: 'md', content, chars: content.length, dataHash, managedSections: {}, createdById: actorId } });
      return version;
    });
  }

  /** Per country: the version in use, whether the market changed since, and what each section would become. */
  async countryKnowledge(id: string) {
    const bot = await this.shopBot(id);
    const [served, docs] = await Promise.all([this.servedCountries(bot), this.countryDocs(id)]);
    const countries = [...new Set([...served, ...docs.map(doc => doc.country!)])].sort();
    const data = [];
    for (const country of countries) {
      const doc = docs.find(item => item.country === country) ?? null;
      const fresh = await this.knowledge.gather(country);
      const content = this.knowledge.render(fresh);
      const hash = this.knowledge.hash(fresh);
      const before = doc ? shopSections(doc.content) : {};
      const after = shopSections(content);
      const lines = (text: string | undefined) => new Set((text ?? '').split('\n').filter(line => line.startsWith('- ')));
      data.push({
        country,
        served: served.includes(country),
        version: doc?.version ?? null,
        generated_at: doc?.createdAt.toISOString() ?? null,
        stale: !doc || doc.dataHash !== hash,
        content: doc?.content ?? null,
        sections: shopKnowledgeKeys.map(key => {
          const now = before[key];
          const next = after[key] ?? '';
          const was = lines(now);
          const will = lines(next);
          return { key, title: shopKnowledgeTitles[key], state: now === undefined ? 'added' : now === next ? 'unchanged' : 'changed', added: [...will].filter(line => !was.has(line)).length, removed: [...was].filter(line => !will.has(line)).length };
        }),
      });
    }
    return { object: 'list' as const, data };
  }

  /** Generates (or refreshes) the countries' documents from the market's data now; unchanged ones are left as they are. */
  async refreshCountries(actorId: string | null, id: string, countries?: string[]) {
    const bot = await this.shopBot(id);
    const served = await this.servedCountries(bot);
    const chosen = countries?.length ? countries.map(code => code.toUpperCase()).filter(code => served.includes(code)) : served;
    const docs = await this.countryDocs(id);
    const done: Array<{ country: string; version: number }> = [];
    for (const country of chosen) {
      const fresh = await this.knowledge.gather(country);
      const hash = this.knowledge.hash(fresh);
      const doc = docs.find(item => item.country === country);
      if (doc?.dataHash === hash) continue;
      done.push({ country, version: await this.saveCountry(bot, country, this.knowledge.render(fresh), hash, actorId, doc ? 'refreshed' : 'generated') });
    }
    if (done.length) await this.audit.record({ actorId, action: 'support_bot.knowledge_generated', targetType: 'support_bot', targetId: id, before: null, after: { countries: done } });
    return { object: 'shop_knowledge_refreshed' as const, refreshed: done };
  }

  /** The daily job: every shop assistant's country documents brought up to date (they are wholly BitoCard's). */
  async refreshAll() {
    const bots = await this.prisma.supportBot.findMany({ where: { scope: 'shop', status: { not: 'suspended' } } });
    let refreshed = 0;
    for (const bot of bots) {
      try {
        refreshed += (await this.refreshCountries(null, bot.id)).refreshed.length;
      } catch (error) {
        this.logger.warn({ err: error, botId: bot.id }, 'Could not refresh a shop assistant’s knowledge');
      }
    }
    return { assistants: bots.length, refreshed };
  }

  /** Threads older than 30 days, deleted with their messages. */
  async purgeOld(now = new Date()) {
    return (await this.prisma.assistantThread.deleteMany({ where: { lastMessageAt: { lt: new Date(now.getTime() - keepThreadsMs) } } })).count;
  }

  // -- Review ---------------------------------------------------------------------------------------------------

  async threads(id: string, filter: { rating?: 'up' | 'down'; reported?: boolean; limit?: number; starting_after?: string }) {
    await this.shopBot(id);
    const limit = Math.min(filter.limit ?? 25, 100);
    const messages = filter.rating || filter.reported ? { some: { ...(filter.rating ? { rating: filter.rating === 'up' ? 1 : -1 } : {}), ...(filter.reported ? { reportedAt: { not: null } } : {}) } } : undefined;
    const rows = await this.prisma.assistantThread.findMany({
      where: { botId: id, ...(messages ? { messages } : {}) },
      orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(filter.starting_after ? { cursor: { id: filter.starting_after }, skip: 1 } : {}),
      include: { messages: { orderBy: { createdAt: 'asc' }, select: { role: true, body: true, rating: true, reportedAt: true } } },
    });
    return {
      object: 'list' as const,
      data: rows.slice(0, limit).map(row => ({
        id: row.id,
        country: row.country,
        language: row.language,
        surface: row.surface,
        signed_in: Boolean(row.customerId),
        first_question: row.messages.find(message => message.role === 'user')?.body.slice(0, 200) ?? null,
        messages: row.messages.length,
        down: row.messages.filter(message => message.rating === -1).length,
        up: row.messages.filter(message => message.rating === 1).length,
        reported: row.messages.filter(message => message.reportedAt).length,
        last_message_at: row.lastMessageAt.toISOString(),
      })),
      has_more: rows.length > limit,
    };
  }

  async thread(id: string, threadId: string) {
    const row = await this.prisma.assistantThread.findFirst({ where: { id: threadId, botId: id }, include: { messages: { orderBy: { createdAt: 'asc' } } } });
    if (!row) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such conversation.');
    return {
      object: 'assistant_thread' as const,
      id: row.id,
      country: row.country,
      language: row.language,
      surface: row.surface,
      signed_in: Boolean(row.customerId),
      listing_id: row.listingId,
      created_at: row.createdAt.toISOString(),
      messages: row.messages.map(message => ({
        id: message.id,
        role: message.role,
        body: message.body,
        cards: message.cards,
        tool_calls: message.toolCalls,
        rating: message.rating,
        reported_at: message.reportedAt?.toISOString() ?? null,
        report_reason: message.reportReason,
        cost_usd: Number(message.costMicros) / 1_000_000,
        created_at: message.createdAt.toISOString(),
      })),
    };
  }

  async evals(id: string) {
    await this.shopBot(id);
    const rows = await this.prisma.shopBotEval.findMany({ where: { botId: id }, orderBy: { createdAt: 'desc' }, take: 20 });
    return { object: 'list' as const, data: rows.map(row => ({ id: row.id, provider: row.provider, model: row.model, cases: row.cases, passed: row.passed, results: row.results, created_at: row.createdAt.toISOString() })) };
  }
}
