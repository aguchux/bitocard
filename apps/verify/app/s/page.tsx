import type { Metadata } from "next";
import { VerifyFooter, VerifyHeader } from "@/components/header";
import { Handoff } from "./handoff";

export const metadata: Metadata = { title: "Opening your check" };

/** Where links from BitoCard and stores land: `/s#t=<one-time token>`. */
export default function HandoffPage() {
  return (
    <>
      <VerifyHeader />
      <main className="mx-auto w-full max-w-xl px-4 py-5">
        <Handoff />
      </main>
      <VerifyFooter />
    </>
  );
}
