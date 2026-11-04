"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { ShopListingCard } from "@bitocard/api-client/classifieds";
import type { ForYou, ForYouKind, ForYouRow } from "@bitocard/api-client/discovery";
import { railSource } from "@/lib/discovery";
import { ListingTile } from "../listing-card";
import { Slider } from "../slider";
import { NotInterested } from "./not-interested";

type Wanted = { kinds: Set<ForYouKind>; limit: number; resolve: Array<(answer: ForYou | null) => void> };
const waiting = new Map<string, Wanted>();

/**
 * The person's rows for a market, asked once for every personal row on the page: rows asking in the same moment share
 * one request (`/api/for-you`, with their session or visitor ID, never cached). Null when it cannot be read.
 */
export function loadForYou(country: string, kind: ForYouKind, limit: number, fetcher: typeof fetch = fetch): Promise<ForYou | null> {
  return new Promise(resolve => {
    let wanted = waiting.get(country);
    if (!wanted) {
      wanted = { kinds: new Set(), limit: 0, resolve: [] };
      waiting.set(country, wanted);
      const asked = wanted;
      setTimeout(() => {
        waiting.delete(country);
        const params = new URLSearchParams({ country, kinds: [...asked.kinds].join(","), limit: String(asked.limit) });
        fetcher(`/api/for-you?${params}`, { cache: "no-store" })
          .then(res => (res.ok ? (res.json() as Promise<ForYou>) : null))
          .catch(() => null)
          .then(answer => asked.resolve.forEach(done => done(answer?.object === "for_you" ? answer : null)));
      }, 0);
    }
    wanted.kinds.add(kind);
    wanted.limit = Math.min(24, Math.max(wanted.limit, limit));
    wanted.resolve.push(resolve);
  });
}

/** A personal row as drawn: its heading (linked where the row has its own page) and its cards sliding sideways. */
export function PersonalRow({ id, title, row, personalised, limit, itemClass }: { id: string; title: string; row: ForYouRow; personalised: boolean; limit: number; itemClass: string }) {
  const source = railSource(row.kind, personalised);
  const items = row.items.slice(0, limit);
  if (!items.length) return null;
  // "Because you searched …" always names its own search; the others keep the admin's title.
  const heading = row.kind === "searched" ? row.title : title || row.title;
  return (
    <section aria-labelledby={id} data-discovery-source={source}>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 id={id} className="min-w-0 text-base font-bold sm:text-lg">
          {heading}
        </h2>
        {row.href ? (
          <Link href={row.href} className="shrink-0 text-[13px] font-semibold text-brand-700 hover:underline">
            See all
          </Link>
        ) : null}
      </div>
      <Slider label={heading}>
        {items.map((card, index) => (
          <li key={card.id} className={itemClass}>
            {row.kind === "for_you" ? (
              <NotInterested listing={card.ref} source={source} className="h-full">
                <ListingTile card={card as ShopListingCard} was={card.was_price} position={index} className="h-full" />
              </NotInterested>
            ) : (
              <ListingTile card={card as ShopListingCard} was={card.was_price} position={index} className="h-full" />
            )}
          </li>
        ))}
      </Slider>
    </section>
  );
}

/**
 * A home page's personal row (For you, Recently viewed, Because you searched, Price dropped): the page is cached and the
 * same for everyone, so the row is filled for the person after it loads. Nothing is drawn while it loads, when it is
 * empty, or when it cannot be read.
 */
export function PersonalRail({ id, country, kind, title, limit, itemClass }: { id: string; country: string; kind: ForYouKind; title: string; limit: number; itemClass: string }) {
  const [answer, setAnswer] = useState<ForYou | null>(null);
  useEffect(() => {
    let live = true;
    void loadForYou(country, kind, limit).then(result => {
      if (live) setAnswer(result);
    });
    return () => {
      live = false;
    };
  }, [country, kind, limit]);
  const row = answer?.rows.find(item => item.kind === kind);
  if (!answer || !row) return null;
  return <PersonalRow id={id} title={title} row={row} personalised={answer.personalised} limit={limit} itemClass={itemClass} />;
}
