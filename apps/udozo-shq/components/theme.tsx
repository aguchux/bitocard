"use client";

import { useEffect } from "react";
import { type SiteThemeColors, useSellerHqThemeQuery } from "@bitocard/api-client/reseller";
import { consoleThemeVariables } from "@bitocard/admin-ui/theme";

/**
 * The console's colour variables from Udozo's theme (`consoleThemeVariables` in `@bitocard/admin-ui/theme`): the accent
 * drives calls to action, the primary the rail and dark surfaces and its lighter tones the borders and soft panels, the
 * ink the text.
 */
export function themeVariables(colors: SiteThemeColors): Record<string, string> {
  return consoleThemeVariables(colors);
}

/** Applies the published theme to the whole document once it loads; Udozo's logo colours (the layout's) stay until then. */
export function UdozoTheme() {
  const { data } = useSellerHqThemeQuery();
  useEffect(() => {
    if (!data) return;
    const root = document.documentElement;
    const variables = themeVariables(data.colors);
    for (const [name, value] of Object.entries(variables)) root.style.setProperty(name, value);
    return () => {
      for (const name of Object.keys(variables)) root.style.removeProperty(name);
    };
  }, [data]);
  return null;
}
