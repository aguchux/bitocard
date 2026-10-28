import { HttpStatus, Injectable } from '@nestjs/common';
import { afrippaOperatorId, afrippaStoreId } from '../afrippa/ids.js';
import { ApiError } from '../common/errors/api-error.js';
import type { AiTool, AiToolCall } from './ai/providers.js';
import type { PromptBot } from './prompt.js';

/** Whose an assistant is: Afrippa's is the one on Afrippa's own store (its traders' and visitors' chats and tickets). */
export const isAfrippaBot = (bot: { storeId: string | null }) => bot.storeId === afrippaStoreId;
export const isAfrippaAccount = (resellerId: string) => resellerId === afrippaOperatorId;

/** Who the assistant is talking to: a signed-in trader (their customer id) or a signed-out visitor. */
export type AfrippaAsker = { customerId: string | null; chatId?: string };

/**
 * What only Afrippa knows about its assistant, registered by Afrippa's module (`AfrippaAssistantService`) so the shared
 * support code never imports the market: its rules, its knowledge (generated from live settings, a section per market),
 * and its tools (the market's ads, the trader's own orders, fees and the safety checks; none acts on money).
 */
export interface AfrippaAssistant {
  prompt(bot: PromptBot, asker: AfrippaAsker): string;
  generate(): Promise<string>;
  tools(asker: AfrippaAsker): AiTool[];
  /** A tool's result, or null when the tool is not Afrippa's (the shared handover and ticket tools). */
  run(asker: AfrippaAsker, call: AiToolCall): Promise<string | null>;
}

@Injectable()
export class AfrippaAssistantRegistry {
  private hooks: AfrippaAssistant | null = null;

  use(hooks: AfrippaAssistant) {
    this.hooks = hooks;
  }

  get(): AfrippaAssistant {
    if (!this.hooks) throw new ApiError(HttpStatus.SERVICE_UNAVAILABLE, 'api_error', 'assistant_unavailable', 'Afrippa’s assistant is not available.');
    return this.hooks;
  }
}
