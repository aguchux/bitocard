import { Notice } from "@/components/notice";
import { CentreNav } from "@/components/centre-nav";
import { roleWords, statusWords } from "@/lib/centres";
import { myCentres, readCentre } from "@/lib/centre-data";

const tones = { active: "bg-emerald-100 text-emerald-900", paused: "bg-amber-100 text-amber-900", closed: "bg-slate-200 text-slate-700" } as const;

/** Every page of one centre: its name, number and status, the person's role, another centre to switch to, and the menu. */
export default async function CentreLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const centre = await readCentre(id);
  if (!centre.ok) return <Notice title="We could not open your centre" body={centre.message} />;
  const mine = await myCentres(`/centre/${id}`);
  const others = mine.ok ? mine.data.data.filter(item => item.id !== id) : [];
  const { data } = centre;
  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-500">
            Centre {data.number} · {roleWords[data.role]}
          </p>
          <h1 className="mt-0.5 truncate text-2xl font-extrabold text-navy-900">{data.name}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-600">
            <span className={`rounded-full px-2.5 py-0.5 font-semibold ${tones[data.status]}`}>{statusWords[data.status]}</span>
            <span className="min-w-0 truncate">
              {data.area.name}, {data.state.name}
            </span>
          </p>
        </div>
        {others.length ? (
          <details className="relative">
            <summary className="min-h-10 cursor-pointer list-none rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-navy-900 hover:bg-slate-50">Switch centre</summary>
            <ul className="absolute right-0 z-10 mt-2 w-64 rounded-2xl border border-slate-100 bg-white p-2 shadow-lg">
              {others.map(item => (
                <li key={item.id}>
                  <a href={`/centre/${item.id}`} className="block rounded-xl px-3 py-2 text-sm hover:bg-slate-50">
                    <strong className="block truncate text-navy-900">{item.name}</strong>
                    <span className="text-slate-500">{item.number}</span>
                  </a>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>
      <div className="mt-5 grid gap-6 md:grid-cols-[12rem_minmax(0,1fr)]">
        <CentreNav id={id} />
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
