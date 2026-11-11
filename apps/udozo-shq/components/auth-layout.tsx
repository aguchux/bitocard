import type { ReactNode } from "react";
import { Code2, Store, Wallet } from "lucide-react";
import { UdozoAuthLayout } from "@bitocard/admin-ui/shell";
import { UdozoWordmark } from "./wordmark";

const features = [
  { icon: Store, label: "Your own stores and domains" },
  { icon: Wallet, label: "Wallet, orders and earnings" },
  { icon: Code2, label: "API keys and webhooks" },
];

/** Sign-in, sign-up, password and invitation pages: Udozo's own auth layout (`UdozoAuthLayout`), never BitoCard's. */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <UdozoAuthLayout
      brand={<UdozoWordmark className="text-2xl" />}
      product="Seller HQ"
      title="Run your Udozo stores in one place"
      lead="Your stores, orders, wallet and reselling, from any device."
      features={features}
      aside={
        <a href="https://udozo.com" className="font-semibold text-navy-900 hover:underline">
          udozo.com
        </a>
      }
    >
      {children}
    </UdozoAuthLayout>
  );
}
