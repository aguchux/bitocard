"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { consentChangedEvent, optionalAllowed, readConsent, type ConsentChoice } from "@/lib/cookie-consent";
import { countryFromPath, impressionSampleRate } from "@/lib/discovery";
import { flushEvents, startQueue, track } from "@/lib/discovery-client";

const visitorPath = "/api/discovery/visitor";

/** A card's place in its list: its own `data-position`, else its order among the list's cards people can reach. */
export function positionOf(card: Element, list: Element) {
  const own = Number(card.getAttribute("data-position"));
  if (card.hasAttribute("data-position") && Number.isInteger(own) && own >= 0) return own;
  const cards = [...list.querySelectorAll("[data-listing-ref]")].filter(item => !item.closest('[aria-hidden="true"]'));
  const index = cards.indexOf(card);
  return index >= 0 ? index : undefined;
}

/** What a click on a listing card in a list records: the card, the list it was in and its place. Null for anything else. */
export function clickEvent(target: Element | null) {
  const card = target?.closest?.("[data-listing-ref]");
  const list = card?.closest("[data-discovery-source]");
  const source = list?.getAttribute("data-discovery-source");
  const listing = Number(card?.getAttribute("data-listing-ref"));
  if (!card || !list || !source || !Number.isSafeInteger(listing) || listing <= 0) return null;
  return { kind: source === "search" ? ("result_click" as const) : ("rail_click" as const), listing, source, position: positionOf(card, list) };
}

/**
 * Discovery on udozo.com's pages (never resellers' stores: the root layout leaves it out there). Mounted once: starts the
 * page's event queue, which records only for a signed-in customer or a visitor who chose Accept all; keeps the visitor's
 * ID in step with the cookie choice (made after Accept all, removed with Necessary only); records clicks on listing
 * cards in marked lists; and, for one page view in five, which cards were seen. Sends what is queued as the page hides.
 */
export function DiscoveryTracker({ signedIn, hasVisitor }: { signedIn: boolean; hasVisitor: boolean }) {
  const pathname = usePathname();
  const state = useRef({ signedIn, visitor: hasVisitor });

  useEffect(() => {
    state.current.signedIn = signedIn;
  }, [signedIn]);

  useEffect(() => {
    startQueue({ allowed: () => state.current.signedIn || optionalAllowed(readConsent(document.cookie)), country: () => countryFromPath(location.pathname) });

    // The visitor's ID follows the cookie choice: none before Accept all, gone with Necessary only.
    const sync = (choice: ConsentChoice | null) => {
      if (choice === "all" && !state.current.visitor && !state.current.signedIn) {
        state.current.visitor = true;
        void fetch(visitorPath, { method: "POST" }).catch(() => undefined);
      } else if (choice !== "all" && state.current.visitor) {
        state.current.visitor = false;
        void fetch(visitorPath, { method: "DELETE" }).catch(() => undefined);
      }
    };
    sync(readConsent(document.cookie)?.choice ?? null);
    const changed = (event: Event) => sync(((event as CustomEvent<ConsentChoice>).detail ?? null) as ConsentChoice | null);

    const click = (event: MouseEvent) => {
      if (event.type === "auxclick" && event.button !== 1) return;
      const recorded = clickEvent(event.target as Element | null);
      if (recorded) track(recorded);
    };
    const hidden = () => {
      if (document.visibilityState === "hidden") flushEvents();
    };
    window.addEventListener(consentChangedEvent, changed);
    // Capturing, so a link that navigates (or a list that stops the click) still counts it.
    document.addEventListener("click", click, true);
    document.addEventListener("auxclick", click, true);
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("pagehide", flushEvents);
    return () => {
      window.removeEventListener(consentChangedEvent, changed);
      document.removeEventListener("click", click, true);
      document.removeEventListener("auxclick", click, true);
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("pagehide", flushEvents);
    };
  }, []);

  // Impressions: for a sampled page view, each card in a marked list once, when at least half of it is on screen.
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined" || Math.random() >= impressionSampleRate) return;
    const seen = new Set<string>();
    const observing = new WeakSet<Element>();
    const view = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          view.unobserve(entry.target);
          const list = entry.target.closest("[data-discovery-source]");
          const source = list?.getAttribute("data-discovery-source");
          const listing = Number(entry.target.getAttribute("data-listing-ref"));
          if (!list || !source || !Number.isSafeInteger(listing) || seen.has(`${source}|${listing}`)) continue;
          seen.add(`${source}|${listing}`);
          track({ kind: "impression", listing, source, position: positionOf(entry.target, list) });
        }
      },
      { threshold: 0.5 },
    );
    const scan = () => {
      for (const card of document.querySelectorAll("[data-discovery-source] [data-listing-ref]")) {
        if (observing.has(card) || card.closest('[aria-hidden="true"]')) continue;
        observing.add(card);
        view.observe(card);
      }
    };
    scan();
    // Rows filled after the page loads (For you, Recently viewed) are watched too.
    const added = new MutationObserver(scan);
    added.observe(document.body, { childList: true, subtree: true });
    return () => {
      added.disconnect();
      view.disconnect();
    };
  }, [pathname]);

  return null;
}
