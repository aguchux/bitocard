import type { Metadata } from "next";
import { Problem } from "@/components/centre-ui";
import { CentreStaff } from "@/components/centre-staff";
import { readCentre, readMembers } from "@/lib/centre-data";
import { currentCustomer } from "@/lib/session";

export const metadata: Metadata = { title: "Staff" };

export default async function CentreStaffPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [centre, members, me] = await Promise.all([readCentre(id), readMembers(id), currentCustomer()]);
  if (!centre.ok) return null;
  if (!members.ok) return <Problem message={members.message} />;
  return <CentreStaff centre={centre.data} members={members.data.data} me={me?.email ?? ""} />;
}
