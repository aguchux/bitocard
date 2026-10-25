import { ProviderError } from '../../payments/provider-error.js';

/**
 * AI providers behind one interface, so support bots run on Anthropic, OpenAI or DeepSeek alike. The adapters speak each
 * provider's HTTP API with `fetch` (no SDKs), keep keys and raw errors inside, and return text, tool calls and usage.
 */

export const aiProviders = ['anthropic', 'openai', 'deepseek'] as const;
export type AiProviderName = (typeof aiProviders)[number];

export const aiProviderLabels: Record<AiProviderName, string> = { anthropic: 'Anthropic (Claude)', openai: 'OpenAI', deepseek: 'DeepSeek' };

/** A tool the model may call: its JSON Schema parameters. BitoCard runs it (scoped server-side) and returns the result. */
export type AiTool = { name: string; description: string; parameters: Record<string, unknown> };
export type AiToolCall = { id: string; name: string; arguments: Record<string, unknown> };
/** A photo for a model that reads images (Anthropic, OpenAI): base64 bytes and their type. */
export type AiImage = { mediaType: 'image/jpeg' | 'image/png' | 'image/webp'; data: string };

export type AiTurn =
  | { role: 'user'; content: string; images?: AiImage[] }
  | { role: 'assistant'; content: string | null; toolCalls?: AiToolCall[] }
  | { role: 'tool'; toolCallId: string; name: string; content: string };

export type AiRequest = {
  model: string;
  /** Fixed instructions (BitoCard's rules and the bot's profile). */
  system: string;
  /** Long, stable context (the knowledge document): cached by the provider where it can. */
  context?: string;
  /** Per-conversation facts (who the requester is), after the cached context so the cache still matches. */
  about?: string;
  messages: AiTurn[];
  tools?: AiTool[];
  maxTokens: number;
};

/** `input`: every prompt token, the cached ones included; `cached`: those read from the provider's cache. */
export type AiUsage = { input: number; cached: number; output: number };
export type AiReply = { text: string | null; toolCalls: AiToolCall[]; usage: AiUsage; stop: string };

export interface AiProvider {
  readonly name: AiProviderName;
  reply(request: AiRequest): Promise<AiReply>;
  /** A harmless call proving the key works (the model list). Throws ProviderError, definite when the key is refused. */
  check(): Promise<string[]>;
}

const timeoutMs = 60_000;

async function call<T>(provider: AiProviderName, url: string, init: { method?: string; headers: Record<string, string>; body?: unknown }): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: init.method ?? 'GET',
      headers: { accept: 'application/json', ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}), ...init.headers },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new ProviderError(provider, `request failed: ${(error as Error).message}`, false);
  }
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    throw new ProviderError(provider, `unreadable response (HTTP ${res.status})`, false, res.status);
  }
  if (!res.ok) {
    const error = (body as { error?: { message?: string } | string } | null)?.error;
    const message = typeof error === 'string' ? error : (error?.message ?? `HTTP ${res.status}`);
    // A refused key, a bad request or an unknown model is definite; overload, rate limits and server errors are not.
    throw new ProviderError(provider, message.slice(0, 300), res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429, res.status);
  }
  return body as T;
}

