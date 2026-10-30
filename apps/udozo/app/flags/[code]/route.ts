import * as flags from "country-flag-icons/string/3x2";

/**
 * Country flags as SVG files (`/flags/us.svg`), served from the store itself, never an outside image host, and
 * prerendered at build. From country-flag-icons (MIT).
 */
const table = flags as unknown as Record<string, string>;

export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams() {
  return Object.keys(table)
    .filter(code => /^[A-Z]{2}$/.test(code))
    .map(code => ({ code: `${code.toLowerCase()}.svg` }));
}

export async function GET(_request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const svg = table[code.replace(/\.svg$/, "").toUpperCase()];
  if (!svg) return new Response("Not found", { status: 404 });
  return new Response(svg, { headers: { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=31536000, immutable" } });
}
