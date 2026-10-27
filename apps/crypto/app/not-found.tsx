import Link from "next/link";
import { Header } from "@/components/header";
import { globalMarket } from "@bitocard/crypto-ui/market";

export default function NotFound() {
  return (
    <>
      <Header current={globalMarket} />
      <main id="main" className="mx-auto grid max-w-xl place-content-center gap-3 px-4 py-24 text-center">
        <h1 className="font-display text-3xl font-extrabold text-navy-900">This page is not here</h1>
        <p className="text-slate-600">The market or trader may not be open, or the address is wrong.</p>
        <Link href="/" className="mx-auto inline-flex min-h-11 items-center rounded-xl bg-navy-900 px-4 font-semibold text-white">
          Go to the markets
        </Link>
      </main>
    </>
  );
}
