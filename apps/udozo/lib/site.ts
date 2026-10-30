/**
 * This site's own address (`UDOZO_URL`, else udozo.com on Vercel, else localhost:3007), never from forwarded headers a
 * proxy might let callers set. Payment pages return here, and the handoff names it. Pure, for the proxy too.
 */
export function siteOrigin() {
  return new URL(process.env.UDOZO_URL || (process.env.VERCEL ? "https://udozo.com" : "http://localhost:3007")).origin;
}
