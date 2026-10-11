/**
 * An eSIM's activation string (`LPA:1$<SM-DP+ address>$<activation code>`): the address and code for installing by
 * hand, and the one-tap install links Apple and Google publish (they open the phone's own eSIM set-up with the code
 * filled in). Null for anything that is not a well-formed LPA string.
 */
export function esimInstall(lpa: string | null | undefined) {
  const match = /^LPA:1\$([^$\s]+)\$([^$\s]+)$/.exec((lpa ?? "").trim());
  if (!match) return null;
  const carddata = encodeURIComponent(match[0]);
  return {
    lpa: match[0],
    smdp: match[1],
    activationCode: match[2],
    apple: `https://esimsetup.apple.com/esim_qrcode_provisioning?carddata=${carddata}`,
    android: `https://esimsetup.android.com/esim_qrcode_provisioning?carddata=${carddata}`,
  };
}

/** What the customer is told about an eSIM, from its delivery details, in reading order. */
export const esimDetailLabels: Record<string, string> = { data: "Data", validity: "Valid for", apn: "APN", install_by: "Install by" };
