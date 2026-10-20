import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { houseRootId, houseStoreId } from '../checkout/house.service.js';
import { ApiError } from '../common/errors/api-error.js';
import { PrismaService } from '../database/prisma.service.js';
import type { Prisma, SupportBot, SupportBotKnowledge } from '../generated/prisma/client.js';
import { InboxService } from '../notifications/inbox.service.js';
import { AiService } from './ai/ai.service.js';
import { type AiProviderName, aiProviders, type AiTurn } from './ai/providers.js';
import { csvToMarkdown, managedKeys, type ManagedKey, managedSections, managedTitles, maxKnowledgeChars, mergeSections, sectionHashes, StoreKnowledgeService } from './knowledge.js';
import { knowledgeContext, systemPrompt, type Tone, tones } from './prompt.js';

export const botRoles = ['chat', 'tickets'] as const;
export type BotRole = (typeof botRoles)[number];
export const botFundings = ['bitocard', 'own'] as const;
export type BotFunding = (typeof botFundings)[number];

/** Who manages a bot: a reseller for their own stores, or BitoCard for bitocard.com and its assistant for resellers. */
export type BotOwner = { kind: 'reseller'; resellerId: string; userId: string | null } | { kind: 'admin'; userId: string | null };

export type BotInput = {
  name?: string;
  roles?: BotRole[];
  provider?: AiProviderName;
  model?: string;
  funding?: BotFunding;
  store_id?: string | null;
  scope?: 'store' | 'platform';
  greeting?: string | null;
  tone?: Tone;
  instructions?: string | null;
  ticket_reply_mode?: 'auto' | 'draft';
  avatar_url?: string | null;
  auto_refresh?: boolean;
};

type BotWithKnowledge = SupportBot & { current?: SupportBotKnowledge | null; storeName?: string | null };

const notFound = () => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such assistant.');
const invalid = (code: string, message: string, param?: string) => new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', code, message, param);
const conflict = (code: string, message: string, param?: string) => new ApiError(HttpStatus.CONFLICT, 'conflict_error', code, message, param);

export function presentBot(bot: BotWithKnowledge, audience: 'reseller' | 'admin') {
  return {
    object: 'support_bot' as const,
    id: bot.id,
    scope: bot.scope as 'store' | 'platform',
    store_id: bot.storeId,
    store_name: bot.storeName ?? null,
    roles: bot.roles as BotRole[],
    ticket_reply_mode: bot.ticketReplyMode as 'auto' | 'draft',
    provider: bot.provider as AiProviderName,
    model: bot.model,
    funding: bot.funding as BotFunding,
    name: bot.name,
    avatar_url: bot.avatarUrl,
    greeting: bot.greeting,
    tone: bot.tone as Tone,
    instructions: bot.instructions,
    status: bot.status as 'draft' | 'active' | 'paused' | 'suspended',
    suspended_reason: bot.suspendedReason,
    auto_refresh: bot.autoRefresh,
    knowledge: bot.current ? { id: bot.current.id, version: bot.current.version, source: bot.current.source, chars: bot.current.chars, created_at: bot.current.createdAt.toISOString() } : null,
    knowledge_stale_at: bot.knowledgeStaleAt?.toISOString() ?? null,
    created_at: bot.createdAt.toISOString(),
    updated_at: bot.updatedAt.toISOString(),
    ...(audience === 'admin' ? { reseller_id: bot.resellerId } : {}),
  };
}

/** How a BitoCard section compares between the knowledge in use and the store's data now. */
export type SectionChange = { key: ManagedKey; title: string; state: 'unchanged' | 'changed' | 'added' | 'edited'; current: string | null; fresh: string; added: number; removed: number };

/**
 * Support bots: one per store (and BitoCard's one for resellers). Role and AI agent, profile, a versioned knowledge
 * document (uploaded, generated from the store by BitoCard, edited, refreshed), a playground, then activation, which
 * checks that everything it needs is in place. Update knowledge base regenerates only BitoCard's sections and asks
 * before replacing one the owner edited; a daily check flags (or, with automatic updates, applies) store changes.
 */
