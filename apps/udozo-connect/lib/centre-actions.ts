"use server";

import { revalidatePath } from "next/cache";
import type { Centre, CentreReturn, CounterOrder, List, Member, Shelf } from "./centres";
import { customerApi } from "./session";

/** What an action answers: what it changed as it now is, or Udozo's refusal in words with the field it names. */
export type CentreResult<T> = { ok: true; data: T } | { ok: false; message: string; code: string | null; param: string | null };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const unknown = { ok: false as const, message: "No such centre.", code: "centre_unknown", param: null };

async function answer<T>(result: Awaited<ReturnType<typeof customerApi<T>>>): Promise<CentreResult<T>> {
  if (!result.ok) return { ok: false, message: result.status === 401 ? "Your session ended. Sign in again to carry on." : result.message, code: result.code, param: result.param };
  revalidatePath("/centre", "layout");
  return { ok: true, data: result.data };
}

const text = (value: string | null | undefined) => (typeof value === "string" && value.trim() ? value.trim() : null);

export type CentreFields = { hours?: string; phone?: string; capacity?: string | number; landmark?: string | null };

/** Changes the centre's opening hours, phone, capacity and landmark (owners and managers). */
export async function updateCentre(id: string, input: CentreFields): Promise<CentreResult<Centre>> {
  if (!uuid.test(id)) return unknown;
  const body: Record<string, string | number | null> = {};
  if (input.hours !== undefined) body.hours = text(input.hours);
  if (input.phone !== undefined) body.phone = text(input.phone);
  if (input.landmark !== undefined) body.landmark = text(input.landmark);
  if (input.capacity !== undefined) {
    const capacity = Number(input.capacity);
    if (!Number.isInteger(capacity) || capacity < 1) return { ok: false, message: "Say how many items the centre can hold: a whole number from 1.", code: "parameter_invalid", param: "capacity" };
    body.capacity = capacity;
  }
  return answer(await customerApi<Centre>("PATCH", `/v1/connect/centres/${id}`, body));
}

/** Pauses the centre for a holiday: until a day (`YYYY-MM-DD`, opening that morning) or until they open it again. */
export async function pauseCentre(id: string, until: string | null, note: string | null): Promise<CentreResult<Centre>> {
  if (!uuid.test(id)) return unknown;
  if (until !== null && until !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(until)) return { ok: false, message: "Choose the day to open again.", code: "parameter_invalid", param: "until" };
  return answer(await customerApi<Centre>("POST", `/v1/connect/centres/${id}/pause`, { until: until ? `${until}T00:00:00.000Z` : null, note: text(note) }));
}

export async function resumeCentre(id: string): Promise<CentreResult<Centre>> {
  if (!uuid.test(id)) return unknown;
  return answer(await customerApi<Centre>("POST", `/v1/connect/centres/${id}/resume`, {}));
}

/** The owner adds a manager or staff member by the email of their Udozo account. */
export async function addMember(id: string, email: string, role: "manager" | "staff"): Promise<CentreResult<List<Member>>> {
  if (!uuid.test(id)) return unknown;
  if (role !== "manager" && role !== "staff") return { ok: false, message: "Choose manager or staff.", code: "parameter_invalid", param: "role" };
  return answer(await customerApi<List<Member>>("POST", `/v1/connect/centres/${id}/members`, { email: email.trim(), role }));
}

export async function changeMemberRole(id: string, member: string, role: "manager" | "staff"): Promise<CentreResult<List<Member>>> {
  if (!uuid.test(id) || !uuid.test(member)) return unknown;
  if (role !== "manager" && role !== "staff") return { ok: false, message: "Choose manager or staff.", code: "parameter_invalid", param: "role" };
  return answer(await customerApi<List<Member>>("PATCH", `/v1/connect/centres/${id}/members/${member}`, { role }));
}

/** The owner removes someone; anyone else removes only themselves (leaving the centre). */
export async function removeMember(id: string, member: string): Promise<CentreResult<List<Member>>> {
  if (!uuid.test(id) || !uuid.test(member)) return unknown;
  return answer(await customerApi<List<Member>>("DELETE", `/v1/connect/centres/${id}/members/${member}`));
}

export type ShelfFields = { code?: string; label?: string | null; capacity?: string | number | null; active?: boolean };

function shelfBody(input: ShelfFields): Record<string, string | number | boolean | null> | { problem: string } {
  const body: Record<string, string | number | boolean | null> = {};
  if (input.code !== undefined) body.code = input.code.trim();
  if (input.label !== undefined) body.label = text(input.label);
  if (input.capacity !== undefined) {
    if (input.capacity === null || input.capacity === "") body.capacity = null;
    else {
      const capacity = Number(input.capacity);
      if (!Number.isInteger(capacity) || capacity < 1) return { problem: "Say how many items it holds: a whole number from 1, or leave it empty." };
      body.capacity = capacity;
    }
  }
  if (input.active !== undefined) body.active = input.active;
  return body;
}

export async function addShelf(id: string, input: ShelfFields): Promise<CentreResult<List<Shelf>>> {
  if (!uuid.test(id)) return unknown;
  const body = shelfBody(input);
  if ("problem" in body) return { ok: false, message: String(body.problem), code: "parameter_invalid", param: "capacity" };
  return answer(await customerApi<List<Shelf>>("POST", `/v1/connect/centres/${id}/shelves`, body));
}

