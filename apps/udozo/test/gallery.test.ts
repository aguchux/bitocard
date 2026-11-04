// The photo gallery: the sums behind the slider, the full-screen viewer's zoom and its history entry, and what the
// listing page and resellers' stores draw (slides with labels, thumbnails, buttons opening full screen, never a link
// to the raw file).
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  clampIndex,
  clampPan,
  clampZoom,
  closesOnRelease,
  containedSize,
  doubleTapZoom,
  isViewerEntry,
  keyTarget,
  maxZoom,
  neighbours,
  photoFromHash,
  photoHash,
  pinchZoom,
  slideAt,
  toggleZoom,
  viewerEntry,
  wrapIndex,
  zoomAbout,
} from "@/lib/gallery";

const { Gallery } = await import("@/components/gallery");
const { Gallery: StoreGallery, ResaleSupplierPage } = await import("@/components/store/resale-detail");

const photos = [1, 2, 3].map(n => ({ url: `https://media.test/listings/p${n}.jpg`, width: 1600, height: 1200 }));
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("which slide", () => {
  it("clamps and wraps indexes, never past the ends or below nothing", () => {
    expect(clampIndex(-1, 3)).toBe(0);
    expect(clampIndex(7, 3)).toBe(2);
    expect(clampIndex(1.4, 3)).toBe(1);
    expect(clampIndex(2, 0)).toBe(0);
    expect(clampIndex(Number.NaN, 3)).toBe(0);
    expect(wrapIndex(3, 3)).toBe(0);
    expect(wrapIndex(-1, 3)).toBe(2);
    expect(wrapIndex(-4, 3)).toBe(2);
    expect(wrapIndex(5, 0)).toBe(0);
  });

  it("reads the slide from how far the track has scrolled, rounding to the nearest", () => {
    expect(slideAt(0, 390, 3)).toBe(0);
    expect(slideAt(390 * 1.49, 390, 3)).toBe(1);
    expect(slideAt(390 * 1.51, 390, 3)).toBe(2);
    expect(slideAt(99_999, 390, 3)).toBe(2);
    expect(slideAt(200, 0, 3)).toBe(0);
  });

  it("moves with the keys: arrows go round, Home and End to the ends, other keys nothing", () => {
    expect(keyTarget("ArrowRight", 2, 3)).toBe(0);
    expect(keyTarget("ArrowLeft", 0, 3)).toBe(2);
    expect(keyTarget("Home", 2, 3)).toBe(0);
    expect(keyTarget("End", 0, 3)).toBe(2);
    expect(keyTarget("Enter", 1, 3)).toBeNull();
    expect(keyTarget("ArrowRight", 0, 0)).toBeNull();
  });

  it("loads the photo shown and its neighbours, going round", () => {
    expect(neighbours(0, 5).sort()).toEqual([0, 1, 4]);
    expect(neighbours(0, 1)).toEqual([0]);
    expect(neighbours(1, 2).sort()).toEqual([0, 1]);
    expect(neighbours(0, 0)).toEqual([]);
  });
});

