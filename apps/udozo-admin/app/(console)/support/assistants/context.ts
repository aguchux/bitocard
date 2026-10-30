"use client";

import type { AssistantContext } from "@bitocard/admin-ui/support";
import { useAdminSupportAiQuery } from "@bitocard/api-client/admin";

/** udozo.com's store. */
export const houseStoreId = "00000000-0000-4000-8000-0000000000b2";

/** Udozo's assistants run on its own AI, for udozo.com or resellers in Seller HQ. */
export function useAdminAssistantContext(): AssistantContext | null {
  const ai = useAdminSupportAiQuery();
  if (!ai.data) return null;
  const bitocard: AssistantContext["ai"]["bitocard"] = {};
  for (const item of ai.data.bitocard_models) bitocard[item.provider] = [...(bitocard[item.provider] ?? []), item.model];
  return {
    base: "/v1/admin/support/bots",
    admin: true,
    stores: [{ id: houseStoreId, name: "udozo.com" }],
    ai: { premium: true, bitocard, own: {} },
    realm: "admin",
    avatarPurpose: "platform_bot_avatar",
    brand: "Udozo",
  };
}
