import { legalsOgImage, ogFileName, ogPathForFile, ogPaths } from "@/components/og";

// Banner social images at stable URLs (/og/home.png, /og/privacy.png, ...), prerendered at build.
// Used instead of opengraph-image files, which get hashed URLs inside route groups.
export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams() {
  return ogPaths.map(path => ({ image: ogFileName(path) }));
}

export async function GET(_request: Request, { params }: { params: Promise<{ image: string }> }) {
  const path = ogPathForFile((await params).image);
  if (!path) return new Response("Not found", { status: 404 });
  return legalsOgImage(path);
}
