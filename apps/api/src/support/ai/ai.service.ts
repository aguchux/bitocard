import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { PlanAccessService } from '../../plans/plan-access.js';
import { AuditService } from '../../audit/audit.service.js';
import { ApiError } from '../../common/errors/api-error.js';
import { Encryption } from '../../common/encryption.js';
import { APP_CONFIG, type AppConfig } from '../../config/config.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { LedgerMode } from '../../generated/prisma/client.js';
import { IntegrationsService } from '../../integrations/integrations.service.js';
import { ProviderError } from '../../payments/provider-error.js';
import { aiCostMicros, aiProvider, type AiProvider, type AiProviderName, aiProviderLabels, aiProviders, type AiReply, type AiRequest, parseAiPrices, parseModelList } from './providers.js';

export type AiFunding = 'bitocard' | 'own';
export type AiKind = 'chat' | 'ticket' | 'generate' | 'test';
export type AiCall = { funding: AiFunding; provider: AiProviderName; model: string; resellerId: string; storeId: string | null; botId: string | null; mode: LedgerMode; kind: AiKind };

const keys: Record<AiProviderName, { key: keyof AppConfig; url: keyof AppConfig; prices: keyof AppConfig }> = {
  anthropic: { key: 'ANTHROPIC_API_KEY', url: 'ANTHROPIC_API_URL', prices: 'ANTHROPIC_PRICES' },
  openai: { key: 'OPENAI_API_KEY', url: 'OPENAI_API_URL', prices: 'OPENAI_PRICES' },
  deepseek: { key: 'DEEPSEEK_API_KEY', url: 'DEEPSEEK_API_URL', prices: 'DEEPSEEK_PRICES' },
};

const unavailable = (message: string) => new ApiError(HttpStatus.SERVICE_UNAVAILABLE, 'api_error', 'ai_unavailable', message);
const invalid = (code: string, message: string, param?: string) => new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', code, message, param);

/** The start of this UTC month, which the allowance counts from. */
export const monthStart = (at = new Date()) => new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1));

/**
 * AI for support. Bots run on BitoCard's keys (integration settings, for stores whose plan includes `ai_assistant`,
 * within a monthly allowance of replies per store) or on the reseller's own key (`ai_keys`, checked with the provider
 * before saving, encrypted, no BitoCard limit). Every call is recorded in `ai_usage` with its tokens and cost.
 */
