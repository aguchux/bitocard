import { ShqInstallPrompt } from "@/components/install";
import { ResellerGate } from "@/components/reseller";
import { ShqStoreGuide } from "@/components/store-guide";

/** Every page in this group needs a signed-in reseller (or team member) with a confirmed email. */
export default function ConsoleLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <ResellerGate>
      {children}
      <ShqInstallPrompt />
      <ShqStoreGuide />
    </ResellerGate>
  );
}
