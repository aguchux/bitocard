import type { ReactNode } from "react";
import { render } from "@testing-library/react";
import { AdminProviders } from "@bitocard/admin-ui/shell";
import { ResellerGate } from "@/components/reseller";

/** Every request the screens send, as the API received it. */
export type Sent = { method: string; path: string; body: unknown };

export const session = {
  object: "session",
  user: { object: "user", id: "u1", name: "Ada Obi", email: "ada@example.com", email_verified: true, phone: "+2348031234567", phone_verified: true, has_password: true, created_at: "2026-10-01T00:00:00.000Z" },
  memberships: [{ object: "membership", role: "owner", reseller: { object: "reseller", id: "r1", name: "Ada Stores", country: "NG", status: "active" } }],
  two_step: { pending: false, setup_required: false, method: null },
};

export const store = {
  object: "store",
  id: "8b1c2b3a-4f5e-4d6c-8b7a-9f8e7d6c5b4a",
  name: "Ada Resale",
  subdomain: "adaresale",
  url: "https://adaresale.udozo.com",
  status: "published",
  branding: { logo_url: null, primary_color: null, accent_color: null },
  template: "resale_shop",
  variant: "showroom",
  theme: "navy",
  focus: null,
  home: { version: null, published_at: null },
  checkout_mode: "test",
  desktop_nav: null,
  ai_overage: "stop",
  customer_verification: true,
  published_at: "2026-10-20T00:00:00.000Z",
  created_at: "2026-10-19T00:00:00.000Z",
};

const missing = () => Response.json({ error: { type: "not_found_error", code: "resource_missing", message: "Not found." } }, { status: 404 });

/**
 * Replaces `fetch` with Udozo's API: `routes` answers `METHOD /path` (or `/path` for any method) with a body, or a
 * Response for errors. The session and the inbox are always there. Returns every request sent.
 */
export function fakeApi(routes: Record<string, unknown | ((body: unknown) => unknown)>) {
  const sent: Sent[] = [];
  process.env.NEXT_PUBLIC_API_URL = "http://api.test";
  globalThis.fetch = (async (input: Request) => {
    const url = new URL(input.url);
    const body = input.method === "GET" ? null : await input.json().catch(() => null);
    sent.push({ method: input.method, path: `${url.pathname}${url.search}`, body });
    const all: Record<string, unknown> = { "/v1/auth/session": session, "/v1/notifications/unread-count": { object: "unread_count", count: 0 }, ...routes };
    const answer = all[`${input.method} ${url.pathname}`] ?? all[url.pathname];
    if (answer === undefined) return missing();
    const value = typeof answer === "function" ? (answer as (body: unknown) => unknown)(body) : answer;
    return value instanceof Response ? value : Response.json(value);
  }) as typeof fetch;
  return sent;
}

/** An API refusal in BitoCard's error shape. */
export const refusal = (status: number, code: string, message: string, param?: string) =>
  Response.json({ error: { type: status === 409 ? "conflict_error" : "invalid_request_error", code, message, param, request_id: "req_1" } }, { status });

/** A Seller HQ screen inside the session gate, as the console layout renders it. */
export const renderSignedIn = (element: ReactNode) =>
  render(
    <AdminProviders>
      <ResellerGate>{element}</ResellerGate>
    </AdminProviders>,
  );

/** jsdom has no modal dialogs. */
export function modalDialogs() {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.open = false;
  };
}
