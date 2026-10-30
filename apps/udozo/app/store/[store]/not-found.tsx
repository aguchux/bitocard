import Link from "next/link";

/** A store page that does not exist, or a listing no longer on sale here. */
export default function StoreNotFound() {
  return (
    <div className="mx-auto grid max-w-md gap-3 py-12 text-center">
      <h1 className="font-display text-2xl font-extrabold">This page is not here</h1>
      <p className="text-slate-600">It may have sold, or the address is wrong.</p>
      <Link href="/listings" className="justify-self-center rounded-xl bg-navy-900 px-5 py-3 font-semibold text-white hover:bg-navy-700">
        See what is on sale
      </Link>
    </div>
  );
}
