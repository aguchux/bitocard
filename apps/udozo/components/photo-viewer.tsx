"use client";

/* eslint-disable @next/next/no-img-element -- sellers' and suppliers' photos come from the media CDN at their own sizes. */
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import {
  type Point,
  type Size,
  clampPan,
  clampZoom,
  closesOnRelease,
  containedSize,
  distance,
  keyTarget,
  midpoint,
  neighbours,
  pinchZoom,
  slideAt,
  toggleZoom,
  wrapIndex,
  zoomAbout,
} from "@/lib/gallery";

export type ViewerPhoto = { url: string; width: number | null; height: number | null };
type Zoom = { scale: number; pan: Point };

const unzoomed = (): Zoom => ({ scale: 1, pan: { x: 0, y: 0 } });

export function prefersReducedMotion() {
  return typeof window !== "undefined" && (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
}

/** Scrolls a strip of thumbnails sideways (never the page) so its `index`th child sits in the middle. */
export function centreChild(strip: HTMLElement | null, index: number) {
  const child = strip?.children[index] as HTMLElement | undefined;
  if (!strip || !child) return;
  const left = child.offsetLeft - (strip.clientWidth - child.offsetWidth) / 2;
  strip.scrollTo({ left: Math.max(0, left), behavior: prefersReducedMotion() ? "auto" : "smooth" });
}

/**
 * The photos over the whole screen, black and edge to edge: a native modal `<dialog>` (focus kept inside, the page
 * behind inert and held still) with a sideways scroll-snap track, so swiping and trackpads move it with the browser's
 * own momentum. Pinch, double tap, double click or Ctrl and the wheel zoom the photo shown (up to 3x, panned by a
 * finger or the mouse, the track held still meanwhile); a finger dragging an unzoomed photo down closes it, as do
 * Escape, the close button and Back (the gallery owns the history entry). Arrows, Home and End move between photos.
 */
export function PhotoViewer({
  title,
  photos,
  start,
  onIndex,
  onRequestClose,
}: {
  title: string;
  photos: ViewerPhoto[];
  start: number;
  /** The photo now settled on, so the gallery notes it as seen and shows it inline afterwards. */
  onIndex: (index: number) => void;
  /** Asked to close (with the photo shown): the gallery closes it, through history when it added an entry. */
  onRequestClose: (index: number) => void;
}) {
  const count = photos.length;
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const boxes = useRef<Array<HTMLDivElement | null>>([]);
  const images = useRef<Array<HTMLImageElement | null>>([]);
  const [active, setActive] = useState(start);
  // Where the track came to rest (the filmstrip follows it).
  const [settled, setSettled] = useState(start);
  const activeRef = useRef(start);
  // Photos already drawn stay drawn; the one shown and its neighbours are always loaded (so the next swipe is ready).
  const [seen, setSeen] = useState(() => new Set(neighbours(start, count)));
  const [zoomed, setZoomed] = useState(false);
  const zoom = useRef<Zoom>(unzoomed());
  const zoomIndex = useRef(start);
  const closing = useRef(false);
  const settleTimer = useRef<number | undefined>(undefined);
  const lastTouchAt = useRef(0);
  const mouseDrag = useRef<{ id: number; from: Point; pan: Point } | null>(null);
  const near = new Set(neighbours(active, count));

  const requestClose = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    onRequestClose(activeRef.current);
  }, [onRequestClose]);

  // The photo's box (untransformed) and the size the photo is drawn at inside it, for the zoom sums.
  const measure = useCallback(
    (index: number) => {
      const box = boxes.current[index];
      const image = images.current[index];
      if (!box) return null;
      const rect = box.getBoundingClientRect();
      const size: Size = { width: rect.width, height: rect.height };
      const photo = photos[index];
      const natural: Size = { width: image?.naturalWidth || photo?.width || 0, height: image?.naturalHeight || photo?.height || 0 };
      return { centre: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }, box: size, drawn: containedSize(natural, size) };
    },
    [photos],
  );

  const applyZoom = useCallback((index: number, next: Zoom, animate: boolean) => {
    const image = images.current[index];
    zoom.current = next;
    zoomIndex.current = index;
    setZoomed(next.scale > 1.01);
    if (!image) return;
    image.style.transition = animate && !prefersReducedMotion() ? "transform 0.22s cubic-bezier(0.2, 0.8, 0.2, 1)" : "none";
    image.style.transform = next.scale > 1.001 || next.pan.x || next.pan.y ? `translate3d(${next.pan.x}px, ${next.pan.y}px, 0) scale(${next.scale})` : "";
  }, []);

  const resetZoom = useCallback(
    (animate = false) => {
      if (zoom.current.scale !== 1 || zoom.current.pan.x || zoom.current.pan.y) applyZoom(zoomIndex.current, unzoomed(), animate);
    },
    [applyZoom],
  );

  // Ends a pinch or a pan: barely zoomed goes back to the whole photo, otherwise its edges come back to the screen's.
  const settleZoom = useCallback(() => {
    const index = zoomIndex.current;
    const sizes = measure(index);
    if (zoom.current.scale < 1.05 || !sizes) return applyZoom(index, unzoomed(), true);
    applyZoom(index, { scale: clampZoom(zoom.current.scale), pan: clampPan(zoom.current.pan, zoom.current.scale, sizes.drawn, sizes.box) }, true);
  }, [applyZoom, measure]);

  const go = useCallback(
    (index: number) => {
      const track = trackRef.current;
      if (!track || !count) return;
      const from = activeRef.current;
      resetZoom();
      // A step slides; a jump (round from the last to the first, or a thumbnail far away) is instant, never a blur of photos.
      const smooth = Math.abs(index - from) === 1 && !prefersReducedMotion();
      track.scrollTo({ left: index * track.clientWidth, behavior: smooth ? "smooth" : "auto" });
    },
    [count, resetZoom],
  );

  // Open at once on the chosen photo, with the page behind held still; closed and released when the viewer goes.
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    const track = trackRef.current;
    if (!dialog) return;
    closing.current = false;
    if (!dialog.open) dialog.showModal();
    if (track) {
      track.scrollLeft = activeRef.current * track.clientWidth;
      // Focus the photos (never the close button), so arrow keys move through them and Enter does not close the viewer.
      track.focus({ preventScroll: true });
    }
    const root = document.documentElement;
    const overflow = root.style.overflow;
    root.style.overflow = "hidden";
    return () => {
      closing.current = true;
      if (dialog.open) dialog.close();
      root.style.overflow = overflow;
      window.clearTimeout(settleTimer.current);
    };
  }, []);

  // The photo shown changed: any other photo's zoom undone.
  useEffect(() => {
    if (zoomIndex.current !== active) resetZoom();
  }, [active, resetZoom]);

  // The filmstrip follows once the track has come to rest (a smooth scroll of it during the snap cuts the snap short).
  useEffect(() => {
    centreChild(stripRef.current, settled);
  }, [settled]);

  // A new size (turning the phone, resizing the window) keeps the same photo in view, unzoomed.
  useEffect(() => {
    const track = trackRef.current;
    if (!track || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      resetZoom();
      track.scrollLeft = activeRef.current * track.clientWidth;
    });
    observer.observe(track);
    return () => observer.disconnect();
  }, [resetZoom]);

  // Touch: pinch and pan zoom (cancelling the browser's own scroll and zoom, so listeners that may call preventDefault),
  // a double tap toggles zoom, and an unzoomed photo dragged downwards closes. Sideways swipes are left to the track.
  useEffect(() => {
    const track = trackRef.current;
    const dialog = dialogRef.current;
    if (!track || !dialog) return;
    type Mode = "none" | "pinch" | "pan" | "maybe" | "swipe" | "close";
    let mode: Mode = "none";
    let startDistance = 0;
    let startMid: Point = { x: 0, y: 0 };
    let startZoom: Zoom = unzoomed();
    let startTouch = { x: 0, y: 0, t: 0 };
    let lastTap: { x: number; y: number; t: number } | null = null;
    const at = (touch: Touch): Point => ({ x: touch.clientX, y: touch.clientY });
    const current = (): Zoom => (zoomIndex.current === activeRef.current ? { ...zoom.current } : unzoomed());
    const relative = (point: Point) => {
      const sizes = measure(activeRef.current);
      return sizes ? { x: point.x - sizes.centre.x, y: point.y - sizes.centre.y } : point;
    };
    const dragDown = (dy: number) => {
      const image = images.current[activeRef.current];
      const down = Math.max(0, dy);
      if (image) {
        image.style.transition = "none";
        image.style.transform = dy ? `translate3d(0, ${dy}px, 0) scale(${1 - Math.min(0.2, down / 1500)})` : "";
      }
      dialog.style.backgroundColor = down ? `rgb(0 0 0 / ${1 - Math.min(0.75, down / 400)})` : "";
    };
    const dragBack = () => {
      const image = images.current[activeRef.current];
      if (image) {
        image.style.transition = prefersReducedMotion() ? "none" : "transform 0.2s ease-out";
        image.style.transform = "";
      }
      dialog.style.backgroundColor = "";
    };

    const onStart = (event: TouchEvent) => {
      lastTouchAt.current = Date.now();
      if (event.touches.length >= 2) {
        const a = at(event.touches[0]);
        const b = at(event.touches[1]);
        if (mode === "close") dragBack();
        mode = "pinch";
        startDistance = distance(a, b);
        startMid = relative(midpoint(a, b));
        startZoom = current();
        if (event.cancelable) event.preventDefault();
      } else if (event.touches.length === 1) {
        const point = at(event.touches[0]);
        startTouch = { ...point, t: event.timeStamp };
        startZoom = current();
        mode = startZoom.scale > 1.01 ? "pan" : "maybe";
      }
    };
    const onMove = (event: TouchEvent) => {
      const index = activeRef.current;
      if (mode === "pinch" && event.touches.length >= 2) {
        if (event.cancelable) event.preventDefault();
        const a = at(event.touches[0]);
        const b = at(event.touches[1]);
        const scale = pinchZoom(startZoom.scale, startDistance, distance(a, b));
        const mid = relative(midpoint(a, b));
        const anchored = zoomAbout(startMid, startZoom, scale);
        const sizes = measure(index);
        const pan = { x: anchored.x + mid.x - startMid.x, y: anchored.y + mid.y - startMid.y };
        applyZoom(index, { scale, pan: sizes ? clampPan(pan, scale, sizes.drawn, sizes.box) : pan }, false);
        return;
      }
      if (event.touches.length !== 1) return;
      const point = at(event.touches[0]);
      const dx = point.x - startTouch.x;
      const dy = point.y - startTouch.y;
      if (mode === "pan") {
        if (event.cancelable) event.preventDefault();
        const sizes = measure(index);
        const pan = { x: startZoom.pan.x + dx, y: startZoom.pan.y + dy };
        applyZoom(index, { scale: startZoom.scale, pan: sizes ? clampPan(pan, startZoom.scale, sizes.drawn, sizes.box) : pan }, false);
        return;
      }
      if (mode === "maybe") {
        if (Math.hypot(dx, dy) < 8) return;
        mode = Math.abs(dy) > Math.abs(dx) ? "close" : "swipe";
      }
      if (mode === "close") {
        if (event.cancelable) event.preventDefault();
        dragDown(dy);
      }
    };
    const onEnd = (event: TouchEvent) => {
      lastTouchAt.current = Date.now();
      if (mode === "pinch") {
        if (event.touches.length === 1) {
          // One finger left after a pinch: it pans what the pinch zoomed.
          startTouch = { ...at(event.touches[0]), t: event.timeStamp };
          startZoom = current();
          mode = startZoom.scale > 1.01 ? "pan" : "none";
        } else if (!event.touches.length) {
          settleZoom();
          mode = "none";
        }
        return;
      }
      if (event.touches.length) return;
      const end = event.changedTouches[0];
      const dx = end ? end.clientX - startTouch.x : 0;
      const dy = end ? end.clientY - startTouch.y : 0;
      if (mode === "close") {
        if (closesOnRelease(dx, dy)) requestClose();
        else dragBack();
      } else if ((mode === "maybe" || mode === "pan") && Math.hypot(dx, dy) < 10 && event.timeStamp - startTouch.t < 300) {
        // A tap. Two close together toggle the zoom where they landed.
        if (lastTap && event.timeStamp - lastTap.t < 320 && Math.hypot(startTouch.x - lastTap.x, startTouch.y - lastTap.y) < 30) {
          if (event.cancelable) event.preventDefault();
          const sizes = measure(activeRef.current);
          if (sizes) applyZoom(activeRef.current, toggleZoom(relative(startTouch), current(), sizes.drawn, sizes.box), true);
          lastTap = null;
        } else lastTap = { x: startTouch.x, y: startTouch.y, t: event.timeStamp };
      } else if (mode === "pan") settleZoom();
      mode = "none";
    };
    const onCancel = () => {
      if (mode === "close") dragBack();
      if (mode === "pinch" || mode === "pan") settleZoom();
      mode = "none";
    };
    // Ctrl and the wheel (a trackpad's pinch in most desktop browsers) zooms about the pointer, never the page.
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      const index = activeRef.current;
      const sizes = measure(index);
      if (!sizes) return;
      const from = current();
      const scale = clampZoom(from.scale * Math.exp(-event.deltaY * 0.01));
      if (scale <= 1.01) return applyZoom(index, unzoomed(), false);
      const point = { x: event.clientX - sizes.centre.x, y: event.clientY - sizes.centre.y };
      applyZoom(index, { scale, pan: clampPan(zoomAbout(point, from, scale), scale, sizes.drawn, sizes.box) }, false);
    };
    // Safari's own pinch gestures, which would zoom the page under the viewer.
    const onGesture = (event: Event) => event.preventDefault();
    track.addEventListener("touchstart", onStart, { passive: false });
    track.addEventListener("touchmove", onMove, { passive: false });
    track.addEventListener("touchend", onEnd, { passive: false });
    track.addEventListener("touchcancel", onCancel);
    track.addEventListener("wheel", onWheel, { passive: false });
    dialog.addEventListener("gesturestart", onGesture);
    return () => {
      track.removeEventListener("touchstart", onStart);
      track.removeEventListener("touchmove", onMove);
      track.removeEventListener("touchend", onEnd);
      track.removeEventListener("touchcancel", onCancel);
      track.removeEventListener("wheel", onWheel);
      dialog.removeEventListener("gesturestart", onGesture);
    };
  }, [applyZoom, measure, requestClose, settleZoom]);

  const onScroll = () => {
    const track = trackRef.current;
    if (!track) return;
    const index = slideAt(track.scrollLeft, track.clientWidth, count);
    if (index !== activeRef.current) {
      activeRef.current = index;
      setActive(index);
      // Keep its neighbours loaded from now on, so the next swipe is ready.
      setSeen(previous => (neighbours(index, count).every(slide => previous.has(slide)) ? previous : new Set([...previous, ...neighbours(index, count)])));
    }
    // Noted once the track comes to rest, so photos merely passed are not counted as seen.
    window.clearTimeout(settleTimer.current);
    settleTimer.current = window.setTimeout(() => {
      setSettled(activeRef.current);
      onIndex(activeRef.current);
    }, 150);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    const target = keyTarget(event.key, activeRef.current, count);
    if (target === null || event.altKey || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    go(target);
  };

  // The mouse: a double click zooms in or out where it points; a zoomed photo is dragged to pan.
  const onDoubleClick = (event: React.MouseEvent) => {
    if (Date.now() - lastTouchAt.current < 800) return; // a double tap, handled above
    const index = activeRef.current;
    const sizes = measure(index);
    if (!sizes) return;
    const point = { x: event.clientX - sizes.centre.x, y: event.clientY - sizes.centre.y };
    applyZoom(index, toggleZoom(point, zoomIndex.current === index ? zoom.current : unzoomed(), sizes.drawn, sizes.box), true);
  };
  const onPointerDown = (event: React.PointerEvent) => {
    if (event.pointerType !== "mouse" || event.button !== 0 || zoom.current.scale <= 1.01 || zoomIndex.current !== activeRef.current) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    mouseDrag.current = { id: event.pointerId, from: { x: event.clientX, y: event.clientY }, pan: { ...zoom.current.pan } };
  };
  const onPointerMove = (event: React.PointerEvent) => {
    const drag = mouseDrag.current;
    if (!drag || drag.id !== event.pointerId) return;
    const index = activeRef.current;
    const sizes = measure(index);
    const pan = { x: drag.pan.x + event.clientX - drag.from.x, y: drag.pan.y + event.clientY - drag.from.y };
    applyZoom(index, { scale: zoom.current.scale, pan: sizes ? clampPan(pan, zoom.current.scale, sizes.drawn, sizes.box) : pan }, false);
  };
  const onPointerUp = (event: React.PointerEvent) => {
    if (mouseDrag.current?.id === event.pointerId) mouseDrag.current = null;
  };

  const button = "grid place-items-center rounded-full bg-white/10 text-white backdrop-blur-sm hover:bg-white/25 focus-visible:outline-white";
  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onCancel={event => {
        event.preventDefault();
        requestClose();
      }}
      // Closed by the browser itself (a second Escape it would not let us hold back). Never the close a remount in
      // development's Strict Mode makes, which has opened it again by the time the event comes.
      onClose={event => {
        if (!event.currentTarget.open) requestClose();
      }}
      onKeyDown={onKeyDown}
      className="fixed inset-0 m-0 size-full max-h-none max-w-none overflow-hidden overscroll-contain border-0 bg-black p-0 text-white backdrop:bg-transparent"
    >
      <div
        ref={trackRef}
        tabIndex={-1}
        aria-label="Photos"
        onScroll={onScroll}
        className="absolute inset-0 flex snap-x snap-mandatory overflow-y-hidden overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden outline-none"
        style={{ overflowX: zoomed ? "hidden" : "auto", touchAction: zoomed ? "none" : "pan-x" }}
      >
        {photos.map((photo, index) => (
          <div key={`${index}:${photo.url}`} role="group" aria-roledescription="slide" aria-label={`Photo ${index + 1} of ${count}`} className="relative h-full w-full shrink-0 snap-center snap-always overflow-hidden">
            <div
              ref={element => {
                boxes.current[index] = element;
              }}
              onDoubleClick={onDoubleClick}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              className={`size-full ${zoomed && index === active ? "cursor-grab active:cursor-grabbing" : ""}`}
            >
              {near.has(index) || seen.has(index) ? (
                <img
                  ref={element => {
                    images.current[index] = element;
                  }}
                  src={photo.url}
                  alt={`${title}, photo ${index + 1} of ${count}`}
                  loading={near.has(index) ? "eager" : "lazy"}
                  decoding="async"
                  draggable={false}
                  // A light deterrent to saving the full-size photo; the inline gallery keeps the browser's own menu.
                  onContextMenu={event => event.preventDefault()}
                  className="size-full object-contain select-none [-webkit-touch-callout:none] will-change-transform"
                />
              ) : null}
            </div>
          </div>
        ))}
      </div>

      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center gap-3 bg-gradient-to-b from-black/70 to-transparent pt-[max(0.75rem,env(safe-area-inset-top))] pr-[max(0.75rem,env(safe-area-inset-right))] pb-8 pl-[max(1rem,env(safe-area-inset-left))]">
        <p className="shrink-0 text-sm font-semibold tabular-nums" aria-live="polite" aria-atomic="true">
          <span className="sr-only">Photo </span>
          {active + 1}
          <span aria-hidden="true"> / </span>
          <span className="sr-only"> of </span>
          {count}
        </p>
        <h2 id={titleId} className="min-w-0 flex-1 truncate text-sm font-semibold max-sm:sr-only">
          {title}
        </h2>
        <button type="button" onClick={requestClose} aria-label="Close photos" className={`pointer-events-auto ml-auto size-11 shrink-0 ${button}`}>
          <X className="size-6" aria-hidden="true" />
        </button>
      </div>

      {count > 1 ? (
        <>
          <button type="button" onClick={() => go(wrapIndex(activeRef.current - 1, count))} aria-label="Previous photo" className={`absolute top-1/2 left-[max(1rem,env(safe-area-inset-left))] hidden size-14 -translate-y-1/2 pointer-fine:grid ${button}`}>
            <ChevronLeft className="size-8" aria-hidden="true" />
          </button>
          <button type="button" onClick={() => go(wrapIndex(activeRef.current + 1, count))} aria-label="Next photo" className={`absolute top-1/2 right-[max(1rem,env(safe-area-inset-right))] hidden size-14 -translate-y-1/2 pointer-fine:grid ${button}`}>
            <ChevronRight className="size-8" aria-hidden="true" />
          </button>
          <div className="pointer-events-none absolute inset-x-0 bottom-0 hidden bg-gradient-to-t from-black/70 to-transparent pt-8 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:block">
            <div ref={stripRef} className="pointer-events-auto relative mx-auto flex w-fit max-w-full gap-2 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {photos.map((photo, index) => (
                <button
                  key={`${index}:${photo.url}`}
                  type="button"
                  onClick={() => go(index)}
                  aria-label={`Photo ${index + 1}${index === active ? ", shown" : ""}`}
                  aria-current={index === active ? "true" : undefined}
                  className={`size-14 shrink-0 overflow-hidden rounded-lg border-2 transition-opacity ${index === active ? "border-white" : "border-transparent opacity-60 hover:opacity-100"}`}
                >
                  <img src={photo.url} alt="" loading="lazy" decoding="async" draggable={false} className="size-full object-cover" />
                </button>
              ))}
            </div>
          </div>
        </>
      ) : null}
    </dialog>
  );
}
