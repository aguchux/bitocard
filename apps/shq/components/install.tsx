"use client";

import { useResellerSettingsQuery } from "@bitocard/api-client/reseller";
import { InstallPrompt } from "@bitocard/ui/install-ui";

/**
 * Asks the team to install SHQ as an app where an admin switched `shq_install_prompt` on for their account (reseller,
 * then country, then global): at most three times, on visits an hour apart.
 */
export function ShqInstallPrompt() {
  const { data } = useResellerSettingsQuery();
  return <InstallPrompt enabled={data?.features.shq_install_prompt === true} appName="BitoCard SHQ" />;
}
