"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { type PermissionSet, type PosDeviceInfo, type PosInviteInfo, type PosInviteSent, type PosLinkCode, type PosRoleView, type PosStaffMember, signInPin, weakPin } from "./pos";
import { actorKind } from "./pos-api";
import type { PosResult } from "./pos-actions";
import { type ApiResult, customerApi, deviceApi, dropDevice, dropStaffSession, hasDevice, keepDevice, keepStaffSession, publicApi, staffApi } from "./session";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const refused = (message: string, param: string | null = null, code: string | null = "parameter_invalid"): PosResult<never> => ({ ok: false, message, code, param });
const answer = <T,>(result: ApiResult<T>, refresh = true): PosResult<T> => {
  if (!result.ok) return { ok: false, message: result.status === 401 && result.code !== "invalid_credentials" ? "Your session ended. Sign in again to carry on." : result.message, code: result.code, param: result.param };
  if (refresh) revalidatePath("/app", "layout");
  return { ok: true, data: result.data };
};
type Session = { session: { token: string }; staff: PosStaffMember; till_id: string | null };
const pinOk = (pin: string) => /^\d{6}$/.test(pin);

// ---- Signing in at the till ----

/** Staff on the web: the shop code, their phone and PIN. Kept in this site's own staff cookie. */
export async function staffSignIn(shopCode: string, phone: string, pin: string, tillId: string | null = null): Promise<PosResult<{ name: string }>> {
  const code = shopCode.trim().toUpperCase();
  if (!/^[A-Z]{3}-\d{4}$/.test(code)) return refused("The shop code is three letters and four digits, such as ADA-4821.", "shop_code");
  if (!phone.trim()) return refused("Give your phone number.", "phone");
  if (!signInPin(pin)) return refused("Your PIN is 6 digits.", "pin");
  const result = await publicApi<Session>("POST", "/v1/pos/staff/sign-in", { shop_code: code, phone: phone.trim().slice(0, 20), pin, ...(tillId && uuid.test(tillId) ? { till_id: tillId } : {}) });
  if (!result.ok) return answer(result, false);
  await keepStaffSession(result.data.session.token);
  return { ok: true, data: { name: result.data.staff.name } };
}

/** On a linked till: a name tile and PIN. */
export async function deviceSignIn(staffId: string, pin: string): Promise<PosResult<{ name: string }>> {
  if (!uuid.test(staffId)) return refused("Tap your name.", "staff_id");
  if (!signInPin(pin)) return refused("Your PIN is 6 digits.", "pin");
  const result = await deviceApi<Session>("POST", "/v1/pos/device/sign-in", { staff_id: staffId, pin });
  if (!result.ok) return answer(result, false);
  await keepStaffSession(result.data.session.token);
  return { ok: true, data: { name: result.data.staff.name } };
}

/** A member of staff changes their own PIN: the current one, then a new 6-digit one. */
export async function changePin(currentPin: string, newPin: string): Promise<PosResult<{ changed: true }>> {
  if (!signInPin(currentPin)) return refused("Type your current PIN.", "current_pin");
  if (!pinOk(newPin)) return refused("Your new PIN is 6 digits.", "new_pin");
  if (weakPin(newPin)) return refused("Choose a PIN that is harder to guess.", "new_pin", "pin_too_easy");
  return answer(await staffApi<{ changed: true }>("POST", "/v1/pos/staff/pin", { current_pin: currentPin, new_pin: newPin }));
}

/** Signs the member of staff out; a linked till goes back to its name tiles. */
export async function staffSignOut() {
  await staffApi("POST", "/v1/pos/staff/sign-out");
  await dropStaffSession();
  redirect((await hasDevice()) ? "/signin/till" : "/signin");
}

// ---- Invites ----

export async function lookupInvite(token: string): Promise<PosResult<PosInviteInfo>> {
  if (!/^upi_[A-Za-z0-9_-]{20,80}$/.test(token)) return refused("This invite link is not complete. Open it again from the message.", null, "invite_invalid");
  return answer(await publicApi<PosInviteInfo>("POST", "/v1/pos/invites/lookup", { token }), false);
}

/** Sets the PIN the invite asked for and signs them in. */
export async function acceptInvite(token: string, pin: string): Promise<PosResult<{ name: string }>> {
  if (!/^upi_[A-Za-z0-9_-]{20,80}$/.test(token)) return refused("This invite link is not complete. Open it again from the message.", null, "invite_invalid");
  if (!pinOk(pin)) return refused("Your PIN is 6 digits.", "pin");
  const result = await publicApi<Session>("POST", "/v1/pos/invites/accept", { token, pin });
  if (!result.ok) return answer(result, false);
  await keepStaffSession(result.data.session.token);
  return { ok: true, data: { name: result.data.staff.name } };
}

// ---- Linking this browser to a till ----

export async function linkDevice(code: string, name: string): Promise<PosResult<PosDeviceInfo>> {
  const key = code.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (key.length !== 8) return refused("The code is 8 letters and digits, such as 4F7K-29QX.", "code");
  const result = await publicApi<{ token: string; device: PosDeviceInfo }>("POST", "/v1/pos/devices/link", { code: key, ...(name.trim() ? { name: name.trim().slice(0, 60) } : {}), platform: "web" });
  if (!result.ok) return answer(result, false);
  await keepDevice(result.data.token);
  return { ok: true, data: result.data.device };
}

/** Forgets this browser's link (the till is unlinked from the owner's Shop and tills too). */
export async function forgetDevice() {
  await dropStaffSession();
  await dropDevice();
  redirect("/signin");
}

/** A device token the API no longer takes (unlinked): dropped. */
export async function deviceGone() {
  await dropDevice();
}