export async function updateShelf(id: string, shelf: string, input: ShelfFields): Promise<CentreResult<List<Shelf>>> {
  if (!uuid.test(id) || !uuid.test(shelf)) return unknown;
  const body = shelfBody(input);
  if ("problem" in body) return { ok: false, message: String(body.problem), code: "parameter_invalid", param: "capacity" };
  return answer(await customerApi<List<Shelf>>("PATCH", `/v1/connect/centres/${id}/shelves/${shelf}`, body));
}

// ---- The counter ----

const counter = (id: string, order: string, step: string) => `/v1/connect/centres/${id}/orders/${order}/${step}`;

/** Finds an order of this centre by its number (from its label), for its page. */
export async function findOrder(id: string, number: string): Promise<CentreResult<{ id: string }>> {
  if (!uuid.test(id)) return unknown;
  // A label's QR code holds the order number, then the centre: the number is what is looked up.
  const typed = number.trim().split(/\s+/)[0] ?? "";
  if (!/^(?:sp[-\s]?)?\d{1,12}$/i.test(typed)) return { ok: false, message: "Give the order number on the label, such as SP-000123.", code: "parameter_invalid", param: "number" };
  const found = await customerApi<CounterOrder>("GET", `/v1/connect/centres/${id}/orders/lookup?number=${encodeURIComponent(typed)}`);
  if (!found.ok) return { ok: false, message: found.status === 404 ? "No order with that number is coming to this centre." : found.message, code: found.code, param: "number" };
  return { ok: true, data: { id: found.data.id } };
}

export async function receiveOrder(id: string, order: string, note: string | null): Promise<CentreResult<CounterOrder>> {
  if (!uuid.test(id) || !uuid.test(order)) return unknown;
  return answer(await customerApi<CounterOrder>("POST", counter(id, order, "receive"), { note: text(note) }));
}

export async function refuseOrder(id: string, order: string, reason: string, note: string | null): Promise<CentreResult<CounterOrder>> {
  if (!uuid.test(id) || !uuid.test(order)) return unknown;
  if (!["wrong_item", "damaged", "missing_parts", "not_allowed"].includes(reason)) return { ok: false, message: "Choose why you are refusing it.", code: "parameter_invalid", param: "reason" };
  return answer(await customerApi<CounterOrder>("POST", counter(id, order, "refuse"), { reason, note: text(note) }));
}

export async function shelveOrder(id: string, order: string, shelf: string): Promise<CentreResult<CounterOrder>> {
  if (!uuid.test(id) || !uuid.test(order) || !uuid.test(shelf)) return { ok: false, message: "Choose a storage place.", code: "parameter_invalid", param: "shelf_id" };
  return answer(await customerApi<CounterOrder>("POST", counter(id, order, "shelve"), { shelf_id: shelf }));
}

/** Hands it over: the buyer accepted it after inspecting it and gave their 6-digit code. Never stored for replay. */
export async function releaseOrder(id: string, order: string, code: string): Promise<CentreResult<CounterOrder>> {
  if (!uuid.test(id) || !uuid.test(order)) return unknown;
  const digits = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(digits)) return { ok: false, message: "The release code is 6 digits.", code: "parameter_invalid", param: "code" };
  return answer(await customerApi<CounterOrder>("POST", counter(id, order, "release"), { code: digits }));
}

export async function refuseCollection(id: string, order: string, reason: string): Promise<CentreResult<CounterOrder>> {
  if (!uuid.test(id) || !uuid.test(order)) return unknown;
  return answer(await customerApi<CounterOrder>("POST", counter(id, order, "refuse-collection"), { reason: reason.trim() }));
}

export async function postUpdate(id: string, order: string, body: string): Promise<CentreResult<CounterOrder>> {
  if (!uuid.test(id) || !uuid.test(order)) return unknown;
  return answer(await customerApi<CounterOrder>("POST", counter(id, order, "updates"), { body: body.trim() }));
}

// ---- Returns to sellers ----

/** Asks to return an item to its seller, with why. */
export async function askReturn(id: string, order: string, reason: string, note: string | null): Promise<CentreResult<CentreReturn>> {
  if (!uuid.test(id) || !uuid.test(order)) return unknown;
  if (!["not_collected", "refused_at_check_in", "refused_at_counter", "damaged"].includes(reason)) return { ok: false, message: "Choose why it goes back.", code: "parameter_invalid", param: "reason" };
  return answer(await customerApi<CentreReturn>("POST", `/v1/connect/centres/${id}/orders/${order}/return`, { reason, note: text(note) }));
}

/** Hands an item back to its seller against their 6-digit return code. Never stored for replay. */
export async function handBack(id: string, returnId: string, code: string): Promise<CentreResult<CentreReturn>> {
  if (!uuid.test(id) || !uuid.test(returnId)) return unknown;
  const digits = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(digits)) return { ok: false, message: "The return code is 6 digits.", code: "parameter_invalid", param: "code" };
  return answer(await customerApi<CentreReturn>("POST", `/v1/connect/centres/${id}/returns/${returnId}/hand-back`, { code: digits }));
}
