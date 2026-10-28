import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { globalMarket } from "@afrippa/ui/market";
import { Header } from "@/components/header";
import { TraderCard } from "@/components/trader-card";
import { TraderTrust } from "@/components/trader-trust";
import { MarketsList } from "@/components/markets-list";
import { trader } from "@/lib/api";

type Props = { params: Promise<{ nickname: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const card = await trader((await params).nickname);
  if (!card) return {};
  // A trader's card is public but thin: not indexed, so search engines keep to the markets.
  return { title: `${card.nickname}, P2P trader`, robots: { index: false, follow: true } };
}

/** A trader's public card: read first (cached, and shared with the card itself), so an unknown trader is a real 404. */
export default async function TraderPage({ params }: Props) {
  const { nickname } = await params;
  if (!(await trader(nickname))) notFound();
  return (
    <>
      <Header current={globalMarket} />
      <main id="main" className="mx-auto max-w-3xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
        <TraderCard nickname={nickname} />
        <Suspense fallback={<div aria-hidden="true" className="h-48 animate-pulse rounded-3xl bg-white ring-1 ring-slate-200/70 motion-reduce:animate-none" />}>
          <TraderTrust nickname={nickname} />
        </Suspense>
        <MarketsList title="Markets" />
      </main>
    </>
  );
}
