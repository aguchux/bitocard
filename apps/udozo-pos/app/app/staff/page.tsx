import type { Metadata } from "next";
import Link from "next/link";
import { InviteStaff, type RoleChoice, RolesMatrix, StaffTable } from "@/components/staff-manager";
import { needs } from "@/lib/gates";
import { ownerRoles, posStaff } from "@/lib/pos-data";

export const metadata: Metadata = { title: "Staff and roles", robots: { index: false, follow: false } };

/**
 * Settings > Staff and roles: the owner's staff with their role, tills and status, inviting by WhatsApp, SMS or a
 * link, and the role matrix with custom roles. A manager sees and invites cashiers only.
 */
export default async function StaffPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const pos = await needs("staff");
  if (!pos.ok) return null;
  const view = pos.data;
  const owner = view.actor === "owner";
  const tab = owner && (await searchParams).tab === "roles" ? "roles" : "staff";
  const [list, roles] = await Promise.all([posStaff(), owner ? ownerRoles() : null]);
  const tills = view.shops.flatMap(shop => shop.tills.map(till => ({ id: till.id, name: till.name, shop: shop.name })));
  const choices: RoleChoice[] = roles?.ok
    ? roles.data.data.map(role => ({ id: role.id, name: role.name, description: role.description }))
    : [{ id: "cashier", name: "Cashier", description: "Sells, takes payments and prints receipts. Small discounts only." }];
  const tabClass = (on: boolean) => `flex h-11 items-center rounded-[10px] px-4 text-sm font-semibold no-underline ${on ? "bg-pos-ink text-white" : "text-pos-ink-2 hover:bg-white"}`;
  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-3xl font-bold text-pos-ink">{owner ? "Staff and roles" : "Cashiers"}</h1>
          <p className="mt-1 max-w-2xl text-pos-ink-2">
            Staff work at POS level only. They sign in at pos.udozo.com or in the Udozo POS app with the shop code and their own PIN, with no Udozo account, and never see your Udozo account, payouts, wallet or listings.
          </p>
        </div>
        {tab === "staff" ? <InviteStaff roles={choices} tills={tills} /> : null}
      </div>
      {owner ? (
        <nav aria-label="Staff and roles" className="flex gap-1">
          <Link href="/app/staff" aria-current={tab === "staff" ? "page" : undefined} className={tabClass(tab === "staff")}>
            Staff{list.ok ? ` (${list.data.used})` : ""}
          </Link>
          <Link href="/app/staff?tab=roles" aria-current={tab === "roles" ? "page" : undefined} className={tabClass(tab === "roles")}>
            Roles and permissions{roles?.ok ? ` (${roles.data.data.length})` : ""}
          </Link>
        </nav>
      ) : null}
      {tab === "roles" && roles ? (
        roles.ok ? (
          <RolesMatrix roles={roles.data} />
        ) : (
          <p role="alert" className="rounded-[20px] bg-white p-6 text-pos-error">
            {roles.message}
          </p>
        )
      ) : list.ok ? (
        <>
          {list.data.limit !== null ? (
            <p className="text-sm text-pos-muted">
              {list.data.used} of {list.data.limit} staff on {view.planName}.{owner && list.data.used >= list.data.limit ? " Change plan to invite more." : ""}
            </p>
          ) : null}
          <StaffTable staff={list.data.data} roles={choices} tills={tills} />
          <p className="text-sm text-pos-muted">Removing someone signs them out of every till right away. Their past sales stay on your reports under their name.</p>
        </>
      ) : (
        <p role="alert" className="rounded-[20px] bg-white p-6 text-pos-error">
          {list.message}
        </p>
      )}
    </div>
  );
}
