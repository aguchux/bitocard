import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Notice } from "@/components/notice";
import { centreHome, roleWords, statusWords } from "@/lib/centres";
import { myCentres } from "@/lib/centre-data";

export const metadata: Metadata = { title: "Your centres" };

/** `/centre`: the person's only centre, a choice when they work at several, or their application when they have none. */
export default async function CentresPage() {
  const mine = await myCentres();
  if (!mine.ok) return <Notice title="We could not open your centre" body={mine.message} />;
  const next = centreHome(mine.data.data);
  if ("redirect" in next) redirect(next.redirect);
  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-2xl font-extrabold text-navy-900">Choose a centre</h1>
      <p className="mt-1 text-slate-600">You work at more than one Udozo Connect Centre.</p>
      <ul className="mt-5 grid gap-3">
        {mine.data.data.map(centre => (
          <li key={centre.id}>
            <a href={`/centre/${centre.id}`} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-100 bg-white p-4 shadow-sm hover:border-navy-200">
              <span className="min-w-0">
                <strong className="block truncate text-navy-900">{centre.name}</strong>
                <span className="block truncate text-sm text-slate-600">
                  {centre.number} · {centre.area.name}, {centre.state.name}
                </span>
              </span>
              <span className="shrink-0 text-right text-sm">
                <span className="block font-semibold text-navy-900">{roleWords[centre.role]}</span>
                <span className="block text-slate-500">{statusWords[centre.status]}</span>
              </span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
