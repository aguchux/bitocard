import { AdminGate } from "@bitocard/admin-ui/shell";

/** Every page in this group needs a signed-in admin. */
export default function ConsoleLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <AdminGate>{children}</AdminGate>;
}
