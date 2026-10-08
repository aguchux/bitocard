import { vi } from "vitest";

/** The request the mocked `next/headers` answers with; tests set it before calling the helpers. */
export const request = { headers: new Headers(), cookies: new Map<string, string>() };

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => request.headers,
  cookies: async () => ({ get: (name: string) => (request.cookies.has(name) ? { name, value: request.cookies.get(name) } : undefined) }),
}));

export function setRequest(headers: Record<string, string>, cookies: Record<string, string> = {}) {
  request.headers = new Headers(headers);
  request.cookies = new Map(Object.entries(cookies));
}
