import { brand as current, type VerifyBrand } from "./brand";

/**
 * Where a lost applicant probably came from, from the referring page's address: only the brand's own sites (a store on
 * bitocard.com or SHQ for BitoCard's Verify; afrippa.com for Afrippa's; udozo.com, its stores' <store>.udozo.com
 * addresses or Seller HQ for Udozo's) over https, or localhost in development.
 * Anything else is not offered.
 */
export function returnHint(referrer: string | null | undefined, brand: VerifyBrand = current): { name: string; url: string } | null {
  if (!referrer) return null;
  let url: URL;
  try {
    url = new URL(referrer);
  } catch {
    return null;
  }
  const local = url.hostname === "localhost" || url.hostname.endsWith(".localhost");
  const own = brand.hosts.some(host => url.hostname === host || url.hostname.endsWith(`.${host}`));
  if (!local && (url.protocol !== "https:" || !own)) return null;
  if (url.hostname.startsWith("verify.")) return null;
  const sub = url.hostname.split(".")[0];
  if (brand.key === "afrippa") return { name: brand.name, url: url.origin + "/" };
  const home = brand.key === "udozo" ? "udozo.com" : "bitocard.com";
  const name = url.hostname === home || sub === "www" ? brand.name : sub === "shq" ? (brand.key === "udozo" ? "Udozo Seller HQ" : "BitoCard SHQ") : url.hostname;
  return { name, url: url.origin + "/" };
}
