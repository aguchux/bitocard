// The centre pages' shared pieces: buttons, fields, a panel and a refusal box.

export const primary = "inline-flex min-h-11 items-center justify-center rounded-xl bg-navy-900 px-5 font-semibold text-white hover:bg-navy-800 disabled:opacity-50";
export const secondary = "inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-200 bg-white px-5 font-semibold text-navy-900 hover:bg-slate-50 disabled:opacity-50";
export const danger = "inline-flex min-h-11 items-center justify-center rounded-xl border border-red-200 bg-white px-5 font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50";
export const input = "mt-1 block min-h-11 w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 text-base text-navy-900 focus:border-brand-500 focus:ring-2 focus:ring-brand-200 focus:outline-none aria-[invalid=true]:border-red-400";
export const label = "block text-sm font-semibold text-navy-900";

export function Panel({ title, tone, children, className = "" }: { title: string; tone?: "warn" | "good"; children: React.ReactNode; className?: string }) {
  const colours = tone === "warn" ? "border-amber-200 bg-amber-50 text-amber-950" : tone === "good" ? "border-emerald-200 bg-emerald-50 text-emerald-950" : "border-slate-100 bg-white text-slate-700";
  return (
    <section className={`rounded-3xl border p-5 shadow-sm sm:p-6 ${colours} ${className}`}>
      <h2 className="text-lg font-extrabold text-navy-900">{title}</h2>
      <div className="mt-2">{children}</div>
    </section>
  );
}

export function Problem({ message }: { message: string | null }) {
  return message ? (
    <p className="rounded-2xl border border-red-200 bg-red-50 p-4 font-semibold text-red-800" role="alert">
      {message}
    </p>
  ) : null;
}
