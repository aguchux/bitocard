"use client";

import type { AssistantContext } from "@bitocard/admin-ui/support";
import { useStoresQuery, useSupportAiQuery } from "@bitocard/api-client/reseller";

/**
 * What SHQ's assistant screens need: the reseller's stores, the models on BitoCard's AI (Premium) and the models on their
 * own working keys. Null until both have loaded.
 */
export function useAssistantContext(): AssistantContext | null {
  const stores = useStoresQuery();
  const ai = useSupportAiQuery();
  if (!stores.data || !ai.data) return null;
  const bitocard = Object.fromEntries(ai.data.providers.map(item => [item.provider, item.bitocard_models]));
  const own = Object.fromEntries(ai.data.providers.filter(item => item.own_key && !item.own_key.failed_at).map(item => [item.provider, item.own_key!.models]));
  return {
    base: "/v1/support/bots",
    admin: false,
    stores: stores.data.data.map(store => ({ id: store.id, name: store.name })),
    ai: { premium: ai.data.premium, bitocard, own },
    realm: "reseller",
    avatarPurpose: "bot_avatar",
  };
}