const parseArguments = (raw: unknown): Record<string, unknown> => {
  if (raw && typeof raw === 'object') return raw as Record<string, unknown>;
  try {
    const parsed = JSON.parse(String(raw ?? '{}'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

type AnthropicBlock = { type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string; input: unknown } | { type: string };
type AnthropicReply = { content?: AnthropicBlock[]; stop_reason?: string; usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number } };

/** Anthropic's Messages API. The knowledge document is a cached system block (`cache_control`), so repeats are cheap. */
export class AnthropicProvider implements AiProvider {
  readonly name = 'anthropic' as const;
  constructor(private readonly options: { apiKey: string; baseUrl: string }) {}

  private headers() {
    return { 'x-api-key': this.options.apiKey.trim(), 'anthropic-version': '2023-06-01' };
  }

  private url(path: string) {
    return `${this.options.baseUrl.replace(/\/+$/, '')}${path}`;
  }

  async reply(request: AiRequest): Promise<AiReply> {
    const system = [{ type: 'text', text: request.system }, ...(request.context ? [{ type: 'text', text: request.context, cache_control: { type: 'ephemeral' } }] : []), ...(request.about ? [{ type: 'text', text: request.about }] : [])];
    const messages: Array<{ role: 'user' | 'assistant'; content: unknown }> = [];
    for (const turn of request.messages) {
      if (turn.role === 'user')
        messages.push({ role: 'user', content: turn.images?.length ? [...turn.images.map(image => ({ type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.data } })), { type: 'text', text: turn.content }] : turn.content });
      else if (turn.role === 'assistant') {
        messages.push({ role: 'assistant', content: [...(turn.content ? [{ type: 'text', text: turn.content }] : []), ...(turn.toolCalls ?? []).map(callItem => ({ type: 'tool_use', id: callItem.id, name: callItem.name, input: callItem.arguments }))] });
      } else {
        // Tool results go back as a user turn; consecutive results share one.
        const result = { type: 'tool_result', tool_use_id: turn.toolCallId, content: turn.content };
        const previous = messages.at(-1);
        if (previous?.role === 'user' && Array.isArray(previous.content)) (previous.content as unknown[]).push(result);
        else messages.push({ role: 'user', content: [result] });
      }
    }
    const reply = await call<AnthropicReply>(this.name, this.url('/v1/messages'), {
      method: 'POST',
      headers: this.headers(),
      body: {
        model: request.model,
        max_tokens: request.maxTokens,
        system,
        messages,
        ...(request.tools?.length ? { tools: request.tools.map(tool => ({ name: tool.name, description: tool.description, input_schema: tool.parameters })) } : {}),
      },
    });
    const blocks = reply.content ?? [];
    const text = blocks.filter((block): block is { type: 'text'; text: string } => block.type === 'text').map(block => block.text).join('').trim();
    const toolCalls = blocks.filter((block): block is { type: 'tool_use'; id: string; name: string; input: unknown } => block.type === 'tool_use').map(block => ({ id: block.id, name: block.name, arguments: parseArguments(block.input) }));
    const usage = reply.usage ?? {};
    return {
      text: text || null,
      toolCalls,
      // Anthropic counts cache reads and writes apart from input_tokens; `input` is the whole prompt, as OpenAI reports it.
      usage: { input: (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0), cached: usage.cache_read_input_tokens ?? 0, output: usage.output_tokens ?? 0 },
      stop: reply.stop_reason ?? 'unknown',
    };
  }

  async check() {
    const models = await call<{ data?: Array<{ id: string }> }>(this.name, this.url('/v1/models?limit=100'), { headers: this.headers() });
    return (models.data ?? []).map(model => model.id);
  }
}

type ChatCompletion = {
  choices?: Array<{ message?: { content?: string | null; tool_calls?: Array<{ id: string; function?: { name?: string; arguments?: string } }> }; finish_reason?: string }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number }; prompt_cache_hit_tokens?: number };
};

/**
 * OpenAI's Chat Completions, and DeepSeek's (the same API at https://api.deepseek.com). Both cache repeated prompt
 * prefixes by themselves, so the knowledge document goes first in the system message.
 */
export class OpenAiCompatibleProvider implements AiProvider {
  constructor(
    readonly name: 'openai' | 'deepseek',
    private readonly options: { apiKey: string; baseUrl: string },
  ) {}

  private headers() {
    return { authorization: `Bearer ${this.options.apiKey.trim().replace(/^bearer\s+/i, '')}` };
  }

  /** OpenAI's paths carry /v1; DeepSeek serves them at its root. */
  private url(path: string) {
    const base = this.options.baseUrl.replace(/\/+$/, '');
    return this.name === 'openai' && !base.endsWith('/v1') ? `${base}/v1${path}` : `${base}${path}`;
  }

