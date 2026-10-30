"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { LocateFixed, Search } from "lucide-react";
import type { ShopState } from "@bitocard/api-client/classifieds";
import { areaHref, nearestArea } from "@/lib/places";

/**
 * Choose your area: every state with its cities and areas, filtered as the buyer types, or **Use my location**, which
 * asks the browser for its position and picks the nearest area on this page (the position is never sent anywhere).
 */
export function AreaPicker({ country, states, next }: { country: string; states: ShopState[]; next: string | null }) {
  const router = useRouter();
  const [words, setWords] = useState("");
  const [locating, setLocating] = useState<"idle" | "busy" | "refused" | "unavailable">("idle");
  const shown = useMemo(() => {
    const find = words.trim().toLowerCase();
    if (!find) return states;
    return states.flatMap(state => {
      if (state.name.toLowerCase().includes(find)) return [state];
      const areas = state.areas.filter(area => area.name.toLowerCase().includes(find));
      return areas.length ? [{ ...state, areas }] : [];
    });
  }, [states, words]);

  const locate = () => {
    if (!("geolocation" in navigator)) return setLocating("unavailable");
    setLocating("busy");
    navigator.geolocation.getCurrentPosition(
      position => {
        const nearest = nearestArea(states, position.coords.latitude, position.coords.longitude);
        if (!nearest) return setLocating("unavailable");
        router.push(areaHref(country, nearest.state.slug, nearest.area.slug, next));
      },
      error => setLocating(error.code === error.PERMISSION_DENIED ? "refused" : "unavailable"),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 600_000 },
    );
  };

  return (
    <div className="grid gap-4">
      <button type="button" onClick={locate} disabled={locating === "busy"} className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-navy-900 px-4 font-bold text-white hover:bg-navy-800 disabled:opacity-70">
        <LocateFixed className="size-5" aria-hidden="true" /> {locating === "busy" ? "Finding you…" : "Use my location"}
      </button>
      {locating === "refused" ? <p className="text-sm text-navy-600" role="status">Location is off for this site. Allow it in your browser&apos;s site settings, or choose below.</p> : null}
      {locating === "unavailable" ? <p className="text-sm text-navy-600" role="status">We could not find where you are. Choose your area below.</p> : null}
      <label className="flex h-12 items-center gap-2.5 rounded-2xl border border-navy-200 bg-white px-3.5 focus-within:ring-2 focus-within:ring-brand-500">
        <Search className="size-5 text-navy-500" aria-hidden="true" />
        <input value={words} onChange={event => setWords(event.target.value)} placeholder="Search for a state, city or area" aria-label="Search for a state, city or area" className="min-w-0 flex-1 bg-transparent text-[15px] outline-none" />
      </label>
      {shown.length ? (
        <ul className="grid gap-3 sm:grid-cols-2">
          {shown.map(state => (
            <li key={state.slug} className="rounded-2xl border border-navy-200 bg-white p-3">
              <Link href={areaHref(country, state.slug, null, next)} className="flex min-h-10 items-center font-bold hover:underline">
                {state.name}
                <span className="ml-auto text-xs font-medium text-navy-500">All of {state.name}</span>
              </Link>
              {state.areas.length ? (
                <ul className="mt-1 flex flex-wrap gap-1.5">
                  {state.areas.map(area => (
                    <li key={area.slug}>
                      <Link href={areaHref(country, state.slug, area.slug, next)} className="flex h-9 items-center rounded-full border border-navy-200 px-3 text-sm font-medium hover:border-navy-500">
                        {area.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-navy-600">No state or area by that name.</p>
      )}
    </div>
  );
}
