/**
 * How the API's lists page, so every list in the app can load the next page as it nears its end. Three kinds:
 * - `offset`: `offset` and `limit`, with `total` (saved, chats, UdozoPay orders, wanted requests);
 * - `full`: `offset` and `limit` with no total, so a full page means there may be more (buy orders);
 * - `cursor`: `starting_after` the last item's id, with `has_more` (my listings, notifications, wallet transactions).
 */
export type Paging = 'offset' | 'full' | 'cursor';

export type PageOf<T> = { data: T[]; total?: number; has_more?: boolean };

/** The page's address: the path (which may carry its own query) with the paging added. */
export function pagePath(path: string, paging: Paging, limit: number, param: number | string | null) {
  const join = path.includes('?') ? '&' : '?';
  if (paging === 'cursor') return `${path}${join}limit=${limit}${param ? `&starting_after=${encodeURIComponent(String(param))}` : ''}`;
  return `${path}${join}limit=${limit}&offset=${typeof param === 'number' ? param : 0}`;
}

/** What to ask for next, or undefined once the list is all loaded. */
export function nextPage<T>(paging: Paging, limit: number, last: PageOf<T>, pages: PageOf<T>[]): number | string | undefined {
  if (!last.data.length) return undefined;
  if (paging === 'cursor') return last.has_more ? (last.data[last.data.length - 1] as { id: string }).id : undefined;
  const loaded = pages.reduce((sum, page) => sum + page.data.length, 0);
  if (paging === 'full') return last.data.length >= limit ? loaded : undefined;
  return loaded < (last.total ?? 0) ? loaded : undefined;
}

/**
 * Every page's items in order, each once: a list read again while it changes (chats moving to the top) can bring an
 * item back on a later page.
 */
export function pagedItems<T>(pages: PageOf<T>[] | undefined, keyOf: (item: T) => string = item => (item as { id: string }).id): T[] {
  const seen = new Set<string>();
  const items: T[] = [];
  for (const page of pages ?? []) {
    for (const item of page.data) {
      const key = keyOf(item);
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(item);
    }
  }
  return items;
}
