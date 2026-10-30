import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto grid max-w-md gap-3 px-4 py-20 text-center">
      <h1 className="text-2xl font-extrabold">This page is not on Udozo</h1>
      <p className="text-navy-600">It may have moved, or the address is mistyped.</p>
      <Link href="/" className="mx-auto flex h-11 items-center rounded-xl bg-navy-900 px-5 font-bold text-white">
        Go to Udozo
      </Link>
    </main>
  );
}
