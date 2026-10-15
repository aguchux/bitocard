import { redirect } from "next/navigation";

/** Spin and win opens over Home, as a full-screen dialog; this address is kept for older links. */
export default function SpinPage() {
  redirect("/account?spin=1");
}
