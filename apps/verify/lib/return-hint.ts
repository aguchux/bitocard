/**
 * Where a lost applicant probably came from, from the referring page's address: only BitoCard's own sites (a store on
 * bitocard.com, SHQ) over https, or localhost in development. Anything else is not offered.
 */
export function returnHint(referrer: string | null | undefined): { name: string; url: string } | null {
  if (!referrer) return null;
  let url: URL;
  try {
    url = new URL(referrer);
  } catch {
    return null;
  }
  const local = url.hostname === "localhost" || url.hostname.endsWith(".localhost");
  if (!local && (url.protocol !== "https:" || !(url.hostname === "bitocard.com" || url.hostname.endsWith(".bitocard.com")))) return null;
  if (url.hostname.startsWith("verify.")) return null;
  const sub = url.hostname.split(".")[0];
  const name = url.hostname === "bitocard.com" || sub === "www" ? "BitoCard" : sub === "shq" ? "BitoCard SHQ" : url.hostname;
  return { name, url: url.origin + "/" };
}
