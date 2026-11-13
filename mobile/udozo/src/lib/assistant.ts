import { parseAssistantEvents, type ShopAssistantEvent, type ShopAssistantMessage, type ShopAssistantProfile, type ShopAssistantSurface, type ShopAssistantThread } from '@shared/classifieds';
import { useQuery } from '@tanstack/react-query';
import { fetch as streamingFetch } from 'expo/fetch';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { api, newIdempotencyKey } from '@/lib/api';
import { appTag, buildRequest, networkError, readResponse } from '@/lib/api-core';
import { useAccount } from '@/lib/account';
import { appPlatform } from '@/lib/app-config';
import { apiUrl, appVersion } from '@/lib/config';
import { readSession } from '@/lib/session';

/**
 * Ask Anjio, the shop assistant, in the app (udozo.com's `components/assistant.tsx`). A signed-in customer is known by
 * their session; a visitor by the token the API gave their first conversation (`bav_…`), kept in the phone's secure
 * store and sent as `BitoCard-Assistant-Visitor` while signed out. Answers stream as server-sent events: React Native's
 * own fetch cannot read a body as it arrives, so they come through Expo's (`expo/fetch`) and `parseAssistantEvents`.
 */
const visitorKey = 'udozo.assistant-visitor';
const visitorHeader = 'BitoCard-Assistant-Visitor';
const visitorPattern = /^bav_[A-Za-z0-9_-]{43}$/;
const languageKey = 'udozo.assistant-language';

const readVisitor = async () => {
  const token = await SecureStore.getItemAsync(visitorKey).catch(() => null);
  return token && visitorPattern.test(token) ? token : null;
};

/** What every assistant call carries signed out: the visitor's token, if they have one (signed in, the session does). */
async function visitorHeaders(): Promise<Record<string, string> | undefined> {
  if (await readSession()) return undefined;
  const token = await readVisitor();
  return token ? { [visitorHeader]: token } : undefined;
}

/** The language chosen in the assistant before, on this phone (a convenience only). */
export const savedLanguage = () => SecureStore.getItemAsync(languageKey).catch(() => null);
export const saveLanguage = (code: string) => SecureStore.setItemAsync(languageKey, code).catch(() => undefined);

/** The assistant serving a country (and language), or `assistant: null` where none answers. */
export async function assistantProfile(country: string, language?: string | null) {
  return api<ShopAssistantProfile>(`/v1/classifieds/assistant?country=${country}&surface=browse${language ? `&language=${encodeURIComponent(language)}` : ''}`, { headers: await visitorHeaders() });
}

/**
 * Whether Anjio answers buyers in the market: the market's assistant switch (`features.assistant` from
 * `/v1/app/config`; unknown counts as maybe), then its profile. Null while unknown or where none answers.
 */
export function useShopAssistant(country: string | null | undefined) {
  const { customer } = useAccount();
  const features = useQuery({
    queryKey: ['app-config', 'features', country],
    enabled: Boolean(country),
    staleTime: 10 * 60_000,
    queryFn: () => api<{ features: Record<string, boolean> | null }>(`/v1/app/config?platform=${appPlatform}&version=${encodeURIComponent(appVersion)}&country=${country}`),
  });
  const off = features.data?.features?.assistant === false;
  const profile = useQuery({
    queryKey: ['assistant', 'browse', country, Boolean(customer)],
    enabled: Boolean(country) && !off && !features.isPending,
    staleTime: 5 * 60_000,
    queryFn: () => assistantProfile(country!),
  });
  const found = profile.data?.assistant;
  return !off && found && found.roles.includes('browse') ? profile.data! : null;
}

/** Starts a conversation; a visitor's first keeps the token the API gives. */
export async function startThread(input: { country: string; language?: string | null; surface: ShopAssistantSurface; listing_id?: string | null; conversation_id?: string | null }) {
  const body = { country: input.country, surface: input.surface, ...(input.language ? { language: input.language } : {}), ...(input.listing_id ? { listing_id: input.listing_id } : {}), ...(input.conversation_id ? { conversation_id: input.conversation_id } : {}) };
  const thread = await api<ShopAssistantThread>('/v1/classifieds/assistant/threads', { body, headers: await visitorHeaders() });
  if (thread.visitor_token && visitorPattern.test(thread.visitor_token)) await SecureStore.setItemAsync(visitorKey, thread.visitor_token).catch(() => undefined);
  return thread;
}

export async function rateAnswer(messageId: string, rating: 'up' | 'down') {
  return api<ShopAssistantMessage>(`/v1/classifieds/assistant/messages/${messageId}/rating`, { body: { rating }, headers: await visitorHeaders() });
}

export async function reportAnswer(messageId: string, reason: string) {
  return api<ShopAssistantMessage>(`/v1/classifieds/assistant/messages/${messageId}/report`, { body: { reason: reason.trim().slice(0, 500) }, headers: await visitorHeaders() });
}

/** Talk to a person (signed in): a support chat with Udozo's team, opened with the conversation. */
export const talkToPerson = (threadId: string) => api<{ chat_id: string }>(`/v1/classifieds/assistant/threads/${threadId}/human`, { body: {} });

/**
 * Asks a question and hands each event to `onEvent` as it arrives: `status` as each tool runs, `cards`, then `message`
 * (or `error`). A refusal before the answer starts is thrown as an `ApiError`, as any call's.
 */
export async function askAssistant(threadId: string, question: string, onEvent: (event: ShopAssistantEvent) => void) {
  const session = await readSession();
  const visitor = session ? null : await readVisitor();
  const { url, init } = buildRequest(
    apiUrl,
    `/v1/classifieds/assistant/threads/${threadId}/messages`,
    { body: { body: question }, session, app: appTag(Platform.OS === 'ios' ? 'ios' : 'android', appVersion), headers: { ...(visitor ? { [visitorHeader]: visitor } : {}) } },
    newIdempotencyKey,
  );
  init.headers.Accept = 'text/event-stream';
  let response: Awaited<ReturnType<typeof streamingFetch>>;
  try {
    response = await streamingFetch(url, init);
  } catch {
    throw networkError();
  }
  if (!response.ok) {
    await readResponse(response as unknown as Response);
    return;
  }
  const decoder = new TextDecoder();
  let buffer = '';
  const take = (final: boolean) => {
    const parsed = parseAssistantEvents(final ? `${buffer}\n\n` : buffer);
    buffer = parsed.rest;
    parsed.events.forEach(onEvent);
  };
  const reader = response.body?.getReader();
  if (!reader) {
    buffer = await response.text();
    take(true);
    return;
  }
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    take(false);
  }
  buffer += decoder.decode();
  take(true);
}
