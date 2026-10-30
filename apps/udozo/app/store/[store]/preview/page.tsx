import type { Metadata } from "next";
import { StoreSections } from "@/components/store/store-sections";
import { requireStore, storeHome } from "@/lib/store";

export const metadata: Metadata = { title: "Preview", robots: { index: false, follow: false } };

type Props = { params: Promise<{ store: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

const tokenPattern = /^\d{10,16}\.[A-Za-z0-9_-]{20,100}$/;

/** The owner's draft home page, from Seller HQ's preview link (`/preview?token=`, 30 minutes). */
export default async function StorePreviewPage({ params, searchParams }: Props) {
  const { store: key } = await params;
  const store = await requireStore(key);
  const raw = (await searchParams).token;
  const token = typeof raw === "string" && tokenPattern.test(raw) ? raw : null;
  const home = token ? await storeHome(key, token) : null;
  if (!home?.ok) {
    return (
      <div className="mx-auto grid max-w-md gap-2 py-10 text-center">
        <h1 className="font-display text-2xl font-extrabold">This preview link has expired</h1>
        <p className="text-slate-600">Open a new one from Seller HQ.</p>
      </div>
    );
  }
  return (
    <div className="grid gap-4">
      <p role="status" className="rounded-xl bg-brand-50 px-4 py-2 text-center text-sm font-semibold text-navy-900">
        Preview: this is your draft, not yet published.
      </p>
      <StoreSections sections={home.data.sections} design={store.design} />
    </div>
  );
}
