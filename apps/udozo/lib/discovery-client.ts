import type { DiscoveryEvent } from "@bitocard/api-client/discovery";
import { maxBatch, newSessionId } from "./discovery";

/**
 * The browser's side of discovery events: a queue sent in batches of up to 50 to this site's own `/api/events`, with
 * `navigator.sendBeacon` (it survives the page closing), else a `fetch` with `keepalive`. Sent a few seconds after the
 * last event, at once when a batch fills, and when the page is hidden or left. The visit's ID lives here only.
 */

export const eventsPath = "/api/events";
/** How long the queue waits for more events before sending. */
export const flushDelayMs = 5000;

type Deps = {
  /** Whether anything may be recorded now: signed in, or a visitor who chose Accept all. */
  allowed: () => boolean;
  /** The market of the page, or null where there is none (nothing is sent then). */
  country: () => string | null;
  send: (path: string, body: string) => void;
  setTimer: (run: () => void, ms: number) => unknown;
  clearTimer: (timer: unknown) => void;
  now: () => Date;
  session?: string;
};

export class EventQueue {
  readonly session: string;
  private queue: DiscoveryEvent[] = [];
  private timer: unknown = null;
  private later = new Map<number, DiscoveryEvent>();
  private nextLater = 1;

  constructor(private readonly deps: Deps) {
    this.session = deps.session ?? newSessionId();
  }

  /** Queues an event (stamped with its time); `now` sends what is queued at once (the page is closing). */
  track(event: DiscoveryEvent, options: { now?: boolean } = {}) {
    if (!this.deps.allowed() || !this.deps.country()) return;
    this.queue.push({ ...event, at: event.at ?? this.deps.now().toISOString() });
    if (options.now || this.queue.length >= maxBatch) this.flush();
    else this.schedule();
  }

  /** An event that can still be taken back (Not interested, with Undo): queued only when `commit` runs or the page closes. */
  trackLater(event: DiscoveryEvent): { commit: () => void; cancel: () => void } {
    const id = this.nextLater++;
    this.later.set(id, { ...event, at: this.deps.now().toISOString() });
    return {
      commit: () => {
        const held = this.later.get(id);
        this.later.delete(id);
        if (held) this.track(held);
      },
      cancel: () => {
        this.later.delete(id);
      },
    };
  }

  /** Sends everything queued (and anything held for Undo), up to 50 a call. */
  flush() {
    if (this.timer !== null) this.deps.clearTimer(this.timer);
    this.timer = null;
    for (const held of this.later.values()) this.queue.push(held);
    this.later.clear();
    const country = this.deps.country();
    if (!country || !this.deps.allowed()) {
      this.queue = [];
      return;
    }
    while (this.queue.length) {
      const events = this.queue.splice(0, maxBatch);
      this.deps.send(eventsPath, JSON.stringify({ country, session: this.session, events }));
    }
  }

  private schedule() {
    if (this.timer !== null) return;
    this.timer = this.deps.setTimer(() => {
      this.timer = null;
      this.flush();
    }, flushDelayMs);
  }

  /** What is waiting to be sent (tests). */
  get pending() {
    return this.queue.length + this.later.size;
  }
}

/** Sends a batch: a beacon as plain text (no preflight, and it outlives the page), else `fetch` with `keepalive`. */
export function beacon(path: string, body: string) {
  try {
    if (typeof navigator !== "undefined" && navigator.sendBeacon?.(path, new Blob([body], { type: "text/plain;charset=UTF-8" }))) return;
  } catch {
    // Fall through to fetch.
  }
  void fetch(path, { method: "POST", keepalive: true, headers: { "content-type": "text/plain;charset=UTF-8" }, body }).catch(() => undefined);
}

// -- The page's one queue ---------------------------------------------------------------------------------------------

let current: EventQueue | null = null;

/** Starts the page's queue (the tracker, once, in the root layout). */
export function startQueue(deps: Pick<Deps, "allowed" | "country">) {
  current ??= new EventQueue({ ...deps, send: beacon, setTimer: (run, ms) => setTimeout(run, ms), clearTimer: timer => clearTimeout(timer as ReturnType<typeof setTimeout>), now: () => new Date() });
  return current;
}

/** Records an event on this page; nothing happens where the tracker is not running (resellers' stores) or nothing may be recorded. */
export function track(event: DiscoveryEvent, options?: { now?: boolean }) {
  current?.track(event, options);
}

export function trackLater(event: DiscoveryEvent) {
  return current?.trackLater(event) ?? { commit: () => undefined, cancel: () => undefined };
}

export function flushEvents() {
  current?.flush();
}

// -- Photos opened on the listing being looked at (the gallery tells, the engagement event counts) -------------------

const photosSeen = new Set<number>();
export function photoOpened(index: number) {
  photosSeen.add(index);
}
export function photosOpened() {
  return photosSeen.size;
}
export function resetPhotos() {
  photosSeen.clear();
}