describe("zoom", () => {
  const box = { width: 400, height: 800 };
  const drawn = containedSize({ width: 1600, height: 1200 }, box);

  it("draws a photo as object-fit: contain does", () => {
    expect(drawn).toEqual({ width: 400, height: 300 });
    expect(containedSize({ width: 0, height: 0 }, box)).toEqual(box);
  });

  it("keeps the zoom between the whole photo and 3x", () => {
    expect(clampZoom(0.4)).toBe(1);
    expect(clampZoom(9)).toBe(maxZoom);
    expect(clampZoom(Number.NaN)).toBe(1);
    expect(pinchZoom(1, 100, 200)).toBe(2);
    expect(pinchZoom(2, 100, 400)).toBe(3);
    expect(pinchZoom(2, 100, 10)).toBe(1);
    expect(pinchZoom(1.5, 0, 50)).toBe(1.5);
  });

  it("pans only as far as the zoomed photo's edges, a side narrower than the screen staying centred", () => {
    // At 2x the photo is 800 x 600: 200 px spare either side across, none up and down (the screen is 800 tall).
    expect(clampPan({ x: 500, y: 300 }, 2, drawn, box)).toEqual({ x: 200, y: 0 });
    expect(clampPan({ x: -500, y: -300 }, 2, drawn, box)).toEqual({ x: -200, y: 0 });
    expect(clampPan({ x: 50, y: 0 }, 1, drawn, box)).toEqual({ x: 0, y: 0 });
  });

  it("keeps the spot under the fingers where it is while zooming", () => {
    const from = { scale: 1, pan: { x: 0, y: 0 } };
    const point = { x: 100, y: -50 };
    const pan = zoomAbout(point, from, 2);
    // The photo's point first under the fingers ((100, -50) at 1x) is drawn at pan + 2x itself: still (100, -50).
    expect(pan).toEqual({ x: -100, y: 50 });
    expect(pan.x + 2 * point.x).toBe(point.x);
    expect(zoomAbout(point, { scale: 2, pan }, 2)).toEqual(pan);
  });

  it("a double tap zooms in where it lands, and out again when zoomed", () => {
    const zoomedIn = toggleZoom({ x: 100, y: 0 }, { scale: 1, pan: { x: 0, y: 0 } }, drawn, box);
    expect(zoomedIn.scale).toBe(doubleTapZoom);
    expect(zoomedIn.pan.x).toBeLessThan(0);
    expect(Math.abs(zoomedIn.pan.x)).toBeLessThanOrEqual((drawn.width * doubleTapZoom - box.width) / 2);
    expect(toggleZoom({ x: 0, y: 0 }, zoomedIn, drawn, box)).toEqual({ scale: 1, pan: { x: 0, y: 0 } });
  });

  it("closes on a drag mostly downwards and far enough, never a sideways swipe or a short pull", () => {
    expect(closesOnRelease(10, 160)).toBe(true);
    expect(closesOnRelease(0, 60)).toBe(false);
    expect(closesOnRelease(150, 130)).toBe(false);
    expect(closesOnRelease(0, -200)).toBe(false);
  });
});

describe("history", () => {
  it("adds one entry for the open viewer: the same page and query with a #photo fragment, marked as this gallery's", () => {
    const entry = viewerEntry("g1", 2, { pathname: "/ng/l/100027-alienware", search: "?ref=abc" });
    expect(entry.url).toBe("/ng/l/100027-alienware?ref=abc#photo-3");
    expect(isViewerEntry(entry.state, "g1")).toBe(true);
    // Next.js adds its own router state to the same object; still ours.
    expect(isViewerEntry({ ...entry.state, __NA: true }, "g1")).toBe(true);
    expect(isViewerEntry(entry.state, "g2")).toBe(false);
    expect(isViewerEntry({ __NA: true }, "g1")).toBe(false);
    expect(isViewerEntry(null, "g1")).toBe(false);
  });

  it("reads the photo back from the fragment, only a photo the listing has", () => {
    expect(photoHash(0)).toBe("#photo-1");
    expect(photoFromHash("#photo-3", 3)).toBe(2);
    expect(photoFromHash("#photo-4", 3)).toBeNull();
    expect(photoFromHash("#photo-0", 3)).toBeNull();
    expect(photoFromHash("#similar", 3)).toBeNull();
    expect(photoFromHash("", 3)).toBeNull();
  });
});

