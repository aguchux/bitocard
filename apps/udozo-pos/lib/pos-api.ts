import "server-only";
import { cookies } from "next/headers";
import { apiFile, type ApiResult, customerApi, staffApi, staffCookie } from "./session";

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/**
 * Who is at the till: a member of staff when this browser holds a staff session (which then wins), else the owner
 * with their Udozo account. Staff never use the owner's session, and the owner's routes never take a staff one.
 */
export async function actorKind(): Promise<"owner" | "staff"> {
  return (await cookies()).get(staffCookie)?.value ? "staff" : "owner";
}

/**
 * Calls one of the till's routes that owner and staff share (the catalogue, sales and refunds, payments asked of
 * buyers, stock, the shop's customers, transfers to match): `/v1/pos/owner…` for the owner, `/v1/pos/staff…` for staff,
 * whose role the API holds every call to.
 */
export async function posApi<T>(method: Method, path: string, body?: unknown, options: { idempotencyKey?: string } = {}): Promise<ApiResult<T>> {
  return (await actorKind()) === "staff" ? staffApi<T>(method, `/v1/pos/staff${path}`, body, options) : customerApi<T>(method, `/v1/pos/owner${path}`, body, options);
}

/** A file from a shared route (a receipt's PDF), as the owner or the member of staff at the till. */
export async function posFile(path: string) {
  return (await actorKind()) === "staff" ? apiFile("staff", `/v1/pos/staff${path}`) : apiFile("customer", `/v1/pos/owner${path}`);
}
