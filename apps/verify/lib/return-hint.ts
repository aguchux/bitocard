import { brand as current, type VerifyBrand } from "./brand";

/**
 * Where a lost applicant probably came from, from the referring page's address: only the brand's own sites (a store on
 * bitocard.com or SHQ for BitoCard's Verify; afrippa.com for Afrippa's) over https, or localhost in development.
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
  if (brand.key !== "bitocard") return { name: brand.name, url: url.origin + "/" };
  const name = url.hostname === "bitocard.com" || sub === "www" ? "BitoCard" : sub === "shq" ? "BitoCard SHQ" : url.hostname;
  return { name, url: url.origin + "/" };
}
