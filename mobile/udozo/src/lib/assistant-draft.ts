import { useEffect, useRef } from 'react';

/**
 * A first message Anjio drafted, handed to the listing or chat screen the assistant was opened from (its "Use in the
 * chat", as udozo.com's `useAssistantDraft`): kept here until that screen takes it, so the buyer reads and sends it
 * themselves. Only the screen named takes it, so a listing behind a chat never opens a second chat.
 */
type Where = 'listing' | 'chat';
const waiting = new Map<string, string>();
const listeners = new Set<() => void>();

export function putDraft(where: Where, listingId: string, text: string) {
  waiting.set(`${where}:${listingId}`, text);
  listeners.forEach(listener => listener());
}

/** Calls `apply` with a draft left for this screen and listing, once, as soon as there is one. */
export function useAssistantDraft(where: Where, listingId: string | null | undefined, apply: (text: string) => void) {
  const latest = useRef(apply);
  useEffect(() => {
    latest.current = apply;
  });
  useEffect(() => {
    if (!listingId) return;
    const key = `${where}:${listingId}`;
    const take = () => {
      const text = waiting.get(key);
      if (text === undefined) return;
      waiting.delete(key);
      latest.current(text);
    };
    take();
    listeners.add(take);
    return () => void listeners.delete(take);
  }, [where, listingId]);
}