  async reply(request: AiRequest): Promise<AiReply> {
    const system = [request.context, request.system, request.about].filter(Boolean).join('\n\n');
    const messages: unknown[] = [{ role: 'system', content: system }];
    for (const turn of request.messages) {
      if (turn.role === 'user')
        messages.push({ role: 'user', content: turn.images?.length ? [{ type: 'text', text: turn.content }, ...turn.images.map(image => ({ type: 'image_url', image_url: { url: `data:${image.mediaType};base64,${image.data}` } }))] : turn.content });
      else if (turn.role === 'assistant') {
        messages.push({
          role: 'assistant',
          content: turn.content,
          ...(turn.toolCalls?.length ? { tool_calls: turn.toolCalls.map(callItem => ({ id: callItem.id, type: 'function', function: { name: callItem.name, arguments: JSON.stringify(callItem.arguments) } })) } : {}),
        });
      } else messages.push({ role: 'tool', tool_call_id: turn.toolCallId, content: turn.content });
    }
    const reply = await call<ChatCompletion>(this.name, this.url('/chat/completions'), {
      method: 'POST',
      headers: this.headers(),
      body: {
        model: request.model,
        messages,
        // OpenAI's newer models take max_completion_tokens; DeepSeek takes max_tokens.
        ...(this.name === 'openai' ? { max_completion_tokens: request.maxTokens } : { max_tokens: request.maxTokens }),
        ...(request.tools?.length ? { tools: request.tools.map(tool => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.parameters } })) } : {}),
      },
    });
    const choice = reply.choices?.[0];
    const usage = reply.usage ?? {};
    return {
      text: choice?.message?.content?.trim() || null,
      toolCalls: (choice?.message?.tool_calls ?? []).map(item => ({ id: item.id, name: item.function?.name ?? '', arguments: parseArguments(item.function?.arguments) })),
      usage: { input: usage.prompt_tokens ?? 0, cached: usage.prompt_tokens_details?.cached_tokens ?? usage.prompt_cache_hit_tokens ?? 0, output: usage.completion_tokens ?? 0 },
      stop: choice?.finish_reason ?? 'unknown',
    };
  }

  async check() {
    const models = await call<{ data?: Array<{ id: string }> }>(this.name, this.url('/models'), { headers: this.headers() });
    return (models.data ?? []).map(model => model.id);
  }
}

/** Providers whose models read photos (DeepSeek's API takes text only). */
export const visionProviders: readonly AiProviderName[] = ['anthropic', 'openai'];

export function aiProvider(name: AiProviderName, options: { apiKey: string; baseUrl: string }): AiProvider {
  return name === 'anthropic' ? new AnthropicProvider(options) : new OpenAiCompatibleProvider(name, options);
}

/** A model's price per million tokens in US dollars, from the admin's price list. */
export type AiPrice = { input: number; output: number; cached: number };

/**
 * "model input output cached" per line or separated by semicolons, US dollars per million tokens, for example
 * `claude-haiku-5-5 1 5 0.1`. Lines it cannot read are skipped (a missing price only means the cost shows as 0).
 */
export function parseAiPrices(text: string | undefined): Map<string, AiPrice> {
  const prices = new Map<string, AiPrice>();
  for (const line of (text ?? '').split(/[;\n]+/)) {
    const [model, input, output, cached] = line.trim().split(/\s+/);
    const numbers = [input, output, cached ?? input].map(Number);
    if (model && numbers.every(value => Number.isFinite(value) && value >= 0)) prices.set(model, { input: numbers[0], output: numbers[1], cached: numbers[2] });
  }
  return prices;
}

/** What a reply cost, in millionths of a US dollar (cached input at its own price). */
export function aiCostMicros(usage: AiUsage, price: AiPrice | undefined) {
  if (!price) return 0n;
  const fresh = Math.max(0, usage.input - usage.cached);
  return BigInt(Math.round(fresh * price.input + usage.cached * price.cached + usage.output * price.output));
}

/** "anthropic:claude-haiku-5-5, openai:gpt-5-mini" to the models allowed per provider. */
export function parseModelList(text: string | undefined): Array<{ provider: AiProviderName; model: string }> {
  return (text ?? '')
    .split(/[,;\n]+/)
    .map(item => item.trim())
    .filter(Boolean)
    .map(item => {
      const [provider, ...rest] = item.split(':');
      return { provider: provider as AiProviderName, model: rest.join(':').trim() };
    })
    .filter(item => (aiProviders as readonly string[]).includes(item.provider) && item.model);
}
