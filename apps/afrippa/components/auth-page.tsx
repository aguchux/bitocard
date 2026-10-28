import type { ReactNode } from "react";
import { globalMarket } from "@afrippa/ui/market";
import { Header } from "@/components/header";

/** The narrow page signing in, signing up and two-step use: the header, a title, a line, then a card. */
export function AuthPage({ title, lead, children, below }: { title: string; lead?: ReactNode; children: ReactNode; below?: ReactNode }) {
  return (
    <>
      <Header current={globalMarket} />
      <main id="main">
        <div className="mx-auto grid max-w-md gap-4 px-4 py-8">
          <h1 className="text-2xl leading-tight font-extrabold">{title}</h1>
          {lead ? <p className="text-sm text-navy-600">{lead}</p> : null}
          <section className="rounded-3xl border border-navy-200 bg-white p-5">{children}</section>
          {below}
        </div>
      </main>
    </>
  );
}
