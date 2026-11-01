import { callRoute } from "@/lib/calls";
import { customerFetch } from "@/lib/customer";

const reply = (data: unknown, status = 200) => Response.json(data, { status, headers: { "cache-control": "no-store" } });

/**
 * Calls in the browser go through this site's server, which adds the customer's session (browsers never hold it):
 * presence, starting a call, polling it, answering, ending and the connection details. Route handlers rather than
 * Server Actions, which a page runs one at a time (a poll would hold up the connection details). Only this site's pages
 * may use them.
 */
async function forward(request: Request, path: string[] | undefined) {
  const site = request.headers.get("sec-fetch-site");
  if (site !== null && site !== "same-origin") return reply({ error: { message: "Calls are made from Udozo's own pages." } }, 403);
  const body = request.method === "POST" ? ((await request.json().catch(() => ({}))) as Record<string, unknown>) : undefined;
  const route = callRoute(request.method, path ?? [], body ?? {}, new URL(request.url).searchParams);
  if (!route) return reply({ error: { message: "No such call." } }, 404);
  const res = await customerFetch(route.method, route.path, route.body);
  if (!res) return reply({ error: { message: "We could not reach Udozo. Try again shortly." } }, 502);
  return reply(await res.json().catch(() => ({ error: { message: "Something went wrong. Try again." } })), res.status);
}

export async function GET(request: Request, { params }: { params: Promise<{ path?: string[] }> }) {
  return forward(request, (await params).path);
}

export async function POST(request: Request, { params }: { params: Promise<{ path?: string[] }> }) {
  return forward(request, (await params).path);
}
