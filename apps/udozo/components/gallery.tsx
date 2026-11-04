"use client";

/* eslint-disable @next/next/no-img-element -- sellers' photos come from the media CDN at their own sizes. */
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, ImageIcon, Play } from "lucide-react";
import { photoOpened } from "@/lib/discovery-client";
import { isViewerEntry, photoFromHash, slideAt, viewerEntry, wrapIndex } from "@/lib/gallery";
import { PhotoViewer, type ViewerPhoto, centreChild, prefersReducedMotion } from "./photo-viewer";

export type GalleryVideo = { url: string; poster_url: string | null; duration_ms: number | null };

const seconds = (ms: number | null) => {
  if (!ms) return "";
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};

/**
 * A listing's photos (and the seller's video, played only when chosen, never on its own): a sideways scroll-snap track
 * swiped like any phone gallery, with arrows where there is a mouse, the count, and thumbnails that follow it. A photo
 * opens over the whole screen (`PhotoViewer`), which Back closes: opening adds one history entry, `#photo-<n>`, taken
 * off again on closing, and Forward opens it again. Each photo the person comes to rest on, here or full screen, is
 * noted for discovery. `tone="store"` is a reseller's store's (rounded, its own colours); the raw files are never linked.
 */
export function Gallery({ title, photos, video = null, tone = "listing" }: { title: string; photos: ViewerPhoto[]; video?: GalleryVideo | null; tone?: "listing" | "store" }) {
  const count = photos.length;
  const slides = count + (video ? 1 : 0);
  const id = useId();
  const trackRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const openers = useRef<Array<HTMLButtonElement | null>>([]);
  // `active` follows the track as it moves; `shown` is where the person came to rest (here or full screen).
  const [active, setActive] = useState(0);
  const [shown, setShown] = useState(0);
  const shownRef = useRef(0);
  const settleTimer = useRef<number | undefined>(undefined);
  const [viewer, setViewer] = useState<{ start: number } | null>(null);
  const viewerOpen = useRef(false);
  // Whether the open viewer has its own history entry to go back over.
  const pushed = useRef(false);
  const fallback = useRef<number | undefined>(undefined);
  const restore = useRef(false);

  const show = useCallback((index: number) => {
    shownRef.current = index;
    setShown(index);
  }, []);

  // Which photos were looked at, for the listing's engagement (`ListingView`).
  useEffect(() => {
    if (typeof shown === "number" && shown < count) photoOpened(shown);
  }, [shown, count]);

  const scrollTo = (index: number, smooth: boolean) => {
    const track = trackRef.current;
    if (track) track.scrollTo({ left: index * track.clientWidth, behavior: smooth && !prefersReducedMotion() ? "smooth" : "auto" });
  };

  const onScroll = () => {
    const track = trackRef.current;
    if (!track) return;
    const index = slideAt(track.scrollLeft, track.clientWidth, slides);
    setActive(index);
    window.clearTimeout(settleTimer.current);
    settleTimer.current = window.setTimeout(() => show(index), 150);
  };

  // A video left behind stops playing.
  useEffect(() => {
    if (active !== count) videoRef.current?.pause();
  }, [active, count]);

  // The thumbnails follow once the track has come to rest: a smooth scroll of the strip while the track is still
  // snapping cuts the snap short in Chrome, leaving the track between two photos.
  useEffect(() => {
    centreChild(stripRef.current, shown);
  }, [shown]);

  useEffect(() => () => window.clearTimeout(settleTimer.current), []);

  const open = (index: number) => {
    // One history entry, so Back (Android's included) closes the viewer instead of leaving the listing.
    const entry = viewerEntry(id, index, window.location);
    window.history.pushState(entry.state, "", entry.url);
    pushed.current = true;
    viewerOpen.current = true;
    show(index);
    setViewer({ start: index });
  };

  const finish = useCallback(() => {
    window.clearTimeout(fallback.current);
    if (!viewerOpen.current) return;
    viewerOpen.current = false;
    pushed.current = false;
    restore.current = true;
    setViewer(null);
  }, []);

  const close = useCallback(
    (index: number) => {
      show(index);
      if (pushed.current && isViewerEntry(window.history.state, id)) {
        // Going back over our entry closes it (below); should the browser not say so, it closes anyway.
        window.history.back();
        window.clearTimeout(fallback.current);
        fallback.current = window.setTimeout(finish, 500);
      } else finish();
    },
    [finish, id, show],
  );

  // Back closes the viewer; Forward onto its entry opens it again at the photo in the address.
  useEffect(() => {
    const onPop = () => {
      const ours = isViewerEntry(window.history.state, id);
      if (viewerOpen.current && !ours) finish();
      else if (!viewerOpen.current && ours) {
        const index = photoFromHash(window.location.hash, count) ?? 0;
        pushed.current = true;
        viewerOpen.current = true;
        show(index);
        setViewer({ start: index });
      }
    };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      window.clearTimeout(fallback.current);
    };
  }, [count, finish, id, show]);

  // Closed: the gallery here comes to the photo last shown full screen, and focus returns to it.
  useEffect(() => {
    if (viewer || !restore.current) return;
    restore.current = false;
    const index = shownRef.current;
    // Moving the track says which slide it is on (`onScroll`).
    scrollTo(index, false);
    openers.current[index]?.focus({ preventScroll: true });
  }, [viewer]);

  const step = (by: number) => {
    const target = wrapIndex(active + by, count);
    scrollTo(target, Math.abs(target - active) === 1);
  };

  const frame = tone === "store" ? "rounded-2xl bg-slate-100" : "bg-navy-100 sm:rounded-2xl";
  const thumbOn = tone === "store" ? "border-navy-900" : "border-brand-700";
  const onVideo = video !== null && active === count;
  return (
    <div className="grid gap-2">
      <div className={`relative aspect-[4/3] overflow-hidden ${frame}`} role="region" aria-roledescription="carousel" aria-label={`Photos of ${title}`}>
        {slides ? (
          <div
            ref={trackRef}
            onScroll={onScroll}
            className="flex size-full snap-x snap-mandatory overflow-x-auto overflow-y-hidden overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {photos.map((photo, index) => (
              <div key={`${index}:${photo.url}`} role="group" aria-roledescription="slide" aria-label={`Photo ${index + 1} of ${count}`} className="relative size-full shrink-0 snap-center snap-always">
                <button
                  ref={element => {
                    openers.current[index] = element;
                  }}
                  type="button"
                  onClick={() => open(index)}
                  aria-label={`Open photo ${index + 1} of ${count} full screen`}
                  className="block size-full cursor-zoom-in"
                >
                  <img
                    src={photo.url}
                    alt={`${title}, photo ${index + 1} of ${count}`}
                    loading={index === 0 ? "eager" : "lazy"}
                    decoding="async"
                    draggable={false}
                    className="size-full object-contain"
                  />
                </button>
              </div>
            ))}
            {video ? (
              <div role="group" aria-roledescription="slide" aria-label="The seller's video" className="relative size-full shrink-0 snap-center snap-always bg-black">
                <video ref={videoRef} src={video.url} poster={video.poster_url ?? undefined} controls playsInline preload="none" className="size-full object-contain">
                  <track kind="captions" />
                </video>
              </div>
            ) : null}
          </div>
        ) : (
          <span className="grid size-full place-items-center text-navy-400">
            <ImageIcon className="size-10" aria-hidden="true" />
          </span>
        )}
        {count > 1 && !onVideo ? (
          <>
            <button type="button" onClick={() => step(-1)} className="absolute top-1/2 left-2 hidden size-10 -translate-y-1/2 place-items-center rounded-full bg-white/90 text-navy-900 shadow pointer-fine:grid" aria-label="Previous photo">
              <ChevronLeft className="size-5" aria-hidden="true" />
            </button>
            <button type="button" onClick={() => step(1)} className="absolute top-1/2 right-2 hidden size-10 -translate-y-1/2 place-items-center rounded-full bg-white/90 text-navy-900 shadow pointer-fine:grid" aria-label="Next photo">
              <ChevronRight className="size-5" aria-hidden="true" />
            </button>
          </>
        ) : null}
        {count > 1 && !onVideo ? (
          <span className="pointer-events-none absolute right-3 bottom-3 rounded-full bg-navy-900/70 px-2.5 py-1 text-xs font-semibold text-white tabular-nums" aria-hidden="true">
            {active + 1} / {count}
          </span>
        ) : null}
        {/* Said once the track comes to rest, never for every photo a swipe passes. */}
        {count > 1 ? (
          <span className="sr-only" aria-live="polite">
            {shown < count ? `Photo ${shown + 1} of ${count}` : "The seller's video"}
          </span>
        ) : null}
      </div>
      {count > 1 || video ? (
        <div ref={stripRef} className="relative flex gap-2 overflow-x-auto px-4 [scrollbar-width:none] sm:px-0 [&::-webkit-scrollbar]:hidden">
          {photos.map((item, index) => (
            <button
              key={`${index}:${item.url}`}
              type="button"
              onClick={() => scrollTo(index, Math.abs(index - active) <= 2)}
              aria-label={`Photo ${index + 1}${active === index ? ", shown" : ""}`}
              aria-pressed={active === index}
              className={`size-14 shrink-0 overflow-hidden rounded-xl border-2 ${active === index ? thumbOn : "border-transparent"}`}
            >
              <img src={item.url} alt="" loading="lazy" decoding="async" draggable={false} className="size-full object-cover" />
            </button>
          ))}
          {video ? (
            <button
              type="button"
              onClick={() => {
                scrollTo(count, false);
                // Chosen, so it plays (sound and all, the browser permitting); never before.
                videoRef.current?.play().catch(() => undefined);
              }}
              aria-pressed={onVideo}
              aria-label={`Play the seller's video${video.duration_ms ? `, ${Math.round(video.duration_ms / 1000)} seconds` : ""}`}
              className={`flex h-14 shrink-0 items-center gap-1.5 rounded-xl border-2 bg-navy-900 px-3 text-sm font-semibold text-white ${onVideo ? thumbOn : "border-transparent"}`}
            >
              <Play className="size-4" aria-hidden="true" /> {seconds(video.duration_ms) || "Video"}
            </button>
          ) : null}
        </div>
      ) : null}
      {viewer && count ? <PhotoViewer title={title} photos={photos} start={viewer.start} onIndex={show} onRequestClose={close} /> : null}
    </div>
  );
}