@Injectable()
export class BotsService {
  private readonly logger = new Logger('SupportBots');

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
    private readonly knowledge: StoreKnowledgeService,
    private readonly inbox: InboxService,
    private readonly audit: AuditService,
  ) {}

  private async withKnowledge(bot: SupportBot): Promise<BotWithKnowledge> {
    const [current, store] = await Promise.all([
      bot.knowledgeId ? this.prisma.supportBotKnowledge.findUnique({ where: { id: bot.knowledgeId } }) : null,
      bot.storeId ? this.prisma.store.findUnique({ where: { id: bot.storeId }, select: { name: true } }) : null,
    ]);
    return { ...bot, current, storeName: store?.name ?? (bot.scope === 'platform' ? 'SHQ (resellers)' : null) };
  }

  private audience(owner: BotOwner) {
    return owner.kind === 'admin' ? ('admin' as const) : ('reseller' as const);
  }

  /** A bot the owner may manage: a reseller's own stores' bots; BitoCard's bitocard.com and platform bots. */
  private async owned(owner: BotOwner, id: string) {
    const bot = await this.prisma.supportBot.findUnique({ where: { id } });
    if (!bot) throw notFound();
    if (owner.kind === 'reseller' && bot.resellerId !== owner.resellerId) throw notFound();
    if (owner.kind === 'admin' && bot.scope !== 'platform' && bot.storeId !== houseStoreId && bot.resellerId !== houseRootId) {
      // Admins see every bot (to suspend one) but edit only BitoCard's own.
      throw new ApiError(HttpStatus.FORBIDDEN, 'permission_error', 'not_bitocard_assistant', 'This assistant belongs to a reseller: admins can only suspend it.');
    }
    return bot;
  }

  async list(owner: BotOwner) {
    const rows = await this.prisma.supportBot.findMany({ where: owner.kind === 'reseller' ? { resellerId: owner.resellerId } : {}, orderBy: { createdAt: 'asc' } });
    return { object: 'list' as const, data: await Promise.all(rows.map(async row => presentBot(await this.withKnowledge(row), this.audience(owner)))), has_more: false };
  }

  async get(owner: BotOwner, id: string) {
    const bot = owner.kind === 'admin' ? await this.prisma.supportBot.findUnique({ where: { id } }) : await this.owned(owner, id);
    if (!bot) throw notFound();
    return presentBot(await this.withKnowledge(bot), this.audience(owner));
  }

  /** Validates a store the owner may give a bot. */
  private async checkStore(owner: BotOwner, storeId: string) {
    const store = await this.prisma.store.findUnique({ where: { id: storeId } });
    const allowed = store && (owner.kind === 'reseller' ? store.resellerId === owner.resellerId : store.id === houseStoreId);
    if (!allowed) throw invalid('parameter_invalid', 'Choose one of your stores.', 'store_id');
    return store;
  }

  private checkModel(input: { provider: AiProviderName; model: string; funding: BotFunding }) {
    if (!(aiProviders as readonly string[]).includes(input.provider)) throw invalid('parameter_invalid', 'Choose Anthropic, OpenAI or DeepSeek.', 'provider');
    if (input.funding === 'bitocard' && !this.ai.bitocardModels().some(item => item.provider === input.provider && item.model === input.model)) {
      throw invalid('ai_model_unavailable', 'This model is not offered on BitoCard’s AI. Choose another, or use your own key.', 'model');
    }
  }

  async create(owner: BotOwner, input: Required<Pick<BotInput, 'name' | 'roles' | 'provider' | 'model' | 'funding'>> & BotInput) {
    const platform = owner.kind === 'admin' && input.scope === 'platform';
    if (input.scope === 'platform' && owner.kind !== 'admin') throw invalid('parameter_invalid', 'Only BitoCard runs the assistant for resellers.', 'scope');
    this.checkModel(input);
    const store = !platform && input.store_id ? await this.checkStore(owner, input.store_id) : null;
    const resellerId = owner.kind === 'reseller' ? owner.resellerId : (store?.resellerId ?? houseRootId);
    try {
      const bot = await this.prisma.supportBot.create({
        data: {
          resellerId,
          scope: platform ? 'platform' : 'store',
          storeId: platform ? null : (store?.id ?? null),
          roles: [...new Set(input.roles)],
          ticketReplyMode: input.ticket_reply_mode ?? 'draft',
          provider: input.provider,
          model: input.model,
          funding: input.funding,
          name: input.name.trim(),
          avatarUrl: input.avatar_url ?? null,
          greeting: input.greeting?.trim() || null,
          tone: input.tone ?? 'friendly',
          instructions: input.instructions?.trim() || null,
          autoRefresh: input.auto_refresh ?? false,
          createdById: owner.userId,
        },
      });
      await this.audit.record({ actorId: owner.userId, action: 'support_bot.created', targetType: 'support_bot', targetId: bot.id, before: null, after: { name: bot.name, store_id: bot.storeId, scope: bot.scope, provider: bot.provider, model: bot.model, funding: bot.funding } });
      return presentBot(await this.withKnowledge(bot), this.audience(owner));
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') throw conflict(platform ? 'platform_assistant_exists' : 'store_has_assistant', platform ? 'BitoCard already has an assistant for resellers.' : 'This store already has an assistant: one per store.', platform ? 'scope' : 'store_id');
      throw error;
    }
  }

  async update(owner: BotOwner, id: string, input: BotInput) {
    const bot = await this.owned(owner, id);
    const next = { provider: input.provider ?? (bot.provider as AiProviderName), model: input.model ?? bot.model, funding: input.funding ?? (bot.funding as BotFunding) };
    if (input.provider || input.model || input.funding) this.checkModel(next);
    const store = input.store_id ? await this.checkStore(owner, input.store_id) : null;
    try {
      const updated = await this.prisma.supportBot.update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: input.name.trim() } : {}),
          ...(input.roles ? { roles: [...new Set(input.roles)] } : {}),
          ...(input.ticket_reply_mode ? { ticketReplyMode: input.ticket_reply_mode } : {}),
          ...next,
          ...(input.store_id !== undefined && bot.scope === 'store' ? { storeId: store?.id ?? null } : {}),
          ...(input.greeting !== undefined ? { greeting: input.greeting?.trim() || null } : {}),
          ...(input.tone ? { tone: input.tone } : {}),
          ...(input.instructions !== undefined ? { instructions: input.instructions?.trim() || null } : {}),
          ...(input.avatar_url !== undefined ? { avatarUrl: input.avatar_url } : {}),
          ...(input.auto_refresh !== undefined ? { autoRefresh: input.auto_refresh } : {}),
        },
      });
      // An active bot must stay complete: a change that breaks it pauses it, with why.
      if (updated.status === 'active') {
        const missing = await this.missing(updated);
        if (missing.length) await this.prisma.supportBot.update({ where: { id }, data: { status: 'paused' } });
      }
      return presentBot(await this.withKnowledge((await this.prisma.supportBot.findUnique({ where: { id } }))!), this.audience(owner));
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') throw conflict('store_has_assistant', 'That store already has an assistant: one per store.', 'store_id');
      throw error;
    }
  }

  async remove(owner: BotOwner, id: string) {
    const bot = await this.owned(owner, id);
    await this.prisma.supportBot.delete({ where: { id } });
    await this.audit.record({ actorId: owner.userId, action: 'support_bot.deleted', targetType: 'support_bot', targetId: id, before: { name: bot.name, store_id: bot.storeId }, after: null });
  }

  /** What a bot still needs before it can answer anyone. */
  async missing(bot: SupportBot) {
    const missing: string[] = [];
    if (!bot.roles.length) missing.push('Choose what it answers: chats, tickets or both.');
    if (bot.scope === 'store' && !bot.storeId) missing.push('Assign it to a store.');
    if (!bot.knowledgeId) missing.push('Add its knowledge: upload a document or generate one from BitoCard.');
    if (bot.funding === 'bitocard') {
      if (!(await this.ai.premium(bot.resellerId, bot.storeId))) missing.push('BitoCard’s AI needs the Premium plan: change plan, or use your own AI key.');
      if (!this.ai.bitocardModels().some(item => item.provider === bot.provider && item.model === bot.model)) missing.push('Its model is no longer offered on BitoCard’s AI: choose another.');
    } else {
      const key = (await this.ai.keysFor(bot.resellerId)).find(item => item.provider === bot.provider);
      if (!key) missing.push('Add your AI key for its provider (Support > AI keys).');
      else if (key.failed_at) missing.push('Your AI key was refused by the provider: replace it.');
      else if (key.models.length && !key.models.includes(bot.model)) missing.push('Your AI key cannot use this model: choose one it lists.');
    }
    return missing;
  }

  async activate(owner: BotOwner, id: string) {
    const bot = await this.owned(owner, id);
    if (bot.status === 'suspended') throw conflict('assistant_suspended', `BitoCard suspended this assistant${bot.suspendedReason ? `: ${bot.suspendedReason}` : '.'}`);
    const missing = await this.missing(bot);
    if (missing.length) throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'assistant_incomplete', missing.join(' '));
    const updated = await this.prisma.supportBot.update({ where: { id }, data: { status: 'active' } });
    await this.audit.record({ actorId: owner.userId, action: 'support_bot.activated', targetType: 'support_bot', targetId: id, before: { status: bot.status }, after: { status: 'active' } });
    return presentBot(await this.withKnowledge(updated), this.audience(owner));
  }

  async pause(owner: BotOwner, id: string) {
    const bot = await this.owned(owner, id);
    if (bot.status === 'suspended') throw conflict('assistant_suspended', 'BitoCard suspended this assistant.');
    const updated = await this.prisma.supportBot.update({ where: { id }, data: { status: 'paused' } });
    return presentBot(await this.withKnowledge(updated), this.audience(owner));
  }

  /** BitoCard suspends any bot (for example one saying things it must not), with a reason its owner sees. */
  async suspend(actorId: string | null, id: string, reason: string) {
    const bot = await this.prisma.supportBot.findUnique({ where: { id } });
    if (!bot) throw notFound();
    const updated = await this.prisma.supportBot.update({ where: { id }, data: { status: 'suspended', suspendedReason: reason.trim() } });
    await this.audit.record({ actorId, action: 'support_bot.suspended', targetType: 'support_bot', targetId: id, before: { status: bot.status }, after: { status: 'suspended', reason } });
    await this.inbox.reseller(bot.resellerId, 'support.bot_paused', { subject: `${id}:suspended:${Date.now()}`, title: `BitoCard suspended your assistant ${bot.name}`, body: reason, link: `/support/assistants/${id}` });
    return presentBot(await this.withKnowledge(updated), 'admin');
  }

  async unsuspend(actorId: string | null, id: string) {
    const bot = await this.prisma.supportBot.findUnique({ where: { id } });
    if (!bot) throw notFound();
    if (bot.status !== 'suspended') throw conflict('assistant_not_suspended', 'This assistant is not suspended.');
    const updated = await this.prisma.supportBot.update({ where: { id }, data: { status: 'paused', suspendedReason: null } });
    await this.audit.record({ actorId, action: 'support_bot.unsuspended', targetType: 'support_bot', targetId: id, before: { status: 'suspended' }, after: { status: 'paused' } });
    return presentBot(await this.withKnowledge(updated), 'admin');
  }

  // -- Knowledge ---------------------------------------------------------------------------------------------------

  async knowledgeOf(owner: BotOwner, id: string) {
    const bot = await this.owned(owner, id);
    const versions = await this.prisma.supportBotKnowledge.findMany({ where: { botId: id }, orderBy: { version: 'desc' }, take: 50 });
    const current = versions.find(item => item.id === bot.knowledgeId) ?? null;
    return {
      object: 'support_bot_knowledge' as const,
      current: current ? { version: current.version, source: current.source, format: current.format, chars: current.chars, content: current.content, created_at: current.createdAt.toISOString() } : null,
      versions: versions.map(item => ({ version: item.version, source: item.source, chars: item.chars, created_at: item.createdAt.toISOString(), current: item.id === bot.knowledgeId })),
      stale_since: bot.knowledgeStaleAt?.toISOString() ?? null,
      max_chars: maxKnowledgeChars,
    };
  }

  /** Saves a new version (an upload, an edit, or a generated document the owner applied) and puts it in use. */
  async saveKnowledge(owner: BotOwner, id: string, input: { content: string; format?: 'md' | 'csv'; source?: 'upload' | 'edited' | 'generated' }) {
    const bot = await this.owned(owner, id);
    let content = input.content.replace(/\r\n/g, '\n').trim();
    if (input.format === 'csv') {
      const converted = csvToMarkdown(content);
      if (!converted) throw invalid('knowledge_invalid', 'The CSV needs a header row with question and answer columns, and at least one row.', 'content');
      content = converted;
    }
    if (!content) throw invalid('parameter_missing', 'The document is empty.', 'content');
    if (content.length > maxKnowledgeChars) throw invalid('knowledge_too_long', `The document is ${content.length.toLocaleString('en-GB')} characters; the limit is ${maxKnowledgeChars.toLocaleString('en-GB')}.`, 'content');
    const source = input.source ?? 'upload';
    const previous = bot.knowledgeId ? await this.prisma.supportBotKnowledge.findUnique({ where: { id: bot.knowledgeId } }) : null;
    const hashes = sectionHashes(content);
    let managed: Partial<Record<ManagedKey, string>>;
    let dataHash: string | null;
    if (source === 'generated' && bot.storeId) {
      // As BitoCard wrote it: every section's hash is the generated one, and the data is the store's now.
      managed = hashes;
      dataHash = this.knowledge.hash(await this.knowledge.gather(bot.storeId));
    } else {
      // An upload or edit keeps what BitoCard last wrote for each section, so hand edits can be told apart later.
      managed = (previous?.managedSections as Partial<Record<ManagedKey, string>> | undefined) ?? {};
      managed = Object.fromEntries(Object.entries(managed).filter(([key]) => key in hashes));
      dataHash = Object.keys(managed).length ? (previous?.dataHash ?? null) : null;
    }
    const version = await this.newVersion(bot, { source, format: input.format ?? 'md', content, dataHash, managed, createdById: owner.userId });
    return { ...(await this.knowledgeOf(owner, id)), version };
  }

  private async newVersion(bot: SupportBot, data: { source: string; format: string; content: string; dataHash: string | null; managed: Partial<Record<ManagedKey, string>>; createdById: string | null }) {
    return this.prisma.$transaction(async tx => {
      const last = await tx.supportBotKnowledge.findFirst({ where: { botId: bot.id }, orderBy: { version: 'desc' }, select: { version: true } });
      const version = (last?.version ?? 0) + 1;
      const row = await tx.supportBotKnowledge.create({
        data: { botId: bot.id, version, source: data.source, format: data.format, content: data.content, chars: data.content.length, dataHash: data.dataHash, managedSections: data.managed as Prisma.InputJsonValue, createdById: data.createdById },
      });
      await tx.supportBot.update({ where: { id: bot.id }, data: { knowledgeId: row.id, knowledgeStaleAt: null } });
      return version;
    });
  }

  /** A fresh document generated from the store's data, for the owner to read and edit before applying. */
  async generate(owner: BotOwner, id: string) {
    const bot = await this.owned(owner, id);
    if (!bot.storeId) throw conflict('assistant_without_store', 'Assign the assistant to a store first: BitoCard generates the document from the store.');
    const data = await this.knowledge.gather(bot.storeId);
    return { object: 'support_bot_knowledge_draft' as const, content: this.knowledge.render(data), data_hash: this.knowledge.hash(data) };
  }

  /** BitoCard's sections now against the knowledge in use, section by section. */
  private async changes(bot: SupportBot) {
    if (!bot.storeId) throw conflict('assistant_without_store', 'Assign the assistant to a store first.');
    const current = bot.knowledgeId ? await this.prisma.supportBotKnowledge.findUnique({ where: { id: bot.knowledgeId } }) : null;
    if (!current) throw conflict('assistant_without_knowledge', 'Generate or upload a document first.');
    const data = await this.knowledge.gather(bot.storeId);
    const fresh = this.knowledge.render(data);
    const freshSections = managedSections(fresh);
    const currentSections = managedSections(current.content);
    const recorded = (current.managedSections ?? {}) as Partial<Record<ManagedKey, string>>;
    const hashes = sectionHashes(current.content);
    const lines = (text: string | undefined) => new Set((text ?? '').split('\n').filter(line => line.startsWith('- ')));
    const sections: SectionChange[] = managedKeys.map(key => {
      const now = currentSections[key];
      const next = freshSections[key] ?? '';
      const before = lines(now);
      const after = lines(next);
      const added = [...after].filter(line => !before.has(line)).length;
      const removed = [...before].filter(line => !after.has(line)).length;
      const state = now === undefined ? 'added' : now === next ? 'unchanged' : recorded[key] && hashes[key] !== recorded[key] ? 'edited' : 'changed';
      return { key, title: managedTitles[key], state, current: now ?? null, fresh: next, added, removed };
    });
    return { current, fresh, data, sections };
  }

  /** Update knowledge base, step 1: what would change. */
  async refreshPreview(owner: BotOwner, id: string) {
    const bot = await this.owned(owner, id);
    const { sections, data } = await this.changes(bot);
    return { object: 'support_bot_knowledge_refresh' as const, data_hash: this.knowledge.hash(data), sections };
  }

  /** Update knowledge base, step 2: applies the chosen BitoCard sections (default: those not edited by the owner). */
  async refreshApply(owner: BotOwner | null, id: string, keys?: ManagedKey[]) {
    const bot = owner ? await this.owned(owner, id) : await this.prisma.supportBot.findUniqueOrThrow({ where: { id } });
    const { current, fresh, data, sections } = await this.changes(bot);
    const chosen = keys ?? sections.filter(section => section.state === 'changed' || section.state === 'added').map(section => section.key);
    const apply = sections.filter(section => chosen.includes(section.key) && section.state !== 'unchanged').map(section => section.key);
    if (!apply.length && current.dataHash === this.knowledge.hash(data)) return { applied: [] as ManagedKey[], version: current.version };
    const content = mergeSections(current.content, fresh, apply);
    if (content.length > maxKnowledgeChars) throw invalid('knowledge_too_long', `The updated document would be over ${maxKnowledgeChars.toLocaleString('en-GB')} characters: shorten your own sections first.`);
    const recorded = { ...((current.managedSections ?? {}) as Partial<Record<ManagedKey, string>>) };
    const freshHashes = sectionHashes(fresh);
    for (const key of apply) recorded[key] = freshHashes[key];
    // Sections the store changed but the owner kept (their edits) still differ, so the data stays stale only if some remain.
    const leftBehind = sections.some(section => (section.state === 'changed' || section.state === 'added' || section.state === 'edited') && !apply.includes(section.key));
    const version = await this.newVersion(bot, { source: 'refreshed', format: 'md', content, dataHash: leftBehind ? current.dataHash : this.knowledge.hash(data), managed: recorded, createdById: owner?.userId ?? null });
    return { applied: apply, version };
  }

  async restore(owner: BotOwner, id: string, version: number) {
    const bot = await this.owned(owner, id);
    const row = await this.prisma.supportBotKnowledge.findUnique({ where: { botId_version: { botId: id, version } } });
    if (!row) throw invalid('parameter_invalid', 'No such version.', 'version');
    await this.prisma.supportBot.update({ where: { id: bot.id }, data: { knowledgeId: row.id } });
    return this.knowledgeOf(owner, id);
  }

  // -- Playground --------------------------------------------------------------------------------------------------

  /** A test conversation with the bot as it is now (its draft knowledge too). Nothing is kept but the usage. */
  async test(owner: BotOwner, id: string, messages: Array<{ role: 'user' | 'assistant'; content: string }>) {
    const bot = await this.owned(owner, id);
    const current = bot.knowledgeId ? await this.prisma.supportBotKnowledge.findUnique({ where: { id: bot.knowledgeId } }) : null;
    const store = bot.storeId ? await this.prisma.store.findUnique({ where: { id: bot.storeId }, select: { name: true } }) : null;
    const audience = bot.scope === 'platform' ? ({ kind: 'reseller' } as const) : ({ kind: 'customer', store: store?.name ?? 'the store' } as const);
    const turns: AiTurn[] = messages.slice(-20).map(message => (message.role === 'user' ? { role: 'user', content: message.content } : { role: 'assistant', content: message.content }));
    const reply = await this.ai.reply(
      { funding: bot.funding as BotFunding, provider: bot.provider as AiProviderName, model: bot.model, resellerId: bot.resellerId, storeId: bot.storeId, botId: bot.id, mode: 'live', kind: 'test' },
      { system: systemPrompt(bot, audience), context: knowledgeContext(current?.content), messages: turns, maxTokens: 600 },
    );
    return { object: 'support_bot_test' as const, reply: reply.text ?? '', usage: reply.usage };
  }

  // -- The daily check ---------------------------------------------------------------------------------------------

  /**
   * For bots with BitoCard sections: when the store's data differs from what their knowledge was made from, flag it
   * once (and tell the owner), or with automatic updates apply BitoCard's sections the owner has not edited.
   */
  async checkStale(limit = 100) {
    const bots = await this.prisma.supportBot.findMany({ where: { storeId: { not: null }, knowledgeId: { not: null }, status: { not: 'suspended' } }, orderBy: { updatedAt: 'asc' }, take: limit });
    let flagged = 0;
    let refreshed = 0;
    for (const bot of bots) {
      try {
        const current = await this.prisma.supportBotKnowledge.findUnique({ where: { id: bot.knowledgeId! } });
        if (!current?.dataHash) continue;
        const now = this.knowledge.hash(await this.knowledge.gather(bot.storeId!));
        if (now === current.dataHash) {
          if (bot.knowledgeStaleAt) await this.prisma.supportBot.update({ where: { id: bot.id }, data: { knowledgeStaleAt: null } });
          continue;
        }
        if (bot.autoRefresh) {
          const done = await this.refreshApply(null, bot.id);
          if (done.applied.length) refreshed += 1;
          continue;
        }
        if (bot.knowledgeStaleAt) continue;
        const claimed = await this.prisma.supportBot.updateMany({ where: { id: bot.id, knowledgeStaleAt: null }, data: { knowledgeStaleAt: new Date() } });
        if (claimed.count) {
          flagged += 1;
          await this.inbox.reseller(bot.resellerId, 'support.knowledge_stale', { subject: `${bot.id}:${current.version}`, title: `Your store changed: update ${bot.name}’s knowledge`, body: 'Products, payments or policies changed since its knowledge base was updated.', link: `/support/assistants/${bot.id}` });
        }
      } catch (error) {
        this.logger.warn({ err: error, botId: bot.id }, 'Could not check an assistant’s knowledge');
      }
    }
    return { checked: bots.length, flagged, refreshed };
  }
}

export { tones };
