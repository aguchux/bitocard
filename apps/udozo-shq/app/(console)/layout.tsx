import { ShqInstallPrompt } from "@/components/install";
import { ResellerGate } from "@/components/reseller";

/**
 * Every page in this group needs a signed-in seller (or team member) with a confirmed email. BitoCard SHQ's first-store
 * guide is not shown: its steps (`StoreGuideDialog` in @bitocard/admin-ui) name BitoCard's catalogue; the home page's
 * checklist guides Udozo's sellers instead.
 */
export default function ConsoleLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <ResellerGate>
      {children}
      <ShqInstallPrompt />
    </ResellerGate>
  );
}
