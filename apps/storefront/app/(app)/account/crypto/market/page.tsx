import { redirect } from "next/navigation";

type Search = Record<string, string | string[] | undefined>;

/** The P2P market moved to the Crypto tab's first screen; old links (with their filters) go there. */
export default async function MarketMoved({ searchParams }: { searchParams: Promise<Search> }) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) params.append(key, item);
  }
  const query = params.toString();
  redirect(`/account/crypto${query ? `?${query}` : ""}`);
}
