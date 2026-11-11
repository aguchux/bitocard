import type { ReactNode } from "react";
import { ShieldCheck, Store, Users } from "lucide-react";
import { UdozoAuthLayout } from "@bitocard/admin-ui/shell";
import { UdozoWordmark } from "./wordmark";

const features = [
  { icon: ShieldCheck, label: "Secure platform access" },
  { icon: Store, label: "Marketplace and UdozoPay" },
  { icon: Users, label: "Sellers and resellers" },
];

/** The admin's sign-in and set-password pages: Udozo's own auth layout (`UdozoAuthLayout`), never BitoCard's. */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <UdozoAuthLayout
      brand={<UdozoWordmark className="text-2xl" />}
      product="Admin"
      title="The Udozo admin workspace"
      lead="Run the marketplace, sellers and resellers, UdozoPay and settings."
      features={features}
    >
      {children}
    </UdozoAuthLayout>
  );
}
