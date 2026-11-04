// The photo gallery's sums, apart from React so they can be tested: which slide is showing, zoom and pan in the
// full-screen viewer, and the history entry that lets the Back button close it.

/** The largest zoom, and where a double tap or double click takes a photo. */
export const maxZoom = 3;
export const doubleTapZoom = 2.5;
/** How far down a finger drags an unzoomed photo before letting go closes the viewer. */
export const closeDragPx = 110;

export type Point = { x: number; y: number };
export type Size = { width: number; height: number };

/** An index kept within 0..count-1 (0 when there is nothing). */
export function clampIndex(index: number, count: number) {
  if (count <= 0 || !Number.isFinite(index)) return 0;
  return Math.min(count - 1, Math.max(0, Math.round(index)));
}

/** An index going round: after the last comes the first, before the first the last. */
export function wrapIndex(index: number, count: number) {
  if (count <= 0 || !Number.isFinite(index)) return 0;
  return ((Math.round(index) % count) + count) % count;
}

/** The slide a sideways track shows, from how far it has scrolled (each slide the track's own width). */
export function slideAt(scrollLeft: number, width: number, count: number) {
  if (width <= 0) return 0;
  return clampIndex(scrollLeft / width, count);
}

/** Where the keyboard takes the viewer: arrows step (going round), Home and End to the ends; null for any other key. */
export function keyTarget(key: string, index: number, count: number): number | null {
  if (count <= 0) return null;
  if (key === "ArrowRight") return wrapIndex(index + 1, count);
  if (key === "ArrowLeft") return wrapIndex(index - 1, count);
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
}

/** The slides worth loading now: the one shown and its neighbours (going round). */
export function neighbours(index: number, count: number) {
  if (count <= 0) return [];
  return [...new Set([index, wrapIndex(index + 1, count), wrapIndex(index - 1, count)])];
}

export function clampZoom(scale: number) {
  if (!Number.isFinite(scale)) return 1;
  return Math.min(maxZoom, Math.max(1, scale));
}

/** The zoom a pinch has reached: the zoom it started at, times how far the fingers moved apart. */
export function pinchZoom(startScale: number, startDistance: number, distance: number) {
  if (startDistance <= 0) return clampZoom(startScale);
  return clampZoom((startScale * distance) / startDistance);
}

export function distance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** The size a photo is drawn at inside a box with `object-fit: contain` (the box's own when the photo's is unknown). */
export function containedSize(natural: Size, box: Size): Size {
  if (natural.width <= 0 || natural.height <= 0) return box;
  const ratio = Math.min(box.width / natural.width, box.height / natural.height);
  return { width: natural.width * ratio, height: natural.height * ratio };
}

/**
 * The pan kept within the photo: zoomed, its edges may come to the box's edges and no further, and a side still
 * narrower than the box stays centred. The photo is scaled about the box's centre, so a pan of 0 is centred.
 */
export function clampPan(pan: Point, scale: number, drawn: Size, box: Size): Point {
  const maxX = Math.max(0, (drawn.width * scale - box.width) / 2);
  const maxY = Math.max(0, (drawn.height * scale - box.height) / 2);
  return { x: Math.min(maxX, Math.max(-maxX, pan.x)) || 0, y: Math.min(maxY, Math.max(-maxY, pan.y)) || 0 };
}

/**
 * The pan that keeps the spot under the fingers (or the pointer) where it is while the zoom changes from `from` to
 * `to`. `point` is relative to the box's centre.
 */
export function zoomAbout(point: Point, from: { scale: number; pan: Point }, to: number): Point {
  const ratio = to / from.scale;
  return { x: point.x - ratio * (point.x - from.pan.x), y: point.y - ratio * (point.y - from.pan.y) };
}

/** A double tap or double click: zoomed in, back to the whole photo; otherwise in to `doubleTapZoom` at that spot. */
export function toggleZoom(point: Point, current: { scale: number; pan: Point }, drawn: Size, box: Size): { scale: number; pan: Point } {
  if (current.scale > 1.01) return { scale: 1, pan: { x: 0, y: 0 } };
  const scale = doubleTapZoom;
  return { scale, pan: clampPan(zoomAbout(point, current, scale), scale, drawn, box) };
}

/** A finger dragged mostly downwards far enough on an unzoomed photo: let go, and the viewer closes. */
export function closesOnRelease(dx: number, dy: number) {
  return dy > closeDragPx && Math.abs(dy) > Math.abs(dx) * 1.5;
}

// -- History: the viewer is one entry, so Back closes it ---------------------------------------------------------------

/** The mark on the history entry the viewer adds: the gallery's own ID, so two galleries on a page never answer for each other. */
export const historyKey = "udozoPhotos";

/**
 * The address while the viewer is open: the page's own with `#photo-<n>`. A fragment, so it is never a new page for
 * search engines (a canonical tag names the page anyway) and the server never sees it.
 */
export function photoHash(index: number) {
  return `#photo-${index + 1}`;
}

/** The photo a `#photo-<n>` fragment names, or null (another fragment, or a photo the listing does not have). */
export function photoFromHash(hash: string, count: number): number | null {
  const match = /^#photo-(\d{1,3})$/.exec(hash);
  if (!match) return null;
  const index = Number(match[1]) - 1;
  return index >= 0 && index < count ? index : null;
}

/** Whether a history entry is the one this gallery's viewer added (its state carries the gallery's ID). */
export function isViewerEntry(state: unknown, gallery: string): boolean {
  return Boolean(state && typeof state === "object" && (state as Record<string, unknown>)[historyKey] === gallery);
}

/**
 * The entry to add on opening and the address it shows: the same page, same query, with the photo's fragment (any
 * other fragment replaced). Next.js copies its own router state into it, so going back over it is no navigation.
 */
export function viewerEntry(gallery: string, index: number, location: { pathname: string; search: string }) {
  return { state: { [historyKey]: gallery }, url: `${location.pathname}${location.search}${photoHash(index)}` };
}
