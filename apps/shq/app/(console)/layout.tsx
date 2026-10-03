import { ResellerGate } from "@/components/reseller";

/** Every page in this group needs a signed-in reseller (or team member) with a confirmed email. */
export default function ConsoleLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <ResellerGate>{children}</ResellerGate>;
}