// ---- The owner's staff (a manager's cashiers) ----

export type StaffFields = { first_name: string; last_name: string; phone: string; email?: string | null; role: string; till_ids?: string[]; all_tills?: boolean; mobile?: boolean };
export type SendVia = "sms" | "whatsapp" | "link";

async function staffPath(path = "") {
  return (await actorKind()) === "staff" ? { call: staffApi, base: `/v1/pos/staff/staff${path}` } : { call: customerApi, base: `/v1/pos/owner/staff${path}` };
}

function staffBody(fields: Partial<StaffFields>) {
  return {
    ...(fields.first_name !== undefined ? { first_name: fields.first_name.trim().slice(0, 60) } : {}),
    ...(fields.last_name !== undefined ? { last_name: fields.last_name.trim().slice(0, 60) } : {}),
    ...(fields.phone !== undefined ? { phone: fields.phone.trim().slice(0, 20) } : {}),
    ...(fields.email !== undefined ? { email: fields.email?.trim().slice(0, 254) || null } : {}),
    ...(fields.role !== undefined ? { role: fields.role.slice(0, 40) } : {}),
    ...(fields.all_tills !== undefined ? { all_tills: fields.all_tills } : {}),
    ...(fields.till_ids !== undefined ? { till_ids: fields.till_ids.filter(id => uuid.test(id)).slice(0, 100) } : {}),
    ...(fields.mobile !== undefined ? { mobile: fields.mobile } : {}),
  };
}

export async function inviteStaff(fields: StaffFields, sendVia: SendVia): Promise<PosResult<PosStaffMember & { invite: PosInviteSent }>> {
  if (!fields.first_name.trim()) return refused("Give their first name.", "first_name", "parameter_missing");
  if (!fields.last_name.trim()) return refused("Give their last name.", "last_name", "parameter_missing");
  if (!fields.phone.trim()) return refused("Give their phone number.", "phone", "parameter_missing");
  if (!fields.all_tills && !fields.till_ids?.length) return refused("Choose where they can work.", "till_ids", "parameter_missing");
  const { call, base } = await staffPath();
  return answer(await call<PosStaffMember & { invite: PosInviteSent }>("POST", base, { ...staffBody(fields), send_via: sendVia }));
}

export async function updateStaff(id: string, fields: Partial<StaffFields>): Promise<PosResult<PosStaffMember>> {
  if (!uuid.test(id)) return refused("No such member of staff.", null, "resource_missing");
  const { call, base } = await staffPath(`/${id}`);
  return answer(await call<PosStaffMember>("PATCH", base, staffBody(fields)));
}

/** A new invite: to someone still invited, or a new PIN for someone who forgot theirs (signed out at once). */
export async function resendInvite(id: string, sendVia: SendVia): Promise<PosResult<PosStaffMember & { invite: PosInviteSent }>> {
  if (!uuid.test(id)) return refused("No such member of staff.", null, "resource_missing");
  const { call, base } = await staffPath(`/${id}/resend`);
  return answer(await call<PosStaffMember & { invite: PosInviteSent }>("POST", base, { send_via: sendVia }));
}

export async function setStaffStatus(id: string, action: "suspend" | "restore" | "remove"): Promise<PosResult<PosStaffMember>> {
  if (!uuid.test(id)) return refused("No such member of staff.", null, "resource_missing");
  const { call, base } = await staffPath(action === "remove" ? `/${id}` : `/${id}/${action}`);
  return answer(await call<PosStaffMember>(action === "remove" ? "DELETE" : "POST", base));
}

// ---- The owner's roles and devices ----

export type RoleFields = { name: string; description?: string | null; permissions: Partial<PermissionSet>; discount_limit_bps: number | null };

export async function saveRole(id: string | null, fields: RoleFields): Promise<PosResult<PosRoleView>> {
  if (!fields.name.trim()) return refused("Name the role.", "name", "parameter_missing");
  if (fields.discount_limit_bps !== null && (!Number.isInteger(fields.discount_limit_bps) || fields.discount_limit_bps < 0 || fields.discount_limit_bps > 10_000)) return refused("A discount limit is 0% to 100%.", "discount_limit_bps");
  if (id !== null && !uuid.test(id)) return refused("No such role.", null, "resource_missing");
  const body = { name: fields.name.trim().slice(0, 40), description: fields.description?.trim().slice(0, 200) || null, permissions: fields.permissions, discount_limit_bps: fields.discount_limit_bps };
  return answer(id === null ? await customerApi<PosRoleView>("POST", "/v1/pos/owner/roles", body) : await customerApi<PosRoleView>("PATCH", `/v1/pos/owner/roles/${id}`, body));
}

export async function deleteRole(id: string): Promise<PosResult<null>> {
  if (!uuid.test(id)) return refused("No such role.", null, "resource_missing");
  return answer(await customerApi<null>("DELETE", `/v1/pos/owner/roles/${id}`));
}

/** A one-time code (10 minutes) to link a device to a till. */
export async function makeLinkCode(tillId: string): Promise<PosResult<PosLinkCode>> {
  if (!uuid.test(tillId)) return refused("Choose a till.", "till_id", "resource_missing");
  return answer(await customerApi<PosLinkCode>("POST", `/v1/pos/owner/tills/${tillId}/devices/link-code`), false);
}

/** Unlinks a device: it sells nothing more, and whoever is signed in on it is signed out at once. */
export async function unlinkDevice(id: string): Promise<PosResult<unknown>> {
  if (!uuid.test(id)) return refused("No such device.", null, "resource_missing");
  return answer(await customerApi("POST", `/v1/pos/owner/devices/${id}/unlink`));
}
