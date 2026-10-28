import { AdminGate } from "@bitocard/admin-ui/shell";

/** Every page in this group needs one of Afrippa's admins signed in. */
export default function ConsoleLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <AdminGate>{children}</AdminGate>;
}
