import { vi } from "vitest";

/** The request the mocked `next/headers` answers with; tests set it before calling the helpers. */
export const request = { headers: new Headers(), cookies: new Map<string, string>(), set: [] as Array<{ name: string; value: string; options?: Record<string, unknown> }> };

/** What `unstable_cache` was asked to keep: each read's key and options (the cache itself is not kept in tests). */
export const cached: Array<{ keyParts: string[]; options: { revalidate?: number; tags?: string[] } }> = [];

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({
  unstable_cache:
    <T>(fn: () => Promise<T>, keyParts: string[], options: { revalidate?: number; tags?: string[] }) =>
    () => {
      cached.push({ keyParts, options });
      return fn();
    },
  revalidatePath: () => undefined,
}));
vi.mock("next/headers", () => ({
  headers: async () => request.headers,
  cookies: async () => ({
    get: (name: string) => (request.cookies.has(name) ? { name, value: request.cookies.get(name) } : undefined),
    set: (name: string, value: string, options?: Record<string, unknown>) => {
      request.cookies.set(name, value);
      request.set.push({ name, value, options });
    },
    delete: (name: string) => {
      request.cookies.delete(name);
    },
  }),
}));

export function setRequest(headers: Record<string, string>, cookies: Record<string, string> = {}) {
  cached.length = 0;
  request.headers = new Headers(headers);
  request.cookies = new Map(Object.entries(cookies));
  request.set = [];
}
