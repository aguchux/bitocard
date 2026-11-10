import "server-only";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import type { Centre, CentreReturn, CounterOrder, CounterSummary, CounterView, Earnings, List, Member, Pickups, Shelf, Stock, StockCheck, Transfer } from "./centres";
import { customerApi } from "./session";
import { signInPath } from "./site";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What a centre page reads: the data, or a refusal in words to show (a lost session signs in; an unknown centre is a 404). */
export type Read<T> = { ok: true; data: T } | { ok: false; message: string };

async function read<T>(path: string, back: string): Promise<Read<T>> {
  const result = await customerApi<T>("GET", path);
  if (result.ok) return { ok: true, data: result.data };
  if (result.status === 401) redirect(signInPath(back));
  if (result.status === 404) notFound();
  return { ok: false, message: result.message };
}

/** The centres the signed-in person works at, each with their role. */
export const myCentres = cache(async (back = "/centre") => read<List<Centre>>("/v1/connect/centres/mine", back));

export const readCentre = cache(async (id: string) => {
  if (!uuid.test(id)) notFound();
  return read<Centre>(`/v1/connect/centres/${id}`, `/centre/${id}`);
});

export const readMembers = (id: string) => read<List<Member>>(`/v1/connect/centres/${id}/members`, `/centre/${id}/staff`);
export const readShelves = (id: string) => read<List<Shelf>>(`/v1/connect/centres/${id}/shelves`, `/centre/${id}/shelves`);

export const readSummary = (id: string) => read<CounterSummary>(`/v1/connect/centres/${id}/orders/summary`, `/centre/${id}`);
export const readOrders = (id: string, view: CounterView) => read<List<CounterOrder>>(`/v1/connect/centres/${id}/orders?view=${view}`, `/centre/${id}/orders`);
export async function readOrder(id: string, order: string) {
  if (!uuid.test(order)) notFound();
  return read<CounterOrder>(`/v1/connect/centres/${id}/orders/${order}`, `/centre/${id}/orders/${order}`);
}

export const readReturns = (id: string, status?: string) => read<List<CentreReturn>>(`/v1/connect/centres/${id}/returns${status ? `?status=${status}` : ""}`, `/centre/${id}/returns`);

export const readStock = (id: string) => read<Stock>(`/v1/connect/centres/${id}/stock`, `/centre/${id}/stock`);
export const readStockChecks = (id: string) => read<List<StockCheck>>(`/v1/connect/centres/${id}/stock-checks`, `/centre/${id}/stock`);
export const readEarnings = (id: string) => read<Earnings>(`/v1/connect/centres/${id}/earnings`, `/centre/${id}/earnings`);
export const readTransfers = (id: string) => read<List<Transfer>>(`/v1/connect/centres/${id}/transfers`, `/centre/${id}/transfers`);
export const readPickups = (id: string) => read<Pickups>(`/v1/connect/centres/${id}/pickups`, `/centre/${id}/pickups`);
