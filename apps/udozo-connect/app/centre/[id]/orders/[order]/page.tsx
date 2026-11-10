import type { Metadata } from "next";
import { Problem } from "@/components/centre-ui";
import { CounterOrderView } from "@/components/counter-order";
import { readCentre, readOrder, readShelves } from "@/lib/centre-data";

export const metadata: Metadata = { title: "Item" };

/** One item at the counter: check it in, shelve it, hand it over against the buyer's code, or post an update. */
export default async function OrderPage({ params }: { params: Promise<{ id: string; order: string }> }) {
  const { id, order } = await params;
  const [centre, read, shelves] = await Promise.all([readCentre(id), readOrder(id, order), readShelves(id)]);
  if (!centre.ok) return null;
  if (!read.ok) return <Problem message={read.message} />;
  return <CounterOrderView key={`${read.data.status}:${read.data.ready_at}:${read.data.shelf?.id}`} centre={id} country={centre.data.country} order={read.data} shelves={shelves.ok ? shelves.data.data.filter(shelf => shelf.active) : []} />;
}
