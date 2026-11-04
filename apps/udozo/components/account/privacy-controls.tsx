"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Clock, Search, X } from "lucide-react";
import { listingPath } from "@bitocard/api-client/classifieds";
import type { DiscoveryHistory } from "@bitocard/api-client/discovery";
import { clearHistory, removeSearch, removeViewed, setPersonalisation, type PrivacyResult } from "@/lib/discovery-actions";
import { useConfirm } from "../confirm-dialog";
import { Thumb } from "./thumb";

const card = "grid gap-3 rounded-2xl border border-navy-200 bg-white p-4 sm:p-5";
const remove = "grid size-10 shrink-0 place-items-center rounded-full text-navy-500 hover:bg-navy-50 hover:text-navy-900 disabled:opacity-50";
const when = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

/**
 * Account > Privacy: **Personalise what I see** (on or off), what Udozo remembers (listings viewed and searches, each
 * removable) and **Clear my history** (asked first, in Udozo's own dialog). Changes show at once and are undone if the
 * API refuses them.
 */
export function PrivacyControls({ personalisation, history }: { personalisation: boolean; history: Pick<DiscoveryHistory, "listings" | "searches"> | null }) {
  const [on, setOn] = useState(personalisation);
  const [listings, setListings] = useState(history?.listings ?? []);
  const [searches, setSearches] = useState(history?.searches ?? []);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const [confirm, dialog] = useConfirm();

  const run = (action: () => Promise<PrivacyResult>, undo: () => void) =>
    start(async () => {
      setError(null);
      const result = await action();
      if (!result.ok) {
        undo();
        setError(result.message);
      }
    });

  const toggle = async () => {
    const next = !on;
    if (!next) {
      const answer = await confirm({
        title: "Stop personalising what you see?",
        body: "Udozo stops remembering what you look at and search for, and deletes what it kept. Home pages and suggestions then show what is popular instead.",
        action: "Turn it off",
        dismiss: "Keep it on",
      });
      if (!answer) return;
    }
    setOn(next);
    if (!next) {
      setListings([]);
      setSearches([]);
    }
    const before = { listings, searches };
    run(
      () => setPersonalisation(next),
      () => {
        setOn(!next);
        setListings(before.listings);
        setSearches(before.searches);
      },
    );
  };

  const clearAll = async () => {
    const answer = await confirm({
      title: "Clear your history?",
      body: "Every listing you viewed and every search you made on Udozo is deleted, with what Udozo learned from them. This cannot be undone.",
      action: "Clear my history",
      tone: "danger",
    });
    if (!answer) return;
    const before = { listings, searches };
    setListings([]);
    setSearches([]);
    run(clearHistory, () => {
      setListings(before.listings);
      setSearches(before.searches);
    });
  };

  return (
    <div className="grid gap-5">
      {dialog}
      <section aria-labelledby="personalise" className={card}>
        <div className="flex items-start justify-between gap-3">
          <span className="grid min-w-0 gap-1">
            <h2 id="personalise" className="font-bold">
              Personalise what I see
            </h2>
            <span className="text-sm text-navy-600">
              Udozo uses the listings you look at, save and contact, and what you search for, to put what you are likely to want first: For you, Recently viewed and your searches. Never for advertising, and never shown to sellers.
            </span>
          </span>
          <button type="button" role="switch" aria-checked={on} aria-labelledby="personalise" disabled={busy} onClick={() => void toggle()} className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${on ? "bg-mint-700" : "bg-navy-300"} disabled:opacity-60`}>
            <span className={`absolute top-1 size-5 rounded-full bg-white shadow transition-[left] ${on ? "left-6" : "left-1"}`} />
          </button>
        </div>
        <Link href="/legal/privacy#what" className="w-fit text-sm font-semibold text-brand-700 hover:underline">
          How Udozo uses this
        </Link>
      </section>

      <section aria-labelledby="viewed" className={card}>
        <h2 id="viewed" className="font-bold">
          Recently viewed
        </h2>
        {listings.length ? (
          <ul className="grid gap-2">
            {listings.map(item => (
              <li key={item.id} className="flex items-center gap-3">
                <Link href={listingPath(item.country, item.ref, item.slug)} className="flex min-w-0 flex-1 items-center gap-3 hover:underline">
                  <Thumb url={item.cover?.url} size="size-12" />
                  <span className="grid min-w-0">
                    <span className="truncate text-sm font-semibold">{item.title}</span>
                    <span className="text-xs text-navy-500">Viewed {when(item.viewed_at)}</span>
                  </span>
                </Link>
                <button
                  type="button"
                  disabled={busy}
                  aria-label={`Remove ${item.title} from Recently viewed`}
                  className={remove}
                  onClick={() => {
                    const before = listings;
                    setListings(listings.filter(other => other.id !== item.id));
                    run(
                      () => removeViewed(item.ref),
                      () => setListings(before),
                    );
                  }}
                >
                  <X className="size-4" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="flex items-center gap-2 text-sm text-navy-600">
            <Clock className="size-4 shrink-0" aria-hidden="true" /> {on ? "Nothing yet. Listings you open show here." : "Nothing is remembered while personalisation is off."}
          </p>
        )}
      </section>

      <section aria-labelledby="searches" className={card}>
        <h2 id="searches" className="font-bold">
          Recent searches
        </h2>
        {searches.length ? (
          <ul className="grid gap-1">
            {searches.map(item => (
              <li key={item.query} className="flex items-center gap-3">
                <Search className="size-4 shrink-0 text-navy-400" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate text-sm">{item.query}</span>
                <span className="shrink-0 text-xs text-navy-500">{when(item.searched_at)}</span>
                <button
                  type="button"
                  disabled={busy}
                  aria-label={`Remove ${item.query} from Recent searches`}
                  className={remove}
                  onClick={() => {
                    const before = searches;
                    setSearches(searches.filter(other => other.query !== item.query));
                    run(
                      () => removeSearch(item.query),
                      () => setSearches(before),
                    );
                  }}
                >
                  <X className="size-4" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-navy-600">No searches remembered.</p>
        )}
      </section>

      <section aria-labelledby="clear" className={card}>
        <h2 id="clear" className="font-bold">
          Clear my history
        </h2>
        <p className="text-sm text-navy-600">Deletes every listing viewed and search made, and what Udozo learned from them. Personalisation stays as you set it.</p>
        <button type="button" disabled={busy} onClick={() => void clearAll()} className="flex min-h-11 w-fit items-center rounded-xl border border-red-700 px-4 font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60">
          Clear my history
        </button>
      </section>
      {error ? (
        <p role="alert" className="text-sm font-semibold text-brand-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}
