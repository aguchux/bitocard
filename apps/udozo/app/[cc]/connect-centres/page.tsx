import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connectName, payName } from "@bitocard/api-client/classifieds";
import { marketFor } from "@/lib/api";
import { connectUrl } from "@/lib/connect";
import { byState, centresOf, mapLink, telLink } from "@/lib/connect-centres";

type Props = { params: Promise<{ cc: string }>; searchParams: Promise<{ state?: string }> };

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { cc } = await params;
  const market = await marketFor(cc);
  const filtered = Boolean((await searchParams).state);
  const { centres } = await centresOf(cc);
  return {
    title: `${connectName} Centres in ${market?.name ?? "Udozo"}`,
    description: `${connectName} Centres in ${market?.name ?? "your country"}: offices where you collect items bought with ${payName}, and inspect them before you take them.`,
    alternates: { canonical: `/${cc}/connect-centres` },
    // A filtered list, or one with no centres yet, is not a page for search engines.
    robots: filtered || !centres.length ? { index: false, follow: true } : undefined,
  };
}

/** A market's Udozo Connect Centres, by state: where each is, when it opens and how to reach it. */
export default async function ConnectCentresPage({ params, searchParams }: Props) {
  const { cc } = await params;
  const market = await marketFor(cc);
  // Pages render alongside the layout, so each checks the market itself.
  if (!market) notFound();
  const { ok, centres } = await centresOf(cc);
  const groups = byState(centres);
  const chosen = (await searchParams).state;
  const shown = chosen ? groups.filter(group => group.state.slug === chosen) : groups;
  return (
    <div className="mx-auto grid max-w-4xl gap-5 px-4 pt-5 pb-8">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">
          {connectName} Centres in {market.name}
        </h1>
        <p className="mt-1 text-sm text-navy-600">
          Offices where you collect what you bought with {payName}. The seller sends the item to the centre you chose; you inspect it at the counter, and
          only then give your code.
        </p>
      </div>

      {groups.length > 1 ? (
        <form method="get" className="flex flex-wrap items-end gap-2">
          <label className="grid gap-1 text-sm font-semibold text-navy-900" htmlFor="centre-state">
            Where
            <select id="centre-state" name="state" defaultValue={chosen ?? ""} className="min-h-11 rounded-xl border border-navy-200 bg-white px-3">
              <option value="">Everywhere</option>
              {groups.map(group => (
                <option key={group.state.slug} value={group.state.slug}>
                  {group.state.name} ({group.centres.length})
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="min-h-11 rounded-xl bg-navy-900 px-4 font-semibold text-white">
            Show
          </button>
        </form>
      ) : null}

      {!ok ? (
        <p className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-950" role="status">
          We could not load the centres just now. Try again shortly.
        </p>
      ) : !shown.length ? (
        <p className="rounded-2xl border border-navy-100 bg-white p-4 text-navy-700">{chosen ? "No centres there yet." : `There are no ${connectName} Centres in ${market.name} yet.`}</p>
      ) : (
        shown.map(group => (
          <section key={group.state.slug} aria-labelledby={`state-${group.state.slug}`}>
            <h2 id={`state-${group.state.slug}`} className="text-lg font-extrabold text-navy-900">
              {group.state.name}
            </h2>
            <ul className="mt-3 grid gap-3 sm:grid-cols-2">
              {group.centres.map(centre => {
                const map = mapLink(centre);
                return (
                  <li key={centre.id} className="flex min-w-0 gap-3 rounded-2xl border border-navy-100 bg-white p-4">
                    {centre.photo ? (
                      // eslint-disable-next-line @next/next/no-img-element -- the centre's shopfront from its own address
                      <img src={centre.photo} alt="" width={80} height={80} className="size-20 shrink-0 rounded-xl object-cover" loading="lazy" />
                    ) : null}
                    <div className="min-w-0">
                      <h3 className="font-bold text-navy-900">{centre.name}</h3>
                      <p className="text-sm text-navy-700">
                        {centre.address}
                        {centre.landmark ? ` (${centre.landmark})` : ""}
                      </p>
                      <p className="text-sm text-navy-600">{centre.area.name}</p>
                      <p className="mt-1 text-sm text-navy-700">{centre.hours}</p>
                      <p className="mt-1 flex flex-wrap gap-x-3 text-sm">
                        <a href={telLink(centre.phone)} className="font-semibold text-navy-900 hover:underline">
                          {centre.phone}
                        </a>
                        {map ? (
                          <a href={map} target="_blank" rel="noopener noreferrer" className="font-semibold text-navy-900 hover:underline">
                            Map
                          </a>
                        ) : null}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}

      <p className="text-sm text-navy-600">
        Run an office near buyers and sellers?{" "}
        <a href={connectUrl} className="font-semibold text-navy-900 hover:underline">
          Become a Connect Centre
        </a>
      </p>
    </div>
  );
}