describe("the listing page's gallery", () => {
  const html = renderToStaticMarkup(createElement(Gallery, { title: "Alienware 17", photos, video: { url: "https://media.test/v.mp4", poster_url: "https://media.test/v.jpg", duration_ms: 42_000 } }));

  it("draws every photo as a labelled slide on a sideways scroll-snap track", () => {
    expect(html).toContain('aria-roledescription="carousel"');
    expect(html).toContain('aria-label="Photos of Alienware 17"');
    for (const n of [1, 2, 3]) expect(html).toContain(`aria-label="Photo ${n} of 3"`);
    expect(html).toContain('alt="Alienware 17, photo 1 of 3"');
    expect(html).toMatch(/class="[^"]*snap-x snap-mandatory overflow-x-auto/);
    expect(html.match(/snap-center snap-always/g)?.length).toBe(4);
  });

  it("each photo opens full screen; the first loads at once, the rest lazily", () => {
    for (const n of [1, 2, 3]) expect(html).toContain(`aria-label="Open photo ${n} of 3 full screen"`);
    expect(html).toMatch(/<img src="https:\/\/media\.test\/listings\/p1\.jpg"[^>]*loading="eager"/);
    expect(html).toMatch(/<img src="https:\/\/media\.test\/listings\/p2\.jpg"[^>]*loading="lazy"/);
    expect(html).toContain('draggable="false"');
  });

  it("thumbnails for each photo and the video, the video never playing or loading on its own", () => {
    expect(html).toContain('aria-label="Photo 1, shown"');
    expect(html).toContain('aria-label="Photo 2"');
    expect(html).toContain("Play the seller&#x27;s video, 42 seconds");
    expect(html).toContain('preload="none"');
    expect(html).not.toContain("autoPlay");
    expect(html).not.toContain("autoplay");
  });

  it("arrows only where there is a mouse, and the count", () => {
    expect(html).toMatch(/class="[^"]*hidden[^"]*pointer-fine:grid" aria-label="Next photo"/);
    expect(html).toContain(">1 / 3</span>");
  });

  it("never links the raw photo", () => {
    expect(html).not.toMatch(/<a [^>]*href="https:\/\/media\.test/);
  });

  it("a listing without photos shows the empty frame", () => {
    const empty = renderToStaticMarkup(createElement(Gallery, { title: "Nothing yet", photos: [] }));
    expect(empty).not.toContain("<img");
    expect(empty).not.toContain("Open photo");
  });

  it("still notes the photos the person comes to rest on for discovery", () => {
    expect(read("../components/gallery.tsx")).toContain("photoOpened(shown)");
  });
});

describe("resellers' stores", () => {
  it("use the same gallery, rounded in the store's colours, with no link to the raw photo", () => {
    const html = renderToStaticMarkup(createElement(StoreGallery, { title: "Hisense 55 TV", photos }));
    expect(html).toContain('aria-label="Open photo 2 of 3 full screen"');
    expect(html).toContain("rounded-2xl bg-slate-100");
    expect(html).not.toMatch(/<a [^>]*href="https:\/\/media\.test/);
    expect(read("../components/store/resale-detail.tsx")).not.toContain("href={photo.url}");
  });

  it("the supplier's listing as written too", () => {
    const supplier = {
      id: "rel_1",
      name: "Ada's Electronics",
      member_since: "2025-01-01T00:00:00.000Z",
      badges: [],
      completed_sales: 4,
      area: null,
      listings_here: 2,
      listing: { title: "Hisense 55 TV", condition: "used", category: null, area: null, features: [], description: null, photos },
    };
    const html = renderToStaticMarkup(createElement(ResaleSupplierPage, { supplier: supplier as never }));
    expect(html).toContain('aria-label="Open photo 1 of 3 full screen"');
    expect(html).not.toMatch(/<a [^>]*href="https:\/\/media\.test/);
  });
});

describe("the full-screen viewer", () => {
  const source = read("../components/photo-viewer.tsx");

  it("is a native modal dialog over the whole screen, labelled with the listing, its safe areas kept", () => {
    expect(source).toContain("dialog.showModal()");
    expect(source).toContain("aria-labelledby={titleId}");
    expect(source).toContain("fixed inset-0 m-0 size-full max-h-none max-w-none");
    expect(source).toContain("env(safe-area-inset-top)");
    expect(source).toContain("env(safe-area-inset-bottom)");
    expect(source).toContain('aria-live="polite"');
    expect(source).toContain('aria-label="Close photos"');
  });

  it("holds the page still, listens for pinches without passive listeners, and respects reduced motion", () => {
    expect(source).toContain('root.style.overflow = "hidden"');
    expect(source).toContain('addEventListener("touchmove", onMove, { passive: false })');
    expect(source).toContain("prefers-reduced-motion: reduce");
  });

  it("Back closes it through the gallery's own history entry, never a new page", () => {
    const gallery = read("../components/gallery.tsx");
    expect(gallery).toContain("window.history.pushState(entry.state");
    expect(gallery).toContain("window.history.back()");
    expect(gallery).toContain('addEventListener("popstate"');
  });
});
