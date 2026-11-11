import "server-only";
import { redirect } from "next/navigation";
import { allows, type PosPermission } from "./pos";
import { actorKind } from "./pos-api";
import { currentPos } from "./pos-data";

/** Pages of the owner's Udozo account (plan, payments, the shop and its tills): staff go home. */
export async function ownerOnly() {
  if ((await actorKind()) === "staff") redirect("/app");
}

/** A page a member of staff reaches only when their role opens one of `permissions` (the API holds every call too). */
export async function needs(...permissions: PosPermission[]) {
  const pos = await currentPos();
  if (pos.ok && pos.data.actor === "staff" && !permissions.some(key => allows(pos.data.permissions, key))) redirect("/app");
  return pos;
}
