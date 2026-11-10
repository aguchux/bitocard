import { readPhoto, uuid } from "@/lib/centre-files";

/** One of a pickup's check-out photos, for the centre's people, read through this site's server. Never cached. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string; pickup: string; photo: string }> }) {
  const { id, pickup, photo } = await params;
  if (![id, pickup, photo].every(value => uuid.test(value))) return new Response("Not found", { status: 404 });
  return readPhoto(`/v1/connect/centres/${id}/pickups/${pickup}/photos/${photo}`);
}
