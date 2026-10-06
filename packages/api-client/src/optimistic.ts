/** What `updateQueryData` gives back: the change can be undone. */
export type Patch = { undo: () => void };

/**
 * Optimistic updates, the one way: the change is drawn into the cache at once (the patches), the API's answer is
 * awaited, and if it refuses, every patch is undone and `resync` asks the server for the truth again. Returns the
 * API's answer, or undefined when it refused (the screen shows the mutation's error as usual).
 */
export async function settleOptimistic<T>(patches: Patch[], fulfilled: Promise<{ data: T }>, resync?: () => void): Promise<T | undefined> {
  try {
    return (await fulfilled).data;
  } catch {
    for (const patch of patches.reverse()) patch.undo();
    resync?.();
    return undefined;
  }
}
