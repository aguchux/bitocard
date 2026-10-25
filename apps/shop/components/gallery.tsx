"use client";

/* eslint-disable @next/next/no-img-element -- sellers' photos come from the media CDN at their own sizes. */
import { useState } from "react";
import { ChevronLeft, ChevronRight, ImageIcon, Play } from "lucide-react";
import type { ShopListingPage } from "@bitocard/api-client/classifieds";

const seconds = (ms: number | null) => {
  if (!ms) return "";
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};

/** The listing's photos with their thumbnails, and the seller's video (played only when chosen, never on its own). */
export function Gallery({ title, photos, video }: { title: string; photos: ShopListingPage["photos"]; video: ShopListingPage["video"] }) {
  const [shown, setShown] = useState<number | "video">(0);
  const count = photos.length;
  const step = (by: number) => setShown(current => (typeof current === "number" && count ? (current + by + count) % count : 0));
  const photo = typeof shown === "number" ? photos[shown] : null;
  return (
    <div className="grid gap-2">
      <div className="relative aspect-[4/3] overflow-hidden bg-navy-100 sm:rounded-2xl" aria-roledescription="carousel" aria-label={`Photos of ${title}`}>
        {shown === "video" && video ? (
          <video src={video.url} poster={video.poster_url ?? undefined} controls autoPlay playsInline className="size-full bg-black object-contain">
            <track kind="captions" />
          </video>
        ) : photo ? (
          <img src={photo.url} alt={`${title}, photo ${(shown as number) + 1} of ${count}`} className="size-full object-contain" />
        ) : (
          <span className="grid size-full place-items-center text-navy-400">
            <ImageIcon className="size-10" aria-hidden="true" />
          </span>
        )}
        {count > 1 && shown !== "video" ? (
          <>
            <button type="button" onClick={() => step(-1)} className="absolute top-1/2 left-2 grid size-10 -translate-y-1/2 place-items-center rounded-full bg-white/90 text-navy-900 shadow" aria-label="Previous photo">
              <ChevronLeft className="size-5" aria-hidden="true" />
            </button>
            <button type="button" onClick={() => step(1)} className="absolute top-1/2 right-2 grid size-10 -translate-y-1/2 place-items-center rounded-full bg-white/90 text-navy-900 shadow" aria-label="Next photo">
              <ChevronRight className="size-5" aria-hidden="true" />
            </button>
            <span className="absolute right-3 bottom-3 rounded-full bg-navy-900/70 px-2.5 py-1 text-xs font-semibold text-white" aria-live="polite">
              {(shown as number) + 1} / {count}
            </span>
          </>
        ) : null}
      </div>
      {count > 1 || video ? (
        <div className="flex gap-2 overflow-x-auto px-4 sm:px-0">
          {photos.map((item, index) => (
            <button
              key={item.url}
              type="button"
              onClick={() => setShown(index)}
              aria-label={`Photo ${index + 1}${shown === index ? ", shown" : ""}`}
              aria-pressed={shown === index}
              className={`size-14 shrink-0 overflow-hidden rounded-xl border-2 ${shown === index ? "border-brand-700" : "border-transparent"}`}
            >
              <img src={item.url} alt="" loading="lazy" className="size-full object-cover" />
            </button>
          ))}
          {video ? (
            <button
              type="button"
              onClick={() => setShown("video")}
              aria-pressed={shown === "video"}
              aria-label={`Play the seller's video${video.duration_ms ? `, ${Math.round(video.duration_ms / 1000)} seconds` : ""}`}
              className={`flex h-14 shrink-0 items-center gap-1.5 rounded-xl border-2 bg-navy-900 px-3 text-sm font-semibold text-white ${shown === "video" ? "border-brand-700" : "border-transparent"}`}
            >
              <Play className="size-4" aria-hidden="true" /> {seconds(video.duration_ms) || "Video"}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