@Injectable()
export class AiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly integrations: IntegrationsService,
    private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly planAccess: PlanAccessService,
  ) {}

  private encryption() {
    if (!this.config.ENCRYPTION_KEY) throw new Error('ENCRYPTION_KEY is not configured');
    return new Encryption(this.config.ENCRYPTION_KEY);
  }

  private setting(name: keyof AppConfig) {
    return this.integrations.config[name] as string | undefined;
  }

  /** The models stores may choose on BitoCard's keys, for providers whose key is set. */
  bitocardModels() {
    return parseModelList(this.integrations.config.AI_BITOCARD_MODELS as string | undefined).filter(item => Boolean(this.setting(keys[item.provider].key)?.trim()));
  }

  /** The default replies a month per store, for plans that set none (the Support assistant setting). */
  defaultAllowance() {
    return Number(this.integrations.config.AI_MONTHLY_REPLIES ?? 2000);
  }

  /** Replies a month per store on BitoCard's AI for the reseller's plan (null: unlimited). */
  async allowance(resellerId: string) {
    return (await this.planAccess.limit(resellerId, 'ai_replies')).value;
  }

  private bitocardProvider(provider: AiProviderName): AiProvider | null {
    const apiKey = this.setting(keys[provider].key)?.trim();
    return apiKey ? aiProvider(provider, { apiKey, baseUrl: this.setting(keys[provider].url) ?? '' }) : null;
  }

  /** Test connection for BitoCard's own key. */
  async checkBitocard(provider: AiProviderName) {
    const client = this.bitocardProvider(provider);
    if (!client) return { ok: false, message: 'Set the API key first.' };
    try {
      const models = await client.check();
      return { ok: true, message: models.length ? `The key can use ${models.length} models.` : null };
    } catch (error) {
      const detail = error instanceof Error ? error.message.replace(new RegExp(`^${provider}: `), '') : 'unknown error';
      return { ok: false, message: error instanceof ProviderError && error.definite ? `${aiProviderLabels[provider]} refused this key (${detail}).` : `Could not reach ${aiProviderLabels[provider]} (${detail}). Try again in a moment.` };
    }
  }

  // -- Resellers' own keys -----------------------------------------------------------------------------------------

  async keysFor(resellerId: string) {
    const rows = await this.prisma.aiKey.findMany({ where: { resellerId } });
    return rows.map(row => ({ provider: row.provider as AiProviderName, last4: row.last4, models: row.models, checked_at: row.checkedAt.toISOString(), failed_at: row.failedAt?.toISOString() ?? null }));
  }

  /** Saves the reseller's key once the provider accepts it (its model list), replacing any earlier one. */
  async saveKey(resellerId: string, actorId: string | null, provider: AiProviderName, apiKey: string) {
    const key = apiKey.trim();
    if (key.length < 16) throw invalid('parameter_invalid', 'That does not look like an API key.', 'api_key');
    let models: string[];
    try {
      models = await aiProvider(provider, { apiKey: key, baseUrl: this.setting(keys[provider].url) ?? '' }).check();
    } catch (error) {
      if (error instanceof ProviderError && error.definite) throw invalid('ai_key_refused', `${aiProviderLabels[provider]} refused this key. Check it and try again.`, 'api_key');
      throw unavailable(`${aiProviderLabels[provider]} could not be reached to check the key. Try again in a moment.`);
    }
    const data = { keyEncrypted: this.encryption().encrypt(key), last4: key.slice(-4), models: models.slice(0, 200), checkedAt: new Date(), failedAt: null, createdById: actorId };
    await this.prisma.aiKey.upsert({ where: { resellerId_provider: { resellerId, provider } }, create: { resellerId, provider, ...data }, update: data });
    await this.audit.record({ actorId, action: 'ai_key.saved', targetType: 'reseller', targetId: resellerId, before: null, after: { provider, last4: data.last4 } });
    return (await this.keysFor(resellerId)).find(item => item.provider === provider)!;
  }

  async deleteKey(resellerId: string, actorId: string | null, provider: AiProviderName) {
    const deleted = await this.prisma.aiKey.deleteMany({ where: { resellerId, provider } });
    if (deleted.count) await this.audit.record({ actorId, action: 'ai_key.deleted', targetType: 'reseller', targetId: resellerId, before: { provider }, after: null });
  }

  private async ownProvider(resellerId: string, provider: AiProviderName): Promise<AiProvider | null> {
    const row = await this.prisma.aiKey.findUnique({ where: { resellerId_provider: { resellerId, provider } } });
    if (!row || row.failedAt) return null;
    return aiProvider(provider, { apiKey: this.encryption().decrypt(row.keyEncrypted), baseUrl: this.setting(keys[provider].url) ?? '' });
  }

  // -- Allowance and usage -----------------------------------------------------------------------------------------

  /** Bot replies on BitoCard's keys this month for a store (playground tests and knowledge generation do not count). */
  async usedThisMonth(storeId: string) {
    return this.prisma.aiUsage.count({ where: { storeId, funding: 'bitocard', kind: { in: ['chat', 'ticket'] }, createdAt: { gte: monthStart() } } });
  }

  /** Replies left this month for a store (Infinity when its plan has no limit). */
  async allowanceLeft(storeId: string) {
    const allowance = (await this.planAccess.storeLimit(storeId, 'ai_replies')).value;
    return allowance === null ? Infinity : Math.max(0, allowance - (await this.usedThisMonth(storeId)));
  }

  /**
   * Whether bots on BitoCard's keys are included: the store's own plan when there is a store, else the account's (its
   * highest store plan).
   */
  async premium(resellerId: string, storeId?: string | null) {
    if (storeId) return this.planAccess.storeHas(storeId, 'ai_assistant');
    const reseller = await this.prisma.reseller.findUnique({ where: { id: resellerId }, include: { plan: true } });
    return Boolean(reseller?.house || reseller?.plan.features.includes('ai_assistant'));
  }

  /**
   * One AI call for support, recorded with its usage. On BitoCard's keys the plan must include the assistant and, for
   * replies, the store must have allowance left (`ai_allowance_reached`). A key the provider refuses stops being used
   * (`failed_at`) until it is replaced.
   */
  async reply(call: AiCall, request: Omit<AiRequest, 'model'>): Promise<AiReply> {
    let client: AiProvider | null;
    if (call.funding === 'bitocard') {
      if (!(await this.premium(call.resellerId, call.storeId))) throw new ApiError(HttpStatus.FORBIDDEN, 'permission_error', 'ai_plan_required', 'Assistants on BitoCard’s AI need the Premium plan. Use your own AI key instead, or change plan.');
      if (!this.bitocardModels().some(item => item.provider === call.provider && item.model === call.model)) throw invalid('ai_model_unavailable', 'This model is not offered on BitoCard’s AI. Choose another.', 'model');
      if (call.storeId && (call.kind === 'chat' || call.kind === 'ticket') && (await this.allowanceLeft(call.storeId)) <= 0) {
        throw new ApiError(HttpStatus.PAYMENT_REQUIRED, 'invalid_request_error', 'ai_allowance_reached', 'This store has used this month’s assistant replies on BitoCard’s AI. People answer until next month, or add your own AI key.');
      }
      client = this.bitocardProvider(call.provider);
      if (!client) throw unavailable(`${aiProviderLabels[call.provider]} is not set up on BitoCard’s AI.`);
    } else {
      client = await this.ownProvider(call.resellerId, call.provider);
      if (!client) throw unavailable(`Add a working ${aiProviderLabels[call.provider]} key to use it.`);
    }
    let reply: AiReply;
    try {
      reply = await client.reply({ ...request, model: call.model });
    } catch (error) {
      if (call.funding === 'own' && error instanceof ProviderError && (error.status === 401 || error.status === 403)) {
        await this.prisma.aiKey.updateMany({ where: { resellerId: call.resellerId, provider: call.provider }, data: { failedAt: new Date() } });
      }
      throw error;
    }
    const price = parseAiPrices(this.setting(keys[call.provider].prices)).get(call.model);
    await this.prisma.aiUsage.create({
      data: {
        resellerId: call.resellerId,
        storeId: call.storeId,
        botId: call.botId,
        mode: call.mode,
        funding: call.funding,
        provider: call.provider,
        model: call.model,
        kind: call.kind,
        inputTokens: reply.usage.input,
        cachedTokens: reply.usage.cached,
        outputTokens: reply.usage.output,
        costMicros: call.funding === 'bitocard' ? aiCostMicros(reply.usage, price) : 0n,
      },
    });
    return reply;
  }

  /** What the reseller sees: providers, their keys, the models on BitoCard's AI, and this month's use per store. */
  async overview(resellerId: string) {
    const [own, premium, stores] = await Promise.all([this.keysFor(resellerId), this.premium(resellerId), this.prisma.store.findMany({ where: { resellerId }, select: { id: true, name: true } })]);
    const usage = await Promise.all(
      stores.map(async store => ({
        store_id: store.id,
        store_name: store.name,
        bitocard_replies: await this.usedThisMonth(store.id),
        /** This store's monthly replies on its own plan (null: no limit). */
        replies_allowed: (await this.planAccess.storeLimit(store.id, 'ai_replies')).value,
      })),
    );
    const bitocard = this.bitocardModels();
    return {
      object: 'support_ai' as const,
      premium,
      allowance: { replies_per_store: await this.allowance(resellerId), month_start: monthStart().toISOString(), stores: usage },
      providers: aiProviders.map(provider => ({ provider, label: aiProviderLabels[provider], bitocard_models: bitocard.filter(item => item.provider === provider).map(item => item.model), own_key: own.find(item => item.provider === provider) ?? null })),
    };
  }

  /** Usage for a month: per store and funding (resellers), or per reseller and provider (admins). */
  async usage(filter: { resellerId?: string; month?: string }) {
    const start = filter.month && /^\d{4}-\d{2}$/.test(filter.month) ? new Date(`${filter.month}-01T00:00:00.000Z`) : monthStart();
    const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
    const rows = await this.prisma.aiUsage.groupBy({
      by: ['resellerId', 'storeId', 'funding', 'provider', 'model'],
      where: { resellerId: filter.resellerId, createdAt: { gte: start, lt: end } },
      _count: { _all: true },
      _sum: { inputTokens: true, cachedTokens: true, outputTokens: true, costMicros: true },
    });
    return {
      object: 'list' as const,
      month: start.toISOString().slice(0, 7),
      data: rows.map(row => ({
        ...(filter.resellerId ? {} : { reseller_id: row.resellerId }),
        store_id: row.storeId,
        funding: row.funding as AiFunding,
        provider: row.provider as AiProviderName,
        model: row.model,
        calls: row._count._all,
        input_tokens: row._sum.inputTokens ?? 0,
        cached_tokens: row._sum.cachedTokens ?? 0,
        output_tokens: row._sum.outputTokens ?? 0,
        // Costs are BitoCard's (its keys); the store's own key is billed by its provider.
        cost_usd: Number(row._sum.costMicros ?? 0n) / 1_000_000,
      })),
    };
  }
}
