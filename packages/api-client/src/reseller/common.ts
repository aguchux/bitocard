/**
 * Shared shapes for the reseller API (SHQ). The public OpenAPI document has no response schemas yet, so these mirror
 * the API presenters by hand, like the admin types; the API tests pin the presenters. Money is in integer minor units.
 */
export type Mode = 'test' | 'live';
export type List<T> = { object: 'list'; data: T[]; has_more?: boolean };
export type Page = { limit?: number; starting_after?: string };
export type ResellerRole = 'owner' | 'admin' | 'developer' | 'finance' | 'support';
export type ResellerStatus = 'pending' | 'active' | 'suspended';

/** Drops empty values so query strings stay clean. */
export const params = (values: Record<string, string | number | boolean | undefined | null>) =>
  Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined && value !== null && value !== ''));

/** Cursor pages: the next page starts after the last item, while the API says there is more. */
export const cursorPages = {
  initialPageParam: '',
  getNextPageParam: (last: { data: Array<{ id: string }>; has_more?: boolean }) => (last.has_more ? last.data.at(-1)?.id : undefined),
};
