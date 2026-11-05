"use client";

import { useEffect } from "react";
import { adminUdozoApi } from "@bitocard/api-client/admin";
import { useSellerHqThemeQuery } from "@bitocard/api-client/reseller";
import { consoleThemeVariables } from "@bitocard/admin-ui/theme";

/**
 * Udozo's admin wears Udozo's published theme, as Seller HQ does: the public `/v1/theme` (Udozo's logo colours, from
 * the layout, until it loads), or, once the Theme page has read the settings, what it says is live, so publishing a
 * theme recolours the console at once.
 */
export function UdozoTheme() {
  const { data: site } = useSellerHqThemeQuery();
  // Read from the cache only: the Theme page fetches the settings; this never asks for them (they need a session).
  const { data: settings } = adminUdozoApi.endpoints.themeSettings.useQueryState();
  const colors = settings?.published?.colors ?? site?.colors;
  useEffect(() => {
    if (!colors) return;
    const root = document.documentElement;
    const variables = consoleThemeVariables(colors);
    for (const [name, value] of Object.entries(variables)) root.style.setProperty(name, value);
    return () => {
      for (const name of Object.keys(variables)) root.style.removeProperty(name);
    };
  }, [colors]);
  return null;
}
